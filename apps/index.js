'use strict';
// The apps of AkulavBox, each a Fastify plugin. Trove (apps/trove, the core: every account has it) keeps
// its API at /api/… and its files in box/; the others live under their own prefix, keep their files in
// their own folder of the data folder (config.appDataDir(id)), sign people in with the shared
// cookie (src/core/session.js) and registers its hooks (usage, delete-user, …) in src/core/apps.js.
const closers = [];
const onClose = (fn) => closers.push(fn);

/** Register every app on the server */
function load(fastify) {
  fastify.register(require('./trove'));
  fastify.register(require('./documents'), { prefix: '/docs', onClose });
  fastify.register(require('./budget'), { prefix: '/budget', onClose });
  fastify.register(require('./tasks'), { prefix: '/tasks', onClose });
  fastify.register(require('./ironveil'), { prefix: '/ironveil' });
}

async function close() {
  for (const fn of closers.splice(0)) { try { await fn(); } catch (e) { /* shutting down */ } }
}

module.exports = { load, close };
