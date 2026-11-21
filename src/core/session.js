const crypto = require('crypto');
const config = require('./config');
const auth = require('./auth');

// ---------------------------------------------------------------------------
// One sign-in for every app. AkulavBox's own API keeps using the JWT in the
// Authorization header (stored by the page). The other apps (documents, budget,
// tasks, ironveil) are plain page navigations and forms, so the same JWT also travels in
// an HttpOnly cookie. It is checked exactly like the header (signature, account
// still exists, token_version), so "sign out everywhere", a password change or
// deleting the account ends it in every app at once.
//
// The AkulavBox API never reads this cookie: a cookie is sent by the browser on
// its own, and the API has no CSRF tokens. The apps that do read it have their
// own CSRF defences (same-origin checks, per-user tokens, custom headers), and
// SameSite=Lax keeps it off cross-site POSTs.
// ---------------------------------------------------------------------------

const COOKIE = 'akb_session';
const REFRESH_AFTER = 24 * 3600; // seconds, like the header tokens

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { /* malformed: skip */ }
  }
  return out;
}

/** The raw Node request of a Fastify request (or a raw request itself) */
const rawOf = (req) => req.raw || req;

function isHttps(req) {
  const r = rawOf(req);
  if (r.socket && r.socket.encrypted) return true;
  return config.trustProxy && String(r.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

const read = (req) => parseCookies(rawOf(req).headers.cookie)[COOKIE] || null;

/** Set-Cookie value for a token; it lives exactly as long as the token */
function cookieFor(req, token) {
  let maxAge = 7 * 86400;
  try { const exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp; if (exp) maxAge = Math.max(0, exp - Math.floor(Date.now() / 1000)); } catch (e) { /* keep the default */ }
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}
const clearCookie = (req) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;

/** Add a Set-Cookie header on a Node response (or a Fastify reply) without dropping others */
function addCookie(res, value) {
  const raw = res.raw || res;
  if (res.raw && typeof res.header === 'function') {
    const prev = res.getHeader('set-cookie');
    res.header('set-cookie', prev ? [].concat(prev, value) : value);
    return;
  }
  const prev = raw.getHeader('set-cookie');
  raw.setHeader('set-cookie', prev ? [].concat(prev, value) : value);
}

/**
 * The signed-in account of a request, from the cookie: { user, token } or null.
 * user = { id, username, role, token_version }. Tokens older than a day are
 * swapped for a fresh one on `res` (sliding sessions, like the API).
 */
function userOf(req, res) {
  const token = read(req);
  if (!token) return null;
  let r;
  try { r = auth.authenticate(token); } catch (e) {
    if (res) addCookie(res, clearCookie(req));
    return null;
  }
  if (res && Date.now() / 1000 - (r.decoded.iat || 0) > REFRESH_AFTER) addCookie(res, cookieFor(req, auth.signToken(r.user)));
  return { user: r.user, token };
}

/**
 * A CSRF token for form posts, stable for an account until its sessions are
 * revoked (password change, sign out everywhere). Derived, so nothing is stored.
 */
const csrfOf = (user) => crypto.createHmac('sha256', String(process.env.JWT_SECRET)).update(`csrf:${user.id}:${user.token_version || 0}`).digest('base64url').slice(0, 32);

/** Same-origin check for state-changing requests: Origin (or Referer) must name this host */
function sameOrigin(req) {
  const h = rawOf(req).headers;
  const from = h.origin || h.referer;
  if (!from) return true; // not a browser, or a browser that sends neither: no cookie theft either way
  try { return new URL(from).host === h.host; } catch (e) { return false; }
}

/** A path on this server to go back to after signing in ("/docs/#/documents"), never another site */
const safeNext = (n) => (typeof n === 'string' && /^\/(?![/\\])[^\s]*$/.test(n) && n.length < 2000 ? n : '/');
function loginUrl(next) {
  const to = safeNext(next);
  return to === '/' ? '/login' : `/login?next=${encodeURIComponent(to)}`;
}

module.exports = { COOKIE, parseCookies, read, cookieFor, clearCookie, addCookie, userOf, csrfOf, sameOrigin, safeNext, loginUrl, isHttps };
