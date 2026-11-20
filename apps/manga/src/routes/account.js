'use strict';
// Koma Shelf: signing in and out (on the server's shared pages), the account page and API tokens.
// Accounts are made by the server's admin (Admin console), so there is no sign-up here.
const { accountPage } = require('../views/account');

const str = (v, max) => (typeof v === 'string' ? v : '').replace(/\r\n/g, '\n').trim().slice(0, max);
// a path inside the site to come back to ("/w/abc"), never another site
const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)[\w\-./?=&%]*$/.test(n) ? n : '/');

module.exports = async function account(app, { ctx }) {
  const { db, send, go, session, B } = ctx;
  const auth = { preHandler: ctx.requireUser };

  const signIn = async (req, reply) => {
    if (req.user) return go(reply, '/me');
    const next = safeNext(req.query.next);
    return reply.redirect(session.loginUrl(B + (next === '/' ? '/me' : next)));
  };
  app.get('/login', signIn);
  app.get('/register', signIn);

  app.post('/logout', async (req, reply) => {
    session.addCookie(reply, session.clearCookie(req));
    // ?out=1: the sign-in page also forgets the token AkulavBox keeps in the browser
    return reply.redirect('/login?out=1', 303);
  });

  const tokensOf = (uid) => db.all('SELECT id, name, prefix, created, last_used FROM api_tokens WHERE user_id = ? ORDER BY created DESC', uid);
  const view = (req, extra = {}) => accountPage(req, { tokens: tokensOf(req.user.id), siteUrl: ctx.origin(req) + B, usage: (() => { const s = ctx.spaceOf(req.user); return { used: ctx.usedBy(req.user.id), total: s?.used_bytes ?? 0, quota: s?.quota_bytes ?? 0 }; })(), ...extra });

  app.get('/account', auth, async (req, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return send(reply, view(req));
  });
  app.post('/account/tokens', auth, async (req, reply) => {
    if (req.viaToken) return reply.code(403).send({ error: 'Tokens can’t create tokens.' });
    if (tokensOf(req.user.id).length >= 20) return send(reply, view(req, { error: 'You have 20 tokens already — revoke one first.' }), 400);
    const name = str(req.body?.name, 60) || 'Koma';
    const token = ctx.auth.createToken(req.user.id, name);
    reply.header('Cache-Control', 'no-store');
    return send(reply, view(req, { newToken: { name, token } }));
  });
  app.post('/account/tokens/:id/delete', auth, async (req, reply) => {
    db.run('DELETE FROM api_tokens WHERE id = ? AND user_id = ?', Number(req.params.id) || 0, req.user.id);
    ctx.flash(reply, 'ok', 'Token revoked. Anything using it can no longer upload.');
    return go(reply, '/account#koma');
  });
  app.post('/account/profile', auth, async (req, reply) => {
    db.run('UPDATE users SET bio = ? WHERE id = ?', str(req.body?.bio, 500), req.user.id);
    ctx.flash(reply, 'ok', 'Profile saved.');
    return go(reply, '/account');
  });
};
