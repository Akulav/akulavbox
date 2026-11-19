'use strict';
// Florin (/budget): expenses and income in any currency, with budgets and charts. A Fastify plugin of
// the AkulavBox server; data in DATA_DIR/budget/florin.db, accounts from AkulavBox.
// The page is the React app in client/, built into dist/ (npm run build:budget). The build is part of
// the repository, so a server never needs the build tools.
const fs = require('node:fs');
const path = require('node:path');
const session = require('../../src/core/session');
const apps = require('../../src/core/apps');
const { db, getSetting, DB_PATH } = require('./server/db.js');
const { loadUser, requireAuth, requireAdmin, rowOfBox } = require('./server/auth.js');

const DIST = path.join(__dirname, 'dist');
const { version: VERSION } = require('./meta.json');

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:", "connect-src 'self'",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
].join('; ');

const hooks = {
  usage: () => null, // no files: nothing counts towards a quota
  summary: (boxId) => {
    const u = rowOfBox(boxId);
    const n = u ? db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?').get(u.id).n : 0;
    return `${n} transaction${n === 1 ? '' : 's'}`;
  },
  totals: () => {
    let bytes = 0;
    try { bytes = fs.statSync(DB_PATH).size; } catch { /* not created yet */ }
    return { bytes, items: db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, label: 'transactions' };
  },
  // categories and transactions go with the row (ON DELETE CASCADE)
  deleteUser: (boxId) => db.prepare('DELETE FROM users WHERE box_id = ?').run(boxId),
};

module.exports = async function budget(app, opts) {
  apps.register('budget', hooks);
  opts.onClose?.(() => db.close());

  app.addHook('onRequest', loadUser);
  app.addHook('onSend', async (req, reply) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    if (req.url.startsWith(`${opts.prefix}/api/`)) reply.header('Cache-Control', 'no-store');
  });

  // CSRF defence: state-changing API calls must carry a custom header,
  // which cross-site forms cannot set and cross-origin fetch cannot send without CORS.
  app.register(async (api) => {
    api.addHook('onRequest', async (req, reply) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
      if (req.headers['x-requested-with'] !== 'florin') return reply.code(403).send({ error: 'Missing CSRF header' });
    });
    api.get('/health', async () => ({ ok: true, version: VERSION }));
    api.get('/config', async () => ({ appName: 'Florin', version: VERSION, defaultCurrency: getSetting('default_currency') ?? 'EUR' }));
    api.get('/currencies', async () => ({ currencies: db.prepare('SELECT code, name, rate, updated_at AS updatedAt, source FROM rates ORDER BY code').all() }));
    api.register(require('./server/routes/auth.js'), { prefix: '/auth' });
    // everything else needs a signed-in account (and /admin an admin)
    for (const [name, guard] of [['categories', requireAuth], ['transactions', requireAuth], ['stats', requireAuth], ['admin', requireAdmin]]) {
      api.register(async (scope) => {
        scope.addHook('preHandler', guard);
        scope.register(require(`./server/routes/${name}.js`));
      }, { prefix: `/${name}` });
    }
    api.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'Not found' }));
    api.setErrorHandler((err, req, reply) => {
      const status = err.status || err.statusCode || 500;
      if (status >= 500) req.log.error(err);
      reply.code(status).send({ error: status >= 500 ? 'Something went wrong on our side' : err.message });
    });
  }, { prefix: '/api' });

  // The built page. Signed-out visitors go to the server's sign-in page first.
  if (fs.existsSync(DIST)) {
    // hashed file names under assets/ never change; index.html is served by `page` below
    app.register(require('@fastify/static'), {
      root: DIST, prefix: '/', decorateReply: false, wildcard: false, index: false, maxAge: '1h',
      allowedPath: (p) => p !== '/index.html',
      setHeaders: (res, file) => { if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); },
    });
  }
  const page = async (req, reply) => {
    if (!fs.existsSync(DIST)) return reply.code(503).type('text/plain').send('Florin’s page has not been built. Run: npm run build:budget');
    if (!req.user && !req.noAccess) return reply.redirect(session.loginUrl(req.url));
    reply.header('Cache-Control', 'no-cache');
    return reply.sendFile('index.html', DIST);
  };
  // The React router handles every other path of the page. A wildcard route under the prefix, not
  // only a not-found handler: AkulavBox's own static files answer "/*" first otherwise.
  const apiPath = `${opts.prefix}/api/`;
  const pageOr404 = (req, reply) => (req.url.startsWith(apiPath) ? reply.code(404).send({ error: 'Not found' }) : page(req, reply));
  app.get('/', page);
  app.get('/*', pageOr404);
  app.setNotFoundHandler((req, reply) => (req.method === 'GET' || req.method === 'HEAD' ? pageOr404(req, reply) : reply.code(404).send({ error: 'Not found' })));
};
