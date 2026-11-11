const db = require('../core/db');
const { verifyUser } = require('../core/auth');
const lib = require('../core/library');
const col = require('../core/collections');

const cleanTitle = (v) => String(v ?? '').trim().slice(0, col.TITLE_MAX);

module.exports = async function (fastify) {
  const owned = (id, userId) => db.prepare('SELECT * FROM media_collections WHERE id = ? AND owner_id = ?').get(id, userId);
  const notFound = (reply) => reply.code(404).send({ error: 'Collection not found' });
  const ids = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 5000) : []);

  // Collections of one kind, with counts, total length and a cover to show
  fastify.get('/api/media-collections', { preHandler: verifyUser }, async (request, reply) => {
    const kind = String(request.query.kind || 'videos');
    if (!col.KINDS.includes(kind)) return reply.code(400).send({ error: 'Unknown kind' });
    return db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM media_collection_items i JOIN files f ON f.id = i.file_id WHERE i.collection_id = c.id AND f.trashed_at IS NULL) AS item_count,
        (SELECT COALESCE(SUM(m.duration), 0) FROM media_collection_items i JOIN files f ON f.id = i.file_id LEFT JOIN media_meta m ON m.file_id = f.id
          WHERE i.collection_id = c.id AND f.trashed_at IS NULL) AS total_duration,
        COALESCE(c.cover_file_id, (SELECT i.file_id FROM media_collection_items i JOIN files f ON f.id = i.file_id
          WHERE i.collection_id = c.id AND f.trashed_at IS NULL ORDER BY i.position LIMIT 1)) AS display_cover_id
      FROM media_collections c WHERE c.owner_id = ? AND c.kind = ?
      ORDER BY c.is_favorite DESC, c.title COLLATE NOCASE
    `).all(request.user.id, kind);
  });

  fastify.post('/api/media-collections', { preHandler: verifyUser }, async (request, reply) => {
    const kind = String(request.body?.kind || 'videos');
    const title = cleanTitle(request.body?.title);
    if (!col.KINDS.includes(kind)) return reply.code(400).send({ error: 'Unknown kind' });
    if (!title) return reply.code(400).send({ error: 'Title is required' });
    const id = col.createCollection(request.user.id, kind, title);
    const added = col.addToCollection(id, request.user.id, ids(request.body?.file_ids));
    return { success: true, id, added };
  });

  // { title?, notes?, cover_file_id? }
  fastify.patch('/api/media-collections/:id', { preHandler: verifyUser }, async (request, reply) => {
    const c = owned(request.params.id, request.user.id);
    if (!c) return notFound(reply);
    const b = request.body || {};
    if (b.title !== undefined) {
      const title = cleanTitle(b.title);
      if (!title) return reply.code(400).send({ error: 'Title is required' });
      db.prepare('UPDATE media_collections SET title = ? WHERE id = ?').run(title, c.id);
    }
    if (b.notes !== undefined) db.prepare('UPDATE media_collections SET notes = ? WHERE id = ?').run(String(b.notes ?? '').slice(0, 10000), c.id);
    if (b.cover_file_id !== undefined) {
      const fid = typeof b.cover_file_id === 'string' && b.cover_file_id ? b.cover_file_id : null;
      if (fid && !db.prepare('SELECT 1 FROM files WHERE id = ? AND owner_id = ? AND trashed_at IS NULL').get(fid, request.user.id)) return reply.code(404).send({ error: 'File not found' });
      db.prepare('UPDATE media_collections SET cover_file_id = ? WHERE id = ?').run(fid, c.id);
    }
    return { success: true };
  });

  fastify.patch('/api/media-collections/:id/favorite', { preHandler: verifyUser }, async (request, reply) => {
    const r = db.prepare('UPDATE media_collections SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END WHERE id = ? AND owner_id = ?').run(request.params.id, request.user.id);
    return r.changes ? { success: true } : notFound(reply);
  });

  // Deleting a collection keeps the videos themselves
  fastify.delete('/api/media-collections/:id', { preHandler: verifyUser }, async (request, reply) => {
    if (!owned(request.params.id, request.user.id)) return notFound(reply);
    db.tx(() => {
      db.prepare('DELETE FROM media_collection_items WHERE collection_id = ?').run(request.params.id);
      db.prepare('DELETE FROM media_collections WHERE id = ?').run(request.params.id);
    });
    return { success: true };
  });

  fastify.get('/api/media-collections/:id/items', { preHandler: verifyUser }, async (request, reply) => {
    if (!owned(request.params.id, request.user.id)) return notFound(reply);
    return db.prepare(`
      SELECT f.id, f.filename, f.size_bytes, f.mime_type, f.is_encrypted, f.public_hash, f.created_at, ${lib.META_COLS}
      FROM media_collection_items i JOIN files f ON f.id = i.file_id LEFT JOIN media_meta m ON m.file_id = f.id
      WHERE i.collection_id = ? AND f.owner_id = ? AND f.trashed_at IS NULL
      ORDER BY i.position IS NULL, i.position, i.added_at
    `).all(request.params.id, request.user.id).map(lib.withMeta);
  });

  fastify.post('/api/media-collections/:id/items', { preHandler: verifyUser }, async (request, reply) => {
    if (!owned(request.params.id, request.user.id)) return notFound(reply);
    return { success: true, added: col.addToCollection(request.params.id, request.user.id, ids(request.body?.file_ids)) };
  });

  fastify.post('/api/media-collections/:id/items/remove', { preHandler: verifyUser }, async (request, reply) => {
    if (!owned(request.params.id, request.user.id)) return notFound(reply);
    const del = db.prepare('DELETE FROM media_collection_items WHERE collection_id = ? AND file_id = ?');
    db.tx(() => { for (const id of ids(request.body?.file_ids)) del.run(request.params.id, id); });
    return { success: true };
  });

  // Save a new order: { file_ids: [...] }
  fastify.put('/api/media-collections/:id/order', { preHandler: verifyUser }, async (request, reply) => {
    if (!owned(request.params.id, request.user.id)) return notFound(reply);
    const set = db.prepare('UPDATE media_collection_items SET position = ? WHERE collection_id = ? AND file_id = ?');
    db.tx(() => { ids(request.body?.file_ids).forEach((id, i) => set.run(i, request.params.id, id)); });
    return { success: true };
  });
};
