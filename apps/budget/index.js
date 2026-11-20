'use strict';
// Florin (/budget): expenses and income in any currency, with budgets and charts. A Fastify plugin of
// the AkulavBox server; data in DATA_DIR/budget/florin.db, accounts from AkulavBox.
// The page (public/) is Vue 3 with string templates and Tailwind compiled in the browser, like the rest
// of AkulavBox: no build step. Both libraries are served from node_modules, so it works offline.
const fs = require('node:fs');
const path = require('node:path');
const session = require('../../src/core/session');
const apps = require('../../src/core/apps');
const { db, getSetting, DB_PATH } = require('./server/db.js');
const { loadUser, requireAuth, requireAdmin, rowOfBox } = require('./server/auth.js');

const PUBLIC = path.join(__dirname, 'public');
const { version: VERSION } = require('./meta.json');
const VENDOR = {
  'vue.js': require.resolve('vue/dist/vue.esm-browser.prod.js'),
  'tailwind.js': require.resolve('@tailwindcss/browser'),
};

const INDEX_HTML = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
// the one inline script, the import map, is allowed by its hash
const importMap = /<script type="importmap">([\s\S]*?)<\/script>/.exec(INDEX_HTML)[1];
const importMapHash = require('node:crypto').createHash('sha256').update(importMap.replace(/\r\n?/g, '\n')).digest('base64');

// Vue compiles the templates in the browser, hence 'unsafe-eval'; Tailwind writes <style> tags.
const CSP = [
  "default-src 'self'", `script-src 'self' 'unsafe-eval' 'sha256-${importMapHash}'`, "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
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

  // The page's files. maxAge 0: browsers revalidate (ETag), so an update is picked up on reload.
  // index.html is served by `page` below, which checks the sign-in first.
  app.register(require('@fastify/static'), {
    root: PUBLIC, prefix: '/', decorateReply: false, wildcard: false, index: false, maxAge: 0,
    allowedPath: (p) => p !== '/index.html',
  });
  const vendor = Object.fromEntries(Object.entries(VENDOR).map(([name, file]) => [name, fs.readFileSync(file)]));
  app.get('/vendor/:file', (req, reply) => {
    const body = vendor[req.params.file];
    if (!body) return reply.code(404).send({ error: 'Not found' });
    return reply.type('text/javascript; charset=utf-8').header('Cache-Control', 'public, max-age=86400').send(body);
  });

  const page = async (req, reply) => {
    if (!req.user && !req.noAccess) return reply.redirect(session.loginUrl(req.url));
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(INDEX_HTML);
  };
  // The page's router handles every other path. A wildcard route under the prefix, not only a
  // not-found handler: AkulavBox's own static files answer "/*" first otherwise.
  const apiPath = `${opts.prefix}/api/`;
  const pageOr404 = (req, reply) => (req.url.startsWith(apiPath) ? reply.code(404).send({ error: 'Not found' }) : page(req, reply));
  app.get('/', page);
  app.get('/*', pageOr404);
  app.setNotFoundHandler((req, reply) => (req.method === 'GET' || req.method === 'HEAD' ? pageOr404(req, reply) : reply.code(404).send({ error: 'Not found' })));
};
