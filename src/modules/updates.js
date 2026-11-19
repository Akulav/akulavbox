const config = require('../core/config');
const { verifyAdmin } = require('../core/auth');
const activity = require('../core/activity');
const updater = require('../core/updater');
const schedule = require('../core/schedule');

// Admin → Updates (from GitHub), and restarting the server so a staged restore or update applies

module.exports = async function (fastify) {
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
