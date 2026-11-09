const jwt = require('jsonwebtoken');
const db = require('./db');
const config = require('./config');

const userById = db.prepare('SELECT id, username, role, token_version FROM users WHERE id = ?');

/** Sign a login token. `tv` ties it to the user's token_version so it can be revoked. */
function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, tv: user.token_version || 0 },
    process.env.JWT_SECRET,
    { expiresIn: config.tokenTtl, algorithm: 'HS256' },
  );
}

/** Shortest password accepted when one is set or changed (existing ones keep working) */
const PASSWORD_MIN = 8;

/**
 * Verify a token AND that it still belongs to a live account. Tokens of deleted
 * users, or issued before a password change, are rejected. Role comes from the
 * database, so promoting or demoting someone takes effect immediately.
 */
function authenticate(token) {
  if (typeof token !== 'string') throw new Error('No token');
  // only the algorithm we sign with: no "none", no switching to another family
  const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  const user = userById.get(decoded.id);
  if (!user) throw new Error('Account no longer exists');
  if ((decoded.tv || 0) !== (user.token_version || 0)) throw new Error('Session was revoked');
  return { decoded, user };
}

// Accepts "Authorization: Bearer <token>" or ?token=<token>
// (the query form is needed for <img>/<video>/<a download> URLs).
function readToken(request) {
  const header = request.headers.authorization || '';
  const fromHeader = header.startsWith('Bearer ') ? header.slice(7) : null;
  const fromQuery = request.query && typeof request.query.token === 'string' ? request.query.token : null;
  return fromHeader || fromQuery || null;
}

const REFRESH_AFTER = 24 * 3600; // seconds

function check(request, reply, needAdmin) {
  const token = readToken(request);
  if (!token) return 'No token';
  let res;
  try { res = authenticate(token); } catch (e) { return e.message; }
  if (needAdmin && res.user.role !== 'admin') return 'Insufficient permissions';
  request.user = { id: res.user.id, username: res.user.username, role: res.user.role };
  // Sliding sessions: API calls (not media URLs) get a fresh token once a day
  const age = Date.now() / 1000 - (res.decoded.iat || 0);
  if (age > REFRESH_AFTER && request.headers.authorization) reply.header('X-Refresh-Token', signToken(res.user));
  return null;
}

async function verifyUser(request, reply) {
  if (check(request, reply, false)) return reply.code(401).send({ error: 'Unauthorized' });
}

async function verifyAdmin(request, reply) {
  const problem = check(request, reply, true);
  if (problem === 'Insufficient permissions') return reply.code(403).send({ error: 'Admins only' });
  if (problem) return reply.code(401).send({ error: 'Unauthorized access' });
}

/**
 * For real form posts (zip and backup downloads must be navigations, so they can't
 * set headers): the token comes in the `token` field instead.
 */
const fromForm = (verify) => async (request, reply) => {
  if (!request.headers.authorization && typeof request.body?.token === 'string') request.headers.authorization = `Bearer ${request.body.token}`;
  return verify(request, reply);
};

const bumpVersion = db.prepare('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?');
const setHash = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');

/** Sign a user out on every device. Returns false when there's no such user. */
const revokeSessions = (userId) => bumpVersion.run(userId).changes > 0;

/** Store a new password hash; every existing session of that user stops working */
const setPassword = (userId, hash) => db.tx(() => setHash.run(hash, userId).changes > 0 && revokeSessions(userId));

module.exports = { verifyUser, verifyAdmin, readToken, signToken, authenticate, fromForm, revokeSessions, setPassword, PASSWORD_MIN };
