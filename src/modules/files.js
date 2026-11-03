const db = require('../core/db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const bcrypt = require('bcrypt');
const { ZipArchive } = require('archiver');
const { verifyUser } = require('../core/auth');
const { guessMime, isActiveContent } = require('../core/mime');
const lib = require('../core/library');
const thumbs = require('../core/thumbs');

// --- MIGRATIONS ---
try { db.exec('ALTER TABLE files ADD COLUMN created_at TEXT'); } catch (e) { /* already exists */ }

// Helper Stream: Drops excess bytes if the stream request doesn't align perfectly with a 16-byte block
class DropBytes extends Transform {
  constructor(dropCount) { super(); this.dropCount = dropCount; }
  _transform(chunk, enc, cb) {
    if (this.dropCount > 0) {
      if (chunk.length <= this.dropCount) {
        this.dropCount -= chunk.length;
        return cb();
      }
      const toKeep = chunk.subarray(this.dropCount);
      this.dropCount = 0;
      this.push(toKeep);
    } else { this.push(chunk); }
    cb();
  }
}

const UPLOAD_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

module.exports = async function (fastify, opts) {

  fastify.register(require('@fastify/multipart'), {
    limits: { fileSize: 50 * 1024 * 1024 * 1024 } // 50 GB limit
  });

  const MASTER_KEY = Buffer.from(process.env.MASTER_KEY, 'utf-8');

  const userDirOf = (userId) => path.join(process.cwd(), 'storage', 'users', userId);
  const diskPathOf = (file) => path.join(userDirOf(file.owner_id), file.is_encrypted ? `${file.id}.enc` : `${file.id}.plain`);

  // Ensure a temporary directory exists for the chunked uploads
  const tempDir = path.join(process.cwd(), 'storage', 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  // Clean abandoned chunked uploads (older than 24h) every hour
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
  const tempTimer = setInterval(cleanTemp, 60 * 60 * 1000);
  tempTimer.unref();

  const ownsFolder = (folderId, userId) =>
    !!db.prepare('SELECT 1 FROM folders WHERE id = ? AND owner_id = ?').get(folderId, userId);

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

  // --- FOLDERS ---
  fastify.post('/api/folders', { preHandler: verifyUser }, async (request, reply) => {
    const name = (request.body?.name || '').trim();
    const parentId = request.body?.parent_id || null;
    if (!name) return reply.code(400).send({ error: 'Folder name is required' });
    if (parentId && !ownsFolder(parentId, request.user.id)) return reply.code(404).send({ error: 'Parent folder not found' });
    if (parentId && lib.systemKeyOf(parentId)) return reply.code(400).send({ error: 'Locked library folders can’t contain sub-folders.' });
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO folders (id, owner_id, parent_id, name) VALUES (?, ?, ?, ?)').run(id, request.user.id, parentId, name);
    return { success: true, id };
  });

  fastify.get('/api/folders/all', { preHandler: verifyUser }, async (request, reply) => {
    return db.prepare('SELECT id, name, parent_id, system_key FROM folders WHERE owner_id = ? ORDER BY name COLLATE NOCASE').all(request.user.id);
  });

  fastify.patch('/api/folders/:id/name', { preHandler: verifyUser }, async (request, reply) => {
    const name = (request.body?.name || '').trim();
    if (!name) return reply.code(400).send({ error: 'Folder name is required' });
    const folder = db.prepare('SELECT name, system_key FROM folders WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
    if (!folder) return reply.code(404).send({ error: 'Folder not found' });
    if (folder.system_key) return reply.code(400).send({ error: 'Locked library folders can’t be renamed.' });
    db.prepare('UPDATE folders SET name = ? WHERE id = ? AND owner_id = ?').run(name, request.params.id, request.user.id);
    return { success: true };
  });

  fastify.patch('/api/folders/:id/move', { preHandler: verifyUser }, async (request, reply) => {
    const targetFolderId = request.body?.folder_id || null;
    if (!ownsFolder(request.params.id, request.user.id)) return reply.code(404).send({ error: 'Folder not found' });
    if (lib.systemKeyOf(request.params.id)) return reply.code(400).send({ error: 'Locked library folders can’t be moved.' });
    if (targetFolderId) {
      if (!ownsFolder(targetFolderId, request.user.id)) return reply.code(404).send({ error: 'Destination not found' });
      if (lib.systemKeyOf(targetFolderId)) return reply.code(400).send({ error: 'Locked library folders can’t contain sub-folders.' });
      // Moving a folder into itself or into one of its own sub-folders would create a cycle
      if (isSelfOrDescendant(request.params.id, targetFolderId)) {
        return reply.code(400).send({ error: 'Cannot move a folder into itself or one of its sub-folders' });
      }
    }
    db.prepare('UPDATE folders SET parent_id = ? WHERE id = ? AND owner_id = ?').run(targetFolderId, request.params.id, request.user.id);
    return { success: true };
  });

  fastify.delete('/api/folders/:id', { preHandler: verifyUser }, async (request, reply) => {
    const targetFolder = db.prepare('SELECT name, system_key FROM folders WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
    if (!targetFolder) return reply.code(404).send({ error: 'Folder not found' });

    if (targetFolder.system_key) {
      return reply.code(400).send({ error: 'Locked library folders can’t be deleted.' });
    }

    const childFiles = db.prepare('SELECT count(*) as count FROM files WHERE folder_id = ?').get(request.params.id);
    const childFolders = db.prepare('SELECT count(*) as count FROM folders WHERE parent_id = ?').get(request.params.id);
    if (childFiles.count > 0 || childFolders.count > 0) return reply.code(400).send({ error: 'Folder must be empty to delete it.' });

    db.prepare('DELETE FROM folders WHERE id = ? AND owner_id = ?').run(request.params.id, request.user.id);
    return { success: true };
  });

  fastify.get('/api/directory/:folderId?', { preHandler: verifyUser }, async (request, reply) => {
    const folderId = request.params.folderId || null;
    if (folderId && !ownsFolder(folderId, request.user.id)) return reply.code(404).send({ error: 'Folder not found' });

    const folders = folderId
      ? db.prepare('SELECT * FROM folders WHERE owner_id = ? AND parent_id = ?').all(request.user.id, folderId)
      : db.prepare('SELECT * FROM folders WHERE owner_id = ? AND parent_id IS NULL').all(request.user.id);

    const fileCols = 'id, filename, size_bytes, mime_type, is_encrypted, public_hash, created_at';
    const files = folderId
      ? db.prepare(`SELECT ${fileCols} FROM files WHERE owner_id = ? AND folder_id = ?`).all(request.user.id, folderId)
      : db.prepare(`SELECT ${fileCols} FROM files WHERE owner_id = ? AND folder_id IS NULL`).all(request.user.id);

    // Nested folder sizes + item counts
    const sizeStmt = db.prepare(`
      WITH RECURSIVE folder_tree(id) AS (
        SELECT ? AS id
        UNION
        SELECT f.id FROM folders f INNER JOIN folder_tree t ON f.parent_id = t.id
      )
      SELECT SUM(size_bytes) as total FROM files WHERE folder_id IN folder_tree
    `);
    const countStmt = db.prepare(`
      SELECT (SELECT count(*) FROM files WHERE folder_id = ?) + (SELECT count(*) FROM folders WHERE parent_id = ?) AS n
    `);

    folders.forEach(f => {
      f.size_bytes = sizeStmt.get(f.id).total || 0;
      f.item_count = countStmt.get(f.id, f.id).n || 0;
      f.is_system = f.system_key ? 1 : 0;
      if (f.system_key) { f.section = lib.SYSTEM[f.system_key]?.section; f.accepts = lib.SYSTEM[f.system_key]?.accepts; f.role = lib.SYSTEM[f.system_key]?.role || null; }
    });
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
        const doc = db.prepare('SELECT id, name, parent_id, system_key FROM folders WHERE id = ? AND owner_id = ?').get(scan, request.user.id);
        if (!doc) break;
        currentPath.unshift({ id: doc.id, name: doc.name, system_key: doc.system_key || null,
          section: doc.system_key ? lib.SYSTEM[doc.system_key]?.section : undefined, accepts: doc.system_key ? lib.SYSTEM[doc.system_key]?.accepts : undefined, role: doc.system_key ? (lib.SYSTEM[doc.system_key]?.role || null) : undefined });
        scan = doc.parent_id;
      }
    }

    return { folders, files, currentPath };
  });

  // Search across every folder the user owns
  fastify.get('/api/search', { preHandler: verifyUser }, async (request, reply) => {
    const q = String(request.query.q || '').trim();
    if (q.length < 2) return { files: [], folders: [] };
    const like = `%${q.replace(/[%_\\]/g, m => '\\' + m)}%`;
    const files = db.prepare(`
      SELECT f.id, f.filename, f.size_bytes, f.mime_type, f.is_encrypted, f.public_hash, f.created_at, f.folder_id, d.name AS folder_name
      FROM files f LEFT JOIN folders d ON d.id = f.folder_id
      WHERE f.owner_id = ? AND f.filename LIKE ? ESCAPE '\\' ORDER BY f.filename COLLATE NOCASE LIMIT 200
    `).all(request.user.id, like);
    const folders = db.prepare(`
      SELECT id, name, parent_id, system_key, (system_key IS NOT NULL) AS is_system FROM folders WHERE owner_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT 50
    `).all(request.user.id, like);
    return { files, folders };
  });

  // --- FILES (UPLOAD, MOVE, RENAME, DELETE) ---

  fastify.post('/api/files/upload', { preHandler: verifyUser }, async (request, reply) => {
    let tempPath = null;
    try {
      const data = await request.file();
      if (!data) return reply.code(400).send({ error: 'No file uploaded' });

      const fields = data.fields;
      const uploadId = fields.upload_id?.value;
      const chunkIndex = parseInt(fields.chunk_index?.value || '0', 10);
      const totalChunks = parseInt(fields.total_chunks?.value || '1', 10);
      const folderIdRaw = fields.folder_id?.value;
      const folderId = folderIdRaw && folderIdRaw !== 'null' ? folderIdRaw : null;

      // upload_id is used to build a path on disk, so it must be strictly validated
      if (!uploadId || !UPLOAD_ID_RE.test(uploadId)) {
        data.file.resume();
        return reply.code(400).send({ error: 'Missing or invalid upload id' });
      }
      if (folderId && !ownsFolder(folderId, request.user.id)) {
        data.file.resume();
        return reply.code(404).send({ error: 'Destination folder not found' });
      }

      const filename = (data.filename || 'untitled').replace(/[\\/]/g, '_');
      const sysKey = lib.systemKeyOf(folderId);
      if (sysKey && !lib.accepts(sysKey, filename, data.mimetype)) {
        data.file.resume();
        return reply.code(400).send({ error: lib.rejectMessage(sysKey) });
      }
      tempPath = path.join(tempDir, `${request.user.id}-${uploadId}.tmp`);

      // Chunks are written at an explicit byte offset so a retried chunk overwrites
      // its own bytes instead of being appended twice. The first chunk starts a fresh file.
      const offsetRaw = fields.offset?.value;
      if (offsetRaw !== undefined) {
        const offset = parseInt(offsetRaw, 10);
        const current = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : 0;
        if (!(offset >= 0) || (offset > 0 && offset > current)) {
          data.file.resume();
          return reply.code(409).send({ error: 'Upload chunk out of order, restart the upload' });
        }
        if (offset === 0) {
          await pipeline(data.file, fs.createWriteStream(tempPath, { flags: 'w' }));
        } else {
          fs.truncateSync(tempPath, offset);
          await pipeline(data.file, fs.createWriteStream(tempPath, { flags: 'r+', start: offset }));
        }
      } else {
        // Older clients without offsets
        await pipeline(data.file, fs.createWriteStream(tempPath, { flags: chunkIndex === 0 ? 'w' : 'a' }));
      }

      if (chunkIndex < totalChunks - 1) {
        return { success: true, chunk: chunkIndex };
      }

      // --- Final chunk: assemble ---
      const finalSize = fs.statSync(tempPath).size;
      const user = db.prepare('SELECT quota_bytes, used_bytes FROM users WHERE id = ?').get(request.user.id);

      if (user.used_bytes + finalSize > user.quota_bytes) {
        fs.unlinkSync(tempPath);
        return reply.code(400).send({ error: 'Storage quota exceeded' });
      }

      const finalMime = guessMime(filename, data.mimetype);
      const fileId = crypto.randomUUID();
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-ctr', MASTER_KEY, iv);

      const userDir = userDirOf(request.user.id);
      if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

      await pipeline(fs.createReadStream(tempPath), cipher, fs.createWriteStream(path.join(userDir, `${fileId}.enc`)));
      fs.unlinkSync(tempPath);

      db.prepare(`
        INSERT INTO files (id, owner_id, folder_id, filename, size_bytes, mime_type, is_encrypted, iv_hex, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, datetime('now'))
      `).run(fileId, request.user.id, folderId, filename, finalSize, finalMime, iv.toString('hex'));

      db.prepare('UPDATE users SET used_bytes = used_bytes + ? WHERE id = ?').run(finalSize, request.user.id);

      if (lib.categoryOf(filename, finalMime) === 'image') {
        const saved = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
        thumbs.warm(saved, path.join(userDir, `${fileId}.enc`), MASTER_KEY);
      }

      return { success: true, fileId };
    } catch (err) {
      fastify.log.error(err);
      if (tempPath && fs.existsSync(tempPath)) { try { fs.unlinkSync(tempPath); } catch (e) { /* ignore */ } }
      return reply.code(500).send({ error: 'Upload failed', detail: err.message });
    }
  });

  fastify.patch('/api/files/:id/move', { preHandler: verifyUser }, async (request, reply) => {
    const folderId = request.body?.folder_id || null;
    if (folderId && !ownsFolder(folderId, request.user.id)) return reply.code(404).send({ error: 'Destination not found' });
    const file = db.prepare('SELECT filename, mime_type FROM files WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
    if (!file) return reply.code(404).send({ error: 'File not found' });
    // Files can be moved into a library folder (that adds them to Photos/Music/Videos/Books) if the type fits
    const sysKey = lib.systemKeyOf(folderId);
    if (sysKey && !lib.accepts(sysKey, file.filename, file.mime_type)) return reply.code(400).send({ error: lib.rejectMessage(sysKey) });
    db.prepare('UPDATE files SET folder_id = ? WHERE id = ? AND owner_id = ?').run(folderId, request.params.id, request.user.id);
    return { success: true };
  });

  fastify.patch('/api/files/:id/name', { preHandler: verifyUser }, async (request, reply) => {
    const name = (request.body?.name || '').trim().replace(/[\\/]/g, '_');
    if (!name) return reply.code(400).send({ error: 'File name is required' });
    const file = db.prepare('SELECT mime_type, folder_id FROM files WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
    if (!file) return reply.code(404).send({ error: 'File not found' });
    const sysKey = lib.systemKeyOf(file.folder_id);
    if (sysKey && !lib.accepts(sysKey, name, guessMime(name))) return reply.code(400).send({ error: `That name would change the file type. ${lib.rejectMessage(sysKey)}` });
    db.prepare('UPDATE files SET filename = ?, mime_type = ? WHERE id = ?').run(name, guessMime(name, file.mime_type), request.params.id);
    return { success: true };
  });

  fastify.delete('/api/files/:id', { preHandler: verifyUser }, async (request, reply) => {
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
    if (!file) return reply.code(404).send({ error: 'File not found' });
    const filePath = diskPathOf(file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
    // Foreign keys aren't enforced, so clean up references manually
    db.prepare('DELETE FROM album_images WHERE file_id = ?').run(file.id);
    db.prepare('DELETE FROM playlist_songs WHERE file_id = ?').run(file.id);
    db.prepare('DELETE FROM song_covers WHERE file_id = ? OR cover_file_id = ?').run(file.id, file.id);
    db.prepare('UPDATE albums SET cover_file_id = NULL WHERE cover_file_id = ?').run(file.id);
    db.prepare('UPDATE collections SET cover_file_id = NULL WHERE cover_file_id = ?').run(file.id);
    db.prepare('UPDATE playlists SET cover_file_id = NULL WHERE cover_file_id = ?').run(file.id);
    lib.deleteMetaFor(file.id);
    thumbs.purge(file.owner_id, file.id);
    db.prepare('UPDATE users SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?').run(file.size_bytes, request.user.id);
    return { success: true };
  });

  fastify.patch('/api/files/:id/share', { preHandler: verifyUser }, async (request, reply) => {
    const { is_shared } = request.body || {};
    const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
    if (!file) return reply.code(404).send({ error: 'File not found' });

    const userDir = userDirOf(request.user.id);
    const encPath = path.join(userDir, `${file.id}.enc`);
    const plainPath = path.join(userDir, `${file.id}.plain`);

    if (is_shared && file.is_encrypted) {
      const publicHash = crypto.randomBytes(12).toString('hex');
      const decipher = crypto.createDecipheriv('aes-256-ctr', MASTER_KEY, Buffer.from(file.iv_hex, 'hex'));
      await pipeline(fs.createReadStream(encPath), decipher, fs.createWriteStream(plainPath));
      fs.unlinkSync(encPath);
      db.prepare('UPDATE files SET is_encrypted = 0, public_hash = ? WHERE id = ?').run(publicHash, file.id);
      return { success: true, public_hash: publicHash };
    } else if (!is_shared && !file.is_encrypted) {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-ctr', MASTER_KEY, iv);
      await pipeline(fs.createReadStream(plainPath), cipher, fs.createWriteStream(encPath));
      fs.unlinkSync(plainPath);
      db.prepare('UPDATE files SET is_encrypted = 1, public_hash = NULL, iv_hex = ? WHERE id = ?').run(iv.toString('hex'), file.id);
      return { success: true };
    }
    return { success: true, public_hash: file.public_hash };
  });

  // --- VIEWER, DOWNLOADS & PUBLIC LINKS (WITH OFFSET MATH FOR ENCRYPTED SCRUBBING) ---

  const decryptStreamFrom = (filePath, file, start, end) => {
    const blockIndex = Math.floor(start / 16);
    const blockOffset = start % 16;
    const ivBigInt = BigInt('0x' + file.iv_hex);
    const offsetIvHex = (ivBigInt + BigInt(blockIndex)).toString(16).padStart(32, '0').slice(-32);
    const decipher = crypto.createDecipheriv('aes-256-ctr', MASTER_KEY, Buffer.from(offsetIvHex, 'hex'));
    const fileStream = fs.createReadStream(filePath, { start: start - blockOffset, end });
    return fileStream.pipe(decipher).pipe(new DropBytes(blockOffset));
  };

  const serveStream = (request, reply, filePath, file) => {
    const mime = guessMime(file.filename, file.mime_type);
    const totalSize = fs.statSync(filePath).size;
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
    const stat = fs.statSync(filePath);
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    reply.header('ETag', etag);
    reply.header('Cache-Control', 'private, no-cache');
    if (!range && request.headers['if-none-match'] === etag) { reply.removeHeader('Content-Length'); return reply.code(304).send(); }
    // Uploaded HTML/SVG must never run scripts on our origin (would expose the login token)
    if (isActiveContent(mime)) reply.header('Content-Security-Policy', "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'");

    const safeName = encodeURIComponent(file.filename);
    reply.header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${safeName}`);

    if (totalSize === 0) return reply.send('');

    if (file.is_encrypted) return reply.send(decryptStreamFrom(filePath, file, start, end));
    return reply.send(fs.createReadStream(filePath, { start, end }));
  };

  // --- USER PROFILE & SETTINGS ---
  fastify.get('/api/user/profile', { preHandler: verifyUser }, async (request, reply) => {
    return db.prepare('SELECT id, username, role, quota_bytes, used_bytes, profile_image FROM users WHERE id = ?').get(request.user.id);
  });

  fastify.patch('/api/user/profile', { preHandler: verifyUser }, async (request, reply) => {
    const img = request.body?.profile_image;
    if (img && (typeof img !== 'string' || !img.startsWith('data:image/') || img.length > 2_000_000)) {
      return reply.code(400).send({ error: 'Invalid image' });
    }
    db.prepare('UPDATE users SET profile_image = ? WHERE id = ?').run(img || null, request.user.id);
    return { success: true };
  });

  fastify.patch('/api/user/password', { preHandler: verifyUser }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body || {};
    if (!newPassword || newPassword.length < 4) return reply.code(400).send({ error: 'New password must be at least 4 characters' });
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(request.user.id);
    if (!user || !(await bcrypt.compare(currentPassword || '', user.password_hash))) {
      return reply.code(400).send({ error: 'Current password is incorrect' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, request.user.id);
    return { success: true };
  });

  // Replace the contents of a text file in place. The file keeps its id, name, folder,
  // album/playlist links and – if it is shared – its public link.
  const EDITABLE_MAX = 5 * 1024 * 1024;
  fastify.put('/api/files/:id/content', { preHandler: verifyUser, bodyLimit: EDITABLE_MAX + 64 * 1024 }, async (request, reply) => {
    const content = request.body?.content;
    if (typeof content !== 'string') return reply.code(400).send({ error: 'Missing file content' });
    const buf = Buffer.from(content, 'utf-8');
    if (buf.length > EDITABLE_MAX) return reply.code(413).send({ error: 'Files larger than 5 MB can’t be edited here.' });

    const file = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
    if (!file) return reply.code(404).send({ error: 'File not found' });

    // Optional conflict check: the client sends the size it loaded; refuse if it changed meanwhile
    const baseSize = request.body?.base_size;
    if (Number.isInteger(baseSize) && baseSize !== file.size_bytes) {
      return reply.code(409).send({ error: 'This file was changed somewhere else since you opened it. Reopen it and try again.' });
    }

    const delta = buf.length - file.size_bytes;
    const user = db.prepare('SELECT quota_bytes, used_bytes FROM users WHERE id = ?').get(request.user.id);
    if (delta > 0 && user.used_bytes + delta > user.quota_bytes) return reply.code(400).send({ error: 'Storage quota exceeded' });

    const finalPath = diskPathOf(file);
    const tmpPath = `${finalPath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    let ivHex = file.iv_hex;
    try {
      if (file.is_encrypted) {
        const iv = crypto.randomBytes(16);   // never reuse a CTR IV with new content
        const cipher = crypto.createCipheriv('aes-256-ctr', MASTER_KEY, iv);
        fs.writeFileSync(tmpPath, Buffer.concat([cipher.update(buf), cipher.final()]));
        ivHex = iv.toString('hex');
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
      if (onlyCached || !thumbs.available()) {
        reply.header('Cache-Control', 'no-store');
        return reply.code(404).send({ error: 'Not generated yet', source: file.id, width });
      }
      return serveStream(request, reply, filePath, file); // sharp couldn't decode it (e.g. HEIC): send the original
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
    const filePath = diskPathOf(file);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: 'Missing on disk' });
    return serveStream(request, reply, filePath, file);
  });

  // Download a whole folder (recursively) as a zip
  fastify.get('/api/folders/:id/download', { preHandler: verifyUser }, async (request, reply) => {
    const root = db.prepare('SELECT id, name FROM folders WHERE id = ? AND owner_id = ?').get(request.params.id, request.user.id);
    if (!root) return reply.code(404).send({ error: 'Folder not found' });

    const entries = [];
    const walk = (folderId, prefix, seen) => {
      if (seen.has(folderId)) return;
      seen.add(folderId);
      for (const f of db.prepare('SELECT * FROM files WHERE folder_id = ? AND owner_id = ?').all(folderId, request.user.id)) {
        entries.push({ file: f, name: prefix + f.filename });
      }
      for (const sub of db.prepare('SELECT id, name FROM folders WHERE parent_id = ? AND owner_id = ?').all(folderId, request.user.id)) {
        walk(sub.id, `${prefix}${sub.name}/`, seen);
      }
    };
    walk(root.id, '', new Set());

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(root.name)}.zip`);

    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.on('error', (err) => fastify.log.error(err));
    reply.send(archive);

    for (const { file, name } of entries) {
      const p = diskPathOf(file);
      if (!fs.existsSync(p)) continue;
      const size = fs.statSync(p).size;
      const stream = file.is_encrypted && size > 0 ? decryptStreamFrom(p, file, 0, size - 1) : fs.createReadStream(p);
      archive.append(stream, { name });
    }
    await archive.finalize();
    return reply;
  });

  fastify.get('/shared/:hash', async (request, reply) => {
    const file = db.prepare('SELECT * FROM files WHERE public_hash = ?').get(request.params.hash);
    if (!file || file.is_encrypted) return reply.code(404).send('File not found or is private.');

    const filePath = path.join(userDirOf(file.owner_id), `${file.id}.plain`);
    if (!fs.existsSync(filePath)) return reply.code(404).send('Missing on disk');

    return serveStream(request, reply, filePath, file);
  });
};
