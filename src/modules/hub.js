const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const config = require('../core/config');
const db = require('../core/db');
const session = require('../core/session');
const apps = require('../core/apps');
const { verifyUser, readToken } = require('../core/auth');

// The pages of AkulavBox around the apps: sign-in (/login), the app launcher (/), the Admin
// console (/admin), AI connectors (/connect), and Trove's page at /box/. They are static files;
// each page asks the API who is signed in and goes to /login when nobody is.
const HUB = path.join(__dirname, '../../hub');
const TROVE = path.join(__dirname, '../../apps/trove/public');
const BRAND = path.join(HUB, 'brand');

/** A short hash of everything in hub/ (except brand/): changes whenever any of its files does */
function hubRevision() {
  const h = crypto.createHash('sha1');
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'brand') walk(p); } else { h.update(e.name); h.update(fs.readFileSync(p)); }
    }
  };
  walk(HUB);
  return h.digest('base64url').slice(0, 10);
}

module.exports = async function (fastify) {
  fastify.register(require('@fastify/static'), { root: HUB, prefix: '/hub/', decorateReply: false, index: false, maxAge: 0 });

  // The hub's pages load their scripts and styles from /hub/~<revision>/…: the revision changes with
  // their contents, so a browser never mixes an old cached module with a new one (Safari on iPhone kept
  // an old common.js after an update and the launcher stopped at "Loading your apps…"), and the files
  // can be kept for a year. Relative imports (./common.js) stay under the same revision. /hub/… without
  // one still works (the other apps load /hub/account.js and /hub/vue/… that way).
  const REV = hubRevision();
  fastify.get('/hub/~:rev/*', async (request, reply) => {
    const rel = request.params['*'];
    if (!/^[\w./-]+$/.test(rel) || rel.includes('..') || rel.startsWith('vendor/')) return reply.code(404).send({ error: 'Not found' });
    reply.header('Cache-Control', request.params.rev === REV ? 'public, max-age=31536000, immutable' : 'no-cache');
    return reply.sendFile(rel, HUB, { cacheControl: false }); // keep the header above
  });
  const pages = new Map();
  const hubPage = (file) => {
    if (!pages.has(file)) {
      const html = fs.readFileSync(path.join(HUB, file), 'utf-8').replace(/(["'(])\/hub\/(?!vendor\/|~)([\w./-]+\.(?:js|css))/g, `$1/hub/~${REV}/$2`);
      pages.set(file, { html, etag: `"${crypto.createHash('sha1').update(html).digest('base64url').slice(0, 16)}"` });
    }
    return pages.get(file);
  };

  // Vue and Tailwind's browser build for every app's page (Trove too), from node_modules: no CDN, works
  // offline. Read and gzipped once at start (≈430 KB → ≈130 KB on the wire), with an ETag, so a reload
  // costs a 304 and no CPU. The file names carry no version, so they are revalidated daily.
  const VENDOR = {
    'vue.js': require.resolve('vue/dist/vue.esm-browser.prod.js'),
    'tailwind.js': require.resolve('@tailwindcss/browser'),
  };
  const vendor = new Map(Object.entries(VENDOR).map(([name, file]) => {
    const body = fs.readFileSync(file);
    return [name, { body, gz: zlib.gzipSync(body, { level: 9 }), etag: `"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20)}"` }];
  }));
  fastify.get('/hub/vendor/:file', async (request, reply) => {
    const v = vendor.get(request.params.file);
    if (!v) return reply.code(404).send({ error: 'Not found' });
    reply.header('Cache-Control', 'public, max-age=86400').header('ETag', v.etag).header('Vary', 'Accept-Encoding');
    if (request.headers['if-none-match'] === v.etag) return reply.code(304).send();
    reply.type('text/javascript; charset=utf-8');
    if (/\bgzip\b/.test(String(request.headers['accept-encoding'] || ''))) return reply.header('Content-Encoding', 'gzip').send(v.gz);
    return reply.send(v.body);
  });

  /** A hub page, its module and style URLs carrying the revision */
  const page = (file) => async (request, reply) => {
    const p = hubPage(file);
    reply.header('Cache-Control', 'no-cache').header('ETag', p.etag);
    if (request.headers['if-none-match'] === p.etag) return reply.code(304).send();
    return reply.type('text/html; charset=utf-8').send(p.html);
  };
  fastify.get('/', page('index.html'));
  fastify.get('/login', page('login.html'));
  fastify.get('/admin', page('admin.html'));
  fastify.get('/connect', page('connect.html'));
  // an AI app asks to connect (the rest of OAuth is in modules/connector.js)
  fastify.get('/oauth/authorize', page('authorize.html'));
  fastify.get('/box', async (request, reply) => reply.redirect('/box/'));
  fastify.get('/box/', async (request, reply) => {
    reply.header('Cache-Control', 'no-cache');
    return reply.sendFile('index.html', TROVE);
  });
  // Trove's own install manifest (its files stay at the root paths, so it is mapped here)
  fastify.get('/box/manifest.webmanifest', async (request, reply) => {
    reply.header('Cache-Control', 'no-cache').type('application/manifest+json');
    return reply.sendFile('trove.webmanifest', TROVE);
  });

  // AkulavBox's own icons and install manifest, at the site's root where browsers and password
  // managers (Bitwarden) look for them. /apple-touch-icon-precomposed.png is the name iOS tries first.
  const BRAND_FILES = { 'favicon.ico': 'favicon.ico', 'favicon.svg': 'favicon.svg', 'favicon-32x32.png': 'favicon-32x32.png', 'favicon-96x96.png': 'favicon-96x96.png', 'icon-192.png': 'icon-192.png', 'icon-512.png': 'icon-512.png', 'apple-touch-icon.png': 'apple-touch-icon.png', 'apple-touch-icon-precomposed.png': 'apple-touch-icon.png', 'manifest.webmanifest': 'manifest.webmanifest' };
  for (const [url, file] of Object.entries(BRAND_FILES)) {
    fastify.get(`/${url}`, async (request, reply) => {
      reply.header('Cache-Control', file.endsWith('.webmanifest') ? 'no-cache' : 'public, max-age=86400');
      if (file.endsWith('.webmanifest')) reply.type('application/manifest+json');
      return reply.sendFile(file, BRAND);
    });
  }

  // The apps of this server, for the signed-out sign-in page: names, colours and taglines only.
  const catalog = JSON.stringify({ name: config.name, version: config.version, apps: apps.APPS.map((a) => ({ id: a.id, name: a.name, path: a.path, tagline: a.tagline, short: a.short, color: a.color })) });
  fastify.get('/api/apps/catalog', async (request, reply) => reply.type('application/json; charset=utf-8').header('Cache-Control', 'public, max-age=300').send(catalog));

  // Bearer token (the page's) → the same token in the cookie the other apps read.
  // The launcher calls it on every load, so sessions from before 4.0 carry over.
  fastify.post('/api/session', { preHandler: verifyUser }, async (request, reply) => {
    session.addCookie(reply, session.cookieFor(request, readToken(request)));
    return { success: true };
  });

  // Cookie → token, for a page that lost its stored token (another tab signed in,
  // or storage was cleared). Same-origin only; SameSite=Lax keeps other sites out too.
  fastify.post('/api/session/resume', async (request, reply) => {
    if (!session.sameOrigin(request)) return reply.code(403).send({ error: 'Cross-site request refused.' });
    const s = session.userOf(request, reply);
    if (!s) return reply.code(401).send({ error: 'Not signed in' });
    return { token: s.token, id: s.user.id, username: s.user.username, role: s.user.role };
  });

  // For the account menu of the other apps (hub/account.js), which only have the cookie: who is
  // signed in, and their AkulavBox profile picture. Read-only; other sites can't read the answer
  // (no CORS with credentials) and SameSite=Lax keeps the cookie off their requests anyway.
  const pictureOf = db.prepare('SELECT profile_image FROM users WHERE id = ?');
  const pictureVersion = (img) => crypto.createHash('sha1').update(img).digest('hex').slice(0, 12);
  fastify.get('/api/session/me', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const s = session.userOf(request, reply);
    if (!s) return reply.code(401).send({ error: 'Not signed in' });
    const img = pictureOf.get(s.user.id)?.profile_image;
    // the apps the account may open, for the app switcher in the account menu
    const list = apps.APPS.filter((a) => apps.access(s.user.id, a.id).enabled && apps.status(a.id) === 'running').map((a) => ({ id: a.id, name: a.name, path: a.path, color: a.color }));
    return { id: s.user.id, username: s.user.username, role: s.user.role, avatar: img ? `/api/session/avatar?v=${pictureVersion(img)}` : null, apps: list };
  });
  fastify.get('/api/session/avatar', async (request, reply) => {
    const s = session.userOf(request, reply);
    if (!s) return reply.code(401).send({ error: 'Not signed in' });
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/s.exec(pictureOf.get(s.user.id)?.profile_image || '');
    if (!m) return reply.code(404).send({ error: 'No profile picture' });
    // the URL carries the picture's version (?v=), so it may be kept until it changes
    return reply.type(m[1]).header('Cache-Control', 'private, max-age=31536000, immutable').header('X-Content-Type-Options', 'nosniff').send(Buffer.from(m[2], 'base64'));
  });

  fastify.post('/api/logout', async (request, reply) => {
    // another site must not be able to sign people out
    if (!session.sameOrigin(request)) return reply.code(403).send({ error: 'Cross-site request refused.' });
    session.addCookie(reply, session.clearCookie(request));
    return { success: true };
  });

  // The launcher: the apps this account can open, with what each one stores
  fastify.get('/api/apps', { preHandler: verifyUser }, async (request) => ({
    user: request.user,
    name: config.name,
    version: config.version,
    apps: apps.forUser(request.user),
    space: apps.describeSpace(apps.space(request.user.id)),
  }));
};
