const db = require('../core/db');
const crypto = require('crypto');
const { verifyUser } = require('../core/auth');
const lib = require('../core/library');

module.exports = async function (fastify, opts) {

  const ownsPlaylist = (id, userId) => !!db.prepare('SELECT 1 FROM playlists WHERE id = ? AND owner_id = ?').get(id, userId);
  const ownsFile = (id, userId) => !!db.prepare('SELECT 1 FROM files WHERE id = ? AND owner_id = ?').get(id, userId);
  const notFound = (reply) => reply.code(404).send({ error: 'Playlist not found' });

  // --- MUSIC & PLAYLISTS SYSTEM ---
  fastify.get('/api/music/songs', { preHandler: verifyUser }, async (request, reply) => {
    const musicFolder = { id: lib.ensureSystemFolder(request.user.id, 'music') };

    const songs = db.prepare(`
      SELECT f.id, f.filename, f.size_bytes, f.mime_type, f.is_encrypted, f.public_hash, f.created_at, sc.cover_file_id, ${lib.META_COLS}
      FROM files f
      LEFT JOIN song_covers sc ON f.id = sc.file_id
      LEFT JOIN media_meta m ON m.file_id = f.id
      WHERE f.folder_id = ? AND f.owner_id = ?
      ORDER BY f.filename COLLATE NOCASE
    `).all(musicFolder.id, request.user.id).map(lib.withMeta);

    return { songs, folderId: musicFolder.id };
  });

  fastify.post('/api/music/playlists', { preHandler: verifyUser }, async (request, reply) => {
    const title = (request.body?.title || '').trim();
    if (!title) return reply.code(400).send({ error: 'Title is required' });
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO playlists (id, owner_id, title) VALUES (?, ?, ?)').run(id, request.user.id, title);
    return { success: true, id };
  });

  fastify.get('/api/music/playlists', { preHandler: verifyUser }, async (request, reply) => {
    return db.prepare(`
      SELECT p.*, (SELECT COUNT(*) FROM playlist_songs ps JOIN files f ON f.id = ps.file_id WHERE ps.playlist_id = p.id) as song_count
      FROM playlists p WHERE p.owner_id = ?
      ORDER BY p.is_favorite DESC, p.title COLLATE NOCASE
    `).all(request.user.id);
  });

  fastify.delete('/api/music/playlists/:id', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsPlaylist(request.params.id, request.user.id)) return notFound(reply);
    db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ?').run(request.params.id);
    db.prepare('DELETE FROM playlists WHERE id = ? AND owner_id = ?').run(request.params.id, request.user.id);
    return { success: true };
  });

  fastify.patch('/api/music/playlists/:id/title', { preHandler: verifyUser }, async (request, reply) => {
    const title = (request.body?.title || '').trim();
    if (!title) return reply.code(400).send({ error: 'Title is required' });
    db.prepare('UPDATE playlists SET title = ? WHERE id = ? AND owner_id = ?').run(title, request.params.id, request.user.id);
    return { success: true };
  });

  fastify.patch('/api/music/playlists/:id/favorite', { preHandler: verifyUser }, async (request, reply) => {
    db.prepare('UPDATE playlists SET is_favorite = NOT is_favorite WHERE id = ? AND owner_id = ?').run(request.params.id, request.user.id);
    return { success: true };
  });

  fastify.patch('/api/music/playlists/:id/cover', { preHandler: verifyUser }, async (request, reply) => {
    const coverId = request.body?.cover_file_id;
    if (!ownsPlaylist(request.params.id, request.user.id)) return notFound(reply);
    if (!ownsFile(coverId, request.user.id)) return reply.code(404).send({ error: 'Image not found' });
    db.prepare('UPDATE playlists SET cover_file_id = ? WHERE id = ? AND owner_id = ?').run(coverId, request.params.id, request.user.id);

    const songsInPlaylist = db.prepare('SELECT file_id FROM playlist_songs WHERE playlist_id = ?').all(request.params.id);
    const getCover = db.prepare('SELECT cover_file_id FROM song_covers WHERE file_id = ?');
    const insertCover = db.prepare('INSERT OR IGNORE INTO song_covers (file_id, cover_file_id) VALUES (?, ?)');
    for (const s of songsInPlaylist) {
      if (!getCover.get(s.file_id)) insertCover.run(s.file_id, coverId);
    }
    return { success: true };
  });

  fastify.get('/api/music/playlists/:id/songs', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsPlaylist(request.params.id, request.user.id)) return notFound(reply);
    return db.prepare(`
      SELECT f.id, f.filename, f.size_bytes, f.mime_type, f.is_encrypted, f.public_hash, f.created_at, sc.cover_file_id, ${lib.META_COLS}
      FROM playlist_songs ps
      JOIN files f ON ps.file_id = f.id
      LEFT JOIN song_covers sc ON f.id = sc.file_id
      LEFT JOIN media_meta m ON m.file_id = f.id
      WHERE ps.playlist_id = ? AND f.owner_id = ?
      ORDER BY ps.added_at ASC
    `).all(request.params.id, request.user.id).map(lib.withMeta);
  });

  const addSongs = (playlistId, userId, fileIds) => {
    const playlist = db.prepare('SELECT cover_file_id FROM playlists WHERE id = ? AND owner_id = ?').get(playlistId, userId);
    const insertSong = db.prepare('INSERT OR IGNORE INTO playlist_songs (playlist_id, file_id) VALUES (?, ?)');
    const getCover = db.prepare('SELECT cover_file_id FROM song_covers WHERE file_id = ?');
    const insertCover = db.prepare('INSERT OR IGNORE INTO song_covers (file_id, cover_file_id) VALUES (?, ?)');
    for (const fileId of fileIds) {
      if (!ownsFile(fileId, userId)) continue;
      insertSong.run(playlistId, fileId);
      if (playlist && playlist.cover_file_id && !getCover.get(fileId)) insertCover.run(fileId, playlist.cover_file_id);
    }
  };

  fastify.post('/api/music/playlists/:id/songs', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsPlaylist(request.params.id, request.user.id)) return notFound(reply);
    addSongs(request.params.id, request.user.id, [request.body?.file_id]);
    return { success: true };
  });

  fastify.post('/api/music/playlists/:id/songs/bulk', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsPlaylist(request.params.id, request.user.id)) return notFound(reply);
    const ids = Array.isArray(request.body?.file_ids) ? request.body.file_ids : [];
    addSongs(request.params.id, request.user.id, ids);
    return { success: true };
  });

  fastify.delete('/api/music/playlists/:id/songs/:file_id', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsPlaylist(request.params.id, request.user.id)) return notFound(reply);
    db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ? AND file_id = ?').run(request.params.id, request.params.file_id);
    return { success: true };
  });

  fastify.post('/api/music/songs/:id/cover', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsFile(request.params.id, request.user.id) || !ownsFile(request.body?.cover_file_id, request.user.id)) {
      return reply.code(404).send({ error: 'File not found' });
    }
    db.prepare('INSERT OR REPLACE INTO song_covers (file_id, cover_file_id) VALUES (?, ?)').run(request.params.id, request.body.cover_file_id);
    return { success: true };
  });
};
