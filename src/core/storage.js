const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const thumbs = require('./thumbs');
const { pipeline } = require('stream/promises');

// ---------------------------------------------------------------------------
// On-disk layout and encryption (unchanged since 1.0, so old files keep working):
//   data/users/<owner>/<fileId>.enc     AES-256-CTR, IV in files.iv_hex
//   data/users/<owner>/<fileId>.plain   while the file has a public link
// ---------------------------------------------------------------------------

const MASTER_KEY = Buffer.from(process.env.MASTER_KEY || '', 'utf-8');

/**
 * One path segment from the database. Ids are UUIDs, but a restored backup's database
 * is not to be trusted with paths: "../x" or "a/b" must never reach outside data/users.
 */
const segment = (s) => {
  const v = String(s ?? '');
  return v && v !== '.' && v !== '..' && !/[\\/\u0000]/.test(v) ? v : '_invalid_';
};
const userDirOf = (userId) => path.join(config.usersDir, segment(userId));
const diskPathOf = (file) => path.join(userDirOf(file.owner_id), `${segment(file.id)}.${file.is_encrypted ? 'enc' : 'plain'}`);

/**
 * AES-256-CTR positioned at any byte offset: the counter jumps to the offset's
 * block and the keystream is advanced past the bytes before it. Lets chunked
 * uploads encrypt each chunk in place and lets range requests decrypt from anywhere.
 */
function ctrAt(ivHex, offset = 0) {
  const block = BigInt(Math.floor(offset / 16));
  const counter = ((BigInt('0x' + ivHex) + block) % (1n << 128n)).toString(16).padStart(32, '0');
  const c = crypto.createCipheriv('aes-256-ctr', MASTER_KEY, Buffer.from(counter, 'hex'));
  const skip = offset % 16;
  if (skip) c.update(Buffer.alloc(skip));
  return c;
}

/** Readable stream of the plain bytes start..end (inclusive) of a stored file */
function readRange(file, start, end) {
  const filePath = diskPathOf(file);
  const raw = fs.createReadStream(filePath, { start, end });
  if (!file.is_encrypted) return raw;
  const d = ctrAt(file.iv_hex, start);
  raw.on('error', (e) => d.destroy(e));
  return raw.pipe(d);
}

/** Readable stream of a whole stored file (decrypted) */
function readAll(file) {
  const p = diskPathOf(file);
  const size = fs.existsSync(p) ? fs.statSync(p).size : 0;
  if (!size) return null;
  return readRange(file, 0, size - 1);
}

// ---------------------------------------------------------------------------
// Disk space
// ---------------------------------------------------------------------------
function diskSpace() {
  try {
    const s = fs.statfsSync(config.storageDir);
    const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
    return { total, free, used: total - s.bfree * s.bsize };
  } catch (e) { return null; }
}

/** Is there room for `bytes` more, keeping the configured reserve free? */
function hasRoomFor(bytes) {
  const d = diskSpace();
  return !d || d.free - bytes >= config.diskReserveBytes;
}

async function dirSize(dir) {
  let bytes = 0, files = 0;
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return { bytes, files }; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const s = await dirSize(p); bytes += s.bytes; files += s.files; }
    else { try { bytes += (await fs.promises.stat(p)).size; files++; } catch (err) { /* vanished */ } }
  }
  return { bytes, files };
}

// ---------------------------------------------------------------------------
// Permanent deletion (the trash calls this when it is emptied)
// ---------------------------------------------------------------------------
// Foreign keys aren't enforced, so every reference is cleaned up by hand. Prepared once:
// emptying a big trash runs these for thousands of files.
const PURGE = [
  'DELETE FROM files WHERE id = ?1',
  'DELETE FROM album_images WHERE file_id = ?1',
  'DELETE FROM playlist_songs WHERE file_id = ?1',
  'DELETE FROM song_covers WHERE file_id = ?1 OR cover_file_id = ?1',
  'UPDATE albums SET cover_file_id = NULL WHERE cover_file_id = ?1',
  'UPDATE collections SET cover_file_id = NULL WHERE cover_file_id = ?1',
  'UPDATE playlists SET cover_file_id = NULL WHERE cover_file_id = ?1',
  'DELETE FROM media_collection_items WHERE file_id = ?1',
  'UPDATE media_collections SET cover_file_id = NULL WHERE cover_file_id = ?1',
  'DELETE FROM media_meta WHERE file_id = ?1',
  'UPDATE media_meta SET thumb_file_id = NULL WHERE thumb_file_id = ?1',
].map(sql => db.prepare(sql));
const giveBack = db.prepare('UPDATE users SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?');

function purgeFile(file) {
  // one transaction: a crash halfway must not leave references to a deleted row or a wrong quota
  db.tx(() => {
    for (const st of PURGE) st.run(file.id);
    giveBack.run(file.size_bytes, file.owner_id);
  });
  // the data goes once the row is gone (a leftover file is an orphan the storage check removes)
  try { fs.unlinkSync(diskPathOf(file)); } catch (e) { /* already gone */ }
  thumbs.purge(file.owner_id, file.id);
}

/**
 * Encrypt a file that is already on this server (e.g. a finished link download)
 * into someone's storage. Checks quota and free disk first. Returns the new file row.
 */
async function storeFile({ ownerId, folderId, srcPath, filename, mime }) {
  const size = fs.statSync(srcPath).size;
  const u = db.prepare('SELECT quota_bytes, used_bytes FROM users WHERE id = ?').get(ownerId);
  if (!u || u.used_bytes + size > u.quota_bytes) throw Object.assign(new Error('Storage quota exceeded'), { code: 'QUOTA' });
  if (!hasRoomFor(size)) throw Object.assign(new Error('The server’s disk is full'), { code: 'DISK' });
  const id = crypto.randomUUID();
  const iv = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(userDirOf(ownerId), { recursive: true });
  const dest = path.join(userDirOf(ownerId), `${id}.enc`);
  await pipeline(fs.createReadStream(srcPath), ctrAt(iv, 0), fs.createWriteStream(dest));
  db.tx(() => {
    db.prepare(`INSERT INTO files (id, owner_id, folder_id, filename, size_bytes, mime_type, is_encrypted, iv_hex, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, datetime('now'))`).run(id, ownerId, folderId, filename, size, mime, iv);
    db.prepare('UPDATE users SET used_bytes = used_bytes + ? WHERE id = ?').run(size, ownerId);
  });
  return db.prepare('SELECT * FROM files WHERE id = ?').get(id);
}

/**
 * Swap a stored file's contents for a file on this server, keeping its id (and so
 * its albums, collections, details and share link). A fresh IV is used: a CTR IV
 * is never reused with new content. Shared files stay plain. Readers see the old
 * or the new file, never half of one. Returns the updated row.
 */
async function replaceFile(file, srcPath, { filename, mime } = {}) {
  const size = fs.statSync(srcPath).size;
  const delta = size - file.size_bytes;
  const u = db.prepare('SELECT quota_bytes, used_bytes FROM users WHERE id = ?').get(file.owner_id);
  if (delta > 0 && u.used_bytes + delta > u.quota_bytes) throw Object.assign(new Error('Storage quota exceeded'), { code: 'QUOTA' });
  if (!hasRoomFor(size)) throw Object.assign(new Error('The server’s disk is full'), { code: 'DISK' });
  const dest = diskPathOf(file);
  const tmp = `${dest}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const iv = file.is_encrypted ? crypto.randomBytes(16).toString('hex') : file.iv_hex;
  try {
    if (file.is_encrypted) await pipeline(fs.createReadStream(srcPath), ctrAt(iv, 0), fs.createWriteStream(tmp));
    else await pipeline(fs.createReadStream(srcPath), fs.createWriteStream(tmp));
    fs.renameSync(tmp, dest);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (err) { /* never written */ }
    throw e;
  }
  db.tx(() => {
    db.prepare('UPDATE files SET size_bytes = ?, iv_hex = ?, filename = COALESCE(?, filename), mime_type = COALESCE(?, mime_type) WHERE id = ?')
      .run(size, iv, filename || null, mime || null, file.id);
    db.prepare('UPDATE users SET used_bytes = MAX(0, used_bytes + ?) WHERE id = ?').run(delta, file.owner_id);
  });
  thumbs.purge(file.owner_id, file.id);
  return db.prepare('SELECT * FROM files WHERE id = ?').get(file.id);
}

// ---------------------------------------------------------------------------
// Zip downloads
// ---------------------------------------------------------------------------
const STORED_EXT = /\.(jpe?g|png|gif|webp|avif|heic|heif|mp4|m4v|mov|webm|mkv|avi|mp3|m4a|aac|ogg|opus|flac|zip|7z|rar|gz|xz|bz2|epub|docx|xlsx|pptx|pdf)$/i;

/** Append files to an archive, de-duplicating names ("a.jpg", "a (2).jpg") */
function appendToZip(archive, entries) {
  const used = new Set();
  for (let { file, name } of entries) {
    const stream = readAll(file);
    // a folder called ".." must not become a path that climbs out of wherever the zip is unpacked
    name = name.split('/').map(s => (s === '.' || s === '..' ? '_' : s)).join('/');
    let n = name, i = 2;
    while (used.has(n.toLowerCase())) {
      const dot = name.lastIndexOf('.'), slash = name.lastIndexOf('/');
      n = dot > slash + 1 ? `${name.slice(0, dot)} (${i})${name.slice(dot)}` : `${name} (${i})`;
      i++;
    }
    used.add(n.toLowerCase());
    // already-compressed media is stored as-is: same size, far less CPU
    const opts = { name: n, store: STORED_EXT.test(n) };
    if (stream) archive.append(stream, opts);
    else if (fs.existsSync(diskPathOf(file))) archive.append(Buffer.alloc(0), opts);
  }
}

module.exports = { MASTER_KEY, segment, userDirOf, diskPathOf, ctrAt, readRange, readAll, diskSpace, hasRoomFor, dirSize, purgeFile, appendToZip, storeFile, replaceFile };
