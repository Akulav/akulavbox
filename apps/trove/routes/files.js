const db = require('../../../src/core/db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const config = require('../../../src/core/config');
const { verifyUser } = require('../../../src/core/auth');
const activity = require('../../../src/core/activity');
const { guessMime } = require('../lib/mime');
const lib = require('../lib/library');
const thumbs = require('../lib/thumbs');
const store = require('../lib/storage');
const trash = require('../lib/trash');
const apps = require('../../../src/core/apps');

const { MASTER_KEY, userDirOf, diskPathOf } = store;
const { cleanName } = require('../lib/serve');
const UPLOAD_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

// Folders, uploads, moving, renaming, trashing and sharing files, and editing text files in place.
// Opening files and thumbnails are in media.js, zips and public links in zip.js, the account in user.js.

/** Counts bytes flowing through (to enforce quota while a chunk streams in) */
class Meter extends Transform {
  constructor(limit) { super(); this.bytes = 0; this.limit = limit; }
  _transform(chunk, enc, cb) {
    this.bytes += chunk.length;
    if (this.bytes > this.limit) return cb(Object.assign(new Error('Storage quota exceeded'), { code: 'QUOTA' }));
    cb(null, chunk);
  }
}

module.exports = async function (fastify) {

  fastify.register(require('@fastify/multipart'), {
    limits: { fileSize: 50 * 1024 * 1024 * 1024 } // 50 GB per file
  });


  const tempDir = config.tempDir;

  // Abandoned chunked uploads (older than 24h) are cleaned every hour
  const cleanTemp = () => {
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const name of fs.readdirSync(tempDir)) {
        const p = path.join(tempDir, name);
        try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch (e) { /* ignore */ }
      }
    } catch (e) { fastify.log.warn(e, 'temp cleanup failed'); }
  };
  cleanTemp();
  setInterval(cleanTemp, 60 * 60 * 1000).unref();

  // Trash older than TRASH_DAYS is removed for good
  const sweepTrash = () => { try { const n = trash.purgeExpired(); if (n) fastify.log.info(`trash: removed ${n} expired item(s)`); } catch (e) { fastify.log.warn(e, 'trash sweep failed'); } };
  setTimeout(sweepTrash, 30 * 1000).unref();
  setInterval(sweepTrash, 60 * 60 * 1000).unref();

  // prepared once: these run for every listing, move and upload chunk
  const ownedFolder = db.prepare('SELECT 1 FROM folders WHERE id = ? AND owner_id = ? AND trashed_at IS NULL');
  const parentOf = db.prepare('SELECT parent_id FROM folders WHERE id = ?');
  const crumbOf = db.prepare('SELECT id, name, parent_id, system_key FROM folders WHERE id = ? AND owner_id = ?');
  const ownsFolder = (folderId, userId) => typeof folderId === 'string' && !!ownedFolder.get(folderId, userId);

  // Returns true if `candidateId` is `folderId` itself or one of its descendants
  const isSelfOrDescendant = (folderId, candidateId) => {
    let scan = candidateId;
    const seen = new Set();
    while (scan && !seen.has(scan)) {
      if (scan === folderId) return true;
      seen.add(scan);
      const row = parentOf.get(scan);
      scan = row ? row.parent_id : null;
    }
    return false;
  };

  // what is left of the account's storage space, shared with its other apps (their usage is cached
  // for a minute, so a chunk costs one query here)
  const quotaLeft = (userId) => apps.room(userId, 'box');

  // --- FOLDERS ---
  function createFolder(userId, name, parentId) {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO folders (id, owner_id, parent_id, name) VALUES (?, ?, ?, ?)').run(id, userId, parentId, name);
    return id;
  }

  fastify.post('/api/folders', { preHandler: verifyUser }, async (request, reply) => {
    const name = cleanName(request.body?.name);
    const parentId = request.body?.parent_id || null;
    if (!name) return reply.code(400).send({ error: 'Folder name is required' });
    if (parentId && !ownsFolder(parentId, request.user.id)) return reply.code(404).send({ error: 'Parent folder not found' });
    if (parentId && lib.systemKeyOf(parentId)) return reply.code(400).send({ error: 'Locked library folders can’t contain sub-folders.' });
    return { success: true, id: createFolder(request.user.id, name, parentId) };
  });

  // Find or create a nested path ("Trip/Day 1") under a parent — used by folder uploads
  fastify.post('/api/folders/path', { preHandler: verifyUser }, async (request, reply) => {
    const parentId = request.body?.parent_id || null;
    const parts = String(request.body?.path || '').split('/').map(cleanName).filter(Boolean).slice(0, 32);
    if (parentId && !ownsFolder(parentId, request.user.id)) return reply.code(404).send({ error: 'Parent folder not found' });
    if (parentId && lib.systemKeyOf(parentId) && parts.length) return reply.code(400).send({ error: 'Locked library folders can’t contain sub-folders.' });
    const find = db.prepare('SELECT id FROM folders WHERE owner_id = ? AND parent_id IS ? AND name = ? AND trashed_at IS NULL AND system_key IS NULL LIMIT 1');
    let cur = parentId;
    for (const name of parts) {
      const hit = find.get(request.user.id, cur, name);
      cur = hit ? hit.id : createFolder(request.user.id, name, cur);
    }
    return { id: cur };
  });

  fastify.get('/api/folders/all', { preHandler: verifyUser }, async (request) => {
    return db.prepare(`SELECT id, name, parent_id, system_key FROM folders WHERE owner_id = ? AND trashed_at IS NULL AND (system_key IS NULL OR system_key NOT IN ${lib.hiddenSql(request.user.id)}) ORDER BY name COLLATE NOCASE`).all(request.user.id);
  });

  fastify.patch('/api/folders/:id/name', { preHandler: verifyUser }, async (request, reply) => {
    const name = cleanName(request.body?.name);
    if (!name) return reply.code(400).send({ error: 'Folder name is required' });
    const folder = db.prepare('SELECT name, system_key FROM folders WHERE id = ? AND owner_id = ? AND trashed_at IS NULL').get(request.params.id, request.user.id);
    if (!folder) return reply.code(404).send({ error: 'Folder not found' });
    if (folder.system_key) return reply.code(400).send({ error: 'Locked library folders can’t be renamed.' });
    db.prepare('UPDATE folders SET name = ? WHERE id = ? AND owner_id = ?').run(name, request.params.id, request.user.id);
    return { success: true };
  });

  /** Shared by single and bulk moves. Returns an error string or null. */
  function moveFolder(userId, id, targetFolderId) {
    if (!ownsFolder(id, userId)) return 'Folder not found';
    if (lib.systemKeyOf(id)) return 'Locked library folders can’t be moved.';
    if (targetFolderId) {
      if (!ownsFolder(targetFolderId, userId)) return 'Destination not found';
      if (lib.systemKeyOf(targetFolderId)) return 'Locked library folders can’t contain sub-folders.';
      // Moving a folder into itself or into one of its own sub-folders would create a cycle
      if (isSelfOrDescendant(id, targetFolderId)) return 'Cannot move a folder into itself or one of its sub-folders';
    }
    db.prepare('UPDATE folders SET parent_id = ? WHERE id = ? AND owner_id = ?').run(targetFolderId, id, userId);
    return null;
  }
  function moveFile(userId, id, folderId) {
    if (folderId && !ownsFolder(folderId, userId)) return 'Destination not found';
    const file = db.prepare('SELECT filename, mime_type FROM files WHERE id = ? AND owner_id = ? AND trashed_at IS NULL').get(id, userId);
    if (!file) return 'File not found';
    // Files can be moved into a library folder (that adds them to Photos/Music/Videos/Books) if the type fits
    const sysKey = lib.systemKeyOf(folderId);
    if (sysKey && !lib.accepts(sysKey, file.filename, file.mime_type)) return lib.rejectMessage(sysKey);
    db.prepare('UPDATE files SET folder_id = ? WHERE id = ? AND owner_id = ?').run(folderId, id, userId);
    if (sysKey === 'videos' || sysKey === 'xxx') require('../lib/downloader').probeSoon();
    return null;
  }
  const errCode = (msg) => (/not found/i.test(msg) ? 404 : 400);

  fastify.patch('/api/folders/:id/move', { preHandler: verifyUser }, async (request, reply) => {
    const err = moveFolder(request.user.id, request.params.id, request.body?.folder_id || null);
    return err ? reply.code(errCode(err)).send({ error: err }) : { success: true };
  });

  // Deleting a folder moves it (and everything in it) to the trash
  fastify.delete('/api/folders/:id', { preHandler: verifyUser }, async (request, reply) => {
    const folder = db.prepare('SELECT system_key FROM folders WHERE id = ? AND owner_id = ? AND trashed_at IS NULL').get(request.params.id, request.user.id);
    if (!folder) return reply.code(404).send({ error: 'Folder not found' });
    if (folder.system_key) return reply.code(400).send({ error: 'Locked library folders can’t be deleted.' });
    trash.trashFolder(request.params.id, request.user.id);
    return { success: true, trashed: true };
  });

  // Folder sizes and item counts for the whole tree in one pass (1.x ran a recursive query per folder)
  function folderStats(userId) {
    const folders = db.prepare('SELECT id, parent_id, system_key FROM folders WHERE owner_id = ? AND trashed_at IS NULL').all(userId);
    const hiddenKeys = lib.hiddenKeys(userId);
    const hidden = new Set(folders.filter(f => hiddenKeys.includes(f.system_key)).map(f => f.id));
    const sums = db.prepare('SELECT folder_id, SUM(size_bytes) AS bytes, COUNT(*) AS n FROM files WHERE owner_id = ? AND trashed_at IS NULL GROUP BY folder_id').all(userId);
    const own = new Map(sums.map(s => [s.folder_id, s]));
    const children = new Map();
    for (const f of folders) { if (!children.has(f.parent_id)) children.set(f.parent_id, []); children.get(f.parent_id).push(f.id); }
    const memo = new Map();
    const sizeOf = (id, seen = new Set()) => {
      if (memo.has(id)) return memo.get(id);
      if (seen.has(id)) return 0; // cycle guard for damaged data
      seen.add(id);
      let total = own.get(id)?.bytes || 0;
      for (const c of children.get(id) || []) total += sizeOf(c, seen);
      memo.set(id, total);
      return total;
    };
    // sizes include covers (they use space), counts only what Files shows
    const countOf = (id) => (own.get(id)?.n || 0) + (children.get(id) || []).filter(c => !hidden.has(c)).length;
    return { sizeOf, countOf };
  }

  const sysInfo = (key) => key ? { section: lib.SYSTEM[key]?.section, accepts: lib.SYSTEM[key]?.accepts, role: lib.SYSTEM[key]?.role || null } : {};

  fastify.get('/api/directory/:folderId?', { preHandler: verifyUser }, async (request, reply) => {
    const uid = request.user.id;
    const folderId = request.params.folderId || null;
    if (folderId && !ownsFolder(folderId, uid)) return reply.code(404).send({ error: 'Folder not found' });
    // a turned-off XXX folder doesn't exist as far as Files is concerned
    if (folderId && lib.OPT_IN.includes(lib.systemKeyOf(folderId)) && !lib.showsXxx(uid)) return reply.code(404).send({ error: 'Folder not found' });

    const folders = db.prepare(`SELECT id, name, parent_id, system_key FROM folders WHERE owner_id = ? AND parent_id IS ? AND trashed_at IS NULL AND (system_key IS NULL OR system_key NOT IN ${lib.hiddenSql(uid)})`).all(uid, folderId);
    const files = db.prepare(`SELECT id, filename, size_bytes, mime_type, is_encrypted, public_hash, created_at FROM files
      WHERE owner_id = ? AND folder_id IS ? AND trashed_at IS NULL`).all(uid, folderId);

    const stats = folderStats(uid);
    for (const f of folders) {
      f.size_bytes = stats.sizeOf(f.id);
      f.item_count = stats.countOf(f.id);
      f.is_system = f.system_key ? 1 : 0;
      if (f.system_key) Object.assign(f, sysInfo(f.system_key));
    }
    // Locked folders always come first, in a fixed order
    const order = Object.keys(lib.SYSTEM);
    folders.sort((a, b) => (a.system_key ? order.indexOf(a.system_key) : 99) - (b.system_key ? order.indexOf(b.system_key) : 99));

    // Breadcrumb path (guarded against cycles from older data)
    const currentPath = [];
    if (folderId) {
      let scan = folderId;
      const seen = new Set();
      while (scan && !seen.has(scan)) {
        seen.add(scan);
        const doc = crumbOf.get(scan, uid);
        if (!doc) break;
        currentPath.unshift({ id: doc.id, name: doc.name, system_key: doc.system_key || null, ...(doc.system_key ? sysInfo(doc.system_key) : {}) });
        scan = doc.parent_id;
      }
    }
    return { folders, files, currentPath };
  });

  // Search across every folder the user owns
  fastify.get('/api/search', { preHandler: verifyUser }, async (request) => {
    const q = String(request.query.q || '').trim();
    if (q.length < 2) return { files: [], folders: [] };
    const like = `%${q.replace(/[%_\\]/g, m => '\\' + m)}%`;
    const hidden = lib.hiddenSql(request.user.id);
    const files = db.prepare(`
      SELECT f.id, f.filename, f.size_bytes, f.mime_type, f.is_encrypted, f.public_hash, f.created_at, f.folder_id, d.name AS folder_name
      FROM files f LEFT JOIN folders d ON d.id = f.folder_id
      WHERE f.owner_id = ? AND f.trashed_at IS NULL AND (d.system_key IS NULL OR d.system_key NOT IN ${hidden}) AND f.filename LIKE ? ESCAPE '\\' ORDER BY f.filename COLLATE NOCASE LIMIT 200
    `).all(request.user.id, like);
    const folders = db.prepare(`
      SELECT id, name, parent_id, system_key, (system_key IS NOT NULL) AS is_system FROM folders
      WHERE owner_id = ? AND trashed_at IS NULL AND (system_key IS NULL OR system_key NOT IN ${hidden}) AND name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT 50
    `).all(request.user.id, like);
    return { files, folders };
  });

  // --- UPLOADS ---
  // Chunks are encrypted as they arrive and written at their byte offset into
  // one .part file (AES-CTR can start at any offset), so the last chunk only
  // has to rename it into place. 1.x wrote plain chunks and then re-read and
  // encrypted the whole file, doubling the disk work for big uploads.
  fastify.post('/api/files/upload', { preHandler: verifyUser }, async (request, reply) => {
    let partPath = null, metaPath = null;
    const uid = request.user.id;
    const drop = (data, code, error) => { data.file.resume(); return reply.code(code).send({ error }); };
    try {
      const data = await request.file();
      if (!data) return reply.code(400).send({ error: 'No file uploaded' });

      const fields = data.fields;
      const uploadId = fields.upload_id?.value;
      const chunkIndex = parseInt(fields.chunk_index?.value || '0', 10);
      const totalChunks = parseInt(fields.total_chunks?.value || '1', 10);
      const totalSize = fields.total_size?.value !== undefined ? parseInt(fields.total_size.value, 10) : null;
      const folderIdRaw = fields.folder_id?.value;
      const folderId = folderIdRaw && folderIdRaw !== 'null' ? folderIdRaw : null;

      // upload_id is used to build a path on disk, so it must be strictly validated
      if (!uploadId || !UPLOAD_ID_RE.test(uploadId)) return drop(data, 400, 'Missing or invalid upload id');
      if (folderId && !ownsFolder(folderId, uid)) return drop(data, 404, 'Destination folder not found');

      const filename = cleanName(data.filename) || 'untitled';
      const sysKey = lib.systemKeyOf(folderId);
      if (sysKey && !lib.accepts(sysKey, filename, data.mimetype)) return drop(data, 400, lib.rejectMessage(sysKey));

      partPath = path.join(tempDir, `${uid}-${uploadId}.part`);
      metaPath = `${partPath}.json`;
      const current = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
      const offsetRaw = fields.offset?.value;
      // Older clients don't send offsets: they append
      const offset = offsetRaw !== undefined ? parseInt(offsetRaw, 10) : (chunkIndex === 0 ? 0 : current);
      if (!(offset >= 0) || offset > current) return drop(data, 409, 'Upload chunk out of order, restart the upload');

      // Refuse early instead of filling the disk with a file that can't be kept
      const left = quotaLeft(uid);
      if (offset === 0 && totalSize !== null && totalSize > left) return drop(data, 400, 'Storage quota exceeded');
      const incoming = parseInt(request.headers['content-length'] || '0', 10) || 0;
      if (!store.hasRoomFor(incoming)) return drop(data, 507, 'The server’s disk is full. Ask the admin to free up space.');

      let meta;
      if (offset === 0) {
        meta = { iv: crypto.randomBytes(16).toString('hex') };
        fs.writeFileSync(metaPath, JSON.stringify(meta));
      } else {
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch (e) { return drop(data, 409, 'Upload expired, restart the upload'); }
      }

      // A retried chunk overwrites its own bytes instead of being appended twice
      if (offset > 0 && offset < current) fs.truncateSync(partPath, offset);
      const meter = new Meter(Math.max(0, left - offset));
      await pipeline(data.file, meter, store.ctrAt(meta.iv, offset),
        fs.createWriteStream(partPath, offset === 0 ? { flags: 'w' } : { flags: 'r+', start: offset }));
      if (data.file.truncated) throw new Error('File is larger than the 50 GB limit');

      if (chunkIndex < totalChunks - 1) return { success: true, chunk: chunkIndex };

      // --- Last chunk: move into place ---
      const finalSize = fs.statSync(partPath).size;
      if (totalSize !== null && totalSize !== finalSize) throw new Error(`Upload incomplete (${finalSize} of ${totalSize} bytes arrived), try again`);
      if (finalSize > quotaLeft(uid)) throw Object.assign(new Error('Storage quota exceeded'), { code: 'QUOTA' });

      const finalMime = guessMime(filename, data.mimetype);
      const fileId = crypto.randomUUID();
      const userDir = userDirOf(uid);
      fs.mkdirSync(userDir, { recursive: true });
      const encPath = path.join(userDir, `${fileId}.enc`);
      try { fs.renameSync(partPath, encPath); }
      catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(partPath, encPath); fs.unlinkSync(partPath); }
      try { fs.unlinkSync(metaPath); } catch (e) { /* ignore */ }

      db.tx(() => {
        db.prepare(`INSERT INTO files (id, owner_id, folder_id, filename, size_bytes, mime_type, is_encrypted, iv_hex, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, datetime('now'))`).run(fileId, uid, folderId, filename, finalSize, finalMime, meta.iv);
        store.addUsage(uid, finalSize);
      });

      if (lib.categoryOf(filename, finalMime) === 'image') {
        thumbs.warm(db.prepare('SELECT * FROM files WHERE id = ?').get(fileId), encPath, MASTER_KEY);
      }
      // a video in Videos or XXX: read its codec in the background (the format badge, "Convert to AV1")
      if (sysKey === 'videos' || sysKey === 'xxx') require('../lib/downloader').probeSoon();
      return { success: true, fileId };
    } catch (err) {
      const quota = err.code === 'QUOTA';
      if (!quota) fastify.log.error(err);
      for (const p of [partPath, metaPath]) { if (p) { try { fs.unlinkSync(p); } catch (e) { /* ignore */ } } }
      return reply.code(quota ? 400 : 500).send({ error: quota ? 'Storage quota exceeded' : (err.message || 'Upload failed') });
    }
  });

  // --- FILES (MOVE, RENAME, TRASH, SHARE) ---
  fastify.patch('/api/files/:id/move', { preHandler: verifyUser }, async (request, reply) => {
    const err = moveFile(request.user.id, request.params.id, request.body?.folder_id || null);
    return err ? reply.code(errCode(err)).send({ error: err }) : { success: true };
  });

  // ids from a request body: anything but a string (an object, a number) would make SQLite throw
  const idList = (v) => [].concat(v || []).filter(x => typeof x === 'string' && x).slice(0, 5000);

  // Move many files and folders in one request: { files: [], folders: [], folder_id }
  fastify.post('/api/items/move', { preHandler: verifyUser }, async (request) => {
    const target = typeof request.body?.folder_id === 'string' ? request.body.folder_id : null;
    const errors = [];
    let moved = 0;
    db.tx(() => {
      for (const id of idList(request.body?.files)) { const e = moveFile(request.user.id, id, target); if (e) errors.push(e); else moved++; }
      for (const id of idList(request.body?.folders)) { const e = moveFolder(request.user.id, id, target); if (e) errors.push(e); else moved++; }
    });
    return { success: !errors.length, moved, errors: [...new Set(errors)] };
  });

  // Move many files and folders to the trash in one request: { files: [], folders: [] }
  fastify.post('/api/items/trash', { preHandler: verifyUser }, async (request) => {
    let n = 0;
    db.tx(() => {
      for (const id of idList(request.body?.files)) if (trash.trashFile(id, request.user.id)) n++;
      for (const id of idList(request.body?.folders)) if (trash.trashFolder(id, request.user.id)) n++;
    });
    return { success: true, trashed: n };
  });

  fastify.patch('/api/files/:id/name', { preHandler: verifyUser }, async (request, reply) => {
    const name = cleanName(request.body?.name);
    if (!name) return reply.code(400).send({ error: 'File name is required' });
    const file = db.prepare('SELECT mime_type, folder_id FROM files WHERE id = ? AND owner_id = ? AND trashed_at IS NULL').get(request.params.id, request.user.id);
    if (!file) return reply.code(404).send({ error: 'File not found' });
    const sysKey = lib.systemKeyOf(file.folder_id);
    if (sysKey && !lib.accepts(sysKey, name, guessMime(name))) return reply.code(400).send({ error: `That name would change the file type. ${lib.rejectMessage(sysKey)}` });
    db.prepare('UPDATE files SET filename = ?, mime_type = ? WHERE id = ?').run(name, guessMime(name, file.mime_type), request.params.id);
    return { success: true };
  });

  // Deleting a file moves it to the trash; ?permanent=1 removes it right away
  fastify.delete('/api/files/:id', { preHandler: verifyUser }, async (request, reply) => {
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
    if (!file) return reply.code(404).send({ error: 'File not found' });
    if (request.query.permanent === '1' || file.trashed_at) { store.purgeFile(file); return { success: true, trashed: false }; }
    trash.trashFile(file.id, request.user.id);
    return { success: true, trashed: true };
  });

  fastify.patch('/api/files/:id/share', { preHandler: verifyUser }, async (request, reply) => {
    const { is_shared } = request.body || {};
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ? AND trashed_at IS NULL').get(request.params.id, request.user.id);
    if (!file) return reply.code(404).send({ error: 'File not found' });

    const userDir = userDirOf(request.user.id);
    const encPath = path.join(userDir, `${file.id}.enc`);
    const plainPath = path.join(userDir, `${file.id}.plain`);
    const tmp = path.join(userDir, `${file.id}.${crypto.randomBytes(4).toString('hex')}.swap`);

    // Write the new copy first, switch the database, then remove the old copy,
    // so a viewer streaming the file at that moment never hits a missing file.
    try {
      if (is_shared && file.is_encrypted) {
        const publicHash = crypto.randomBytes(12).toString('hex');
        await pipeline(fs.createReadStream(encPath), store.ctrAt(file.iv_hex, 0), fs.createWriteStream(tmp));
        fs.renameSync(tmp, plainPath);
        db.prepare('UPDATE files SET is_encrypted = 0, public_hash = ? WHERE id = ?').run(publicHash, file.id);
        try { fs.unlinkSync(encPath); } catch (e) { /* ignore */ }
        activity.log(request, 'share.created', { target: file.filename });
        return { success: true, public_hash: publicHash };
      } else if (!is_shared && !file.is_encrypted) {
        const iv = crypto.randomBytes(16).toString('hex');
        await pipeline(fs.createReadStream(plainPath), store.ctrAt(iv, 0), fs.createWriteStream(tmp));
        fs.renameSync(tmp, encPath);
        db.prepare('UPDATE files SET is_encrypted = 1, public_hash = NULL, iv_hex = ? WHERE id = ?').run(iv, file.id);
        try { fs.unlinkSync(plainPath); } catch (e) { /* ignore */ }
        activity.log(request, 'share.removed', { target: file.filename });
        return { success: true };
      } else if (is_shared && !file.public_hash) {
        // already stored plain (e.g. recovered by the storage check): only the link is missing
        const publicHash = crypto.randomBytes(12).toString('hex');
        db.prepare('UPDATE files SET public_hash = ? WHERE id = ?').run(publicHash, file.id);
        activity.log(request, 'share.created', { target: file.filename });
        return { success: true, public_hash: publicHash };
      }
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
      fastify.log.error(err);
      return reply.code(500).send({ error: err.code === 'ENOENT' ? 'The file is missing on the server.' : 'Could not change sharing' });
    }
    return { success: true, public_hash: file.public_hash };
  });

  // --- VIEWER, DOWNLOADS & PUBLIC LINKS ---
  // Replace the contents of a text file in place. The file keeps its id, name, folder,
  // album/playlist links and – if it is shared – its public link.
  const EDITABLE_MAX = 5 * 1024 * 1024;
  fastify.put('/api/files/:id/content', { preHandler: verifyUser, bodyLimit: EDITABLE_MAX + 64 * 1024 }, async (request, reply) => {
    const content = request.body?.content;
    if (typeof content !== 'string') return reply.code(400).send({ error: 'Missing file content' });
    const buf = Buffer.from(content, 'utf-8');
    if (buf.length > EDITABLE_MAX) return reply.code(413).send({ error: 'Files larger than 5 MB can’t be edited here.' });

    const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ? AND trashed_at IS NULL').get(request.params.id, request.user.id);
    if (!file) return reply.code(404).send({ error: 'File not found' });

    // Optional conflict check: the client sends the size it loaded; refuse if it changed meanwhile
    const baseSize = request.body?.base_size;
    if (Number.isInteger(baseSize) && baseSize !== file.size_bytes) {
      return reply.code(409).send({ error: 'This file was changed somewhere else since you opened it. Reopen it and try again.' });
    }

    const delta = buf.length - file.size_bytes;
    if (delta > 0 && delta > quotaLeft(request.user.id)) return reply.code(400).send({ error: 'Storage quota exceeded' });

    const finalPath = diskPathOf(file);
    const tmpPath = `${finalPath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    let ivHex = file.iv_hex;
    try {
      if (file.is_encrypted) {
        ivHex = crypto.randomBytes(16).toString('hex');   // never reuse a CTR IV with new content
        const cipher = store.ctrAt(ivHex, 0);
        fs.writeFileSync(tmpPath, Buffer.concat([cipher.update(buf), cipher.final()]));
      } else {
        fs.writeFileSync(tmpPath, buf);      // shared file: stays plain so /shared/<hash> keeps working
      }
      fs.renameSync(tmpPath, finalPath);       // atomic swap: readers see old or new, never half
    } catch (err) {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Could not save the file' });
    }

    db.prepare('UPDATE files SET size_bytes = ?, iv_hex = ? WHERE id = ?').run(buf.length, ivHex, file.id);
    store.addUsage(request.user.id, delta);
    thumbs.purge(file.owner_id, file.id);
    return { success: true, size_bytes: buf.length, public_hash: file.public_hash };
  });

};
