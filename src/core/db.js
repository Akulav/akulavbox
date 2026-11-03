const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const storageDir = path.join(process.cwd(), 'storage');
if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

const db = new DatabaseSync(path.join(storageDir, 'akulavbox.db'));

db.exec(`

  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    FOREIGN KEY(owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    folder_id TEXT,
    filename TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    mime_type TEXT,
    is_encrypted INTEGER DEFAULT 1,
    iv_hex TEXT,
    public_hash TEXT UNIQUE,
    FOREIGN KEY(owner_id) REFERENCES users(id),
    FOREIGN KEY(folder_id) REFERENCES folders(id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    quota_bytes INTEGER DEFAULT 5368709120,
    used_bytes INTEGER DEFAULT 0,
    profile_image TEXT
  );

  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    cover_file_id TEXT,
    FOREIGN KEY(owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    collection_id TEXT NOT NULL,
    title TEXT NOT NULL,
    cover_file_id TEXT,
    FOREIGN KEY(owner_id) REFERENCES users(id),
    FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS album_images (
    album_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    PRIMARY KEY (album_id, file_id),
    FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE,
    FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  cover_file_id TEXT,
  is_favorite INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlist_songs (
  playlist_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (playlist_id, file_id)
);

CREATE TABLE IF NOT EXISTS song_covers (
  file_id TEXT PRIMARY KEY,
  cover_file_id TEXT NOT NULL
);
`);

// Admin creation logic remains the same...
const stmt = db.prepare('SELECT count(*) as count FROM users');
if (stmt.get().count === 0) {
  const hash = bcrypt.hashSync('admin', 10);
  db.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run('admin-uuid-0000', 'admin', hash, 'admin');
  console.log('Default admin created.');
}

module.exports = db;