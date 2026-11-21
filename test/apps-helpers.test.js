require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../apps/documents/src/validate');
const util = require('../apps/budget/server/util');
const fmt = require('../src/core/backup-format');

test('e-Management: dates, ids, names', () => {
  assert.equal(v.validDate('2024-02-29'), true);
  for (const bad of ['2023-02-29', '2024-13-01', '24-01-01', '1800-01-01', '2024-01-01T00:00']) assert.equal(v.validDate(bad), false, bad);
  assert.deepEqual(v.idList([3, '3', 4, -1, 'x', 1.5, 0]), [3, 4]);
  assert.equal(v.idOrNull(''), null);
  assert.equal(v.str('  a\u0000b\u0007  ', 10), 'ab');
  assert.equal(v.readCategory({ name: ' Acte ', color: 'red' }).color, '#1d4e89');
  assert.throws(() => v.readCategory({ name: '  ' }), /denumirea/);
  assert.throws(() => v.paramId({ params: { id: '../1' } }), (e) => e.statusCode === 404);
});

test('Florin: input checks', () => {
  assert.equal(util.num('12.5', { field: 'Amount', min: 0.01 }), 12.5);
  assert.throws(() => util.num('x', { field: 'Amount' }), /must be a number/);
  assert.throws(() => util.num(0, { field: 'Amount', min: 0.01 }), /out of range/);
  assert.equal(util.date('2026-01-15'), '2026-01-15');
  assert.throws(() => util.date('15.01.2026'), /YYYY-MM-DD/);
  assert.equal(util.oneOf(undefined, ['a'], { field: 'K', optional: true }), undefined);
  assert.throws(() => util.oneOf('b', ['a'], { field: 'K' }), /one of/);
  assert.equal(util.round2(1.234), 1.23);
  assert.equal(util.round2(19.999), 20);
});

test('backups: app entries stay inside their folder', () => {
  const ok = (n) => { const m = fmt.APP_ENTRY.exec(n); return !!m && !m[2].split('/').some((s) => s === '.' || s === '..'); };
  assert.equal(ok('apps/documents/u1/personal/ansc.db'), true);
  for (const bad of ['apps/documents/../akulavbox.db', 'apps/documents/./x', 'apps/other/x', 'apps/documents/', 'apps/documents/a\\b', 'users/x/y.enc']) assert.equal(ok(bad), false, bad);
  assert.equal(ok('apps/ironveil/u1/run.json'), true);
  assert.deepEqual(fmt.APP_IDS, ['documents', 'budget', 'tasks', 'ironveil']);
});

test('backups: a removed app (Koma Shelf) is read past, never restored', () => {
  assert.equal(fmt.APP_ENTRY.test('apps/manga/works/abc/cover.webp'), false);
  assert.equal(fmt.RETIRED_ENTRY.test('apps/manga/works/abc/cover.webp'), true);
  assert.equal(fmt.RETIRED_ENTRY.test('apps/documents/u1/a.db'), false);
});
