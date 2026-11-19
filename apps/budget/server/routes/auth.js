'use strict';
const { db } = require('../db.js');
const { publicUser, requireAuth } = require('../auth.js');
const { CURRENCY_CODES } = require('../currencies.js');
const { str, oneOf } = require('../util.js');

// Signing in, out and passwords are handled by the server's shared pages (/login, the account
// profile); Florin only keeps the display name and main currency.
module.exports = async function routes(router) {
  router.get('/me', { preHandler: requireAuth }, async (req, reply) => reply.send({ user: publicUser(req.user) }));

  router.patch('/me', { preHandler: requireAuth }, async (req, reply) => {
    const u = req.user;
    const name = str(req.body.name, { field: 'Name', min: 1, max: 80, optional: true }) ?? u.name;
    const currency = oneOf(req.body.baseCurrency, [...CURRENCY_CODES], { field: 'Currency', optional: true }) ?? u.base_currency;
    db.prepare('UPDATE users SET name = ?, base_currency = ? WHERE id = ?').run(name, currency, u.id);
    return reply.send({ user: publicUser({ ...db.prepare('SELECT * FROM users WHERE id = ?').get(u.id), username: u.username, role: u.role }) });
  });

};
