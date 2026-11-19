const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { Readable } = require('stream');
const { MAGIC, SCRYPT, END, deriveKeys, checkValue, entryHeader, snapshotDb, listData, listApps, estimate, APP_IDS } = require('./backup-format');
const restore = require('./restore');

// ---------------------------------------------------------------------------
// Full backups (.akbx): every account, password hash, setting, album,
// playlist and file, plus the data of the other apps (apps/<app>/…),
// in one passphrase-protected file.
//
//   "AKBX" 0x01 | u32 header length | header JSON (salt, iv, scrypt cost, check)
//   AES-256-CTR( entries… ) | HMAC-SHA256(header + ciphertext)
//
// Keys: scrypt(passphrase, salt) → 32 bytes for AES + 32 bytes for the HMAC.
// `check` lets a wrong passphrase fail at once instead of after the whole file.
//
// Each entry: u8 type (1 = entry, 0 = end) | u16 name length | name | u8 gzip |
// u64 stored length | stored bytes. The manifest and the database are gzipped at
// level 9. Stored files are already encrypted (random-looking), so they are kept
// as they are; compressing them would cost CPU and save nothing.
//
// The export carries the MASTER_KEY inside the encrypted body, so it restores on
// a server with a different key: .enc files are re-keyed on the way in.
//
// Importing stages everything in data/import-staging/ and checks the HMAC.
// The swap happens on the next start, before the database opens
// (applyPending, called from db.js). The data it replaces goes to
// data/backups/pre-import-<time>/, so an import can be undone by hand.
//
// The swap is a list of renames recorded in import-staging/swap.json as they
// happen. A failed rename (Windows: a file held open by antivirus, Explorer or a
// second server) is retried for a while, then everything already moved is put
// back and the reason is saved in failed.json for the Admin page. A crash in the
// middle resumes from the journal on the next start.
// ---------------------------------------------------------------------------
//
// Files: backup-format.js (the format, what goes in), this file (export), restore.js (import, swap).

/**
 * A readable stream of a complete, encrypted backup. `db` is the open database.
 * onProgress({ done, total }) is called as file bytes go out.
 */
function exportStream(db, passphrase, { onProgress } = {}) {
  if (String(passphrase || '').length < 8) throw new Error('Use a passphrase of at least 8 characters.');
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(16);
  const keys = deriveKeys(passphrase, salt);
  const header = Buffer.from(JSON.stringify({
    app: config.name, version: config.version, created_at: new Date().toISOString(),
    salt: salt.toString('hex'), iv: iv.toString('hex'), scrypt: { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, check: checkValue(keys.mac),
  }), 'utf-8');
  const head = Buffer.concat([MAGIC, Buffer.alloc(4), header]);
  head.writeUInt32BE(header.length, MAGIC.length);

  const tmpDb = path.join(config.tempDir, `export-${crypto.randomBytes(6).toString('hex')}.db`);
  async function* body() {
    try {
      snapshotDb(db, tmpDb);
      const snap = new DatabaseSync(tmpDb, { readOnly: true });
      const schema = snap.prepare('PRAGMA user_version').get().user_version;
      const counts = snap.prepare('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM files) AS files').get();
      snap.close();
      const files = listData(db);
      const appDbs = listApps().dbs;
      const manifest = zlib.gzipSync(JSON.stringify({
        app: config.name, version: config.version, schema, created_at: new Date().toISOString(), ...counts,
        data_files: files.length, data_bytes: files.reduce((a, f) => a + f.size, 0),
        master_key: process.env.MASTER_KEY,
        // the apps whose folders this backup replaces on restore
        apps: APP_IDS,
      }), { level: 9 });
      yield entryHeader('manifest.json', true, manifest.length);
      yield manifest;

      const dbGz = `${tmpDb}.gz`;
      await pipeline(fs.createReadStream(tmpDb), zlib.createGzip({ level: 9 }), fs.createWriteStream(dbGz));
      fs.rmSync(tmpDb, { force: true });
      yield entryHeader('akulavbox.db', true, fs.statSync(dbGz).size);
      for await (const c of fs.createReadStream(dbGz)) yield c;
      fs.rmSync(dbGz, { force: true });

      // the apps' databases, each a consistent snapshot (another connection may be writing)
      for (const d of appDbs) {
        try {
          const src = new DatabaseSync(d.path);
          try { snapshotDb(src, tmpDb); } finally { src.close(); }
        } catch (e) { continue; } // deleted since the listing
        await pipeline(fs.createReadStream(tmpDb), zlib.createGzip({ level: 9 }), fs.createWriteStream(dbGz));
        fs.rmSync(tmpDb, { force: true });
        yield entryHeader(d.name, true, fs.statSync(dbGz).size);
        for await (const c of fs.createReadStream(dbGz)) yield c;
        fs.rmSync(dbGz, { force: true });
      }

      const total = files.reduce((a, f) => a + f.size, 0);
      let done = 0;
      for (const f of files) {
        let size;
        try { size = fs.statSync(f.path).size; } catch (e) { continue; } // deleted since the listing
        yield entryHeader(f.name, false, size);
        let sent = 0;
        for await (const c of fs.createReadStream(f.path, { end: size - 1 })) {
          const part = c.length > size - sent ? c.subarray(0, size - sent) : c;
          sent += part.length; done += part.length;
          yield part;
        }
        if (sent < size) yield Buffer.alloc(size - sent); // the file shrank while reading: keep the stream aligned
        if (onProgress) onProgress({ done, total });
      }
      yield Buffer.from([END]);
    } finally {
      fs.rmSync(tmpDb, { force: true });
      fs.rmSync(`${tmpDb}.gz`, { force: true });
    }
  }

  const cipher = crypto.createCipheriv('aes-256-ctr', keys.enc, iv);
  const mac = crypto.createHmac('sha256', keys.mac).update(head);
  return Readable.from((async function* sealed() {
    yield head;
    for await (const chunk of body()) { const c = cipher.update(chunk); mac.update(c); yield c; }
    const tail = cipher.final();
    if (tail.length) { mac.update(tail); yield tail; }
    yield mac.digest();
  })());
}

module.exports = { exportStream, estimate, ...restore };
