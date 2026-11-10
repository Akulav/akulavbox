const db = require('../core/db');
const bcrypt = require('../core/hash');
const config = require('../core/config');
const { signToken, PASSWORD_MIN } = require('../core/auth');
const activity = require('../core/activity');

// A real hash to compare against when the username doesn't exist, so a wrong
// username takes as long as a wrong password (no account discovery by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

// Brute-force protection: per IP and per username, 10 failures in 15 minutes
// lock that key for the rest of the window.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const failures = new Map(); // key -> { count, first }
// a flood of made-up usernames must not grow the map without bound
const MAX_KEYS = 20000;
function blocked(key) {
  const f = failures.get(key);
  if (!f) return 0;
  if (Date.now() - f.first > WINDOW_MS) { failures.delete(key); return 0; }
  return f.count >= MAX_FAILS ? Math.ceil((f.first + WINDOW_MS - Date.now()) / 60000) : 0;
}
function fail(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) {
    if (failures.size >= MAX_KEYS) failures.delete(failures.keys().next().value); // oldest first (Map keeps insertion order)
    failures.set(key, { count: 1, first: Date.now() });
  } else f.count++;
}
setInterval(() => { for (const [k, f] of failures) if (Date.now() - f.first > WINDOW_MS) failures.delete(k); }, WINDOW_MS).unref();

const WEAK = new Set(['admin', 'password', '1234', '12345', '123456', 'qwerty', 'letmein']);

const exactUser = db.prepare('SELECT * FROM users WHERE username = ?');
const looseUser = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE LIMIT 2');
function findUser(username) {
  // exact match first; otherwise a case-insensitive match if it is unambiguous
  const exact = exactUser.get(username);
  if (exact) return exact;
  const loose = looseUser.all(username);
  return loose.length === 1 ? loose[0] : null;
}
// usernames are at most 32 characters; bcrypt only reads the first 72 bytes of a password
const USERNAME_MAX = 64, PASSWORD_MAX = 1024;

module.exports = async function (fastify) {
  // Public: lets the sign-in page show the version and check the server is up
  fastify.get('/api/health', async () => ({ ok: true, name: config.name, version: config.version, author: config.author }));

  fastify.post('/api/login', async (request, reply) => {
    const username = String(request.body?.username || '').trim();
    const password = String(request.body?.password || '');
    if (!username || !password) return reply.code(400).send({ error: 'Username and password are required' });
    if (username.length > USERNAME_MAX || password.length > PASSWORD_MAX) return reply.code(401).send({ error: 'Invalid credentials' });

    const ipKey = `ip:${request.ip}`, userKey = `user:${username.toLowerCase()}`;
    const wait = Math.max(blocked(ipKey), blocked(userKey));
    if (wait) return reply.code(429).send({ error: `Too many failed sign-ins. Try again in ${wait} minute${wait === 1 ? '' : 's'}.` });

    const user = findUser(username);
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) {
      fail(ipKey); fail(userKey);
      // the name as typed, so guesses at accounts that don't exist show up too
      activity.log(request, 'auth.login_failed', { user: { id: user?.id, username: user ? user.username : username }, detail: user ? 'Wrong password' : 'No such account' });
      if (blocked(ipKey) || blocked(userKey)) activity.log(request, 'auth.locked', { user: { id: user?.id, username: user ? user.username : username }, detail: '10 failed sign-ins: blocked for 15 minutes' });
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    failures.delete(userKey);
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
    activity.log(request, 'auth.login', { user, detail: String(request.headers['user-agent'] || '').slice(0, 200) || null });

    // older accounts may still have a password shorter than today's minimum: nudge them to change it
    const weak = WEAK.has(password.toLowerCase()) || password.toLowerCase() === user.username.toLowerCase() || password.length < PASSWORD_MIN;
    return { token: signToken(user), role: user.role, id: user.id, username: user.username, weak_password: weak };
  });
};
