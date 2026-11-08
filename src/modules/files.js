const db = require('../core/db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const bcrypt = require('../core/hash');
const { ZipArchive } = require('archiver');
const config = require('../core/config');
const { verifyUser, signToken } = require('../core/auth');
const { guessMime, isActiveContent } = require('../core/mime');
const lib = require('../core/library');
const thumbs = require('../core/thumbs');
const store = require('../core/storage');
const trash = require('../core/trash');

const { MASTER_KEY, userDirOf, diskPathOf } = store;
const UPLOAD_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const NAME_MAX = 255;
const cleanName = (s) => String(s ?? '').trim().replace(/[\\/]/g, '_').replace(/[\u0000-\u001f]/g, '').slice(0, NAME_MAX);

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

  // Plain HTML form posts (used by "download selection as zip", which must be a real navigation)
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 4 * 1024 * 1024 },
    (req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body))));

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

  const ownsFolder = (folderId, userId) =>
    !!db.prepare('SELECT 1 FROM folders WHERE id = ? AND owner_id = ? AND trashed_at IS NULL').get(folderId, userId);

  // Returns true if `candidateId` is `folderId` itself or one of its descendants
  const isSelfOrDescendant = (folderId, candidateId) => {
    let scan = candidateId;
    const seen = new Set();
    while (scan && !seen.has(scan)) {
      if (scan === folderId) return true;
      seen.add(scan);
      const row = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(scan);
      scan = row ? row.parent_id : null;
    }
    return false;
  };

  const quotaLeft = (userId) => {
    const u = db.prepare('SELECT quota_bytes, used_bytes FROM users WHERE id = ?').get(userId);
    return u ? u.quota_bytes - u.used_bytes : 0;
  };

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
    return db.prepare(`SELECT id, name, parent_id, system_key FROM folders WHERE owner_id = ? AND trashed_at IS NULL AND (system_key IS NULL OR system_key NOT IN ${lib.HIDDEN_SQL}) ORDER BY name COLLATE NOCASE`).all(request.user.id);
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
    const hidden = new Set(folders.filter(f => lib.HIDDEN.includes(f.system_key)).map(f => f.id));
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

    const folders = db.prepare(`SELECT id, name, parent_id, system_key FROM folders WHERE owner_id = ? AND parent_id IS ? AND trashed_at IS NULL AND (system_key IS NULL OR system_key NOT IN ${lib.HIDDEN_SQL})`).all(uid, folderId);
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
        const doc = db.prepare('SELECT id, name, parent_id, system_key FROM folders WHERE id = ? AND owner_id = ?').get(scan, uid);
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
    const files = db.prepare(`
      SELECT f.id, f.filename, f.size_bytes, f.mime_type, f.is_encrypted, f.public_hash, f.created_at, f.folder_id, d.name AS folder_name
      FROM files f LEFT JOIN folders d ON d.id = f.folder_id
      WHERE f.owner_id = ? AND f.trashed_at IS NULL AND (d.system_key IS NULL OR d.system_key NOT IN ${lib.HIDDEN_SQL}) AND f.filename LIKE ? ESCAPE '\\' ORDER BY f.filename COLLATE NOCASE LIMIT 200
    `).all(request.user.id, like);
    const folders = db.prepare(`
      SELECT id, name, parent_id, system_key, (system_key IS NOT NULL) AS is_system FROM folders
      WHERE owner_id = ? AND trashed_at IS NULL AND (system_key IS NULL OR system_key NOT IN ${lib.HIDDEN_SQL}) AND name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT 50
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
        db.prepare('UPDATE users SET used_bytes = used_bytes + ? WHERE id = ?').run(finalSize, uid);
      });

      if (lib.categoryOf(filename, finalMime) === 'image') {
        thumbs.warm(db.prepare('SELECT * FROM files WHERE id = ?').get(fileId), encPath, MASTER_KEY);
      }
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

  // Move many files and folders in one request: { files: [], folders: [], folder_id }
  fastify.post('/api/items/move', { preHandler: verifyUser }, async (request) => {
    const target = request.body?.folder_id || null;
    const errors = [];
    let moved = 0;
    for (const id of [].concat(request.body?.files || []).slice(0, 5000)) { const e = moveFile(request.user.id, id, target); if (e) errors.push(e); else moved++; }
    for (const id of [].concat(request.body?.folders || []).slice(0, 5000)) { const e = moveFolder(request.user.id, id, target); if (e) errors.push(e); else moved++; }
    return { success: !errors.length, moved, errors: [...new Set(errors)] };
  });

  // Move many files and folders to the trash in one request: { files: [], folders: [] }
  fastify.post('/api/items/trash', { preHandler: verifyUser }, async (request) => {
    let n = 0;
    db.tx(() => {
      for (const id of [].concat(request.body?.files || []).slice(0, 5000)) if (trash.trashFile(id, request.user.id)) n++;
    });
    for (const id of [].concat(request.body?.folders || []).slice(0, 5000)) if (trash.trashFolder(id, request.user.id)) n++;
    return { success: true, trashed: n };
  });

  fastify.patch('/api/files/:id/name', { preHandler: verifyUser }, async (request, reply) => {
    const name = cleanName(request.body?.name);
    if (!name) return reply.code(400).send({ error: 'File name is required' });
    const file = db.prepare('SELECT mime_type, folder_id FROM files WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
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
        return { success: true, public_hash: publicHash };
      } else if (!is_shared && !file.is_encrypted) {
        const iv = crypto.randomBytes(16).toString('hex');
        await pipeline(fs.createReadStream(plainPath), store.ctrAt(iv, 0), fs.createWriteStream(tmp));
        fs.renameSync(tmp, encPath);
        db.prepare('UPDATE files SET is_encrypted = 1, public_hash = NULL, iv_hex = ? WHERE id = ?').run(iv, file.id);
        try { fs.unlinkSync(plainPath); } catch (e) { /* ignore */ }
        return { success: true };
      }
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
      fastify.log.error(err);
      return reply.code(500).send({ error: err.code === 'ENOENT' ? 'The file is missing on the server.' : 'Could not change sharing' });
    }
    return { success: true, public_hash: file.public_hash };
  });

  // --- VIEWER, DOWNLOADS & PUBLIC LINKS ---
  const serveStream = (request, reply, file) => {
    const filePath = diskPathOf(file);
    const mime = guessMime(file.filename, file.mime_type);
    const stat = fs.statSync(filePath);
    const totalSize = stat.size;
    const download = request.query.download === '1' || request.query.download === 'true';

    let start = 0;
    let end = totalSize - 1;
    const range = request.headers.range;

    if (range && totalSize > 0) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!m || (m[1] === '' && m[2] === '')) {
        reply.header('Content-Range', `bytes */${totalSize}`);
        return reply.code(416).send();
      }
      if (m[1] === '') {
        // Suffix range: last N bytes
        start = Math.max(0, totalSize - parseInt(m[2], 10));
      } else {
        start = parseInt(m[1], 10);
        end = m[2] ? Math.min(parseInt(m[2], 10), totalSize - 1) : totalSize - 1;
      }
      if (start >= totalSize || start > end) {
        reply.header('Content-Range', `bytes */${totalSize}`);
        return reply.code(416).send();
      }
      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    }

    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Length', totalSize === 0 ? 0 : (end - start) + 1);
    reply.header('Content-Type', mime);
    reply.header('X-Content-Type-Options', 'nosniff');
    // Revalidate every time: files can be edited in place, so a long max-age would show stale content
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    reply.header('ETag', etag);
    reply.header('Cache-Control', 'private, no-cache');
    if (!range && request.headers['if-none-match'] === etag) { reply.removeHeader('Content-Length'); return reply.code(304).send(); }
    // Uploaded HTML/SVG must never run scripts on our origin (would expose the login token)
    if (isActiveContent(mime)) reply.header('Content-Security-Policy', "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'");

    const safeName = encodeURIComponent(file.filename);
    reply.header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${safeName}`);

    if (totalSize === 0) return reply.send('');
    return reply.send(store.readRange(file, start, end));
  };

  // --- USER PROFILE & SETTINGS ---
  fastify.get('/api/user/profile', { preHandler: verifyUser }, async (request) => {
    const p = db.prepare('SELECT id, username, role, quota_bytes, used_bytes, profile_image, created_at FROM users WHERE id = ?').get(request.user.id);
    const t = db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM files WHERE owner_id = ? AND trashed_at IS NOT NULL').get(request.user.id);
    return { ...p, trash_bytes: t.bytes };
  });

  fastify.patch('/api/user/profile', { preHandler: verifyUser }, async (request, reply) => {
    const img = request.body?.profile_image;
    if (img && (typeof img !== 'string' || !img.startsWith('data:image/') || img.length > 2_000_000)) {
      return reply.code(400).send({ error: 'Invalid image' });
    }
    db.prepare('UPDATE users SET profile_image = ? WHERE id = ?').run(img || null, request.user.id);
    return { success: true };
  });

  // Changing the password signs out every other session; this one gets a fresh token
  fastify.patch('/api/user/password', { preHandler: verifyUser }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body || {};
    if (!newPassword || String(newPassword).length < 4) return reply.code(400).send({ error: 'New password must be at least 4 characters' });
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(request.user.id);
    if (!user || !(await bcrypt.compare(String(currentPassword || ''), user.password_hash))) {
      return reply.code(400).send({ error: 'Current password is incorrect' });
    }
    const hash = await bcrypt.hash(String(newPassword), 10);
    db.prepare('UPDATE users SET password_hash = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?').run(hash, request.user.id);
    const fresh = db.prepare('SELECT id, username, role, token_version FROM users WHERE id = ?').get(request.user.id);
    return { success: true, token: signToken(fresh) };
  });

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
    db.prepare('UPDATE users SET used_bytes = MAX(0, used_bytes + ?) WHERE id = ?').run(delta, request.user.id);
    thumbs.purge(file.owner_id, file.id);
    return { success: true, size_bytes: buf.length, public_hash: file.public_hash };
  });

  // ---------------- Thumbnails ----------------
  // GET  /api/files/:id/thumb?w=240|480|960         cached preview (made by sharp if installed)
  //      &cached=1                                   only answer from cache; 404 { source } otherwise,
  //                                                  so the browser knows which image to make it from
  // PUT  /api/files/:id/thumb?w=…&ow=…&oh=…          the browser uploads a thumbnail it made
  fastify.get('/api/thumbs/status', { preHandler: verifyUser }, async () => ({ server: thumbs.available() }));

  const resolveThumbSource = (fileId, userId) => {
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(fileId, userId);
    if (!file) return null;
    if (lib.categoryOf(file.filename, file.mime_type) === 'image') return file;
    const meta = db.prepare('SELECT thumb_file_id FROM media_meta WHERE file_id = ?').get(file.id);
    return (meta && meta.thumb_file_id && db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(meta.thumb_file_id, userId)) || null;
  };

  fastify.get('/api/files/:id/thumb', { preHandler: verifyUser }, async (request, reply) => {
    const file = resolveThumbSource(request.params.id, request.user.id);
    if (!file) return reply.code(404).send({ error: 'No preview' });
    const width = thumbs.pickWidth(request.query.w);
    const filePath = diskPathOf(file);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'Missing on disk' });

    const onlyCached = request.query.cached === '1';
    const hit = onlyCached ? await thumbs.cached(file, width, MASTER_KEY) : await thumbs.get(file, filePath, width, MASTER_KEY);
    if (!hit) {
      if (onlyCached) {
        reply.header('Cache-Control', 'no-store');
        return reply.code(404).send({ error: 'Not generated yet', source: file.id, width });
      }
      // no sharp, or it couldn't decode the image (e.g. HEIC): send the original so plain <img> tags still work
      return serveStream(request, reply, file);
    }
    reply.header('Content-Type', hit.type);
    reply.header('Content-Length', hit.buf.length);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.send(hit.buf);
  });

  fastify.register(async (scope) => {
    scope.addContentTypeParser(['image/webp', 'image/jpeg', 'image/png'], { parseAs: 'buffer', bodyLimit: 3 * 1024 * 1024 }, (req, body, done) => done(null, body));
    scope.put('/api/files/:id/thumb', { preHandler: verifyUser }, async (request, reply) => {
      const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
      if (!file || lib.categoryOf(file.filename, file.mime_type) !== 'image') return reply.code(404).send({ error: 'Image not found' });
      const buf = request.body;
      if (!Buffer.isBuffer(buf) || buf.length < 32) return reply.code(400).send({ error: 'Empty thumbnail' });
      const width = thumbs.pickWidth(request.query.w);
      const ow = parseInt(request.query.ow, 10), oh = parseInt(request.query.oh, 10);
      await thumbs.store(file, width, buf, MASTER_KEY, ow > 0 && oh > 0 ? { width: ow, height: oh } : null);
      return { success: true };
    });
  });

  // Remember natural sizes measured in the browser: { items: [{ id, w, h }] }
  fastify.post('/api/files/dims', { preHandler: verifyUser }, async (request) => {
    const items = Array.isArray(request.body?.items) ? request.body.items.slice(0, 500) : [];
    const owned = db.prepare('SELECT 1 FROM files WHERE id = ? AND owner_id = ?');
    let n = 0;
    for (const it of items) {
      const w = parseInt(it.w, 10), h = parseInt(it.h, 10);
      if (w > 0 && h > 0 && owned.get(it.id, request.user.id)) { thumbs.saveDims(it.id, request.user.id, w, h); n++; }
    }
    return { success: true, saved: n };
  });

  fastify.get('/api/files/:id/view', { preHandler: verifyUser }, async (request, reply) => {
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
    if (!file) return reply.code(404).send({ error: 'File not found' });
    if (!fs.existsSync(diskPathOf(file))) return reply.code(404).send({ error: 'Missing on disk' });
    return serveStream(request, reply, file);
  });

  // --- ZIP DOWNLOADS ---
  function folderEntries(userId, rootId, prefix, out, seen = new Set()) {
    if (seen.has(rootId)) return;
    seen.add(rootId);
    for (const f of db.prepare('SELECT * FROM files WHERE folder_id = ? AND owner_id = ? AND trashed_at IS NULL').all(rootId, userId)) {
      out.push({ file: f, name: prefix + f.filename });
    }
    for (const sub of db.prepare('SELECT id, name FROM folders WHERE parent_id = ? AND owner_id = ? AND trashed_at IS NULL').all(rootId, userId)) {
      folderEntries(userId, sub.id, `${prefix}${sub.name}/`, out, seen);
    }
  }

  function sendZip(reply, name, entries) {
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}.zip`);
    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.on('error', (err) => fastify.log.error(err));
    reply.send(archive);
    store.appendToZip(archive, entries);
    archive.finalize();
    return reply;
  }

  // Download a whole folder (recursively) as a zip
  fastify.get('/api/folders/:id/download', { preHandler: verifyUser }, async (request, reply) => {
    const root = db.prepare('SELECT id, name FROM folders WHERE id = ? AND owner_id = ? AND trashed_at IS NULL').get(request.params.id, request.user.id);
    if (!root) return reply.code(404).send({ error: 'Folder not found' });
    const entries = [];
    folderEntries(request.user.id, root.id, '', entries);
    return sendZip(reply, root.name, entries);
  });

  // Download a selection (files and folders) as one zip. A form POST, so the
  // browser streams it straight to disk: fields token, files, folders (comma separated), name.
  const formAuth = async (request, reply) => {
    if (!request.headers.authorization && request.body?.token) request.headers.authorization = `Bearer ${request.body.token}`;
    return verifyUser(request, reply);
  };
  fastify.post('/api/zip', { preHandler: formAuth }, async (request, reply) => {
    const ids = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 10000);
    const uid = request.user.id;
    const entries = [];
    const fileStmt = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ? AND trashed_at IS NULL');
    for (const id of ids(request.body?.files)) { const f = fileStmt.get(id, uid); if (f) entries.push({ file: f, name: f.filename }); }
    for (const id of ids(request.body?.folders)) {
      const d = db.prepare('SELECT id, name FROM folders WHERE id = ? AND owner_id = ? AND trashed_at IS NULL').get(id, uid);
      if (d) folderEntries(uid, d.id, `${d.name}/`, entries);
    }
    if (!entries.length) return reply.code(404).send({ error: 'Nothing to download' });
    return sendZip(reply, cleanName(request.body?.name) || 'AkulavBox download', entries);
  });

  fastify.get('/shared/:hash', async (request, reply) => {
    const file = db.prepare('SELECT * FROM files WHERE public_hash = ?').get(request.params.hash);
    if (!file || file.is_encrypted || file.trashed_at) return reply.code(404).type('text/plain').send('File not found or is private.');
    if (!fs.existsSync(diskPathOf(file))) return reply.code(404).type('text/plain').send('Missing on disk');
    return serveStream(request, reply, file);
  });
};
