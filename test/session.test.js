require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const session = require('../src/core/session');
const auth = require('../src/core/auth');

const req = (headers = {}, encrypted = false) => ({ headers, socket: { encrypted } });

test('parseCookies reads every cookie and skips malformed ones', () => {
  assert.deepEqual(session.parseCookies('a=1; b=two%20words; bad=%E0%A4%A; c'), { a: '1', b: 'two words' });
  assert.deepEqual(session.parseCookies(''), {});
  // the first one wins, like browsers send the most specific path first
  assert.equal(session.parseCookies('akb_session=x; akb_session=y').akb_session, 'x');
});

test('safeNext only keeps paths on this server', () => {
  assert.equal(session.safeNext('/tasks/today'), '/tasks/today');
  assert.equal(session.safeNext('/box/#/files'), '/box/#/files');
  for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/a b', '', null, 42]) assert.equal(session.safeNext(bad), '/', String(bad));
});

test('loginUrl carries the way back', () => {
  assert.equal(session.loginUrl('/docs/'), '/login?next=%2Fdocs%2F');
  assert.equal(session.loginUrl('/'), '/login');
  assert.equal(session.loginUrl('//evil.example'), '/login');
});

test('the cookie lives as long as its token, is HttpOnly and SameSite=Lax, Secure on https', () => {
  const token = auth.signToken({ id: 'u1', username: 'u', role: 'user', token_version: 0 });
  const c = session.cookieFor(req(), token);
  assert.match(c, /^akb_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
  const age = Number(/Max-Age=(\d+)/.exec(c)[1]);
  assert.ok(age > 6 * 86400 && age <= 7 * 86400, `Max-Age ${age}`);
  assert.match(session.cookieFor(req({}, true), token), /; Secure$/);
  assert.match(session.clearCookie(req()), /Max-Age=0/);
});

test('CSRF tokens are per account and change when sessions are revoked', () => {
  const a = session.csrfOf({ id: 'u1', token_version: 0 });
  assert.equal(a, session.csrfOf({ id: 'u1', token_version: 0 }));
  assert.notEqual(a, session.csrfOf({ id: 'u2', token_version: 0 }));
  assert.notEqual(a, session.csrfOf({ id: 'u1', token_version: 1 }));
  assert.equal(a.length, 32);
});

test('sameOrigin compares Origin (or Referer) with Host', () => {
  assert.equal(session.sameOrigin(req({ host: 'box.example', origin: 'https://box.example' })), true);
  assert.equal(session.sameOrigin(req({ host: 'box.example', referer: 'https://box.example/budget/'})), true);
  assert.equal(session.sameOrigin(req({ host: 'box.example', origin: 'https://evil.example' })), false);
  assert.equal(session.sameOrigin(req({ host: 'box.example', origin: 'null' })), false);
  assert.equal(session.sameOrigin(req({ host: 'box.example' })), true, 'no Origin: not a browser form from another site');
});

test('addCookie keeps earlier Set-Cookie headers', () => {
  const headers = {};
  const res = { getHeader: (k) => headers[k], setHeader: (k, v) => { headers[k] = v; } };
  session.addCookie(res, 'a=1');
  session.addCookie(res, 'b=2');
  assert.deepEqual(headers['set-cookie'], ['a=1', 'b=2']);
});
