'use strict';
// Accounts come from AkulavBox: one sign-in for every app on the server (src/core/session.js).
// Each AkulavBox account gets a row here the first time it opens Koma Shelf (users.box_id), so
// works, likes and API tokens keep their integer user ids. The role always comes from AkulavBox.
// Forms carry a CSRF token derived from the account (session.csrfOf); API tokens for Koma ("ks_…")
// are still issued here, and only their hash is stored.
const crypto = require('node:crypto');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createAuth(db, { session, apps }) {
  /** The local row of an AkulavBox account, created (or renamed) as needed */
  function localUser(box) {
    let row = db.get('SELECT id, username, bio, created FROM users WHERE box_id = ?', box.id);
    if (row && row.username !== box.username) {
      // renamed in AkulavBox: follow, unless another row holds that name
      if (!db.get('SELECT 1 FROM users WHERE username = ? AND id <> ?', box.username, row.id)) {
        db.run('UPDATE users SET username = ? WHERE id = ?', box.username, row.id);
        row.username = box.username;
      }
    }
    if (!row) {
      // a free name: the AkulavBox name, or the name with a number after it
      let name = box.username;
      for (let i = 2; db.get('SELECT 1 FROM users WHERE username = ?', name); i++) name = `${box.username}-${i}`;
      const id = db.run("INSERT INTO users (username, pass, role, created, box_id) VALUES (?, '!', 'user', ?, ?)", name, Date.now(), box.id).lastInsertRowid;
      row = { id: Number(id), username: name, bio: '', created: Date.now() };
    }
    return { id: row.id, username: row.username, bio: row.bio, created: row.created, role: box.role === 'admin' ? 'admin' : 'user', boxId: box.id };
  }

  /** API token for Koma / scripts: "ks_" + 32 random bytes. Only its hash is stored. */
  function createToken(userId, name) {
    const raw = `ks_${crypto.randomBytes(32).toString('base64url')}`;
    db.run('INSERT INTO api_tokens (user_id, name, token, prefix, created) VALUES (?, ?, ?, ?, ?)', userId, name, sha256(raw), raw.slice(0, 10), Date.now());
    return raw;
  }

  // Role and access are checked in AkulavBox's database on every use, like a sign-in
  const boxUser = (boxId) => apps.boxUser(boxId);

  function bearerUser(req) {
    const m = /^Bearer\s+(ks_[A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization || '');
    if (!m) return null;
    const row = db.get('SELECT t.id AS tid, t.last_used, u.box_id FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ?', sha256(m[1]));
    if (!row || !row.box_id) return null;
    const box = boxUser(row.box_id);
    if (!box || !apps.access(box.id, 'manga').enabled) return null;
    if (!row.last_used || Date.now() - row.last_used > 60_000) db.run('UPDATE api_tokens SET last_used = ? WHERE id = ?', Date.now(), row.tid);
    return localUser(box);
  }

  /** Loads req.user (or null) and req.csrf from the shared sign-in cookie, or from an API token. */
  function middleware(req, res, next) {
    req.cookies = session.parseCookies(req.headers.cookie);
    req.user = null;
    req.csrf = null;
    req.viaToken = false;
    req.noAccess = false;
    if (req.headers.authorization) {
      req.user = bearerUser(req);
      req.viaToken = Boolean(req.user);
      return next();
    }
    const s = session.userOf(req, res);
    if (s) {
      if (!apps.access(s.user.id, 'manga').enabled) req.noAccess = true;
      else {
        req.user = localUser(s.user);
        req.csrf = session.csrfOf(s.user);
      }
    }
    next();
  }

  /** Same-origin check for state-changing requests (browsers always send Origin on form posts). */
  const originOk = (req) => session.sameOrigin(req);

  /** Signed-in users must send their CSRF token (form field _csrf or X-CSRF-Token). */
  function tokenOk(req) {
    // API tokens travel in a header a cross-site page can't set, so they need no CSRF token
    if (!req.user || req.viaToken) return true;
    const sent = req.body?._csrf || req.headers['x-csrf-token'];
    return typeof sent === 'string' && sent.length === req.csrf.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.csrf));
  }

  return { middleware, originOk, tokenOk, createToken, localUser };
}

/** Fixed-window rate limiter kept in memory (per process). */
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return {
    /** true if allowed */
    hit(key) {
      const now = Date.now();
      let v = hits.get(key);
      if (!v || v.reset < now) {
        v = { n: 0, reset: now + windowMs };
        hits.set(key, v);
      }
      v.n++;
      return v.n <= max;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

module.exports = { createAuth, rateLimiter };
