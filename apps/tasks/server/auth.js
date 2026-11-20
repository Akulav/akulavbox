'use strict';
// Accounts come from AkulavBox (one sign-in for every app, src/core/session.js); Tasks keeps no
// account rows of its own: its rows carry the AkulavBox account id.
const session = require('../../../src/core/session');
const apps = require('../../../src/core/apps');

/** onRequest: req.user when the shared sign-in cookie is valid and the account may use Tasks */
async function loadUser(req, reply) {
  req.user = null;
  req.noAccess = false;
  const s = session.userOf(req, reply);
  if (!s) return;
  if (apps.access(s.user.id, 'tasks').enabled) req.user = { id: s.user.id, username: s.user.username, role: s.user.role === 'admin' ? 'admin' : 'user' };
  else req.noAccess = true;
}

async function requireAuth(req, reply) {
  if (req.noAccess) return reply.code(403).send({ error: 'Your account doesn’t have Tasks turned on. Ask the admin of this server.' });
  if (!req.user) return reply.code(401).send({ error: 'Not signed in' });
}

module.exports = { loadUser, requireAuth };
