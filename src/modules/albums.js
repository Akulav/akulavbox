const db = require('../core/db');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ZipArchive } = require('archiver');
const MASTER_KEY = Buffer.from(process.env.MASTER_KEY, 'utf-8');
const { verifyUser } = require('../core/auth');
const lib = require('../core/library');

// --- DATABASE MIGRATIONS ---
try { db.exec('ALTER TABLE collections ADD COLUMN notes TEXT DEFAULT ""'); } catch (e) { }
try { db.exec('ALTER TABLE albums ADD COLUMN notes TEXT DEFAULT ""'); } catch (e) { }
try { db.exec('ALTER TABLE collections ADD COLUMN is_favorite INTEGER DEFAULT 0'); } catch (e) { }
try { db.exec('ALTER TABLE albums ADD COLUMN is_favorite INTEGER DEFAULT 0'); } catch (e) { }

module.exports = async function (fastify, opts) {
  const ownsAlbum = (albumId, userId) => !!db.prepare('SELECT 1 FROM albums WHERE id = ? AND owner_id = ?').get(albumId, userId);

  
  // --- DOWNLOAD ZIPS (COLLECTIONS & ALBUMS) ---
  fastify.get('/api/collections/:id/download', { preHandler: verifyUser }, async (request, reply) => {
    const collection = db.prepare('SELECT title FROM collections WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
    if (!collection) return reply.code(404).send('Collection not found');

    const images = db.prepare(`
      SELECT DISTINCT f.* FROM files f
      JOIN album_images ai ON f.id = ai.file_id
      JOIN albums a ON ai.album_id = a.id
      WHERE a.collection_id = ? AND a.owner_id = ?
    `).all(request.params.id, request.user.id);

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(collection.title)}.zip`);

    const archive = new ZipArchive({ zlib: { level: 5 } });
    reply.send(archive); 

    for (const file of images) {
      const filePath = path.join(process.cwd(), 'storage', 'users', request.user.id, file.is_encrypted ? `${file.id}.enc` : `${file.id}.plain`);
      if (!fs.existsSync(filePath)) continue;

      if (file.is_encrypted) {
        const decipher = crypto.createDecipheriv('aes-256-ctr', MASTER_KEY, Buffer.from(file.iv_hex, 'hex'));
        archive.append(fs.createReadStream(filePath).pipe(decipher), { name: file.filename });
      } else {
        archive.append(fs.createReadStream(filePath), { name: file.filename });
      }
    }
    await archive.finalize();
  });

  fastify.get('/api/albums/:id/download', { preHandler: verifyUser }, async (request, reply) => {
    const album = db.prepare('SELECT title FROM albums WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
    if (!album) return reply.code(404).send('Album not found');

    const images = db.prepare(`
      SELECT f.* FROM files f
      JOIN album_images ai ON f.id = ai.file_id
      WHERE ai.album_id = ? AND f.owner_id = ?
    `).all(request.params.id, request.user.id);

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(album.title)}.zip`);

    const archive = new ZipArchive({ zlib: { level: 5 } });
    reply.send(archive);

    for (const file of images) {
      const filePath = path.join(process.cwd(), 'storage', 'users', request.user.id, file.is_encrypted ? `${file.id}.enc` : `${file.id}.plain`);
      if (!fs.existsSync(filePath)) continue;

      if (file.is_encrypted) {
        const decipher = crypto.createDecipheriv('aes-256-ctr', MASTER_KEY, Buffer.from(file.iv_hex, 'hex'));
        archive.append(fs.createReadStream(filePath).pipe(decipher), { name: file.filename });
      } else {
        archive.append(fs.createReadStream(filePath), { name: file.filename });
      }
    }
    await archive.finalize();
  });

  // --- RENAME COLLECTIONS & ALBUMS ---
  fastify.patch('/api/collections/:id/title', { preHandler: verifyUser }, async (request, reply) => {
    db.prepare('UPDATE collections SET title = ? WHERE id = ? AND owner_id = ?').run(request.body.title, request.params.id, request.user.id);
    return { success: true };
  });

  fastify.patch('/api/albums/:id/title', { preHandler: verifyUser }, async (request, reply) => {
    db.prepare('UPDATE albums SET title = ? WHERE id = ? AND owner_id = ?').run(request.body.title, request.params.id, request.user.id);
    return { success: true };
  });

  // --- VIEW ALL IMAGES IN A COLLECTION ---
  fastify.get('/api/collections/:colId/images', { preHandler: verifyUser }, async (request, reply) => {
    return db.prepare(`
      SELECT DISTINCT f.id, f.filename, f.size_bytes, f.mime_type, f.is_encrypted, f.public_hash, f.created_at, m.width, m.height
      FROM files f
      LEFT JOIN media_meta m ON m.file_id = f.id
      JOIN album_images ai ON f.id = ai.file_id
      JOIN albums a ON ai.album_id = a.id
      WHERE a.collection_id = ? AND a.owner_id = ?
    `).all(request.params.colId, request.user.id);
  });

  // --- COLLECTIONS ---
  fastify.get('/api/collections', { preHandler: verifyUser }, async (request, reply) => {
    return db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM album_images ai JOIN albums a ON a.id = ai.album_id WHERE a.collection_id = c.id) as image_count,
        COALESCE(c.cover_file_id, (
          SELECT ai.file_id FROM albums a 
          JOIN album_images ai ON a.id = ai.album_id 
          WHERE a.collection_id = c.id LIMIT 1
        )) as display_cover_id
      FROM collections c WHERE c.owner_id = ?
    `).all(request.user.id);
  });

  fastify.post('/api/collections', { preHandler: verifyUser }, async (request, reply) => {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO collections (id, owner_id, title) VALUES (?, ?, ?)').run(id, request.user.id, request.body.title);
    return { success: true, id };
  });

  // --- UTILITY: MIGRATE IMAGES ---
  fastify.post('/api/albums/migrate', { preHandler: verifyUser }, async (request, reply) => {
    const folder = { id: lib.ensureSystemFolder(request.user.id, 'gallery') };
    const info = db.prepare(`
      UPDATE files SET folder_id = ? 
      WHERE owner_id = ? AND folder_id IS NULL AND id IN (SELECT file_id FROM album_images)
    `).run(folder.id, request.user.id);
    return { success: true, moved: info.changes };
  });

  fastify.delete('/api/collections/:id', { preHandler: verifyUser }, async (request, reply) => {
    const owned = db.prepare('SELECT 1 FROM collections WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
    if (!owned) return reply.code(404).send({ error: 'Collection not found' });
    const albums = db.prepare('SELECT id FROM albums WHERE collection_id = ?').all(request.params.id);
    albums.forEach(a => db.prepare('DELETE FROM album_images WHERE album_id = ?').run(a.id));
    db.prepare('DELETE FROM albums WHERE collection_id = ?').run(request.params.id);
    db.prepare('DELETE FROM collections WHERE id = ?').run(request.params.id);
    return { success: true };
  });

  fastify.patch('/api/collections/:id/notes', { preHandler: verifyUser }, async (request, reply) => {
    db.prepare('UPDATE collections SET notes = ? WHERE id = ? AND owner_id = ?').run(request.body.notes, request.params.id, request.user.id);
    return { success: true };
  });

  fastify.patch('/api/collections/:id/favorite', { preHandler: verifyUser }, async (request, reply) => {
    db.prepare('UPDATE collections SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END WHERE id = ? AND owner_id = ?').run(request.params.id, request.user.id);
    return { success: true };
  });

  // --- MINI-ALBUMS ---
  fastify.get('/api/collections/:colId/albums', { preHandler: verifyUser }, async (request, reply) => {
    return db.prepare(`
      SELECT a.*, 
        (SELECT COUNT(*) FROM album_images WHERE album_id = a.id) as image_count,
        COALESCE(a.cover_file_id, (SELECT file_id FROM album_images WHERE album_id = a.id LIMIT 1)) as display_cover_id
      FROM albums a WHERE a.collection_id = ? AND a.owner_id = ?
    `).all(request.params.colId, request.user.id);
  });

  fastify.post('/api/collections/:colId/albums', { preHandler: verifyUser }, async (request, reply) => {
    const owned = db.prepare('SELECT 1 FROM collections WHERE id = ? AND owner_id = ?').get(request.params.colId, request.user.id);
    if (!owned) return reply.code(404).send({ error: 'Collection not found' });
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO albums (id, owner_id, collection_id, title) VALUES (?, ?, ?, ?)').run(
      id, request.user.id, request.params.colId, request.body.title
    );
    return { success: true, id };
  });

  fastify.delete('/api/albums/:id', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsAlbum(request.params.id, request.user.id)) return reply.code(404).send({ error: 'Album not found' });
    db.prepare('DELETE FROM album_images WHERE album_id = ?').run(request.params.id);
    db.prepare('DELETE FROM albums WHERE id = ?').run(request.params.id);
    return { success: true };
  });

  fastify.patch('/api/albums/:id/notes', { preHandler: verifyUser }, async (request, reply) => {
    db.prepare('UPDATE albums SET notes = ? WHERE id = ? AND owner_id = ?').run(request.body.notes, request.params.id, request.user.id);
    return { success: true };
  });

  fastify.patch('/api/albums/:id/favorite', { preHandler: verifyUser }, async (request, reply) => {
    db.prepare('UPDATE albums SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END WHERE id = ? AND owner_id = ?').run(request.params.id, request.user.id);
    return { success: true };
  });

  // --- IMAGES INSIDE ALBUMS ---
  fastify.get('/api/albums/:id/images', { preHandler: verifyUser }, async (request, reply) => {
    return db.prepare(`
      SELECT f.id, f.filename, f.size_bytes, f.mime_type, f.is_encrypted, f.public_hash, f.created_at, m.width, m.height
      FROM files f LEFT JOIN media_meta m ON m.file_id = f.id JOIN album_images ai ON f.id = ai.file_id WHERE ai.album_id = ? AND f.owner_id = ?
    `).all(request.params.id, request.user.id);
  });

  fastify.post('/api/albums/:id/images', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsAlbum(request.params.id, request.user.id)) return reply.code(404).send({ error: 'Album not found' });
    const file = db.prepare('SELECT 1 FROM files WHERE id = ? AND owner_id = ?').get(request.body?.file_id, request.user.id);
    if (!file) return reply.code(404).send({ error: 'File not found' });
    db.prepare('INSERT OR IGNORE INTO album_images (album_id, file_id) VALUES (?, ?)').run(request.params.id, request.body.file_id);
    return { success: true };
  });

  fastify.delete('/api/albums/:id/images/:fileId', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsAlbum(request.params.id, request.user.id)) return reply.code(404).send({ error: 'Album not found' });
    db.prepare('DELETE FROM album_images WHERE album_id = ? AND file_id = ?').run(request.params.id, request.params.fileId);
    return { success: true };
  });

  fastify.patch('/api/albums/:id/cover', { preHandler: verifyUser }, async (request, reply) => {
    db.prepare('UPDATE albums SET cover_file_id = ? WHERE id = ? AND owner_id = ?').run(request.body.file_id, request.params.id, request.user.id);
    return { success: true };
  });
};