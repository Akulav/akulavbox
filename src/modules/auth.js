const db = require('../core/db');
const bcrypt = require('../core/hash');
const config = require('../core/config');
const { signToken, PASSWORD_MIN } = require('../core/auth');

// A real hash to compare against when the username doesn't exist, so a wrong
// username takes as long as a wrong password (no account discovery by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

// Brute-force protection: per IP and per username, 10 failures in 15 minutes
// lock that key for the rest of the window.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const failures = new Map(); // key -> { count, first }
function blocked(key) {
  const f = failures.get(key);
  if (!f) return 0;
  if (Date.now() - f.first > WINDOW_MS) { failures.delete(key); return 0; }
  return f.count >= MAX_FAILS ? Math.ceil((f.first + WINDOW_MS - Date.now()) / 60000) : 0;
}
function fail(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else f.count++;
}
setInterval(() => { for (const [k, f] of failures) if (Date.now() - f.first > WINDOW_MS) failures.delete(k); }, WINDOW_MS).unref();

const WEAK = new Set(['admin', 'password', '1234', '12345', '123456', 'qwerty', 'letmein']);

function findUser(username) {
  // exact match first; otherwise a case-insensitive match if it is unambiguous
  const exact = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (exact) return exact;
  const loose = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').all(username);
  return loose.length === 1 ? loose[0] : null;
}

module.exports = async function (fastify) {
  // Public: lets the sign-in page show the version and check the server is up
  fastify.get('/api/health', async () => ({ ok: true, name: config.name, version: config.version, author: config.author }));

  fastify.post('/api/login', async (request, reply) => {
    const username = String(request.body?.username || '').trim();
    const password = String(request.body?.password || '');
    if (!username || !password) return reply.code(400).send({ error: 'Username and password are required' });

    const ipKey = `ip:${request.ip}`, userKey = `user:${username.toLowerCase()}`;
    const wait = Math.max(blocked(ipKey), blocked(userKey));
    if (wait) return reply.code(429).send({ error: `Too many failed sign-ins. Try again in ${wait} minute${wait === 1 ? '' : 's'}.` });

    const user = findUser(username);
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) {
      fail(ipKey); fail(userKey);
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    failures.delete(userKey);
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);

    // older accounts may still have a password shorter than today's minimum: nudge them to change it
    const weak = WEAK.has(password.toLowerCase()) || password.toLowerCase() === user.username.toLowerCase() || password.length < PASSWORD_MIN;
    return { token: signToken(user), role: user.role, id: user.id, username: user.username, weak_password: weak };
  });
};
