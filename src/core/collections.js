const crypto = require('crypto');
const db = require('./db');

// ---------------------------------------------------------------------------
// Collections group library items (videos, and later books) the way playlists
// group songs. Link downloads file each item into a collection named after
// its creator; for music that is a playlist with the creator's name.
// ---------------------------------------------------------------------------

const KINDS = ['videos', 'books'];
const TITLE_MAX = 200;

function createCollection(ownerId, kind, title) {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO media_collections (id, owner_id, kind, title, created_at) VALUES (?, ?, ?, ?, datetime('now'))")
    .run(id, ownerId, kind, String(title).slice(0, TITLE_MAX));
  return id;
}

/** Collection with this title (any case), created if missing */
function collectionByTitle(ownerId, kind, title) {
  const hit = db.prepare('SELECT id FROM media_collections WHERE owner_id = ? AND kind = ? AND title = ? COLLATE NOCASE LIMIT 1').get(ownerId, kind, title);
  return hit ? hit.id : createCollection(ownerId, kind, title);
}

/** Append files (owned, not trashed) to a collection; returns how many were new */
function addToCollection(collectionId, ownerId, fileIds) {
  const owned = db.prepare('SELECT 1 FROM files WHERE id = ? AND owner_id = ? AND trashed_at IS NULL');
  const ins = db.prepare("INSERT OR IGNORE INTO media_collection_items (collection_id, file_id, position, added_at) VALUES (?, ?, ?, datetime('now'))");
  let pos = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM media_collection_items WHERE collection_id = ?').get(collectionId).p;
  let n = 0;
  db.tx(() => {
    for (const id of fileIds.slice(0, 5000)) {
      if (owned.get(id, ownerId) && ins.run(collectionId, id, pos + 1).changes) { pos++; n++; }
    }
  });
  return n;
}

/** Playlist with this title (any case), created if missing */
function playlistByTitle(ownerId, title) {
  const hit = db.prepare('SELECT id FROM playlists WHERE owner_id = ? AND title = ? COLLATE NOCASE LIMIT 1').get(ownerId, title);
  if (hit) return hit.id;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO playlists (id, owner_id, title) VALUES (?, ?, ?)').run(id, ownerId, String(title).slice(0, TITLE_MAX));
  return id;
}

function addToPlaylist(playlistId, fileId) {
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM playlist_songs WHERE playlist_id = ?').get(playlistId).p;
  db.prepare('INSERT OR IGNORE INTO playlist_songs (playlist_id, file_id, position) VALUES (?, ?, ?)').run(playlistId, fileId, pos + 1);
}

module.exports = { KINDS, TITLE_MAX, createCollection, collectionByTitle, addToCollection, playlistByTitle, addToPlaylist };
