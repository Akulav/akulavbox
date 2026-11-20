const db = require('../core/db');
const config = require('../core/config');
const store = require('../core/storage');
const apps = require('../core/apps');
const activity = require('../core/activity');
const { verifyAdmin } = require('../core/auth');

// The Admin console (/admin): every account with its storage (one space shared by
// every app) and its access to each app. Creating, deleting, passwords, roles and
// the storage size use the /api/admin/users routes (admin.js); this adds the
// per-app parts (on or off, and an optional limit inside the account's space).

const gb = (b) => `${(b / 1024 ** 3).toFixed(2).replace(/\.?0+$/, '')} GB`;

module.exports = async function (fastify) {
  const nameOf = (id) => db.prepare('SELECT username FROM users WHERE id = ?').get(id)?.username;

  fastify.get('/api/admin/console', { preHandler: verifyAdmin }, async () => {
    const users = db.prepare(`
      SELECT u.id, u.username, u.role, u.quota_bytes, u.used_bytes, u.profile_image, u.created_at, u.last_login_at,
        (SELECT COUNT(*) FROM files f WHERE f.owner_id = u.id AND f.trashed_at IS NULL) AS file_count
      FROM users u ORDER BY u.role = 'admin' DESC, u.username COLLATE NOCASE
    `).all();
    const others = apps.APPS.filter((a) => !a.core);
    for (const u of users) {
      // the account's one storage space; u.used_bytes stays Trove's part
      u.space = apps.space(u.id);
      u.apps = {};
      for (const a of others) {
        const acc = apps.access(u.id, a.id);
        u.apps[a.id] = { ...acc, used_bytes: apps.usage(u.id, a.id), summary: apps.summary(u.id, a.id) };
      }
    }
    return {
      apps: apps.APPS.map((a) => ({
        id: a.id, name: a.name, path: a.path, color: a.color, tagline: a.tagline, core: !!a.core, quota: !!a.quota,
        status: apps.status(a.id), problem: apps.failures.get(a.id) || null,
        totals: a.core ? { bytes: users.reduce((s, u) => s + (u.used_bytes || 0), 0), items: users.reduce((s, u) => s + (u.file_count || 0), 0), label: 'files' } : apps.totals(a.id),
        folder: a.core ? config.boxDir : config.appDataDir(a.id),
      })),
      defaults: apps.defaults(),
      disk: store.diskSpace(),
      storage_dir: config.storageDir,
      version: config.version,
      users,
    };
  });

  // { enabled?, quota_bytes? } for one app of one account; quota_bytes null = the default
  fastify.patch('/api/admin/users/:id/apps/:app', { preHandler: verifyAdmin }, async (request, reply) => {
    const { id, app } = request.params;
    const name = nameOf(id);
    if (!name) return reply.code(404).send({ error: 'User not found' });
    const a = apps.byId.get(app);
    if (!a || a.core) return reply.code(404).send({ error: 'Unknown app' });
    const b = request.body || {};
    let r;
    try { r = apps.setAccess(id, app, { enabled: b.enabled, quota_bytes: b.quota_bytes }); } catch (e) { return reply.code(400).send({ error: e.message }); }
    const what = [];
    if (b.enabled !== undefined) what.push(b.enabled ? 'turned on' : 'turned off');
    if (b.quota_bytes !== undefined) what.push(b.quota_bytes === null ? 'default limit' : `limit ${gb(r.quota_bytes)}`);
    activity.log(request, 'admin.user_app', { target: name, detail: `${a.name}: ${what.join(', ')}` });
    return { success: true, ...r };
  });

  // What new accounts (and accounts without their own setting) get in each app
  fastify.put('/api/admin/apps/defaults', { preHandler: verifyAdmin }, async (request, reply) => {
    let d;
    try { d = apps.setDefaults(request.body || {}); } catch (e) { return reply.code(400).send({ error: e.message }); }
    activity.log(request, 'admin.app_defaults', { detail: Object.entries(d).map(([k, v]) => `${apps.byId.get(k).name}: ${v.enabled ? 'on' : 'off'}${v.quota_bytes ? `, limit ${gb(v.quota_bytes)}` : ''}`).join(' · ') });
    return d;
  });
};
