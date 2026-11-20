const db = require('../core/db');
const fs = require('fs');
const os = require('os');
const bcrypt = require('../core/hash');
const crypto = require('crypto');
const config = require('../core/config');
const { verifyAdmin, revokeSessions, setPassword, PASSWORD_MIN } = require('../core/auth');
const activity = require('../core/activity');
const thumbs = require('../../apps/trove/lib/thumbs');
const disk = require('../core/disk');
const maintenance = require('../../apps/trove/lib/maintenance');
const downloader = require('../../apps/trove/lib/downloader');
const apps = require('../core/apps');

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
    // optional per-app choices from the Admin console: { documents: { enabled, quota_bytes }, … }
    const choices = request.body?.apps && typeof request.body.apps === 'object' ? request.body.apps : {};
    for (const [app, c] of Object.entries(choices)) {
      if (!apps.byId.has(app) || apps.byId.get(app).core || !c || typeof c !== 'object') continue;
      try { apps.setAccess(id, app, { enabled: c.enabled, quota_bytes: c.quota_bytes }); } catch (e) { /* invalid quota: the default applies */ }
    }
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
      activity.forgetUser(id);
      // AI connectors (tokens and pending OAuth codes) stop with the account
      require('../core/connector/tokens').forgetUser(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    });

    // every app forgets the account too: Trove its files, folders, albums and counter
    // (apps/trove/index.js), e-Management, Koma Shelf, Florin and Tick theirs
    apps.deleteUser(id);
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
      SELECT u.id, u.username, u.role, u.quota_bytes, COALESCE((SELECT bytes FROM trove.usage g WHERE g.user_id = u.id), 0) AS used_bytes, u.profile_image, u.created_at, u.last_login_at,
        (SELECT COUNT(*) FROM files f WHERE f.owner_id = u.id AND f.trashed_at IS NULL) AS file_count,
        (SELECT COALESCE(SUM(size_bytes), 0) FROM files f WHERE f.owner_id = u.id AND f.trashed_at IS NOT NULL) AS trash_bytes
      FROM users u ORDER BY u.role = 'admin' DESC, u.username COLLATE NOCASE
    `).all();
  });

  // Server health: free disk space where storage lives, what AkulavBox uses, versions
  let breakdownCache = null;
  fastify.get('/api/admin/system', { preHandler: verifyAdmin }, async (request) => {
    const space = disk.diskSpace();
    if (!breakdownCache || Date.now() - breakdownCache.at > 30_000 || request.query.fresh === '1') {
      const [users, thumbsDir, temp, backups] = await Promise.all(
        [config.usersDir, config.thumbsDir, config.tempDir, config.backupsDir].map(d => disk.dirSize(d)));
      let dbBytes = 0;
      // akulavbox.db and Trove's trove.db, with their write-ahead logs
      for (const file of [config.dbPath, config.troveDbPath]) for (const suffix of ['', '-wal', '-shm']) { try { dbBytes += fs.statSync(file + suffix).size; } catch (e) { /* none */ } }
      breakdownCache = { at: Date.now(), parts: { files: users, thumbnails: thumbsDir, uploads_in_progress: temp, backups, database: { bytes: dbBytes, files: 2 } } };
    }
    const totals = db.prepare(`SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM files WHERE trashed_at IS NULL) AS files,
        (SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE trashed_at IS NOT NULL) AS trash_bytes,
        (SELECT COALESCE(SUM(quota_bytes), 0) FROM users) AS allocated,
        (SELECT COALESCE(SUM(bytes), 0) FROM trove.usage) AS used`).get();
    const parts = breakdownCache.parts;
    const appBytes = Object.values(parts).reduce((s, p) => s + p.bytes, 0);
    return {
      disk: space,                              // { total, free, used } of the drive holding data/
      storage_dir: config.storageDir,
      app_bytes: appBytes,
      parts,
      totals,
      // quotas promised to users beyond what the disk can still hold
      overcommitted: space ? Math.max(0, (totals.allocated - totals.used) - space.free) : 0,
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
};
