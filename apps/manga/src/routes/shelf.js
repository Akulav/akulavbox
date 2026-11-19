'use strict';
// Koma Shelf: the public side. The shelf, creator profiles, a work, the reader, likes, and the
// access-checked images. Plus the small files around them (manifest, robots.txt, health).
const fs = require('node:fs');
const path = require('node:path');
const { rateLimiter } = require('../auth');
const { shelfPage, workPage, readerPage, profilePage } = require('../views/shelf');
const { errorPage } = require('../views/admin');

const PAGE_SIZE = 24;
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const str = (v, max) => (typeof v === 'string' ? v : '').replace(/\r\n/g, '\n').trim().slice(0, max);
const MEDIA_FILE = /^(?:c\d{3}\/\d{4}(?:-s)?|cover(?:-s)?)\.webp$/;
const WORK_ID = /^[A-Za-z0-9_-]{6,20}$/;

module.exports = async function shelf(app, { ctx }) {
  const { db, send, LIST_COLS, getWork, canView, isOwner, chaptersOf, B } = ctx;
  const seen = rateLimiter({ windowMs: 6 * 60 * 60 * 1000, max: 1 }); // one counted read per reader per 6 h

  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../public/site.webmanifest'), 'utf8'));
  Object.assign(manifest, { name: ctx.site.siteName, short_name: ctx.site.siteName.slice(0, 12), start_url: `${B}/`, scope: `${B}/` });
  for (const i of manifest.icons) i.src = B + i.src;
  const manifestJson = JSON.stringify(manifest);
  app.get('/site.webmanifest', async (req, reply) => reply.header('Cache-Control', 'public, max-age=86400').type('application/manifest+json').send(manifestJson));
  app.get('/robots.txt', async (req, reply) => reply.type('text/plain').send(['User-agent: *', ...['me', 'admin', 'upload', 'account', 'api/'].map((p) => `Disallow: ${B}/${p}`), ''].join('\n')));
  app.get('/healthz', async () => ({ ok: true, version: ctx.site.version, queue: ctx.ingest.pending }));

  app.get('/', async (req, reply) => {
    const sort = ['popular', 'views'].includes(req.query.sort) ? req.query.sort : 'new';
    const q = str(req.query.q, 80);
    const page = Math.min(500, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
    const order = { new: 'w.published DESC', popular: 'w.likes DESC, w.published DESC', views: 'w.views DESC, w.published DESC' }[sort];
    const where = ["w.visibility = 'public'", "w.status = 'ready'"];
    const args = [];
    if (q) {
      where.push("(w.title LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')");
      args.push(`%${likeEscape(q)}%`, `%${likeEscape(q)}%`);
    }
    const from = `FROM works w JOIN users u ON u.id = w.user_id WHERE ${where.join(' AND ')}`;
    const rows = db.all(`SELECT ${LIST_COLS} ${from} ORDER BY ${order} LIMIT ? OFFSET ?`, ...args, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
    const total = q ? db.get(`SELECT COUNT(*) AS n ${from}`, ...args).n : 0;
    let featured = null;
    if (!q && page === 1) {
      const pub = `SELECT ${LIST_COLS} FROM works w JOIN users u ON u.id = w.user_id WHERE w.visibility = 'public' AND w.status = 'ready'`;
      featured = db.get(`${pub} AND w.published > ? ORDER BY w.likes DESC, w.views DESC LIMIT 1`, Date.now() - 30 * 86400 * 1000) || db.get(`${pub} ORDER BY w.published DESC LIMIT 1`) || null;
    }
    reply.header('Cache-Control', 'no-cache');
    return send(reply, shelfPage(req, { works: rows.slice(0, PAGE_SIZE), featured, sort, q, page, hasMore: rows.length > PAGE_SIZE, total }));
  });

  app.get('/u/:username', async (req, reply) => {
    const profile = db.get('SELECT id, username, bio, created FROM users WHERE username = ?', req.params.username);
    if (!profile) return send(reply, errorPage(req, 404), 404);
    const works = db.all(`SELECT ${LIST_COLS} FROM works w JOIN users u ON u.id = w.user_id WHERE w.user_id = ? AND w.visibility = 'public' AND w.status = 'ready' ORDER BY w.published DESC`, profile.id);
    return send(reply, profilePage(req, { profile, works, isSelf: req.user?.id === profile.id }));
  });

  app.get('/w/:id', async (req, reply) => {
    const w = getWork(req.params.id);
    if (!w || !canView(req, w)) return send(reply, errorPage(req, 404), 404);
    const author = db.get('SELECT username FROM users WHERE id = ?', w.user_id);
    const chapters = w.status === 'ready' ? chaptersOf(w.id).map((c) => ({ idx: c.idx, title: c.title })) : [];
    const liked = req.user ? Boolean(db.get('SELECT 1 FROM likes WHERE user_id = ? AND work_id = ?', req.user.id, w.id)) : false;
    reply.header('Cache-Control', 'private, no-cache');
    if (w.visibility !== 'public') reply.header('X-Robots-Tag', 'noindex');
    return send(reply, workPage(req, { work: w, author, chapters, isOwner: isOwner(req, w), isAdmin: req.user?.role === 'admin' && w.visibility !== 'private', liked }));
  });

  app.get('/w/:id/:n', async (req, reply) => {
    if (!/^\d{1,4}$/.test(req.params.n)) return send(reply, errorPage(req, 404), 404);
    const w = getWork(req.params.id);
    if (!w || !canView(req, w) || w.status !== 'ready') return send(reply, errorPage(req, 404), 404);
    const chapters = chaptersOf(w.id);
    const chapter = chapters.find((c) => c.idx === Number(req.params.n));
    if (!chapter) return ctx.go(reply, `/w/${w.id}`);
    if (!isOwner(req, w) && seen.hit(`${req.user?.id ?? req.ip}:${w.id}`)) db.run('UPDATE works SET views = views + 1 WHERE id = ?', w.id);
    if (w.visibility !== 'public') reply.header('X-Robots-Tag', 'noindex');
    reply.header('Cache-Control', 'private, no-cache');
    return send(reply, readerPage(req, { work: w, chapter, chapters: chapters.map((c) => ({ idx: c.idx, title: c.title })), pages: JSON.parse(chapter.pages) }));
  });

  app.post('/w/:id/like', { preHandler: ctx.requireUser }, async (req, reply) => {
    const w = getWork(req.params.id);
    if (!w || !canView(req, w) || w.status !== 'ready') return reply.code(404).send({ error: 'not found' });
    const liked = db.tx(() => {
      const had = db.get('SELECT 1 FROM likes WHERE user_id = ? AND work_id = ?', req.user.id, w.id);
      if (had) db.run('DELETE FROM likes WHERE user_id = ? AND work_id = ?', req.user.id, w.id);
      else db.run('INSERT INTO likes (user_id, work_id, created) VALUES (?, ?, ?)', req.user.id, w.id, Date.now());
      db.run('UPDATE works SET likes = (SELECT COUNT(*) FROM likes WHERE work_id = ?) WHERE id = ?', w.id, w.id);
      return !had;
    });
    const { likes } = db.get('SELECT likes FROM works WHERE id = ?', w.id);
    if (/application\/json/.test(req.headers.accept || '')) return { liked, likes };
    return ctx.go(reply, `/w/${w.id}`, 303);
  });

  // images: private ones only for their owner, the rest once processed
  app.get('/media/:id/*', async (req, reply) => {
    const id = req.params.id;
    const file = req.params['*'];
    if (!WORK_ID.test(id) || !MEDIA_FILE.test(file)) return reply.code(404).send();
    const w = db.get('SELECT user_id, visibility, status FROM works WHERE id = ?', id);
    if (!w || !(req.user?.id === w.user_id || (w.status === 'ready' && w.visibility !== 'private'))) return reply.code(404).send();
    const isCover = file.startsWith('cover');
    reply.header('Cache-Control', w.visibility === 'private' ? 'private, max-age=86400' : isCover ? (req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=300') : 'public, max-age=2592000');
    if (w.visibility !== 'public') reply.header('X-Robots-Tag', 'noindex');
    if (!fs.existsSync(path.join(ctx.worksDir, id, ...file.split('/')))) return reply.code(404).send();
    return reply.sendFile(path.join(id, ...file.split('/')), ctx.worksDir, { cacheControl: false });
  });
};
