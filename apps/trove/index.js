'use strict';
// Trove (/box/): files, photos, music, videos and books, encrypted at rest. The core app of AkulavBox:
// every account has it. A Fastify plugin like the other apps, registered by apps/index.js.
//
//   public/   the page (Vue 3, no build step), served at the site's root paths with index.html at /box/
//   routes/   the API, at /api/… (files, media, zip, trash, albums, music, library, collections, downloads)
//   lib/      storage and encryption, thumbnails, the trash, the library folders, link downloads
//   db.js     its database, box/trove.db (attached to the server's connection as "trove")
//   connector.js  what an AI app may do here (src/core/connector)
const fs = require('node:fs');
const db = require('../../src/core/db');
const apps = require('../../src/core/apps');
const store = require('./lib/storage');
const thumbs = require('./lib/thumbs');
const cookies = require('./lib/cookies');
const { usage } = require('./db');

const ROUTES = ['files', 'media', 'zip', 'trash', 'albums', 'music', 'library', 'collections', 'downloads'];

// Foreign keys aren't enforced, so delete-user removes every row by hand (children first)
const FORGET = [
  'DELETE FROM album_images WHERE album_id IN (SELECT id FROM albums WHERE owner_id = ?)',
  'DELETE FROM albums WHERE owner_id = ?',
  'DELETE FROM collections WHERE owner_id = ?',
  'DELETE FROM playlist_songs WHERE playlist_id IN (SELECT id FROM playlists WHERE owner_id = ?)',
  'DELETE FROM playlists WHERE owner_id = ?',
  'DELETE FROM song_covers WHERE file_id IN (SELECT id FROM files WHERE owner_id = ?)',
  'DELETE FROM media_meta WHERE owner_id = ?',
  'DELETE FROM media_collection_items WHERE collection_id IN (SELECT id FROM media_collections WHERE owner_id = ?)',
  'DELETE FROM media_collections WHERE owner_id = ?',
  'DELETE FROM downloads WHERE owner_id = ?',
  'DELETE FROM files WHERE owner_id = ?',
  'DELETE FROM folders WHERE owner_id = ?',
];

const hooks = {
  usage: (userId) => store.usedBy(userId),
  summary: (userId) => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM files WHERE owner_id = ? AND trashed_at IS NULL').get(userId).n;
    return `${n.toLocaleString('en')} file${n === 1 ? '' : 's'}`;
  },
  totals: () => {
    const r = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS b FROM files WHERE trashed_at IS NULL').get();
    return { bytes: r.b, items: r.n, label: 'files' };
  },
  deleteUser: (userId) => {
    db.tx(() => {
      for (const sql of FORGET) db.prepare(sql).run(userId);
      usage.forget(db, userId);
    });
    const dir = store.userDirOf(userId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    thumbs.purgeUser(userId);
    cookies.remove(userId);
  },
  connector: require('./connector'),
};

module.exports = async function trove(app) {
  apps.register('box', hooks);
  for (const name of ROUTES) app.register(require(`./routes/${name}`));
};
