const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const config = require('../core/config');
const db = require('../core/db');
const session = require('../core/session');
const apps = require('../core/apps');
const { verifyUser, readToken } = require('../core/auth');
const assets = require('../core/assets');

// The pages of AkulavBox around the apps: sign-in (/login), the app launcher (/), the Admin
// console (/admin), AI connectors (/connect), and Trove's page at /box/. They are static files;
// each page asks the API who is signed in and goes to /login when nobody is.
const HUB = path.join(__dirname, '../../hub');
const TROVE = path.join(__dirname, '../../apps/trove/public');
const BRAND = path.join(HUB, 'brand');
const APPS_DIR = path.join(__dirname, '../../apps');

// Every page's scripts and styles are versioned (src/core/assets.js): cached for a year, never mixed
// across an update. Trove's files live at the site's root paths but are versioned under /box/.
assets.addRoot('/hub/', HUB, { skip: /[\\/]hub[\\/](brand|vendor)([\\/]|$)/ });
assets.addRoot('/docs/', path.join(APPS_DIR, 'documents', 'public'));
assets.addRoot('/budget/', path.join(APPS_DIR, 'budget', 'public'));
assets.addRoot('/tasks/', path.join(APPS_DIR, 'tasks', 'public'));
assets.addRoot('/', TROVE, { versioned: '/box/' });
// Vue and Tailwind's browser build for every app's page, from node_modules: no CDN, works offline
const VENDOR = {
  'vue.js': require.resolve('vue/dist/vue.esm-browser.prod.js'),
  'tailwind.js': require.resolve('@tailwindcss/browser'),
};
for (const [name, file] of Object.entries(VENDOR)) assets.addVendor(`/hub/vendor/${name}`, file);

module.exports = async function (fastify) {
  // unversioned /hub/… still works (revalidated on every use)
  fastify.register(require('@fastify/static'), { root: HUB, prefix: '/hub/', decorateReply: false, index: false, maxAge: 0 });
  assets.routes(fastify);

  // /hub/vendor/vue.js without a revision (pages from before 5.2, scripts that name it): read and
  // gzipped once, with an ETag, revalidated daily
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

  const page = (file, dir = HUB) => async (request, reply) => assets.sendPage(request, reply, path.join(dir, file));
  fastify.get('/', page('index.html'));
  fastify.get('/login', page('login.html'));
  fastify.get('/admin', page('admin.html'));
  fastify.get('/connect', page('connect.html'));
  // an AI app asks to connect (the rest of OAuth is in modules/connector.js)
  fastify.get('/oauth/authorize', page('authorize.html'));
  fastify.get('/box', async (request, reply) => reply.redirect('/box/'));
  fastify.get('/box/', page('index.html', TROVE));
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
