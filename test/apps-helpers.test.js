require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { html, raw, withBase, timeAgo, compact } = require('../apps/manga/src/html');
const v = require('../apps/documents/src/validate');
const util = require('../apps/budget/server/util');
const fmt = require('../src/core/backup-format');

test('Koma Shelf: html`` escapes values unless they are html`` or raw()', () => {
  assert.equal(String(html`<p>${'<b>"x"</b>'}</p>`), '<p>&lt;b&gt;&quot;x&quot;&lt;/b&gt;</p>');
  assert.equal(String(html`<p>${raw('<b>')}${html`<i>${'&'}</i>`}</p>`), '<p><b><i>&amp;</i></p>');
  assert.equal(String(html`${[1, null, false, 'a']}`), '1a');
});

test('Koma Shelf: root paths get the prefix, other sites and escaped text don’t', () => {
  const page = '<a href="/w/1">x</a><img src="/media/a/cover.webp" srcset="/media/a/s.webp 300w, /media/a/l.webp 600w">'
    + '<form action="/logout"></form><a href="//cdn.example/x"></a><a href="https://x.example/">y</a>'
    + '<div style="background-image:url(\'/media/a/c.webp\')"></div><a href="~/box/#/profile">p</a><p>href=&quot;/w/2&quot;</p>';
  const out = withBase('/manga', page);
  assert.match(out, /href="\/manga\/w\/1"/);
  assert.match(out, /src="\/manga\/media\/a\/cover\.webp"/);
  assert.match(out, /srcset="\/manga\/media\/a\/s\.webp 300w, \/manga\/media\/a\/l\.webp 600w"/);
  assert.match(out, /action="\/manga\/logout"/);
  assert.match(out, /href="\/\/cdn\.example\/x"/);
  assert.match(out, /url\('\/manga\/media\/a\/c\.webp'\)/);
  assert.match(out, /href="\/box\/#\/profile"/);
  assert.match(out, /href=&quot;\/w\/2&quot;/);
});

test('Koma Shelf: small formatters', () => {
  assert.equal(compact(999), '999');
  assert.equal(compact(1500), '1.5k');
  assert.equal(timeAgo(Date.now() - 3 * 3600 * 1000), '3 hours ago');
});

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
  assert.equal(ok('apps/manga/works/abc/cover.webp'), true);
  assert.equal(ok('apps/documents/u1/personal/ansc.db'), true);
  for (const bad of ['apps/manga/../akulavbox.db', 'apps/manga/./x', 'apps/other/x', 'apps/manga/', 'apps/manga/a\\b', 'users/x/y.enc']) assert.equal(ok(bad), false, bad);
  assert.equal(ok('apps/ironveil/u1/run.json'), true);
  assert.deepEqual(fmt.APP_IDS, ['documents', 'manga', 'budget', 'tasks', 'ironveil']);
});
