'use strict';
// Multipart forms written straight to disk (uploads can be a few GB): the text fields become
// `body`, the files land in tmp/ as { path, originalname, size, fieldname }. Files whose name
// doesn't look like what the field takes (images, or a zip/cbz) are skipped.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');

const IMAGE_FILE = /\.(jpe?g|png|webp|avif|gif|bmp|tiff?)$/i;
const ARCHIVE_FILE = /\.(zip|cbz)$/i;

class UploadError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const newName = (original) => `${crypto.randomBytes(9).toString('base64url')}${path.extname(original).toLowerCase().slice(0, 6)}`;
const accepts = { files: (n) => IMAGE_FILE.test(n) || ARCHIVE_FILE.test(n), cover: (n) => IMAGE_FILE.test(n) };

/** Removes every file of a parsed form (after a refusal, or once the work is processed) */
function removeFiles(files) {
  for (const f of Object.values(files || {}).flat()) fs.rm(f.path, { force: true }, () => {});
}

/**
 * Read a multipart request. `fields` says how many files each field may carry, e.g. { files: 3000, cover: 1 }.
 * Throws UploadError (with a status) for files that are too big or forms that can't be read.
 */
async function readForm(req, { tmpDir, fields, maxMb }) {
  // field names come from the client: no prototype, so "__proto__" is just a key
  const body = Object.create(null);
  const files = Object.fromEntries(Object.keys(fields).map((k) => [k, []]));
  try {
    for await (const part of req.parts()) {
      if (part.type !== 'file') {
        body[part.fieldname] = part.value;
        continue;
      }
      const field = part.fieldname;
      if (!files[field] || !part.filename || !accepts[field]?.(part.filename) || files[field].length >= fields[field]) {
        part.file.resume();
        continue;
      }
      const dest = path.join(tmpDir, newName(part.filename));
      const entry = { path: dest, originalname: path.basename(part.filename), size: 0, fieldname: field };
      files[field].push(entry);
      await pipeline(part.file, fs.createWriteStream(dest));
      if (part.file.truncated) throw new UploadError(`That file is larger than ${maxMb} MB.`, 413);
      entry.size = fs.statSync(dest).size;
    }
    return { body, files };
  } catch (e) {
    removeFiles(files);
    if (e instanceof UploadError) throw e;
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') throw new UploadError(`That file is larger than ${maxMb} MB.`, 413);
    if (e.code === 'FST_FILES_LIMIT') throw new UploadError('Too many files at once — zip them instead.');
    throw new UploadError('The upload could not be read.');
  }
}

module.exports = { readForm, removeFiles, UploadError, IMAGE_FILE, ARCHIVE_FILE };
