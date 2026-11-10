const db = require('../core/db');
const crypto = require('crypto');
const { ZipArchive } = require('archiver');
const { verifyUser } = require('../core/auth');
const lib = require('../core/library');
const store = require('../core/storage');

const TITLE_MAX = 200;
const NOTES_MAX = 10000;
const cleanTitle = (v) => String(v ?? '').trim().slice(0, TITLE_MAX);

const IMG_COLS = 'f.id, f.filename, f.size_bytes, f.mime_type, f.is_encrypted, f.public_hash, f.created_at, m.width, m.height';

module.exports = async function (fastify) {
  const ownsAlbum = (albumId, userId) => !!db.prepare('SELECT 1 FROM albums WHERE id = ? AND owner_id = ?').get(albumId, userId);
  const ownsCollection = (id, userId) => !!db.prepare('SELECT 1 FROM collections WHERE id = ? AND owner_id = ?').get(id, userId);
  const ownsImage = (id, userId) => !!id && !!db.prepare('SELECT 1 FROM files WHERE id = ? AND owner_id = ? AND trashed_at IS NULL').get(id, userId);

  function sendZip(reply, title, images) {
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(title)}.zip`);
    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.on('error', (err) => fastify.log.error(err));
    reply.send(archive);
    store.appendToZip(archive, images.map(f => ({ file: f, name: f.filename })));
    archive.finalize();
    return reply;
  }

  // --- DOWNLOAD ZIPS (COLLECTIONS & ALBUMS) ---
  fastify.get('/api/collections/:id/download', { preHandler: verifyUser }, async (request, reply) => {
    const collection = db.prepare('SELECT title FROM collections WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
    if (!collection) return reply.code(404).send({ error: 'Collection not found' });
    const images = db.prepare(`
      SELECT DISTINCT f.* FROM files f
      JOIN album_images ai ON f.id = ai.file_id
      JOIN albums a ON ai.album_id = a.id
      WHERE a.collection_id = ? AND a.owner_id = ? AND f.trashed_at IS NULL
    `).all(request.params.id, request.user.id);
    return sendZip(reply, collection.title, images);
  });

  fastify.get('/api/albums/:id/download', { preHandler: verifyUser }, async (request, reply) => {
    const album = db.prepare('SELECT title FROM albums WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
    if (!album) return reply.code(404).send({ error: 'Album not found' });
    const images = db.prepare(`
      SELECT f.* FROM files f JOIN album_images ai ON f.id = ai.file_id
      WHERE ai.album_id = ? AND f.owner_id = ? AND f.trashed_at IS NULL ORDER BY ai.rowid
    `).all(request.params.id, request.user.id);
    return sendZip(reply, album.title, images);
  });

  // --- RENAME COLLECTIONS & ALBUMS ---
  const rename = (table) => async (request, reply) => {
    const title = cleanTitle(request.body?.title);
    if (!title) return reply.code(400).send({ error: 'Title is required' });
    const r = db.prepare(`UPDATE ${table} SET title = ? WHERE id = ? AND owner_id = ?`).run(title, request.params.id, request.user.id);
    return r.changes ? { success: true } : reply.code(404).send({ error: 'Not found' });
  };
  fastify.patch('/api/collections/:id/title', { preHandler: verifyUser }, rename('collections'));
  fastify.patch('/api/albums/:id/title', { preHandler: verifyUser }, rename('albums'));

  // --- VIEW ALL IMAGES IN A COLLECTION ---
  fastify.get('/api/collections/:colId/images', { preHandler: verifyUser }, async (request) => {
    return db.prepare(`
      SELECT ${IMG_COLS}, MIN(ai.rowid) AS ord
      FROM files f
      LEFT JOIN media_meta m ON m.file_id = f.id
      JOIN album_images ai ON f.id = ai.file_id
      JOIN albums a ON ai.album_id = a.id
      WHERE a.collection_id = ? AND a.owner_id = ? AND f.trashed_at IS NULL
      GROUP BY f.id ORDER BY ord
    `).all(request.params.colId, request.user.id);
  });

  // --- COLLECTIONS ---
  fastify.get('/api/collections', { preHandler: verifyUser }, async (request) => {
    return db.prepare(`
      SELECT c.*,
        (SELECT COUNT(DISTINCT ai.file_id) FROM album_images ai JOIN albums a ON a.id = ai.album_id JOIN files f ON f.id = ai.file_id
          WHERE a.collection_id = c.id AND f.trashed_at IS NULL) AS image_count,
        (SELECT COUNT(*) FROM albums a WHERE a.collection_id = c.id) AS album_count,
        COALESCE(c.cover_file_id, (
          SELECT ai.file_id FROM albums a
          JOIN album_images ai ON a.id = ai.album_id JOIN files f ON f.id = ai.file_id
          WHERE a.collection_id = c.id AND f.trashed_at IS NULL LIMIT 1
        )) AS display_cover_id
      FROM collections c WHERE c.owner_id = ?
    `).all(request.user.id);
  });

  fastify.post('/api/collections', { preHandler: verifyUser }, async (request, reply) => {
    const title = cleanTitle(request.body?.title);
    if (!title) return reply.code(400).send({ error: 'Title is required' });
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO collections (id, owner_id, title) VALUES (?, ?, ?)').run(id, request.user.id, title);
    return { success: true, id };
  });

  // --- UTILITY: MIGRATE IMAGES ---
  fastify.post('/api/albums/migrate', { preHandler: verifyUser }, async (request) => {
    const folderId = lib.ensureSystemFolder(request.user.id, 'gallery');
    const info = db.prepare(`
      UPDATE files SET folder_id = ?
      WHERE owner_id = ? AND folder_id IS NULL AND trashed_at IS NULL AND id IN (SELECT file_id FROM album_images)
    `).run(folderId, request.user.id);
    return { success: true, moved: info.changes };
  });

  fastify.delete('/api/collections/:id', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsCollection(request.params.id, request.user.id)) return reply.code(404).send({ error: 'Collection not found' });
    db.tx(() => {
      db.prepare('DELETE FROM album_images WHERE album_id IN (SELECT id FROM albums WHERE collection_id = ?)').run(request.params.id);
      db.prepare('DELETE FROM albums WHERE collection_id = ?').run(request.params.id);
      db.prepare('DELETE FROM collections WHERE id = ?').run(request.params.id);
    });
    return { success: true };
  });

  const notes = (table) => async (request, reply) => {
    const text = String(request.body?.notes ?? '').slice(0, NOTES_MAX);
    const r = db.prepare(`UPDATE ${table} SET notes = ? WHERE id = ? AND owner_id = ?`).run(text, request.params.id, request.user.id);
    return r.changes ? { success: true } : reply.code(404).send({ error: 'Not found' });
  };
  fastify.patch('/api/collections/:id/notes', { preHandler: verifyUser }, notes('collections'));
  fastify.patch('/api/albums/:id/notes', { preHandler: verifyUser }, notes('albums'));

  const favorite = (table) => async (request) => {
    db.prepare(`UPDATE ${table} SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END WHERE id = ? AND owner_id = ?`).run(request.params.id, request.user.id);
    return { success: true };
  };
  fastify.patch('/api/collections/:id/favorite', { preHandler: verifyUser }, favorite('collections'));
  fastify.patch('/api/albums/:id/favorite', { preHandler: verifyUser }, favorite('albums'));

  // --- MINI-ALBUMS ---
  fastify.get('/api/collections/:colId/albums', { preHandler: verifyUser }, async (request) => {
    return db.prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM album_images ai JOIN files f ON f.id = ai.file_id WHERE ai.album_id = a.id AND f.trashed_at IS NULL) AS image_count,
        COALESCE(a.cover_file_id, (SELECT ai.file_id FROM album_images ai JOIN files f ON f.id = ai.file_id
          WHERE ai.album_id = a.id AND f.trashed_at IS NULL ORDER BY ai.rowid LIMIT 1)) AS display_cover_id
      FROM albums a WHERE a.collection_id = ? AND a.owner_id = ?
    `).all(request.params.colId, request.user.id);
  });

  fastify.post('/api/collections/:colId/albums', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsCollection(request.params.colId, request.user.id)) return reply.code(404).send({ error: 'Collection not found' });
    const title = cleanTitle(request.body?.title);
    if (!title) return reply.code(400).send({ error: 'Title is required' });
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO albums (id, owner_id, collection_id, title) VALUES (?, ?, ?, ?)').run(id, request.user.id, request.params.colId, title);
    return { success: true, id };
  });

  fastify.delete('/api/albums/:id', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsAlbum(request.params.id, request.user.id)) return reply.code(404).send({ error: 'Album not found' });
    db.tx(() => {
      db.prepare('DELETE FROM album_images WHERE album_id = ?').run(request.params.id);
      db.prepare('DELETE FROM albums WHERE id = ?').run(request.params.id);
    });
    return { success: true };
  });

  // --- IMAGES INSIDE ALBUMS ---
  fastify.get('/api/albums/:id/images', { preHandler: verifyUser }, async (request) => {
    return db.prepare(`
      SELECT ${IMG_COLS}
      FROM files f LEFT JOIN media_meta m ON m.file_id = f.id JOIN album_images ai ON f.id = ai.file_id
      WHERE ai.album_id = ? AND f.owner_id = ? AND f.trashed_at IS NULL ORDER BY ai.rowid
    `).all(request.params.id, request.user.id);
  });

  const addImages = (albumId, userId, ids) => {
    const ins = db.prepare("INSERT OR IGNORE INTO album_images (album_id, file_id, added_at) VALUES (?, ?, datetime('now'))");
    let n = 0;
    db.tx(() => { for (const id of ids.slice(0, 5000)) if (ownsImage(id, userId) && ins.run(albumId, id).changes) n++; });
    return n;
  };

  fastify.post('/api/albums/:id/images', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsAlbum(request.params.id, request.user.id)) return reply.code(404).send({ error: 'Album not found' });
    if (!ownsImage(request.body?.file_id, request.user.id)) return reply.code(404).send({ error: 'File not found' });
    addImages(request.params.id, request.user.id, [request.body.file_id]);
    return { success: true };
  });

  // Many at once: { file_ids: [...] }
  fastify.post('/api/albums/:id/images/bulk', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsAlbum(request.params.id, request.user.id)) return reply.code(404).send({ error: 'Album not found' });
    const ids = Array.isArray(request.body?.file_ids) ? request.body.file_ids : [];
    return { success: true, added: addImages(request.params.id, request.user.id, ids) };
  });

  fastify.post('/api/albums/:id/images/remove', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsAlbum(request.params.id, request.user.id)) return reply.code(404).send({ error: 'Album not found' });
    const ids = Array.isArray(request.body?.file_ids) ? request.body.file_ids : [];
    const del = db.prepare('DELETE FROM album_images WHERE album_id = ? AND file_id = ?');
    db.tx(() => { for (const id of ids.slice(0, 5000)) del.run(request.params.id, id); });
    return { success: true };
  });

  fastify.delete('/api/albums/:id/images/:fileId', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsAlbum(request.params.id, request.user.id)) return reply.code(404).send({ error: 'Album not found' });
    db.prepare('DELETE FROM album_images WHERE album_id = ? AND file_id = ?').run(request.params.id, request.params.fileId);
    return { success: true };
  });

  fastify.patch('/api/albums/:id/cover', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsAlbum(request.params.id, request.user.id)) return reply.code(404).send({ error: 'Album not found' });
    if (!ownsImage(request.body?.file_id, request.user.id)) return reply.code(404).send({ error: 'Image not found' });
    db.prepare('UPDATE albums SET cover_file_id = ? WHERE id = ? AND owner_id = ?').run(request.body.file_id, request.params.id, request.user.id);
    return { success: true };
  });

  fastify.patch('/api/collections/:id/cover', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsCollection(request.params.id, request.user.id)) return reply.code(404).send({ error: 'Collection not found' });
    const fileId = request.body?.file_id || null;
    if (fileId && !ownsImage(fileId, request.user.id)) return reply.code(404).send({ error: 'Image not found' });
    db.prepare('UPDATE collections SET cover_file_id = ? WHERE id = ? AND owner_id = ?').run(fileId, request.params.id, request.user.id);
    return { success: true };
  });
};
