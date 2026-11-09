const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('./hash');
const config = require('./config');
const { migrate } = require('./migrations');
const backup = require('./backup');

// A restore staged from the Admin page is swapped in before anything opens the database
let restored = null;
try { restored = backup.applyPending(); } catch (e) { console.error('[backup] Couldn’t apply the staged restore:', e.message); }

const db = new DatabaseSync(config.dbPath);
db.restored = restored;

// Bring older databases up to date before any module prepares statements
const result = migrate(db, { backupsDir: config.backupsDir, version: config.version });
db.schema = result;

// WAL lets readers (thumbnails, listings) run while an upload is being written.
// Set SQLITE_WAL=0 if the storage folder is on a network drive.
if (process.env.SQLITE_WAL !== '0') db.exec('PRAGMA journal_mode = WAL');
db.exec(`
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA temp_store = MEMORY;
  PRAGMA cache_size = -16000;
`);

// First start: create the default admin (username admin, password admin)
if (db.prepare('SELECT count(*) AS count FROM users').get().count === 0) {
  const hash = bcrypt.hashSync('admin', 10);
  db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', datetime('now'))")
    .run('admin-uuid-0000', 'admin', hash);
  console.log('[db] Default admin created (username "admin", password "admin"). Change the password after signing in.');
}

/**
 * Run fn inside a transaction (synchronous; DatabaseSync has no async work in between).
 * Nested calls join the outer transaction, so helpers like purgeFile() can use it too
 * (a second BEGIN would throw "cannot start a transaction within a transaction").
 */
let txDepth = 0;
db.tx = (fn) => {
  if (txDepth) { txDepth++; try { return fn(); } finally { txDepth--; } }
  db.exec('BEGIN');
  txDepth = 1;
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  finally { txDepth = 0; }
};

module.exports = db;
