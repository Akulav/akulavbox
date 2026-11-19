const db = require('../core/db');
const fs = require('fs');
const { verifyUser } = require('../core/auth');
const lib = require('../core/library');
const thumbs = require('../core/thumbs');
const store = require('../core/storage');
const { serveFile } = require('../core/serve');

const { MASTER_KEY, diskPathOf } = store;

// Opening files: the viewer stream, thumbnails (made by sharp, or by the browser without it),
// and natural image sizes measured in the browser.

module.exports = async function (fastify) {
  // GET  /api/files/:id/thumb?w=240|480|960         cached preview (made by sharp if installed)
  //      &cached=1                                   only answer from cache; 404 { source } otherwise,
  //                                                  so the browser knows which image to make it from
  // PUT  /api/files/:id/thumb?w=…&ow=…&oh=…          the browser uploads a thumbnail it made
  fastify.get('/api/thumbs/status', { preHandler: verifyUser }, async () => ({ server: thumbs.available() }));

  const resolveThumbSource = (fileId, userId) => {
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(fileId, userId);
    if (!file) return null;
    if (lib.categoryOf(file.filename, file.mime_type) === 'image') return file;
    const meta = db.prepare('SELECT thumb_file_id FROM media_meta WHERE file_id = ?').get(file.id);
    return (meta && meta.thumb_file_id && db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(meta.thumb_file_id, userId)) || null;
  };

  fastify.get('/api/files/:id/thumb', { preHandler: verifyUser }, async (request, reply) => {
    const file = resolveThumbSource(request.params.id, request.user.id);
    if (!file) return reply.code(404).send({ error: 'No preview' });
    const width = thumbs.pickWidth(request.query.w);
    const filePath = diskPathOf(file);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'Missing on disk' });

    const onlyCached = request.query.cached === '1';
    const hit = onlyCached ? await thumbs.cached(file, width, MASTER_KEY) : await thumbs.get(file, filePath, width, MASTER_KEY);
    if (!hit) {
      if (onlyCached) {
        reply.header('Cache-Control', 'no-store');
        return reply.code(404).send({ error: 'Not generated yet', source: file.id, width });
      }
      // no sharp, or it couldn't decode the image (e.g. HEIC): send the original so plain <img> tags still work
      return serveFile(request, reply, file);
    }
    reply.header('Content-Type', hit.type);
    reply.header('Content-Length', hit.buf.length);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.send(hit.buf);
  });

  fastify.register(async (scope) => {
    scope.addContentTypeParser(['image/webp', 'image/jpeg', 'image/png'], { parseAs: 'buffer', bodyLimit: 3 * 1024 * 1024 }, (req, body, done) => done(null, body));
    scope.put('/api/files/:id/thumb', { preHandler: verifyUser }, async (request, reply) => {
      const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
      if (!file || lib.categoryOf(file.filename, file.mime_type) !== 'image') return reply.code(404).send({ error: 'Image not found' });
      const buf = request.body;
      if (!Buffer.isBuffer(buf) || buf.length < 32) return reply.code(400).send({ error: 'Empty thumbnail' });
      const width = thumbs.pickWidth(request.query.w);
      const ow = parseInt(request.query.ow, 10), oh = parseInt(request.query.oh, 10);
      await thumbs.store(file, width, buf, MASTER_KEY, ow > 0 && oh > 0 ? { width: ow, height: oh } : null);
      return { success: true };
    });
  });

  // Remember natural sizes measured in the browser: { items: [{ id, w, h }] }
  fastify.post('/api/files/dims', { preHandler: verifyUser }, async (request) => {
    const items = Array.isArray(request.body?.items) ? request.body.items.slice(0, 500) : [];
    const owned = db.prepare('SELECT 1 FROM files WHERE id = ? AND owner_id = ?');
    let n = 0;
    for (const it of items) {
      const w = parseInt(it.w, 10), h = parseInt(it.h, 10);
      if (w > 0 && h > 0 && owned.get(it.id, request.user.id)) { thumbs.saveDims(it.id, request.user.id, w, h); n++; }
    }
    return { success: true, saved: n };
  });

  fastify.get('/api/files/:id/view', { preHandler: verifyUser }, async (request, reply) => {
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
    if (!file) return reply.code(404).send({ error: 'File not found' });
    if (!fs.existsSync(diskPathOf(file))) return reply.code(404).send({ error: 'Missing on disk' });
    return serveFile(request, reply, file);
  });
};
