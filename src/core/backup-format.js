const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

// The .akbx format and what goes into a backup. The header comment of backup.js describes the layout.

const MAGIC = Buffer.from('AKBX\x01', 'latin1');
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const ENTRY = 1, END = 0;

function deriveKeys(passphrase, salt, cost = SCRYPT) {
  const k = crypto.scryptSync(String(passphrase).normalize('NFC'), salt, 64, cost);
  return { enc: k.subarray(0, 32), mac: k.subarray(32) };
}
const checkValue = (macKey) => crypto.createHmac('sha256', macKey).update('akulavbox-backup').digest('hex').slice(0, 32);

function entryHeader(name, gzip, length) {
  const n = Buffer.from(name, 'utf-8');
  const b = Buffer.alloc(1 + 2 + n.length + 1 + 8);
  let o = b.writeUInt8(ENTRY, 0);
  o = b.writeUInt16BE(n.length, o);
  o += n.copy(b, o);
  o = b.writeUInt8(gzip ? 1 : 0, o);
  b.writeBigUInt64BE(BigInt(length), o);
  return b;
}

/** Snapshot the live database consistently (works while the server runs) */
function snapshotDb(db, dest) {
  fs.rmSync(dest, { force: true });
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
}

/** Every file under data/users that belongs to an existing account, plus saved cookies */
function listData(db) {
  const out = [];
  const users = new Set(db.prepare('SELECT id FROM users').all().map(u => u.id));
  for (const u of users) {
    const dir = path.join(config.usersDir, u);
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const n of names) {
      if (!/\.(enc|plain)$/.test(n)) continue;
      try { const st = fs.statSync(path.join(dir, n)); if (st.isFile()) out.push({ name: `users/${u}/${n}`, path: path.join(dir, n), size: st.size }); } catch (e) { /* gone */ }
    }
  }
  const cdir = path.join(config.privateDir, 'cookies');
  try {
    for (const n of fs.readdirSync(cdir)) if (n.endsWith('.enc') && users.has(n.slice(0, -4))) {
      const p = path.join(cdir, n);
      out.push({ name: `private/cookies/${n}`, path: p, size: fs.statSync(p).size });
    }
  } catch (e) { /* none saved */ }
  return out.concat(listApps().files);
}

// ---------------------------------------------------------------------------
// The other apps (since 4.0): everything in DATA_DIR/<app>/ goes into the backup as
// apps/<app>/<path>. Their SQLite databases are snapshotted (VACUUM INTO) and gzipped
// like akulavbox.db; leftovers of interrupted uploads and imports are left out.
// A restore replaces the folder of every app the backup has (manifest.apps), so a
// backup from before 4.0 leaves those apps' data as it is.
// ---------------------------------------------------------------------------
const { APP_IDS } = require('./app-list');
const IS_DB = /\.(db|sqlite)$/;
const SKIP = /(^|\/)(tmp|import-[^/]*)(\/|$)|\.(db|sqlite)-(wal|shm|journal)$|\.part$/;
const APP_ENTRY = new RegExp(`^apps\\/(${APP_IDS.join('|')})\\/((?:[\\w.-]+\\/)*[\\w.-]+)$`);

function listApps() {
  const files = [], dbs = [];
  for (const id of APP_IDS) {
    const root = config.appDataDir(id);
    const walk = (dir, rel) => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (SKIP.test(r) || !/^[\w.-]+$/.test(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, r);
        else if (e.isFile()) {
          if (IS_DB.test(e.name)) dbs.push({ name: `apps/${id}/${r}`, path: p });
          else { try { files.push({ name: `apps/${id}/${r}`, path: p, size: fs.statSync(p).size }); } catch (err) { /* gone */ } }
        }
      }
    };
    walk(root, '');
  }
  return { files, dbs };
}

/** Rough size of an export, for the admin page */
function estimate(db) {
  const files = listData(db);
  let dbBytes = 0;
  for (const f of [config.dbPath, config.troveDbPath]) { try { dbBytes += fs.statSync(f).size; } catch (e) { /* none */ } }
  for (const d of listApps().dbs) { try { dbBytes += fs.statSync(d.path).size; } catch (e) { /* gone */ } }
  return { files: files.length, bytes: files.reduce((a, f) => a + f.size, 0) + Math.round(dbBytes / 3) };
}

module.exports = { MAGIC, SCRYPT, ENTRY, END, deriveKeys, checkValue, entryHeader, snapshotDb, listData, listApps, estimate, APP_IDS, APP_ENTRY };
