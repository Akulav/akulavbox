// Moving a data folder from before 4.0 into box/ (src/core/layout.js)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepare } = require('../src/core/layout');

function folder(withOld) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akulavbox-layout-'));
  if (withOld) for (const name of ['users', 'thumbs', 'private']) {
    fs.mkdirSync(path.join(dir, name, 'u1'), { recursive: true });
    fs.writeFileSync(path.join(dir, name, 'u1', 'f'), name);
  }
  return dir;
}
const rm = (dir) => fs.rmSync(dir, { recursive: true, force: true });

test('an old layout moves into box/, with a note per folder', () => {
  const dir = folder(true);
  try {
    const l = prepare(dir);
    assert.strictEqual(l.usersDir, path.join(dir, 'box', 'users'));
    assert.strictEqual(fs.readFileSync(path.join(l.thumbsDir, 'u1', 'f'), 'utf8'), 'thumbs');
    assert.ok(!fs.existsSync(path.join(dir, 'users')));
    assert.strictEqual(l.notes.length, 3);
    assert.ok(l.notes.every((n) => !n.warn && n.text.startsWith('Moved ')));
    // a second start has nothing to do
    assert.deepStrictEqual(prepare(dir).notes, []);
  } finally { rm(dir); }
});

test('a new install uses box/ and moves nothing', () => {
  const dir = folder(false);
  try {
    const l = prepare(dir);
    assert.strictEqual(l.privateDir, path.join(dir, 'box', 'private'));
    assert.deepStrictEqual(l.notes, []);
  } finally { rm(dir); }
});

test('with move: false (a tool next to a live server) the old folders are used where they are', () => {
  const dir = folder(true);
  try {
    const l = prepare(dir, { move: false });
    assert.strictEqual(l.usersDir, path.join(dir, 'users'));
    assert.ok(fs.existsSync(path.join(dir, 'users', 'u1', 'f')));
    assert.ok(!fs.existsSync(path.join(dir, 'box')));
    assert.deepStrictEqual(l.notes, []);
  } finally { rm(dir); }
});

test('another server on the same folder: nothing moves, and a warning says why', () => {
  const dir = folder(true);
  try {
    // this test's parent process stands in for the other server
    fs.writeFileSync(path.join(dir, 'akulavbox.pid'), JSON.stringify({ pid: process.ppid }));
    const l = prepare(dir);
    assert.strictEqual(l.usersDir, path.join(dir, 'users'));
    assert.ok(l.notes.length === 3 && l.notes.every((n) => n.warn && /another server/.test(n.text)));
  } finally { rm(dir); }
});
