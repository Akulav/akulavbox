'use strict';
// Koma Shelf: moderation. Admins (the AkulavBox role) see shared works and can unpublish or delete
// them; private works stay private, even from admins. Accounts themselves live in the Admin console.
const { adminPage, errorPage } = require('../views/admin');
const { folderBytes } = require('../ingest');

const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const str = (v, max) => (typeof v === 'string' ? v : '').trim().slice(0, max);
const diskLabel = (b) => (b >= 1e9 ? [(b / 1e9).toFixed(2), 'GB'] : [(b / 1e6).toFixed(b >= 1e8 ? 0 : 1), 'MB']);

module.exports = async function admin(app, { ctx }) {
  const { db, send, go, LIST_COLS, getWork } = ctx;
  const admins = { preHandler: [ctx.requireUser, ctx.requireAdmin] };
  let diskCache = { at: 0, bytes: 0 };

  app.get('/admin', admins, async (req, reply) => {
    const q = str(req.query.q, 80);
    const args = [];
    let where = "w.visibility IN ('public', 'unlisted')";
    if (q) {
      where += " AND (w.title LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')";
      args.push(`%${likeEscape(q)}%`, `%${likeEscape(q)}%`);
    }
    const works = db.all(`SELECT ${LIST_COLS} FROM works w JOIN users u ON u.id = w.user_id WHERE ${where} ORDER BY COALESCE(w.published, w.created) DESC LIMIT 200`, ...args);
    const users = db.all('SELECT u.username, u.box_id, u.created, (SELECT COUNT(*) FROM works w WHERE w.user_id = u.id) AS works, (SELECT COALESCE(SUM(bytes), 0) FROM works w WHERE w.user_id = u.id) AS bytes FROM users u WHERE u.box_id IS NOT NULL ORDER BY u.created DESC LIMIT 50');
    for (const u of users) u.role = ctx.apps.boxUser(u.box_id)?.role === 'admin' ? 'admin' : 'user';
    const counts = Object.fromEntries(db.all('SELECT visibility, COUNT(*) AS n FROM works GROUP BY visibility').map((r) => [r.visibility, r.n]));
    if (Date.now() - diskCache.at > 5 * 60 * 1000) diskCache = { at: Date.now(), bytes: await folderBytes(ctx.worksDir) };
    const stats = { users: users.length, public: counts.public || 0, unlisted: counts.unlisted || 0, private: counts.private || 0, disk: diskLabel(diskCache.bytes) };
    return send(reply, adminPage(req, { works, users, stats, q }));
  });

  const adminWork = async (req, reply) => {
    const w = getWork(req.params.id);
    if (!w || (w.visibility === 'private' && w.user_id !== req.user.id)) return send(reply, errorPage(req, 404), 404);
    req.work = w;
  };
  const moderate = { preHandler: [ctx.requireUser, ctx.requireAdmin, adminWork] };

  app.post('/admin/works/:id/delete', moderate, async (req, reply) => {
    await ctx.deleteWork(req.work.id);
    req.log.info(`[manga] ${req.user.username} deleted ${req.work.id} (“${req.work.title}”)`);
    ctx.flash(reply, 'ok', `Deleted “${req.work.title}”.`);
    return go(reply, '/admin');
  });
  app.post('/admin/works/:id/unpublish', moderate, async (req, reply) => {
    db.run("UPDATE works SET visibility = 'private', updated = ? WHERE id = ?", Date.now(), req.work.id);
    ctx.flash(reply, 'ok', `“${req.work.title}” is off the shelf (now private to its creator).`);
    return go(reply, '/admin');
  });
};
