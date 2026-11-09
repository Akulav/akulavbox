const db = require('../core/db');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('../core/hash');
const crypto = require('crypto');
const config = require('../core/config');
const { verifyAdmin, PASSWORD_MIN } = require('../core/auth');
const thumbs = require('../core/thumbs');
const store = require('../core/storage');
const cookies = require('../core/cookies');
const maintenance = require('../core/maintenance');
const backup = require('../core/backup');
const downloader = require('../core/downloader');
const updater = require('../core/updater');
const { LATEST } = require('../core/migrations');

const USERNAME_RE = /^[\p{L}\p{N}._ -]{1,32}$/u;
const startedAt = Date.now();

module.exports = async function (fastify) {

  const adminCount = () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
  const notFound = (reply) => reply.code(404).send({ error: 'User not found' });

  // Create User & Provision Physical Encrypted Folder
  fastify.post('/api/admin/users', { preHandler: verifyAdmin }, async (request, reply) => {
    const username = String(request.body?.username || '').trim();
    const { password, quota } = request.body || {};
    const role = request.body?.role === 'admin' ? 'admin' : 'user';
    if (!username || !password) return reply.code(400).send({ error: 'Username and password are required' });
    if (!USERNAME_RE.test(username)) return reply.code(400).send({ error: 'Usernames are 1–32 letters, numbers, spaces, dots, dashes or underscores.' });
    if (String(password).length < PASSWORD_MIN) return reply.code(400).send({ error: `Passwords need at least ${PASSWORD_MIN} characters.` });
    if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username)) return reply.code(400).send({ error: 'That username is already taken.' });

    const id = crypto.randomUUID();
    const hash = await bcrypt.hash(String(password), 10);
    db.prepare("INSERT INTO users (id, username, password_hash, role, quota_bytes, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
      .run(id, username, hash, role, Number(quota) > 0 ? Math.floor(Number(quota)) : 5368709120);
    fs.mkdirSync(store.userDirOf(id), { recursive: true });
    return { success: true, id, username };
  });

  // Delete User & Wipe Physical Data + all rows that belong to them
  fastify.delete('/api/admin/users/:id', { preHandler: verifyAdmin }, async (request, reply) => {
    const { id } = request.params;
    if (id === request.user.id) return reply.code(400).send({ error: 'You cannot delete your own account.' });
    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
    if (!target) return notFound(reply);

    // temporary chat files they sent or received
    for (const m of db.prepare("SELECT file_path FROM messages WHERE type = 'file' AND (sender_id = ? OR receiver_id = ?)").all(id, id)) {
      if (m.file_path) { try { fs.unlinkSync(m.file_path); } catch (e) { /* gone */ } }
    }
    db.tx(() => {
      const cleanup = [
        'DELETE FROM album_images WHERE album_id IN (SELECT id FROM albums WHERE owner_id = ?)',
        'DELETE FROM albums WHERE owner_id = ?',
        'DELETE FROM collections WHERE owner_id = ?',
        'DELETE FROM playlist_songs WHERE playlist_id IN (SELECT id FROM playlists WHERE owner_id = ?)',
        'DELETE FROM playlists WHERE owner_id = ?',
        'DELETE FROM song_covers WHERE file_id IN (SELECT id FROM files WHERE owner_id = ?)',
        'DELETE FROM media_meta WHERE owner_id = ?',
        'DELETE FROM media_collection_items WHERE collection_id IN (SELECT id FROM media_collections WHERE owner_id = ?)',
        'DELETE FROM media_collections WHERE owner_id = ?',
        'DELETE FROM downloads WHERE owner_id = ?',
        'DELETE FROM files WHERE owner_id = ?',
        'DELETE FROM folders WHERE owner_id = ?',
      ];
      for (const sql of cleanup) db.prepare(sql).run(id);
      db.prepare('DELETE FROM friends WHERE user_id = ? OR friend_id = ?').run(id, id);
      db.prepare('DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?').run(id, id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    });

    const userDir = store.userDirOf(id);
    if (fs.existsSync(userDir)) fs.rmSync(userDir, { recursive: true, force: true });
    thumbs.purgeUser(id);
    cookies.remove(id);
    return { success: true };
  });

  // Force password reset (signs the user out everywhere)
  fastify.patch('/api/admin/users/:id/password', { preHandler: verifyAdmin }, async (request, reply) => {
    const newPassword = String(request.body?.newPassword || '');
    if (newPassword.length < PASSWORD_MIN) return reply.code(400).send({ error: `Passwords need at least ${PASSWORD_MIN} characters.` });
    const hash = await bcrypt.hash(newPassword, 10);
    const r = db.prepare('UPDATE users SET password_hash = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?').run(hash, request.params.id);
    return r.changes ? { success: true } : notFound(reply);
  });

  // Update quota
  fastify.patch('/api/admin/users/:id/quota', { preHandler: verifyAdmin }, async (request, reply) => {
    const quota = Math.floor(Number(request.body?.quota));
    if (!(quota > 0)) return reply.code(400).send({ error: 'Invalid quota' });
    const r = db.prepare('UPDATE users SET quota_bytes = ? WHERE id = ?').run(quota, request.params.id);
    return r.changes ? { success: true } : notFound(reply);
  });

  // Promote / demote. The last admin can't be demoted, and you can't demote yourself.
  fastify.patch('/api/admin/users/:id/role', { preHandler: verifyAdmin }, async (request, reply) => {
    const role = request.body?.role === 'admin' ? 'admin' : 'user';
    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(request.params.id);
    if (!target) return notFound(reply);
    if (role === 'user' && target.role === 'admin') {
      if (request.params.id === request.user.id) return reply.code(400).send({ error: 'You can’t remove your own admin rights.' });
      if (adminCount() <= 1) return reply.code(400).send({ error: 'There must be at least one admin.' });
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, request.params.id);
    return { success: true };
  });

  // Sign a user out on every device
  fastify.post('/api/admin/users/:id/signout', { preHandler: verifyAdmin }, async (request, reply) => {
    const r = db.prepare('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?').run(request.params.id);
    return r.changes ? { success: true } : notFound(reply);
  });

  // Get all users
  fastify.get('/api/admin/users', { preHandler: verifyAdmin }, async () => {
    return db.prepare(`
      SELECT u.id, u.username, u.role, u.quota_bytes, u.used_bytes, u.profile_image, u.created_at, u.last_login_at,
        (SELECT COUNT(*) FROM files f WHERE f.owner_id = u.id AND f.trashed_at IS NULL) AS file_count,
        (SELECT COALESCE(SUM(size_bytes), 0) FROM files f WHERE f.owner_id = u.id AND f.trashed_at IS NOT NULL) AS trash_bytes
      FROM users u ORDER BY u.role = 'admin' DESC, u.username COLLATE NOCASE
    `).all();
  });

  // Server health: free disk space where storage lives, what AkulavBox uses, versions
  let breakdownCache = null;
  fastify.get('/api/admin/system', { preHandler: verifyAdmin }, async (request) => {
    const disk = store.diskSpace();
    if (!breakdownCache || Date.now() - breakdownCache.at > 30_000 || request.query.fresh === '1') {
      const [users, thumbsDir, temp, chat, backups] = await Promise.all(
        [config.usersDir, config.thumbsDir, config.tempDir, config.chatDir, config.backupsDir].map(d => store.dirSize(d)));
      let dbBytes = 0;
      for (const suffix of ['', '-wal', '-shm']) { try { dbBytes += fs.statSync(config.dbPath + suffix).size; } catch (e) { /* none */ } }
      breakdownCache = { at: Date.now(), parts: { files: users, thumbnails: thumbsDir, uploads_in_progress: temp, chat_files: chat, backups, database: { bytes: dbBytes, files: 1 } } };
    }
    const totals = db.prepare(`SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM files WHERE trashed_at IS NULL) AS files,
        (SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE trashed_at IS NOT NULL) AS trash_bytes,
        (SELECT COALESCE(SUM(quota_bytes), 0) FROM users) AS allocated,
        (SELECT COALESCE(SUM(used_bytes), 0) FROM users) AS used`).get();
    const parts = breakdownCache.parts;
    const appBytes = Object.values(parts).reduce((s, p) => s + p.bytes, 0);
    return {
      disk,                                     // { total, free, used } of the drive holding storage/
      storage_dir: config.storageDir,
      app_bytes: appBytes,
      parts,
      totals,
      // quotas promised to users beyond what the disk can still hold
      overcommitted: disk ? Math.max(0, (totals.allocated - totals.used) - disk.free) : 0,
      reserve_bytes: config.diskReserveBytes,
      version: config.version,
      schema: db.prepare('PRAGMA user_version').get().user_version,
      node: process.version,
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      memory_rss: process.memoryUsage().rss,
      thumbnails: thumbs.available() ? 'server (sharp)' : 'browser',
      // Refresh re-checks, so installing yt-dlp / ffmpeg needs no restart
      downloader: (request.query.fresh === '1' && downloader.detect(true), downloader.status()),
      trash_days: config.trashDays,
      measured_at: new Date(breakdownCache.at).toISOString(),
    };
  });

  // --- Storage check: files on disk vs. the database ---
  fastify.get('/api/admin/storage-check', { preHandler: verifyAdmin }, async () => maintenance.scan());
  fastify.post('/api/admin/storage-check/clean', { preHandler: verifyAdmin }, async (request) => {
    const b = request.body || {};
    const done = maintenance.clean({ orphans: b.orphans !== false, missing: b.missing !== false, usage: b.usage !== false });
    breakdownCache = null;
    return { success: true, ...done };
  });

  // --- Full backup and restore ---
  // Export is a form post (token, passphrase) so the browser streams the file straight to disk.
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 64 * 1024 },
    (req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body))));
  const formAdmin = async (request, reply) => {
    if (!request.headers.authorization && request.body?.token) request.headers.authorization = `Bearer ${request.body.token}`;
    return verifyAdmin(request, reply);
  };

  fastify.get('/api/admin/backup', { preHandler: verifyAdmin }, async () => ({
    estimate: backup.estimate(db), import: { ...backup.state, pending: backup.pending() }, restored: db.restored || null,
  }));

  fastify.post('/api/admin/backup/export', { preHandler: formAdmin }, async (request, reply) => {
    let stream;
    try { stream = backup.exportStream(db, request.body?.passphrase); }
    catch (e) { return reply.code(400).type('text/plain; charset=utf-8').send(e.message); }
    const name = `akulavbox-backup-${new Date().toISOString().slice(0, 10)}.akbx`;
    stream.on('error', (e) => fastify.log.error(e, 'backup export failed'));
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    reply.header('Cache-Control', 'no-store');
    return reply.send(stream);
  });

  // Upload a backup in raw chunks (proxies often cap request size): PUT ?id=&offset=
  const IMPORT_ID = /^[\w-]{8,64}$/;
  const importPath = (id) => path.join(config.tempDir, `import-${id}.akbx`);
  fastify.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 32 * 1024 * 1024 }, (req, body, done) => done(null, body));
  fastify.put('/api/admin/backup/upload', { preHandler: verifyAdmin, bodyLimit: 32 * 1024 * 1024 }, async (request, reply) => {
    const id = String(request.query.id || '');
    const offset = Number(request.query.offset);
    if (!IMPORT_ID.test(id) || !(offset >= 0)) return reply.code(400).send({ error: 'Bad upload id or offset' });
    const p = importPath(id);
    const current = fs.existsSync(p) ? fs.statSync(p).size : 0;
    if (offset > current) return reply.code(409).send({ error: 'Upload chunk out of order, start again' });
    const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    if (!store.hasRoomFor(body.length * 2)) return reply.code(507).send({ error: 'The server’s disk is full.' });
    if (offset === 0) fs.writeFileSync(p, body);
    else { if (offset < current) fs.truncateSync(p, offset); fs.appendFileSync(p, body); }
    return { success: true, size: offset + body.length };
  });

  // Unpack and verify an uploaded backup ({ id }) or one already on the server ({ server_path }).
  // Runs in the background; poll GET /api/admin/backup. The swap happens on the next restart.
  fastify.post('/api/admin/backup/import', { preHandler: verifyAdmin }, async (request, reply) => {
    const { id, server_path: serverPath, passphrase } = request.body || {};
    const file = serverPath ? path.resolve(String(serverPath)) : (IMPORT_ID.test(String(id || '')) ? importPath(id) : null);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return reply.code(400).send({ error: serverPath ? 'No file at that path on the server.' : 'Upload the backup first.' });
    if (backup.state.running) return reply.code(409).send({ error: 'An import is already running.' });
    try { await backup.openHeader(file, passphrase || ''); } // fail fast on a wrong passphrase or a wrong file
    catch (e) { return reply.code(400).send({ error: e.message }); }
    backup.stageImport(file, passphrase, { currentSchema: LATEST })
      .catch((e) => fastify.log.warn(`backup import failed: ${e.message}`))
      .finally(() => { if (!serverPath) fs.rmSync(file, { force: true }); });
    return { success: true, started: true };
  });

  fastify.delete('/api/admin/backup/import', { preHandler: verifyAdmin }, async (request, reply) => (
    backup.cancelPending() ? { success: true } : reply.code(409).send({ error: 'The import is still running.' })));

  // --- Updates from GitHub ---
  fastify.get('/api/admin/updates', { preHandler: verifyAdmin }, async (request, reply) => {
    if (request.query.check === '1') {
      try { await updater.check({ force: true }); } catch (e) { return { ...updater.info(), error: e.message }; }
    }
    return updater.info();
  });
  // Download and install the newest version in the background; poll GET /api/admin/updates
  fastify.post('/api/admin/updates/apply', { preHandler: verifyAdmin }, async (request, reply) => {
    const i = updater.info();
    if (i.applying) return reply.code(409).send({ error: 'An update is already running.' });
    if (!i.available) return reply.code(400).send({ error: 'There is no newer version to install. Check again first.' });
    updater.apply().catch((e) => fastify.log.warn(`update failed: ${e.message}`));
    return { success: true, started: true };
  });
  fastify.post('/api/admin/updates/rollback', { preHandler: verifyAdmin }, async (request, reply) => {
    try { return { success: true, ...(await updater.rollback()) }; }
    catch (e) { return reply.code(400).send({ error: e.message }); }
  });
  fastify.addHook('onReady', async () => { updater.start(); });

  // Restart so a staged restore is applied. Needs a service manager (systemd, pm2, Docker) to start
  // the process again; the page says so before offering it.
  fastify.post('/api/admin/restart', { preHandler: verifyAdmin }, async () => {
    setTimeout(() => process.exit(0), 300).unref();
    return { success: true };
  });
};
