'use strict';
// Accounts come from AkulavBox: one sign-in for every app on the server (src/core/session.js).
// Each AkulavBox account gets a row here the first time it opens Florin (users.box_id), so categories
// and transactions keep their integer user ids. The role always comes from AkulavBox.
const session = require('../../../src/core/session');
const apps = require('../../../src/core/apps');
const { db, getSetting, createDefaultCategories, tx } = require('./db.js');

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    role: u.role,
    baseCurrency: u.base_currency,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

const byBox = db.prepare('SELECT * FROM users WHERE box_id = ?');
const DAY = 86_400_000;

/** The local row of an AkulavBox account, created on first use */
function localUser(box) {
  let row = byBox.get(box.id);
  if (!row) {
    row = tx(() => {
      const { lastInsertRowid } = db
        .prepare("INSERT INTO users (email, name, password_hash, role, base_currency, box_id) VALUES (?, ?, '!', 'user', ?, ?)")
        .run(`box:${box.id}`, box.username, getSetting('default_currency') ?? 'EUR', box.id);
      createDefaultCategories(lastInsertRowid);
      return db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
    });
  }
  // once a day is enough for "last seen"
  if (!row.last_login_at || Date.now() - Date.parse(`${row.last_login_at.replace(' ', 'T')}Z`) > DAY) {
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(row.id);
  }
  return { ...row, username: box.username, role: box.role === 'admin' ? 'admin' : 'user', boxId: box.id };
}

/** onRequest: req.user when the shared sign-in cookie is valid and the account may use Florin */
async function loadUser(req, reply) {
  req.user = null;
  req.noAccess = false;
  const s = session.userOf(req, reply);
  if (!s) return;
  if (apps.access(s.user.id, 'budget').enabled) req.user = localUser(s.user);
  else req.noAccess = true;
}

async function requireAuth(req, reply) {
  if (req.noAccess) return reply.code(403).send({ error: 'Your account doesn’t have Florin turned on. Ask the admin of this server.' });
  if (!req.user) return reply.code(401).send({ error: 'Not signed in' });
}

async function requireAdmin(req, reply) {
  if (!req.user) return requireAuth(req, reply);
  if (req.user.role !== 'admin') return reply.code(403).send({ error: 'Admins only' });
}

/** For the rest of the server: the local row of an AkulavBox account, without creating one */
const rowOfBox = (boxId) => byBox.get(boxId);

module.exports = { publicUser, loadUser, requireAuth, requireAdmin, rowOfBox };
