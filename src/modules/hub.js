const path = require('path');
const crypto = require('crypto');
const config = require('../core/config');
const db = require('../core/db');
const session = require('../core/session');
const apps = require('../core/apps');
const { verifyUser, readToken } = require('../core/auth');

// The pages around the apps: sign-in (/login), the app launcher (/), the Admin
// console (/admin) and AkulavBox itself at /box/. They are static files; each
// page asks the API who is signed in and goes to /login when nobody is.
const HUB = path.join(__dirname, '../../hub');
const FRONTEND = path.join(__dirname, '../../frontend');

module.exports = async function (fastify) {
  fastify.register(require('@fastify/static'), { root: HUB, prefix: '/hub/', decorateReply: false, index: false, maxAge: 0 });

  const page = (file, dir = HUB) => async (request, reply) => {
    reply.header('Cache-Control', 'no-cache');
    return reply.sendFile(file, dir);
  };
  fastify.get('/', page('index.html'));
  fastify.get('/login', page('login.html'));
  fastify.get('/admin', page('admin.html'));
  fastify.get('/box', async (request, reply) => reply.redirect('/box/'));
  fastify.get('/box/', page('index.html', FRONTEND));

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
    return { id: s.user.id, username: s.user.username, role: s.user.role, avatar: img ? `/api/session/avatar?v=${pictureVersion(img)}` : null };
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
  }));
};
