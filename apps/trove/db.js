'use strict';
// Trove's database: DATA_DIR/box/trove.db. Until 5.1 Trove's tables lived in akulavbox.db.
//
// It is ATTACHed to the server's one connection as the schema "trove" (src/core/db.js does that before
// anything prepares statements), so Trove's queries name its tables without a schema and SQLite finds
// them there, and a transaction (db.tx) covers both files. New Trove tables in migrations must be
// created as trove.<name>; ALTER TABLE on an existing one finds it on its own.
//
// Moving the tables (moveIn) is safe to interrupt: as long as akulavbox.db still has them, they are
// the real copy. They are copied into trove.db in one transaction (replacing whatever an interrupted
// earlier attempt left there), and only then dropped from akulavbox.db in a second one. An
// interrupted move simply runs again on the next start. Restored backups (old ones, and new ones,
// whose akulavbox.db carries Trove's tables again, see mergeForBackup) go the same way.
//
// Trove's storage counter lives here too: usage(user_id, bytes), what used to be users.used_bytes.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const TABLES = ['files', 'folders', 'albums', 'album_images', 'collections', 'playlists', 'playlist_songs', 'song_covers', 'media_meta', 'media_collections', 'media_collection_items', 'downloads'];
const USAGE = 'CREATE TABLE IF NOT EXISTS trove.usage (user_id TEXT PRIMARY KEY, bytes INTEGER NOT NULL DEFAULT 0)';
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** ATTACH trove.db (created when missing) as "trove", with the same settings as the main file */
function attach(db, file, { wal = true } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db.exec(`ATTACH DATABASE ${q(file)} AS trove`);
  if (wal) db.exec('PRAGMA trove.journal_mode = WAL');
  db.exec('PRAGMA trove.synchronous = NORMAL');
}

const has = (db, schema, name) => !!db.prepare(`SELECT 1 FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`).get(name);
// "CREATE TABLE [IF NOT EXISTS] name" / "CREATE [UNIQUE] INDEX [IF NOT EXISTS] name" into the trove schema.
// A foreign key can't point into another database file, so the ones to users(id) go (SQLite would
// look for trove.users); delete-user removes Trove's rows itself. The ones between Trove's tables stay.
const USERS_FK = /,\s*FOREIGN KEY\s*\(\s*\w+\s*\)\s*REFERENCES\s+["`]?users["`]?\s*\(\s*id\s*\)(\s+ON\s+(DELETE|UPDATE)\s+(SET\s+NULL|SET\s+DEFAULT|NO\s+ACTION|\w+))*/gi;
const toTrove = (sql) => sql
  .replace(USERS_FK, '')
  .replace(/^CREATE TABLE (IF NOT EXISTS )?(["`[]?)(\w+)\2\]?/i, (m, ine, qt, name) => `CREATE TABLE trove."${name}"`)
  .replace(/^CREATE (UNIQUE )?INDEX (IF NOT EXISTS )?(["`[]?)(\w+)\3\]?/i, (m, u, ine, qt, name) => `CREATE ${u || ''}INDEX trove."${name}"`);

/** Run fn in a transaction on `db`; any error rolls it back and is thrown on */
function inTransaction(db, fn) {
  db.exec('BEGIN');
  try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/**
 * Run fn with foreign keys off. node:sqlite turns them on by default, and copying tables one by one
 * would trip over a table that references one not copied yet. The setting only changes outside a
 * transaction; it is put back as it was.
 */
function withoutForeignKeys(db, fn) {
  const was = db.prepare('PRAGMA foreign_keys').get().foreign_keys;
  db.exec('PRAGMA foreign_keys = OFF');
  try { return fn(); } finally { db.exec(`PRAGMA foreign_keys = ${was ? 'ON' : 'OFF'}`); }
}

/** A VACUUM INTO copy of akulavbox.db in backups/, before anything moves (like before a migration) */
function snapshotMain(db, backupsDir, version) {
  fs.mkdirSync(backupsDir, { recursive: true });
  const file = path.join(backupsDir, `akulavbox-before-trove-db-v${version || 'next'}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`);
  db.exec(`VACUUM main INTO ${q(file)}`);
  return file;
}

/** 1. Trove's tables (with their indexes) and its counter into trove.db, replacing a half-done copy */
function copyToTrove(db, tables) {
  const sqlOf = (type, name) => db.prepare(`SELECT sql FROM main.sqlite_master WHERE type = '${type}' AND ${type === 'table' ? 'name' : 'tbl_name'} = ? AND sql IS NOT NULL`).all(name).map((r) => r.sql);
  inTransaction(db, () => {
    for (const t of tables) db.exec(`DROP TABLE IF EXISTS trove."${t}"`);
    for (const t of tables) db.exec(toTrove(sqlOf('table', t)[0]));
    for (const t of tables) db.exec(`INSERT INTO trove."${t}" SELECT * FROM main."${t}"`);
    for (const t of tables) for (const sql of sqlOf('index', t)) db.exec(toTrove(sql));
    db.exec('DROP TABLE IF EXISTS trove.usage');
    db.exec(USAGE);
    db.exec('INSERT INTO trove.usage (user_id, bytes) SELECT id, MAX(0, COALESCE(used_bytes, 0)) FROM main.users');
  });
}

/** 2. Only once the copy is committed do the tables leave akulavbox.db */
function dropFromMain(db, tables) {
  inTransaction(db, () => { for (const t of tables) db.exec(`DROP TABLE main."${t}"`); });
}

/**
 * Move Trove's tables from akulavbox.db into trove.db (and users.used_bytes into usage), when
 * akulavbox.db has them: a first start on 5.1, a fresh install, or a restored backup. Safe to
 * interrupt: until step 2 commits, akulavbox.db still holds the real copy and the move runs again.
 * Returns null when there was nothing to move, else { snapshot, tables }.
 */
function moveIn(db, { backupsDir, version, log = console.log } = {}) {
  const tables = TABLES.filter((t) => has(db, 'main', t));
  if (!tables.length) { db.exec(USAGE); return null; }
  const hasData = has(db, 'main', 'users') && db.prepare('SELECT COUNT(*) AS n FROM main.users').get().n > 0;
  const snapshot = hasData && backupsDir ? snapshotMain(db, backupsDir, version) : null;
  withoutForeignKeys(db, () => {
    try { copyToTrove(db, tables); } catch (e) { throw new Error(`Moving Trove’s tables into trove.db failed (nothing was changed): ${e.message}`); }
    dropFromMain(db, tables);
  });
  if (hasData) log(`[db] Trove’s ${tables.length} tables moved into box/trove.db${snapshot ? ` (backup: ${snapshot})` : ''}`);
  return { snapshot, tables };
}
/**
 * For full backups: put Trove's tables (and users.used_bytes) back into a snapshot of akulavbox.db,
 * so a backup keeps the format every version reads, and a restore moves them out again on start.
 * `liveDb` is the server's connection (trove.db attached).
 */
function mergeForBackup(liveDb, snapPath) {
  const tmp = `${snapPath}.trove`;
  fs.rmSync(tmp, { force: true });
  liveDb.exec(`VACUUM trove INTO ${q(tmp)}`); // a consistent copy, even while the server writes
  const s = new DatabaseSync(snapPath);
  try {
    s.exec(`ATTACH DATABASE ${q(tmp)} AS t`);
    const objs = s.prepare("SELECT type, name, sql FROM t.sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND tbl_name != 'usage'").all();
    const tables = objs.filter((o) => o.type === 'table');
    withoutForeignKeys(s, () => inTransaction(s, () => {
      for (const o of tables) { s.exec(`DROP TABLE IF EXISTS main."${o.name}"`); s.exec(o.sql); }
      for (const o of tables) s.exec(`INSERT INTO main."${o.name}" SELECT * FROM t."${o.name}"`);
      for (const o of objs) if (o.type === 'index') s.exec(o.sql);
      s.exec('UPDATE main.users SET used_bytes = COALESCE((SELECT bytes FROM t.usage WHERE t.usage.user_id = users.id), 0)');
    }));
    s.exec('DETACH DATABASE t');
  } finally {
    s.close();
    fs.rmSync(tmp, { force: true });
  }
}
/** Trove's storage counter, per account. Prepared on first use (after the attach). */
let st = null;
const stmts = (db) => st || (st = {
  get: db.prepare('SELECT bytes FROM trove.usage WHERE user_id = ?'),
  add: db.prepare('INSERT INTO trove.usage (user_id, bytes) VALUES (?, MAX(0, ?)) ON CONFLICT(user_id) DO UPDATE SET bytes = MAX(0, bytes + ?)'),
  set: db.prepare('INSERT INTO trove.usage (user_id, bytes) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET bytes = excluded.bytes'),
  forget: db.prepare('DELETE FROM trove.usage WHERE user_id = ?'),
});
const usage = {
  get: (db, userId) => stmts(db).get.get(userId)?.bytes ?? 0,
  /** add (or with a negative number, give back) bytes; never below 0 */
  add: (db, userId, delta) => { if (delta) stmts(db).add.run(userId, delta, delta); },
  set: (db, userId, bytes) => stmts(db).set.run(userId, Math.max(0, bytes)),
  forget: (db, userId) => stmts(db).forget.run(userId),
};

module.exports = { TABLES, attach, moveIn, mergeForBackup, usage };
