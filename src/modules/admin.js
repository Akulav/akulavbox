const db = require('../core/db');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('../core/hash');
const crypto = require('crypto');
const config = require('../core/config');
const { verifyAdmin, fromForm, revokeSessions, setPassword, PASSWORD_MIN } = require('../core/auth');
const activity = require('../core/activity');
const schedule = require('../core/schedule');
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
  const nameOf = (id) => db.prepare('SELECT username FROM users WHERE id = ?').get(id)?.username || id;

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
    activity.log(request, 'admin.user_created', { target: username, detail: role === 'admin' ? 'Admin' : null });
    return { success: true, id, username };
  });

  // Delete User & Wipe Physical Data + all rows that belong to them
  fastify.delete('/api/admin/users/:id', { preHandler: verifyAdmin }, async (request, reply) => {
    const { id } = request.params;
    if (id === request.user.id) return reply.code(400).send({ error: 'You cannot delete your own account.' });
    const target = db.prepare('SELECT role, username FROM users WHERE id = ?').get(id);
    if (!target) return notFound(reply);

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
      activity.forgetUser(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    });

    const userDir = store.userDirOf(id);
    if (fs.existsSync(userDir)) fs.rmSync(userDir, { recursive: true, force: true });
    thumbs.purgeUser(id);
    cookies.remove(id);
    activity.log(request, 'admin.user_deleted', { target: target.username });
    return { success: true };
  });

  // Force password reset (signs the user out everywhere)
  fastify.patch('/api/admin/users/:id/password', { preHandler: verifyAdmin }, async (request, reply) => {
    const newPassword = String(request.body?.newPassword || '');
    if (newPassword.length < PASSWORD_MIN) return reply.code(400).send({ error: `Passwords need at least ${PASSWORD_MIN} characters.` });
    if (!setPassword(request.params.id, await bcrypt.hash(newPassword, 10))) return notFound(reply);
    activity.log(request, 'admin.user_password_reset', { target: nameOf(request.params.id) });
    return { success: true };
  });

  // Update quota
  fastify.patch('/api/admin/users/:id/quota', { preHandler: verifyAdmin }, async (request, reply) => {
    const quota = Math.floor(Number(request.body?.quota));
    if (!(quota > 0)) return reply.code(400).send({ error: 'Invalid quota' });
    const r = db.prepare('UPDATE users SET quota_bytes = ? WHERE id = ?').run(quota, request.params.id);
    if (!r.changes) return notFound(reply);
    activity.log(request, 'admin.user_quota', { target: nameOf(request.params.id), detail: `${(quota / 1024 ** 3).toFixed(2).replace(/\.?0+$/, '')} GB` });
    return { success: true };
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
    if (role !== target.role) activity.log(request, 'admin.user_role', { target: nameOf(request.params.id), detail: role === 'admin' ? 'Made admin' : 'Admin rights removed' });
    return { success: true };
  });

  // Sign a user out on every device
  fastify.post('/api/admin/users/:id/signout', { preHandler: verifyAdmin }, async (request, reply) => {
    if (!revokeSessions(request.params.id)) return notFound(reply);
    activity.log(request, 'admin.user_signed_out', { target: nameOf(request.params.id) });
    return { success: true };
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
      const [users, thumbsDir, temp, backups] = await Promise.all(
        [config.usersDir, config.thumbsDir, config.tempDir, config.backupsDir].map(d => store.dirSize(d)));
      let dbBytes = 0;
      for (const suffix of ['', '-wal', '-shm']) { try { dbBytes += fs.statSync(config.dbPath + suffix).size; } catch (e) { /* none */ } }
      breakdownCache = { at: Date.now(), parts: { files: users, thumbnails: thumbsDir, uploads_in_progress: temp, backups, database: { bytes: dbBytes, files: 1 } } };
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
      disk,                                     // { total, free, used } of the drive holding data/
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
    activity.log(request, 'admin.storage_cleaned', { detail: `${done.deleted || 0} deleted, ${done.recovered || 0} recovered, ${(done.repaired || 0) + (done.removed_rows || 0)} listings fixed` });
    return { success: true, ...done };
  });

  // --- Activity log ---
  fastify.get('/api/admin/activity', { preHandler: verifyAdmin }, async (request) => {
    const q = request.query;
    return { ...activity.list({ before: Number(q.before) || null, userId: q.user ? String(q.user) : null, kind: q.kind ? String(q.kind) : null, q: q.q ? String(q.q) : null, limit: Number(q.limit) || 100 }), keep_days: activity.DAYS };
  });

  // --- Full backup and restore ---
  fastify.get('/api/admin/backup', { preHandler: verifyAdmin }, async () => ({
    estimate: backup.estimate(db), import: { ...backup.state, staging: backup.stagingBy(), pending: backup.pending() }, restored: db.restored || null,
    schedule: schedule.status(),
  }));

  // Scheduled backups: { enabled, every, hour, weekday, keep, dir, passphrase? }
  fastify.put('/api/admin/backup/schedule', { preHandler: verifyAdmin }, async (request, reply) => {
    let s;
    try { s = schedule.save(request.body); } catch (e) { return reply.code(400).send({ error: e.message }); }
    activity.log(request, 'backup.schedule_changed', { detail: s.enabled ? `${s.every === 'weekly' ? 'Weekly' : 'Daily'} at ${String(s.hour).padStart(2, '0')}:00, keep ${s.keep}, in ${s.dir || s.default_dir}` : 'Off' });
    return s;
  });
  // Make a scheduled-style backup now; poll GET /api/admin/backup for progress
  fastify.post('/api/admin/backup/schedule/run', { preHandler: verifyAdmin }, async (request, reply) => {
    if (schedule.state.running) return reply.code(409).send({ error: 'A scheduled backup is already running.' });
    schedule.run({ request }).catch(() => { /* recorded in the status */ });
    return { success: true, started: true };
  });

  // Export is a form post (token, passphrase) so the browser streams the file straight to disk.
  fastify.post('/api/admin/backup/export', { preHandler: fromForm(verifyAdmin) }, async (request, reply) => {
    let stream;
    try { stream = backup.exportStream(db, request.body?.passphrase); }
    catch (e) { return reply.code(400).type('text/plain; charset=utf-8').send(e.message); }
    const name = `akulavbox-backup-${new Date().toISOString().slice(0, 10)}.akbx`;
    activity.log(request, 'backup.exported', { target: name });
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
  const uploadedSize = (id) => { try { return fs.statSync(importPath(id)).size; } catch (e) { return 0; } };
  // How much of an upload the server has, so a dropped connection or a reload resumes instead of starting over
  fastify.get('/api/admin/backup/upload', { preHandler: verifyAdmin }, async (request, reply) => {
    const id = String(request.query.id || '');
    if (!IMPORT_ID.test(id)) return reply.code(400).send({ error: 'Bad upload id' });
    return { size: uploadedSize(id) };
  });
  fastify.put('/api/admin/backup/upload', { preHandler: verifyAdmin, bodyLimit: 32 * 1024 * 1024 }, async (request, reply) => {
    const id = String(request.query.id || '');
    const offset = Number(request.query.offset);
    if (!IMPORT_ID.test(id) || !Number.isSafeInteger(offset) || offset < 0) return reply.code(400).send({ error: 'Bad upload id or offset' });
    const p = importPath(id);
    const current = uploadedSize(id);
    // the answer carries the size, so the page can carry on from there
    if (offset > current) return reply.code(409).send({ error: 'Upload chunk out of order', size: current });
    const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    if (!store.hasRoomFor(body.length * 2)) return reply.code(507).send({ error: 'The server’s disk is full.' });
    fs.mkdirSync(config.tempDir, { recursive: true });
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
    if (backup.state.running || backup.stagingBy()) return reply.code(409).send({ error: 'An import is already running.' });
    try { await backup.openHeader(file, passphrase || ''); } // fail fast on a wrong passphrase or a wrong file
    catch (e) { return reply.code(400).send({ error: e.message }); }
    // the upload is kept when the check fails (full disk, say), so a retry needn't send it again;
    // the hourly temp sweep removes it after a day
    backup.stageImport(file, passphrase, { currentSchema: LATEST })
      .then((r) => {
        if (!serverPath) fs.rmSync(file, { force: true });
        activity.log(request, 'backup.import_staged', { detail: `Backup from ${r.created_at}: ${r.users} accounts, ${r.files} files. Applied at the next restart.` });
      })
      .catch((e) => {
        fastify.log.warn(`backup import failed: ${e.message}`);
        activity.log(request, 'backup.import_failed', { detail: e.message });
        if (!serverPath && /damaged|incomplete|changed/.test(e.message)) fs.rmSync(file, { force: true }); // bad bytes: a retry must upload again
      });
    return { success: true, started: true };
  });

  fastify.delete('/api/admin/backup/import', { preHandler: verifyAdmin }, async (request, reply) => {
    if (!backup.cancelPending()) return reply.code(409).send({ error: 'The import is still running.' });
    activity.log(request, 'backup.import_cancelled');
    return { success: true };
  });

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
    updater.apply()
      .then(() => activity.log(request, 'admin.update_installed', { detail: `v${config.version} → v${i.latest.version}` }))
      .catch((e) => { fastify.log.warn(`update failed: ${e.message}`); activity.log(request, 'admin.update_failed', { detail: e.message }); });
    return { success: true, started: true };
  });
  fastify.post('/api/admin/updates/rollback', { preHandler: verifyAdmin }, async (request, reply) => {
    try {
      const r = await updater.rollback();
      activity.log(request, 'admin.update_rolled_back', { detail: r?.ready?.version ? `Back to v${r.ready.version}` : null });
      return { success: true, ...r };
    } catch (e) { return reply.code(400).send({ error: e.message }); }
  });
  fastify.addHook('onReady', async () => { updater.start(); schedule.start(); });

  // Restart so a staged restore is applied. Needs a service manager (systemd, pm2, Docker) to start
  // the process again; the page says so before offering it.
  fastify.post('/api/admin/restart', { preHandler: verifyAdmin }, async (request) => {
    activity.log(request, 'admin.server_restart');
    // after the answer is sent; server.js closes the database first (plain exit when run without it)
    setTimeout(() => { if (!process.emit('akulavbox:restart')) process.exit(0); }, 300).unref();
    return { success: true };
  });
};
