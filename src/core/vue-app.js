// What every Vue app of the server (Florin, Tick) needs around its own routes, as Fastify helpers:
//   - its security headers: a CSP that allows Vue's template compiler ('unsafe-eval'), Tailwind's
//     <style> tags, the Google fonts, and the page's one inline script (the import map) by hash
//   - an /api scope with the CSRF header check (X-Requested-With: <app>) and JSON errors
//   - its page: public/ as static files, and index.html for every page path after the sign-in check
const path = require('path');
const crypto = require('crypto');
const session = require('./session');
const assets = require('./assets');

/**
 * The page's index.html (its asset URLs versioned, src/core/assets.js) and the CSP for it, which allows
 * the import map by its hash. Both follow the revision, so they are worked out again when it changes.
 */
const csps = new WeakMap();
function pageOf(publicDir) {
  const p = assets.page(path.join(publicDir, 'index.html'));
  if (csps.has(p)) return { html: p.html, csp: csps.get(p), page: p };
  const html = p.html;
  const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
  const hash = map ? `'sha256-${crypto.createHash('sha256').update(map[1].replace(/\r\n?/g, '\n')).digest('base64')}'` : '';
  const csp = [
    "default-src 'self'", `script-src 'self' 'unsafe-eval' ${hash}`.trim(), "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:", "connect-src 'self'",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
  ].join('; ');
  csps.set(p, csp);
  return { html, csp, page: p };
}

/**
 * Security headers for the whole app, and no caching of its API answers.
 * Call first, in the app's plugin, with the same options as servePage.
 */
function headers(app, { prefix, publicDir }) {
  app.addHook('onSend', async (req, reply) => {
    reply.header('Content-Security-Policy', pageOf(publicDir).csp);
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (req.url.startsWith(`${prefix}/api/`)) reply.header('Cache-Control', 'no-store');
  });
}

/**
 * The app's API under /api. Changes must carry `X-Requested-With: <csrfName>`, which cross-site
 * forms can't set and cross-origin fetch can't send without CORS. Errors with a status below 500
 * answer { error: message } (the message is shown as it is); others are logged.
 */
function api(app, { csrfName, routes }) {
  app.register(async (scope) => {
    scope.addHook('onRequest', async (req, reply) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
      if (req.headers['x-requested-with'] !== csrfName) return reply.code(403).send({ error: 'Missing CSRF header' });
    });
    scope.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'Not found' }));
    scope.setErrorHandler((err, req, reply) => {
      const status = err.status || err.statusCode || 500;
      if (status >= 500) req.log.error(err);
      reply.code(status).send({ error: status >= 500 ? 'Something went wrong on our side' : err.message });
    });
    await routes(scope);
  }, { prefix: '/api' });
}

/**
 * The page. Signed-out visitors go to the shared sign-in page; accounts without the app get the page
 * too (it says so). The page's router handles every path: a wildcard route under the prefix, not
 * only a not-found handler, because AkulavBox's own static files answer "/*" first otherwise.
 */
function servePage(app, { prefix, publicDir }) {
  // maxAge 0: browsers revalidate (ETag), so an update shows on the next reload
  app.register(require('@fastify/static'), {
    root: publicDir, prefix: '/', decorateReply: false, wildcard: false, index: false, maxAge: 0,
    allowedPath: (p) => p !== '/index.html',
  });
  const page = async (req, reply) => {
    if (!req.user && !req.noAccess) return reply.redirect(session.loginUrl(req.url));
    const { page: p } = pageOf(publicDir);
    reply.header('Cache-Control', 'no-cache').header('ETag', p.etag);
    if (req.headers['if-none-match'] === p.etag) return reply.code(304).send();
    return reply.type('text/html; charset=utf-8').send(p.html);
  };
  const apiPath = `${prefix}/api/`;
  const pageOr404 = (req, reply) => (req.url.startsWith(apiPath) ? reply.code(404).send({ error: 'Not found' }) : page(req, reply));
  app.get('/', page);
  app.get('/*', pageOr404);
  app.setNotFoundHandler((req, reply) => (req.method === 'GET' || req.method === 'HEAD' ? pageOr404(req, reply) : reply.code(404).send({ error: 'Not found' })));
}

module.exports = { headers, api, servePage };
