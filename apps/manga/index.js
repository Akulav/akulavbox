'use strict';
// Koma Shelf (/manga): webtoons made with Koma. A Fastify plugin of the AkulavBox server; data in
// DATA_DIR/manga (koma-shelf.sqlite, works/<id>/, tmp/), accounts from AkulavBox (src/core/session.js).
//
// The views are written with root paths ("/w/abc"); `send` adds the prefix to every href/src/action
// on the way out and `go` to redirects, so the site doesn't need to know where it is mounted.
// "~/…" in a view means a page of the server around it (the launcher, AkulavBox, /admin).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../../src/core/config');
const session = require('../../src/core/session');
const apps = require('../../src/core/apps');
const { openData } = require('./src/data');
const { createAuth } = require('./src/auth');
const { createIngest } = require('./src/ingest');
const { toString, withBase: withBaseOf } = require('./src/html');
const { errorPage } = require('./src/views/admin');

const PUBLIC = path.join(__dirname, 'public');
const FONTS = path.join(path.dirname(require.resolve('@fontsource/dela-gothic-one/index.css')), 'files');
const { version: VERSION } = require('./meta.json');

/** Hash of the static assets, appended as ?v= so browsers can cache them forever */
function assetRevision() {
  const h = crypto.createHash('sha256');
  for (const f of fs.readdirSync(path.join(PUBLIC, 'static')).sort()) h.update(fs.readFileSync(path.join(PUBLIC, 'static', f)));
  return h.digest('hex').slice(0, 10);
}

function context(prefix) {
  const { db, dataDir, worksDir, tmpDir, usedBy, hooks } = openData();
  const site = { siteName: process.env.MANGA_SITE_NAME || 'Koma Shelf', version: VERSION, publicUrl: config.publicUrl, base: prefix, assetRev: assetRevision(), maxUploadMb: config.mangaMaxUploadMb };
  const ingest = createIngest({ db, config: { dataDir }, log: console });
  ingest.recover();

  const withBase = (html) => withBaseOf(prefix, html);

  const ctx = {
    db, ingest, site, worksDir, tmpDir, B: prefix, session, apps,
    auth: createAuth(db, { session, apps }),
    withBase,
    send: (reply, view, status = 200) => reply.code(status).type('text/html; charset=utf-8').send(withBase(toString(view))),
    /** Redirect inside the site */
    go: (reply, url, status = 302) => reply.redirect(prefix + url, status),
    flash: (reply, kind, text) => session.addCookie(reply, `flash=${encodeURIComponent(JSON.stringify({ kind, text }))}; Path=${prefix}; HttpOnly; SameSite=Lax; Max-Age=60`),
    origin: (req) => site.publicUrl || `${req.protocol}://${req.host}`,
    getWork: (id) => db.get('SELECT * FROM works WHERE id = ?', id),
    isOwner: (req, w) => Boolean(req.user && req.user.id === w.user_id),
    // storage is the AkulavBox account's one space, shared by every app (plus a limit of Koma Shelf's
    // own, when the admin set one): what may still be stored, and the space for the account page
    roomOf: (u) => apps.room(u.boxId, 'manga'),
    spaceOf: (u) => apps.space(u.boxId, { fresh: 'manga' }),
    usedBy,
    hooks,
    chaptersOf: (id) => db.all('SELECT idx, title, pages FROM chapters WHERE work_id = ? ORDER BY idx', id),
    deleteWork: async (id) => {
      db.run('DELETE FROM works WHERE id = ?', id);
      apps.changed(null, 'manga'); // the space it took is free again
      await fs.promises.rm(path.join(worksDir, id), { recursive: true, force: true });
    },
    LIST_COLS: 'w.id, w.title, w.visibility, w.status, w.cover_rev, w.likes, w.views, w.chapters, w.created, w.published, u.username',
  };
  /** Private: owner only. Unlisted/public: anyone, once processed. Admins get no extra access to private work. */
  ctx.canView = (req, w) => ctx.isOwner(req, w) || (w.status === 'ready' && w.visibility !== 'private');
  ctx.requireUser = async (req, reply) => {
    if (req.user) return;
    if (req.noAccess) return ctx.send(reply, errorPage(req, 403, 'Your account doesn’t have Koma Shelf turned on. Ask the admin of this server.'), 403);
    if (req.method === 'GET') return reply.redirect(session.loginUrl(req.url));
    return ctx.send(reply, errorPage(req, 403, 'Please log in first.'), 403);
  };
  ctx.requireAdmin = async (req, reply) => {
    if (req.user?.role !== 'admin') return ctx.send(reply, errorPage(req, 404), 404);
  };
  return ctx;
}

module.exports = async function manga(app, opts) {
  const ctx = context(opts.prefix);
  apps.register('manga', ctx.hooks);
  opts.onClose?.(async () => {
    await ctx.ingest.idle().catch(() => {});
    ctx.db.close();
  });

  app.register(require('@fastify/multipart'), { limits: { fileSize: ctx.site.maxUploadMb * 1024 * 1024, files: 3000, fields: 400, fieldSize: 16 * 1024, parts: 3500 } });
  app.register(require('@fastify/static'), { root: path.join(PUBLIC, 'static'), prefix: '/static/', decorateReply: false, index: false, immutable: true, maxAge: '1y' });
  app.register(require('@fastify/static'), { root: FONTS, prefix: '/fonts/', decorateReply: false, index: false, immutable: true, maxAge: '1y' });
  app.register(require('@fastify/static'), { root: path.join(PUBLIC, 'root'), prefix: '/', decorateReply: false, index: false, wildcard: false, maxAge: '7d' });

  // no inline scripts at all: the theme (before first paint) and the account menu come from /hub/
  const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "img-src 'self' data: blob:", "font-src 'self' https://fonts.gstatic.com", "connect-src 'self'", "form-action 'self'", "frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'"].join('; ');
  app.addHook('onSend', async (req, reply) => {
    reply.header('Content-Security-Policy', csp);
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Frame-Options', 'DENY');
    if (session.isHttps(req)) reply.header('Strict-Transport-Security', 'max-age=31536000');
  });

  // who is signed in (the shared cookie, or a Koma API token), and the one-shot flash message
  app.addHook('onRequest', async (req, reply) => {
    req.site = { ...ctx.site, origin: ctx.origin(req) };
    ctx.auth.middleware(req, reply, () => {});
    if (req.cookies.flash) {
      try { req.flash = JSON.parse(req.cookies.flash); } catch { /* ignore */ }
      session.addCookie(reply, `flash=; Path=${ctx.B}; Max-Age=0; SameSite=Lax`);
    }
  });
  // CSRF: same origin for every change, plus the form token (multipart forms: once parsed)
  app.addHook('preHandler', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    if (!ctx.auth.originOk(req)) return ctx.send(reply, errorPage(req, 403, 'Cross-site request blocked.'), 403);
    if (req.isMultipart()) return;
    if (!ctx.auth.tokenOk(req)) return ctx.send(reply, errorPage(req, 403, 'This form expired. Go back, reload the page and try again.'), 403);
  });

  for (const routes of ['shelf', 'library', 'account', 'api', 'admin']) app.register(require(`./src/routes/${routes}`), { ctx });

  // unknown pages get the site's own 404 (a wildcard route: AkulavBox's static files answer "/*" otherwise)
  const notFound = (req, reply) => ctx.send(reply, errorPage(req, 404), 404);
  app.get('/*', notFound);
  app.setNotFoundHandler(notFound);
  app.setErrorHandler((err, req, reply) => {
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return ctx.send(reply, errorPage(req, 413, 'That form was too large.'), 413);
    if (err.statusCode >= 400 && err.statusCode < 500) return ctx.send(reply, errorPage(req, err.statusCode), err.statusCode);
    req.log.error(err);
    return ctx.send(reply, errorPage(req, 500), 500);
  });
};
