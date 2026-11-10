const db = require('../core/db');
const crypto = require('crypto');
const { verifyUser } = require('../core/auth');
const lib = require('../core/library');

const TITLE_MAX = 200;
const cleanTitle = (v) => String(v ?? '').trim().slice(0, TITLE_MAX);

module.exports = async function (fastify) {

  const ownsPlaylist = (id, userId) => !!db.prepare('SELECT 1 FROM playlists WHERE id = ? AND owner_id = ?').get(id, userId);
  // trashed files can't be added to playlists or used as artwork (they'd vanish again)
  const ownsFile = (id, userId) => !!id && !!db.prepare('SELECT 1 FROM files WHERE id = ? AND owner_id = ? AND trashed_at IS NULL').get(id, userId);
  const notFound = (reply) => reply.code(404).send({ error: 'Playlist not found' });

  const SONG_COLS = `f.id, f.filename, f.size_bytes, f.mime_type, f.is_encrypted, f.public_hash, f.created_at, sc.cover_file_id, ${lib.META_COLS}`;

  // --- MUSIC & PLAYLISTS SYSTEM ---
  fastify.get('/api/music/songs', { preHandler: verifyUser }, async (request) => {
    const folderId = lib.ensureSystemFolder(request.user.id, 'music');
    const songs = db.prepare(`
      SELECT ${SONG_COLS}
      FROM files f
      LEFT JOIN song_covers sc ON f.id = sc.file_id
      LEFT JOIN media_meta m ON m.file_id = f.id
      WHERE f.folder_id = ? AND f.owner_id = ? AND f.trashed_at IS NULL
      ORDER BY f.filename COLLATE NOCASE
    `).all(folderId, request.user.id).map(lib.withMeta);
    return { songs, folderId };
  });

  fastify.post('/api/music/playlists', { preHandler: verifyUser }, async (request, reply) => {
    const title = cleanTitle(request.body?.title);
    if (!title) return reply.code(400).send({ error: 'Title is required' });
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO playlists (id, owner_id, title) VALUES (?, ?, ?)').run(id, request.user.id, title);
    return { success: true, id };
  });

  fastify.get('/api/music/playlists', { preHandler: verifyUser }, async (request) => {
    return db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM playlist_songs ps JOIN files f ON f.id = ps.file_id WHERE ps.playlist_id = p.id AND f.trashed_at IS NULL) AS song_count,
        (SELECT COALESCE(SUM(m.duration), 0) FROM playlist_songs ps JOIN files f ON f.id = ps.file_id LEFT JOIN media_meta m ON m.file_id = f.id
          WHERE ps.playlist_id = p.id AND f.trashed_at IS NULL) AS total_duration,
        -- like video collections: the playlist's own artwork, else that of its first song that has some
        COALESCE(p.cover_file_id, (SELECT sc.cover_file_id FROM playlist_songs ps JOIN files f ON f.id = ps.file_id
          JOIN song_covers sc ON sc.file_id = ps.file_id JOIN files c ON c.id = sc.cover_file_id AND c.trashed_at IS NULL
          WHERE ps.playlist_id = p.id AND f.trashed_at IS NULL
          ORDER BY ps.position IS NULL, ps.position, ps.added_at, ps.rowid LIMIT 1)) AS display_cover_id
      FROM playlists p WHERE p.owner_id = ?
      ORDER BY p.is_favorite DESC, p.title COLLATE NOCASE
    `).all(request.user.id);
  });

  fastify.delete('/api/music/playlists/:id', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsPlaylist(request.params.id, request.user.id)) return notFound(reply);
    db.tx(() => {
      db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ?').run(request.params.id);
      db.prepare('DELETE FROM playlists WHERE id = ? AND owner_id = ?').run(request.params.id, request.user.id);
    });
    return { success: true };
  });

  fastify.patch('/api/music/playlists/:id/title', { preHandler: verifyUser }, async (request, reply) => {
    const title = cleanTitle(request.body?.title);
    if (!title) return reply.code(400).send({ error: 'Title is required' });
    if (!ownsPlaylist(request.params.id, request.user.id)) return notFound(reply);
    db.prepare('UPDATE playlists SET title = ? WHERE id = ? AND owner_id = ?').run(title, request.params.id, request.user.id);
    return { success: true };
  });

  fastify.patch('/api/music/playlists/:id/favorite', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsPlaylist(request.params.id, request.user.id)) return notFound(reply);
    db.prepare('UPDATE playlists SET is_favorite = NOT is_favorite WHERE id = ? AND owner_id = ?').run(request.params.id, request.user.id);
    return { success: true };
  });

  fastify.patch('/api/music/playlists/:id/cover', { preHandler: verifyUser }, async (request, reply) => {
    const coverId = request.body?.cover_file_id;
    if (!ownsPlaylist(request.params.id, request.user.id)) return notFound(reply);
    if (!ownsFile(coverId, request.user.id)) return reply.code(404).send({ error: 'Image not found' });
    db.prepare('UPDATE playlists SET cover_file_id = ? WHERE id = ? AND owner_id = ?').run(coverId, request.params.id, request.user.id);

    // songs without their own artwork borrow the playlist's
    const songsInPlaylist = db.prepare('SELECT file_id FROM playlist_songs WHERE playlist_id = ?').all(request.params.id);
    const getCover = db.prepare('SELECT cover_file_id FROM song_covers WHERE file_id = ?');
    const insertCover = db.prepare('INSERT OR IGNORE INTO song_covers (file_id, cover_file_id) VALUES (?, ?)');
    db.tx(() => { for (const s of songsInPlaylist) if (!getCover.get(s.file_id)) insertCover.run(s.file_id, coverId); });
    return { success: true };
  });

  fastify.get('/api/music/playlists/:id/songs', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsPlaylist(request.params.id, request.user.id)) return notFound(reply);
    return db.prepare(`
      SELECT ${SONG_COLS}
      FROM playlist_songs ps
      JOIN files f ON ps.file_id = f.id
      LEFT JOIN song_covers sc ON f.id = sc.file_id
      LEFT JOIN media_meta m ON m.file_id = f.id
      WHERE ps.playlist_id = ? AND f.owner_id = ? AND f.trashed_at IS NULL
      ORDER BY ps.position IS NULL, ps.position, ps.added_at, ps.rowid
    `).all(request.params.id, request.user.id).map(lib.withMeta);
  });

  const addSongs = (playlistId, userId, fileIds) => {
    const playlist = db.prepare('SELECT cover_file_id FROM playlists WHERE id = ? AND owner_id = ?').get(playlistId, userId);
    const insertSong = db.prepare('INSERT OR IGNORE INTO playlist_songs (playlist_id, file_id, position) VALUES (?, ?, ?)');
    const getCover = db.prepare('SELECT cover_file_id FROM song_covers WHERE file_id = ?');
    const insertCover = db.prepare('INSERT OR IGNORE INTO song_covers (file_id, cover_file_id) VALUES (?, ?)');
    let pos = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM playlist_songs WHERE playlist_id = ?').get(playlistId).p;
    let added = 0;
    db.tx(() => {
      for (const fileId of fileIds.slice(0, 5000)) {
        if (!ownsFile(fileId, userId)) continue;
        if (insertSong.run(playlistId, fileId, pos + 1).changes) { pos++; added++; }
        if (playlist && playlist.cover_file_id && !getCover.get(fileId)) insertCover.run(fileId, playlist.cover_file_id);
      }
    });
    return added;
  };

  fastify.post('/api/music/playlists/:id/songs', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsPlaylist(request.params.id, request.user.id)) return notFound(reply);
    return { success: true, added: addSongs(request.params.id, request.user.id, [request.body?.file_id]) };
  });

  fastify.post('/api/music/playlists/:id/songs/bulk', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsPlaylist(request.params.id, request.user.id)) return notFound(reply);
    const ids = Array.isArray(request.body?.file_ids) ? request.body.file_ids : [];
    return { success: true, added: addSongs(request.params.id, request.user.id, ids) };
  });

  // Save a new order: { file_ids: [...] } in the order they should play
  fastify.put('/api/music/playlists/:id/order', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsPlaylist(request.params.id, request.user.id)) return notFound(reply);
    const ids = Array.isArray(request.body?.file_ids) ? request.body.file_ids.map(String) : [];
    const set = db.prepare('UPDATE playlist_songs SET position = ? WHERE playlist_id = ? AND file_id = ?');
    db.tx(() => { ids.forEach((id, i) => set.run(i, request.params.id, id)); });
    return { success: true };
  });

  fastify.delete('/api/music/playlists/:id/songs/:file_id', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsPlaylist(request.params.id, request.user.id)) return notFound(reply);
    db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ? AND file_id = ?').run(request.params.id, request.params.file_id);
    return { success: true };
  });

  // Take several songs out of a playlist at once: { file_ids } (the songs stay in the library)
  fastify.post('/api/music/playlists/:id/songs/remove', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsPlaylist(request.params.id, request.user.id)) return notFound(reply);
    const ids = Array.isArray(request.body?.file_ids) ? request.body.file_ids.map(String).slice(0, 5000) : [];
    const del = db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ? AND file_id = ?');
    let removed = 0;
    db.tx(() => { for (const id of ids) removed += del.run(request.params.id, id).changes; });
    return { success: true, removed };
  });

  fastify.post('/api/music/songs/:id/cover', { preHandler: verifyUser }, async (request, reply) => {
    if (!ownsFile(request.params.id, request.user.id) || !ownsFile(request.body?.cover_file_id, request.user.id)) {
      return reply.code(404).send({ error: 'File not found' });
    }
    db.prepare('INSERT OR REPLACE INTO song_covers (file_id, cover_file_id) VALUES (?, ?)').run(request.params.id, request.body.cover_file_id);
    return { success: true };
  });
};
