'use strict';
// Creating a work from an upload: shared by the upload form and the API for Koma.
const path = require('node:path');
const crypto = require('node:crypto');
const { removeFiles, ARCHIVE_FILE } = require('./uploads');
const { rateLimiter } = require('./auth');

const VISIBILITY = new Set(['private', 'unlisted', 'public']);
const str = (v, max) => (typeof v === 'string' ? v : '').replace(/\r\n/g, '\n').trim().slice(0, max);
const newId = () => crypto.randomBytes(9).toString('base64url');
const fmtSize = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1).replace(/\.0$/, '')} GB` : `${Math.round(b / 1024 ** 2)} MB`);
const uploadLimit = rateLimiter({ windowMs: 60 * 60 * 1000, max: 30 });

/**
 * Validate an upload, create the work row and queue its processing.
 * Returns { id } or { error, status, values } (the files are removed on an error).
 */
function startUpload(ctx, user, { body = {}, files: parsed = {} }) {
  const files = parsed.files || [];
  const cover = parsed.cover?.[0] || null;
  const values = { title: str(body.title, 120), description: str(body.description, 4000), visibility: VISIBILITY.has(body.visibility) ? body.visibility : 'private' };
  const fail = (error, status = 400) => {
    removeFiles(parsed);
    return { error, status, values };
  };
  if (!uploadLimit.hit(`u:${user.id}`)) return fail('You’ve uploaded a lot in the last hour. Try again later.', 429);
  if (!files.length) return fail('Choose a .zip, .cbz or some images.');
  const archives = files.filter((f) => ARCHIVE_FILE.test(f.originalname));
  if (archives.length > 1 || (archives.length && archives.length !== files.length)) return fail('Upload one archive at a time, or only images.');
  // the optimised strips end up about as large as the upload, so that is what has to fit
  const room = ctx.roomOf(user);
  const incoming = files.reduce((n, f) => n + (f.size || 0), 0) + (cover?.size || 0);
  if (incoming > room) return fail(`That doesn’t fit in your storage (${fmtSize(room)} left, shared by all your apps). Delete something or ask the admin for more room.`, 413);
  const id = newId();
  const fallbackTitle = path.basename(files[0].originalname, path.extname(files[0].originalname)).replace(/[-_]+/g, ' ').trim().slice(0, 120) || 'Untitled';
  const now = Date.now();
  ctx.db.run('INSERT INTO works (id, user_id, title, description, visibility, status, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, user.id, values.title || (files.length > 1 && !archives.length ? 'Untitled' : fallbackTitle), values.description, values.visibility, 'processing', now, now);
  ctx.ingest.enqueue(id, { files, cover, autoTitle: !values.title });
  return { id };
}

module.exports = { startUpload, VISIBILITY, str };
