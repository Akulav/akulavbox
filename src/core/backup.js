const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const instance = require('./instance');

// ---------------------------------------------------------------------------
// Full backups (.akbx): every account, password hash, setting, chat, album,
// playlist and file, in one passphrase-protected file.
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
// Importing stages everything in storage/import-staging/ and checks the HMAC.
// The swap happens on the next start, before the database opens
// (applyPending, called from db.js). The data it replaces goes to
// storage/backups/pre-import-<time>/, so an import can be undone by hand.
//
// The swap is a list of renames recorded in import-staging/swap.json as they
// happen. A failed rename (Windows: a file held open by antivirus, Explorer or a
// second server) is retried for a while, then everything already moved is put
// back and the reason is saved in failed.json for the Admin page. A crash in the
// middle resumes from the journal on the next start.
// ---------------------------------------------------------------------------

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

/** Every file under storage/users that belongs to an existing account, plus saved cookies */
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
  return out;
}

/** Rough size of an export, for the admin page */
function estimate(db) {
  const files = listData(db);
  let dbBytes = 0;
  try { dbBytes = fs.statSync(config.dbPath).size; } catch (e) { /* none */ }
  return { files: files.length, bytes: files.reduce((a, f) => a + f.size, 0) + Math.round(dbBytes / 3) };
}

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
      const manifest = zlib.gzipSync(JSON.stringify({
        app: config.name, version: config.version, schema, created_at: new Date().toISOString(), ...counts,
        data_files: files.length, data_bytes: files.reduce((a, f) => a + f.size, 0),
        master_key: process.env.MASTER_KEY,
      }), { level: 9 });
      yield entryHeader('manifest.json', true, manifest.length);
      yield manifest;

      const dbGz = `${tmpDb}.gz`;
      await pipeline(fs.createReadStream(tmpDb), zlib.createGzip({ level: 9 }), fs.createWriteStream(dbGz));
      fs.rmSync(tmpDb, { force: true });
      yield entryHeader('akulavbox.db', true, fs.statSync(dbGz).size);
      for await (const c of fs.createReadStream(dbGz)) yield c;
      fs.rmSync(dbGz, { force: true });

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

// --- import -------------------------------------------------------------------------

/** Pulls exact byte counts out of an async iterator of Buffers */
class ByteReader {
  constructor(iter) { this.it = iter[Symbol.asyncIterator](); this.buf = Buffer.alloc(0); }
  async fill(n) {
    while (this.buf.length < n) {
      const { value, done } = await this.it.next();
      if (done) throw new Error('The backup file is incomplete.');
      this.buf = this.buf.length ? Buffer.concat([this.buf, value]) : value;
    }
  }
  async read(n) { await this.fill(n); const out = this.buf.subarray(0, n); this.buf = this.buf.subarray(n); return out; }
  /** Stream the next n bytes through fn(chunk) (awaited, for backpressure) */
  async pipe(n, fn) {
    let left = n;
    while (left > 0) {
      if (!this.buf.length) await this.fill(1);
      const take = this.buf.subarray(0, Math.min(left, this.buf.length));
      this.buf = this.buf.subarray(take.length);
      left -= take.length;
      await fn(take);
    }
  }
}

/** Read and check the plain header of a backup file; throws on a wrong passphrase */
async function openHeader(file, passphrase) {
  const fd = await fs.promises.open(file, 'r');
  try {
    const start = Buffer.alloc(MAGIC.length + 4);
    await fd.read(start, 0, start.length, 0);
    if (!start.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('That isn’t an AkulavBox backup (.akbx) file.');
    const len = start.readUInt32BE(MAGIC.length);
    if (len > 64 * 1024) throw new Error('That backup file is damaged.');
    const hb = Buffer.alloc(len);
    await fd.read(hb, 0, len, start.length);
    const header = JSON.parse(hb.toString('utf-8'));
    const cost = { N: header.scrypt?.N || SCRYPT.N, r: header.scrypt?.r || SCRYPT.r, p: header.scrypt?.p || SCRYPT.p, maxmem: SCRYPT.maxmem };
    const keys = deriveKeys(passphrase, Buffer.from(header.salt, 'hex'), cost);
    if (checkValue(keys.mac) !== header.check) throw new Error('Wrong passphrase for this backup.');
    return { header, keys, headLength: start.length + len, head: Buffer.concat([start, hb]) };
  } finally { await fd.close(); }
}

/** Same bytes, with the current MASTER_KEY instead of the backup's (AES-CTR: same IV, new keystream) */
function rekey(oldKey, newKey, ivHex) {
  const iv = Buffer.from(ivHex, 'hex');
  const d = crypto.createDecipheriv('aes-256-ctr', oldKey, iv);
  const e = crypto.createCipheriv('aes-256-ctr', newKey, iv);
  return (chunk) => e.update(d.update(chunk));
}

const state = { running: false, step: '', done: 0, total: 0, error: null, ready: null };

/**
 * Unpack and verify a backup into storage/import-staging/. The swap happens on
 * the next start. `currentSchema` refuses backups from newer versions.
 */
async function stageImport(file, passphrase, { currentSchema }) {
  if (state.running) throw new Error('An import is already running.');
  // the server and `scripts/backup.js import` share the staging folder
  const other = stagingBy();
  if (other) throw new Error(`Another import is already running (process ${other}). Wait for it to finish or stop it first.`);
  Object.assign(state, { running: true, step: 'Checking the passphrase', done: 0, total: 0, error: null, ready: null });
  const stage = config.importDir;
  let staged = false;
  try {
    const { header, keys, headLength, head } = await openHeader(file, passphrase);
    const size = (await fs.promises.stat(file)).size;
    if (size < headLength + 32) throw new Error('The backup file is incomplete.');
    const { hasRoomFor } = require('./storage');
    if (!hasRoomFor(size)) throw new Error('There isn’t enough free disk space to restore this backup.');
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(path.join(stage, '.staging'), JSON.stringify({ pid: process.pid }));
    staged = true;
    const body = size - headLength - 32; // a damaged length field must not make us buffer the whole file
    state.total = size; state.step = 'Restoring';

    const mac = crypto.createHmac('sha256', keys.mac).update(head);
    const decipher = crypto.createDecipheriv('aes-256-ctr', keys.enc, Buffer.from(header.iv, 'hex'));
    // everything but the last 32 bytes (the HMAC) is ciphertext
    const src = fs.createReadStream(file, { start: headLength, end: size - 33, highWaterMark: 1024 * 1024 });
    const plain = (async function* () {
      for await (const c of src) { mac.update(c); state.done += c.length; yield decipher.update(c); }
    })();
    const r = new ByteReader(plain);
    let manifest = null, ivs = null, swap = false;
    const localKey = Buffer.from(process.env.MASTER_KEY || '', 'utf-8');

    for (;;) {
      const type = (await r.read(1))[0];
      if (type === END) break;
      if (type !== ENTRY) throw new Error('The backup file is damaged.');
      const name = (await r.read((await r.read(2)).readUInt16BE(0))).toString('utf-8');
      const gz = (await r.read(1))[0] === 1;
      const len = Number((await r.read(8)).readBigUInt64BE(0));
      if (!/^(manifest\.json|akulavbox\.db|users\/[\w-]+\/[\w-]+\.(enc|plain)|private\/cookies\/[\w-]+\.enc)$/.test(name)) throw new Error(`Unexpected entry in the backup: ${name}`);
      // entries that are read whole into memory are small; nothing is bigger than the file
      const cap = name === 'manifest.json' ? 16 * 1024 * 1024 : name.startsWith('private/') ? 1024 * 1024 : body;
      if (len > cap) throw new Error('The backup file is damaged.');

      if (name === 'manifest.json') {
        manifest = JSON.parse(zlib.gunzipSync(await r.read(len)).toString('utf-8'));
        if (manifest.schema > currentSchema) throw new Error(`This backup is from a newer AkulavBox (${manifest.version}). Update this server first.`);
        swap = Buffer.byteLength(manifest.master_key || '', 'utf-8') === 32 && manifest.master_key !== process.env.MASTER_KEY;
        continue;
      }
      if (!manifest) throw new Error('The backup file is damaged (no manifest).');
      // with a new key, an .enc file the database doesn't list (a leftover) can't be
      // re-keyed and would never open again: leave it out
      if (swap && /^users\/.+\.enc$/.test(name) && !(ivs && ivs.has(path.basename(name, '.enc')))) {
        await r.pipe(len, async () => {});
        continue;
      }
      const dest = path.join(stage, ...name.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.createWriteStream(dest);
      const write = (b) => new Promise((ok, fail) => { out.write(b, (e) => (e ? fail(e) : ok())); });
      let transform = null;
      if (name === 'akulavbox.db' && gz) {
        const gun = zlib.createGunzip();
        const done = pipeline(gun, out);
        await r.pipe(len, (c) => new Promise((ok) => { if (gun.write(c)) ok(); else gun.once('drain', ok); }));
        gun.end();
        await done;
        // files are re-keyed with the IVs from the restored database
        if (swap) {
          const s = new DatabaseSync(dest, { readOnly: true });
          ivs = new Map(s.prepare('SELECT id, iv_hex FROM files WHERE is_encrypted = 1').all().map(x => [x.id, x.iv_hex]));
          s.close();
        }
        continue;
      }
      if (swap && name.endsWith('.enc')) {
        const oldKey = Buffer.from(manifest.master_key, 'utf-8');
        if (name.startsWith('private/')) {
          // cookie files: the IV is their first 16 bytes
          const body = await r.read(len);
          const iv = body.subarray(0, 16).toString('hex');
          await write(Buffer.concat([body.subarray(0, 16), rekey(oldKey, localKey, iv)(body.subarray(16))]));
          out.end(); await new Promise(ok => out.on('close', ok));
          continue;
        }
        transform = rekey(oldKey, localKey, ivs.get(path.basename(name, '.enc')));
      }
      await r.pipe(len, (c) => write(transform ? transform(c) : c));
      out.end();
      await new Promise((ok, fail) => { out.on('close', ok); out.on('error', fail); });
    }

    // the file must end exactly at the HMAC
    if (r.buf.length || !(await plain.next()).done) throw new Error('The backup file is damaged (extra data).');
    const fd = await fs.promises.open(file, 'r');
    const tag = Buffer.alloc(32);
    await fd.read(tag, 0, 32, size - 32);
    await fd.close();
    if (!crypto.timingSafeEqual(tag, mac.digest())) throw new Error('The backup file is damaged or was changed (integrity check failed).');
    if (!fs.existsSync(path.join(stage, 'akulavbox.db'))) throw new Error('The backup has no database.');

    const ready = { version: manifest.version, schema: manifest.schema, created_at: manifest.created_at, users: manifest.users, files: manifest.files, staged_at: new Date().toISOString(), rekeyed: swap };
    fs.writeFileSync(path.join(stage, 'ready.json'), JSON.stringify(ready, null, 2));
    fs.rmSync(path.join(stage, '.staging'), { force: true });
    Object.assign(state, { running: false, step: 'Ready', ready });
    return ready;
  } catch (e) {
    // a wrong passphrase or a full disk leaves an earlier staged restore alone
    if (staged) fs.rmSync(stage, { recursive: true, force: true });
    Object.assign(state, { running: false, step: '', error: e.message });
    throw e;
  }
}

const readJson = (name) => { try { return JSON.parse(fs.readFileSync(path.join(config.importDir, name), 'utf-8')); } catch (e) { return null; } };

/** The process that is unpacking a backup right now, if it isn't this one */
function stagingBy() {
  const s = readJson('.staging');
  return s && s.pid !== process.pid && instance.alive(s.pid) ? s.pid : null;
}

/** The staged restore, with `failed: { error, at }` when the last start couldn't apply it */
function pending() {
  const ready = readJson('ready.json');
  if (!ready) return null;
  const failed = readJson('failed.json');
  return failed ? { ...ready, failed } : ready;
}

function cancelPending() {
  if (state.running || stagingBy()) return false;
  fs.rmSync(config.importDir, { recursive: true, force: true });
  Object.assign(state, { step: '', ready: null, error: null });
  return true;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// Windows refuses to rename a folder while anything has a file in it open; virus
// scanners and the search indexer let go within seconds
const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES']);

function move(from, to) {
  if (process.env.AKB_TEST_FAIL_MOVE && path.relative(config.storageDir, from).split(path.sep).join('/') === process.env.AKB_TEST_FAIL_MOVE) throw Object.assign(new Error(`EBUSY: resource busy or locked, rename '${from}'`), { code: 'EBUSY' }); // check.js only
  const until = Date.now() + (Number(process.env.AKB_SWAP_RETRY_MS) || 30000);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  for (let wait = 100; ; wait = Math.min(wait * 2, 2000)) {
    try { fs.renameSync(from, to); return; } catch (e) {
      if (e.code === 'EXDEV') { // another drive or a mounted folder: copy, then remove
        fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
        fs.rmSync(from, { recursive: true, force: true });
        return;
      }
      if (!TRANSIENT.has(e.code) || Date.now() > until) throw e;
      sleep(wait);
    }
  }
}

const describe = (e, from) => {
  const rel = path.relative(config.storageDir, from) || from;
  if (TRANSIENT.has(e.code)) return `Couldn’t move ${rel} (${e.code}): another program has it open. Make sure only one AkulavBox uses this storage folder, close Explorer windows inside it, and let antivirus or OneDrive finish scanning it, then restart.`;
  return `Couldn’t move ${rel}: ${e.message}`;
};

/**
 * Called before the database opens. Moves the current data aside and the staged
 * restore into place. Synchronous: nothing else is running yet. Never throws:
 * on failure the old data stays (or is put back) and the reason is saved.
 */
function applyPending() {
  const stage = config.importDir;
  const ready = pending();
  if (!ready) {
    // an import that died half way (server stopped while unpacking) only takes up space
    if (fs.existsSync(stage) && !stagingBy()) fs.rmSync(stage, { recursive: true, force: true });
    return null;
  }
  const fail = (error) => {
    console.error(`[backup] Couldn’t apply the staged restore: ${error}`);
    try { fs.writeFileSync(path.join(stage, 'failed.json'), JSON.stringify({ error, at: new Date().toISOString() }, null, 2)); } catch (e) { /* shown in the log only */ }
    return null;
  };
  const other = instance.otherServer();
  if (other) return fail(`Another AkulavBox (process ${other}) is using this storage folder. Stop it, then start again. If none is running, delete ${instance.pidFile}.`);

  const journalPath = path.join(stage, 'swap.json');
  const journal = readJson('swap.json') || { aside: path.join(config.backupsDir, `pre-import-${new Date().toISOString().replace(/[:.]/g, '-')}`), done: [] };
  if (!journal.done.length && !fs.existsSync(path.join(stage, 'akulavbox.db'))) return fail('The staged backup has no database. Cancel the restore and import the backup again.');
  const cookiesDir = path.join(config.privateDir, 'cookies');
  const steps = [
    ...['', '-wal', '-shm'].map(s => [config.dbPath + s, path.join(journal.aside, path.basename(config.dbPath) + s)]),
    [config.usersDir, path.join(journal.aside, 'users')],
    [cookiesDir, path.join(journal.aside, 'cookies')],
    [path.join(stage, 'akulavbox.db'), config.dbPath],
    [path.join(stage, 'users'), config.usersDir],
    [path.join(stage, 'private', 'cookies'), cookiesDir],
  ];
  const save = () => fs.writeFileSync(journalPath, JSON.stringify(journal));
  if (journal.done.length) console.log(`[backup] Finishing a restore that was interrupted (${journal.done.length} of ${steps.length} steps done)`);

  let i = journal.done.length;
  try {
    save();
    for (; i < steps.length; i++) {
      const [from, to] = steps[i];
      // a crash right after a rename, before the journal was written
      if (!fs.existsSync(from)) journal.done.push(fs.existsSync(to) ? 'moved' : 'skipped');
      else { move(from, to); journal.done.push('moved'); }
      save();
    }
  } catch (e) {
    const reason = describe(e, steps[i][0]);
    // put back what already moved, newest first, so the server starts on the old data
    try {
      while (journal.done.length) {
        const k = journal.done.length - 1;
        if (journal.done[k] === 'moved') move(steps[k][1], steps[k][0]);
        journal.done.pop();
        save();
      }
      fs.rmSync(journalPath, { force: true });
      try { fs.rmdirSync(journal.aside); } catch (err) { /* not empty or never made */ }
    } catch (e2) {
      // Half swapped: starting now would create an empty database. The journal stays,
      // so the next start carries on from here.
      fail(`${reason} Putting the old data back failed too (${e2.message}). Nothing is lost: it is in ${journal.aside} and ${stage}. Fix the cause and start again; the restore carries on from where it stopped.`);
      throw Object.assign(new Error('The restore stopped half way, so AkulavBox won’t start on incomplete data.'), { fatal: true });
    }
    return fail(reason);
  }

  fs.mkdirSync(config.usersDir, { recursive: true });
  // cached thumbnails belong to the old data
  fs.rmSync(config.thumbsDir, { recursive: true, force: true });
  fs.mkdirSync(config.thumbsDir, { recursive: true });
  try { fs.rmSync(stage, { recursive: true, force: true }); } catch (e) { /* swap.json is complete, so a leftover is harmless */ }
  console.log(`[backup] Restored the backup from ${ready.created_at} (${ready.users} accounts, ${ready.files} files). The previous data is in ${journal.aside}`);
  return { version: ready.version, created_at: ready.created_at, users: ready.users, files: ready.files, previous: journal.aside };
}

module.exports = { exportStream, estimate, stageImport, pending, cancelPending, applyPending, stagingBy, state, openHeader };
