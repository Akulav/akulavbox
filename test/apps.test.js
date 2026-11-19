require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/core/db');
const apps = require('../src/core/apps');

const user = (id) => db.prepare("INSERT INTO users (id, username, password_hash, role, quota_bytes, created_at) VALUES (?, ?, 'x', 'user', 1000, datetime('now'))").run(id, id);

test('every account has AkulavBox, with the quota from users.quota_bytes', () => {
  user('a1');
  assert.deepEqual(apps.access('a1', 'box'), { enabled: true, quota_bytes: 1000, custom_quota: true });
  assert.equal(apps.access('nobody', 'box').enabled, false);
  assert.throws(() => apps.setAccess('a1', 'box', { enabled: false }), /Unknown app/);
});

test('without a row an account gets the defaults; a row overrides them', () => {
  user('a2');
  const d = apps.defaults();
  assert.deepEqual(apps.access('a2', 'documents'), { enabled: true, quota_bytes: d.documents.quota_bytes, custom_quota: false });
  apps.setAccess('a2', 'documents', { enabled: false, quota_bytes: 500 });
  assert.deepEqual(apps.access('a2', 'documents'), { enabled: false, quota_bytes: 500, custom_quota: true });
  // only what is given changes
  apps.setAccess('a2', 'documents', { enabled: true });
  assert.equal(apps.access('a2', 'documents').quota_bytes, 500);
  apps.setAccess('a2', 'documents', { quota_bytes: null });
  assert.equal(apps.access('a2', 'documents').custom_quota, false);
});

test('quotas must be positive, and apps without files have none', () => {
  user('a3');
  for (const bad of [0, -5, 'lots', NaN]) assert.throws(() => apps.setAccess('a3', 'manga', { quota_bytes: bad }), /larger than 0/);
  apps.setAccess('a3', 'budget', { quota_bytes: 123 });
  assert.equal(apps.access('a3', 'budget').quota_bytes, null);
});

test('defaults can change, per app', () => {
  user('a4');
  apps.setDefaults({ budget: { enabled: false }, manga: { quota_bytes: 2048 } });
  assert.equal(apps.access('a4', 'budget').enabled, false);
  assert.equal(apps.access('a4', 'manga').quota_bytes, 2048);
  assert.throws(() => apps.setDefaults({ manga: { quota_bytes: 0 } }));
  apps.setDefaults({ budget: { enabled: true } });
});

test('hooks: usage, room left, the launcher list, delete-user', () => {
  user('a5');
  const deleted = [];
  apps.register('documents', { usage: () => 400, summary: () => '3 documente', deleteUser: (id) => deleted.push(id) });
  apps.setAccess('a5', 'documents', { quota_bytes: 500 });
  assert.equal(apps.usage('a5', 'documents'), 400);
  assert.equal(apps.hasRoom('a5', 'documents', 100), true);
  assert.equal(apps.hasRoom('a5', 'documents', 101), false);
  const list = apps.forUser({ id: 'a5' });
  const docs = list.find((a) => a.id === 'documents');
  assert.ok(docs.available && docs.used_bytes === 400 && docs.summary === '3 documente');
  apps.deleteUser('a5');
  assert.deepEqual(deleted, ['a5']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_apps WHERE user_id = ?').get('a5').n, 0);
});

test('an app that failed keeps its data hooks but is not offered', () => {
  user('a6');
  apps.failed('manga', 'no sharp', { usage: () => 7, deleteUser: () => {} });
  assert.equal(apps.status('manga'), 'failed');
  assert.equal(apps.usage('a6', 'manga'), 7);
  const manga = apps.forUser({ id: 'a6' }).find((a) => a.id === 'manga');
  assert.equal(manga.available, false);
  assert.equal(manga.problem, 'no sharp');
});
