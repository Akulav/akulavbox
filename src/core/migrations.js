const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Versioned schema migrations, tracked with SQLite's `PRAGMA user_version`.
//
// Databases made by versions before 2.0 have user_version = 0 but already
// contain most tables, so every step is idempotent: tables use IF NOT EXISTS
// and columns are only added when missing. Append new steps at the end and
// never edit a step that has shipped.
// ---------------------------------------------------------------------------

const columnsOf = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
function addColumn(db, table, column, definition) {
  if (!columnsOf(db, table).includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const MIGRATIONS = [
  {
    name: 'baseline (everything created by 1.x)',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT DEFAULT 'user',
          quota_bytes INTEGER DEFAULT 5368709120,
          used_bytes INTEGER DEFAULT 0,
          profile_image TEXT
        );
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
        CREATE TABLE IF NOT EXISTS media_meta (
          file_id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          title TEXT,
          participants TEXT DEFAULT '[]',
          tags TEXT DEFAULT '[]',
          details TEXT,
          date TEXT,
          series TEXT,
          rating INTEGER,
          duration REAL,
          thumb_file_id TEXT,
          progress TEXT,
          updated_at TEXT,
          width INTEGER,
          height INTEGER
        );
        CREATE TABLE IF NOT EXISTS friends (
          user_id TEXT NOT NULL,
          friend_id TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          PRIMARY KEY (user_id, friend_id),
          FOREIGN KEY(user_id) REFERENCES users(id),
          FOREIGN KEY(friend_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          sender_id TEXT NOT NULL,
          receiver_id TEXT NOT NULL,
          content TEXT,
          type TEXT DEFAULT 'text',
          file_path TEXT,
          file_size INTEGER DEFAULT 0,
          file_mime TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      // columns that 1.x added one release at a time
      addColumn(db, 'files', 'created_at', 'TEXT');
      addColumn(db, 'folders', 'system_key', 'TEXT');
      addColumn(db, 'collections', 'notes', "TEXT DEFAULT ''");
      addColumn(db, 'collections', 'is_favorite', 'INTEGER DEFAULT 0');
      addColumn(db, 'albums', 'notes', "TEXT DEFAULT ''");
      addColumn(db, 'albums', 'is_favorite', 'INTEGER DEFAULT 0');
      addColumn(db, 'media_meta', 'width', 'INTEGER');
      addColumn(db, 'media_meta', 'height', 'INTEGER');
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, receiver_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_media_meta_owner ON media_meta(owner_id);
        CREATE INDEX IF NOT EXISTS idx_folders_system ON folders(owner_id, system_key);
        CREATE TRIGGER IF NOT EXISTS keep_1000_messages
        AFTER INSERT ON messages
        BEGIN
          DELETE FROM messages
          WHERE id NOT IN (
            SELECT id FROM messages
            WHERE (sender_id = NEW.sender_id AND receiver_id = NEW.receiver_id)
               OR (sender_id = NEW.receiver_id AND receiver_id = NEW.sender_id)
            ORDER BY created_at DESC
            LIMIT 1000
          )
          AND (
            (sender_id = NEW.sender_id AND receiver_id = NEW.receiver_id)
            OR (sender_id = NEW.receiver_id AND receiver_id = NEW.sender_id)
          );
        END;
      `);
    },
  },
  {
    name: 'indexes for every hot lookup (1.x scanned whole tables)',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_files_owner_folder ON files(owner_id, folder_id);
        CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
        CREATE INDEX IF NOT EXISTS idx_folders_owner_parent ON folders(owner_id, parent_id);
        CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
        CREATE INDEX IF NOT EXISTS idx_album_images_file ON album_images(file_id);
        CREATE INDEX IF NOT EXISTS idx_albums_collection ON albums(collection_id);
        CREATE INDEX IF NOT EXISTS idx_albums_owner ON albums(owner_id);
        CREATE INDEX IF NOT EXISTS idx_collections_owner ON collections(owner_id);
        CREATE INDEX IF NOT EXISTS idx_playlists_owner ON playlists(owner_id);
        CREATE INDEX IF NOT EXISTS idx_playlist_songs_file ON playlist_songs(file_id);
        CREATE INDEX IF NOT EXISTS idx_media_meta_thumb ON media_meta(thumb_file_id);
        CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, sender_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type, created_at);
        CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends(friend_id);
      `);
    },
  },
  {
    name: 'account security & bookkeeping (token version, created / last login)',
    up(db) {
      // Bumping token_version signs out every session of that user (password change, deletion)
      addColumn(db, 'users', 'token_version', 'INTEGER DEFAULT 0');
      addColumn(db, 'users', 'created_at', 'TEXT');
      addColumn(db, 'users', 'last_login_at', 'TEXT');
    },
  },
  {
    name: 'trash for files and folders',
    up(db) {
      // trashed_at: when it went to the trash. trash_root: for items that went along
      // with a trashed folder, that folder's id (they come back when it is restored).
      addColumn(db, 'files', 'trashed_at', 'TEXT');
      addColumn(db, 'files', 'trash_root', 'TEXT');
      addColumn(db, 'folders', 'trashed_at', 'TEXT');
      addColumn(db, 'folders', 'trash_root', 'TEXT');
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_files_trash ON files(owner_id, trashed_at);
        CREATE INDEX IF NOT EXISTS idx_files_trash_root ON files(trash_root);
        CREATE INDEX IF NOT EXISTS idx_folders_trash ON folders(owner_id, trashed_at);
        CREATE INDEX IF NOT EXISTS idx_folders_trash_root ON folders(trash_root);
      `);
    },
  },
  {
    name: 'stable order for album photos and playlist songs',
    up(db) {
      addColumn(db, 'album_images', 'added_at', 'TEXT');
      addColumn(db, 'playlist_songs', 'position', 'INTEGER');
      // keep today's order: albums by insertion, playlists by when songs were added
      db.exec(`
        UPDATE playlist_songs SET position = (
          SELECT COUNT(*) FROM playlist_songs p2
          WHERE p2.playlist_id = playlist_songs.playlist_id
            AND (p2.added_at < playlist_songs.added_at OR (p2.added_at = playlist_songs.added_at AND p2.rowid < playlist_songs.rowid))
        ) WHERE position IS NULL;
        CREATE INDEX IF NOT EXISTS idx_playlist_songs_order ON playlist_songs(playlist_id, position);
      `);
    },
  },
  {
    name: 'chat read markers (unread counts survive reloads)',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_reads (
          user_id TEXT NOT NULL,
          friend_id TEXT NOT NULL,
          last_read_at TEXT NOT NULL,
          PRIMARY KEY (user_id, friend_id)
        );
      `);
      // everything that already exists counts as read
      db.exec(`
        INSERT OR IGNORE INTO chat_reads (user_id, friend_id, last_read_at)
        SELECT receiver_id, sender_id, MAX(created_at) FROM messages GROUP BY receiver_id, sender_id;
      `);
    },
  },
];

const LATEST = MIGRATIONS.length;

/**
 * Bring the database up to date. Existing databases are snapshotted to
 * storage/backups before the first pending step, so an upgrade can always be undone.
 */
function migrate(db, { backupsDir, version, log = console.log } = {}) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current >= LATEST) return { from: current, to: current, backup: null };

  const hasData = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  let backup = null;
  if (hasData && backupsDir) {
    fs.mkdirSync(backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    backup = path.join(backupsDir, `akulavbox-schema${current}-before-v${version || 'next'}-${stamp}.db`);
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    log(`[db] Backed up the database to ${backup}`);
  }

  for (let v = current; v < LATEST; v++) {
    const step = MIGRATIONS[v];
    db.exec('BEGIN');
    try {
      step.up(db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
      log(`[db] Migration ${v + 1}/${LATEST}: ${step.name}`);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Database migration ${v + 1} (${step.name}) failed: ${e.message}${backup ? `\nYour data is safe in ${backup}` : ''}`);
    }
  }
  return { from: current, to: LATEST, backup };
}

module.exports = { migrate, LATEST, addColumn, columnsOf };
