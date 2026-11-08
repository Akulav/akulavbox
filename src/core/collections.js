const crypto = require('crypto');
const db = require('./db');

// ---------------------------------------------------------------------------
// Collections group library items (videos, and later books) the way playlists
// group songs. Both are made by the user only: downloads are grouped by
// creator / artist in the Creators and Artists views instead.
// ---------------------------------------------------------------------------

const KINDS = ['videos', 'books'];
const TITLE_MAX = 200;

function createCollection(ownerId, kind, title) {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO media_collections (id, owner_id, kind, title, created_at) VALUES (?, ?, ?, ?, datetime('now'))")
    .run(id, ownerId, kind, String(title).slice(0, TITLE_MAX));
  return id;
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

function addToPlaylist(playlistId, fileId) {
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM playlist_songs WHERE playlist_id = ?').get(playlistId).p;
  db.prepare('INSERT OR IGNORE INTO playlist_songs (playlist_id, file_id, position) VALUES (?, ?, ?)').run(playlistId, fileId, pos + 1);
}

module.exports = { KINDS, TITLE_MAX, createCollection, addToCollection, addToPlaylist };
