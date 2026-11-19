const fs = require('fs');
const { guessMime, fileCsp } = require('./mime');
const store = require('./storage');

// Streaming a stored file to the browser: decrypted on the fly, with Range requests (video
// seeking), an ETag, and a sandbox CSP so an uploaded file can never run script on this origin.

/** Send `file` (a files row). ?download=1 makes it an attachment. */
function serveFile(request, reply, file) {
  const filePath = store.diskPathOf(file);
  const mime = guessMime(file.filename, file.mime_type);
  const stat = fs.statSync(filePath);
  const totalSize = stat.size;
  const download = request.query.download === '1' || request.query.download === 'true';

  let start = 0;
  let end = totalSize - 1;
  const range = request.headers.range;

  if (range && totalSize > 0) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === '' && m[2] === '')) {
      reply.header('Content-Range', `bytes */${totalSize}`);
      return reply.code(416).send();
    }
    if (m[1] === '') {
      // Suffix range: last N bytes
      start = Math.max(0, totalSize - parseInt(m[2], 10));
    } else {
      start = parseInt(m[1], 10);
      end = m[2] ? Math.min(parseInt(m[2], 10), totalSize - 1) : totalSize - 1;
    }
    if (start >= totalSize || start > end) {
      reply.header('Content-Range', `bytes */${totalSize}`);
      return reply.code(416).send();
    }
    reply.code(206);
    reply.header('Content-Range', `bytes ${start}-${end}/${totalSize}`);
  }

  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Length', totalSize === 0 ? 0 : (end - start) + 1);
  reply.header('Content-Type', mime);
  reply.header('X-Content-Type-Options', 'nosniff');
  // Revalidate every time: files can be edited in place, so a long max-age would show stale content
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  reply.header('ETag', etag);
  reply.header('Cache-Control', 'private, no-cache');
  if (!range && request.headers['if-none-match'] === etag) { reply.removeHeader('Content-Length'); return reply.code(304).send(); }
  // Uploaded files must never run scripts on our origin (that would expose the login token)
  const csp = fileCsp(mime);
  if (csp) reply.header('Content-Security-Policy', csp);

  const safeName = encodeURIComponent(file.filename);
  reply.header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${safeName}`);

  if (totalSize === 0) return reply.send('');
  return reply.send(store.readRange(file, start, end));
};

/** A file or folder name: no path separators or control characters, at most 255 characters */
const cleanName = (s) => String(s ?? '').trim().replace(/[\\/]/g, '_').replace(/[\u0000-\u001f]/g, '').slice(0, 255);

module.exports = { serveFile, cleanName };
