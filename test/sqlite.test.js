// The schema runner every database uses (src/core/sqlite.js)
const test = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { runSteps, addColumn, columnsOf, tx } = require('../src/core/sqlite');

const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('runSteps runs SQL, functions and { name, up } steps in order, once', () => {
  const db = new DatabaseSync(':memory:');
  const steps = [
    'CREATE TABLE t (id INTEGER PRIMARY KEY)',
    (d) => addColumn(d, 't', 'name', 'TEXT'),
    { name: 'a third', up: (d) => d.exec("INSERT INTO t (name) VALUES ('x')") },
  ];
  const named = [];
  const r = runSteps(db, steps, { onStep: (n) => named.push(n) });
  assert.deepStrictEqual([r.from, r.to, r.ran], [0, 3, 3]);
  assert.deepStrictEqual(named, [1, 2, 3]);
  assert.strictEqual(version(db), 3);
  assert.deepStrictEqual(columnsOf(db, 't'), ['id', 'name']);
  // nothing left to do: nothing runs again, before() isn't called
  let before = 0;
  assert.strictEqual(runSteps(db, steps, { before: () => before++ }).ran, 0);
  assert.strictEqual(before, 0);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM t').get().n, 1);
});

test('a failing step rolls back and stops, keeping the steps before it', () => {
  const db = new DatabaseSync(':memory:');
  const steps = ['CREATE TABLE a (x)', 'CREATE TABLE b (x); INSERT INTO nope VALUES (1)', 'CREATE TABLE c (x)'];
  assert.throws(() => runSteps(db, steps, { before: () => 'snapshot.db', describe: (n) => `Step ${n}` }), (e) => /^Step 2 failed/.test(e.message) && e.extra === 'snapshot.db');
  assert.strictEqual(version(db), 1);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((t) => t.name);
  assert.deepStrictEqual(tables, ['a']);
});

test('before() runs once, with the version the database was at', () => {
  const db = new DatabaseSync(':memory:');
  runSteps(db, ['CREATE TABLE a (x)']);
  const seen = [];
  runSteps(db, ['CREATE TABLE a (x)', 'CREATE TABLE b (x)', 'CREATE TABLE c (x)'], { before: (from) => seen.push(from) });
  assert.deepStrictEqual(seen, [1]);
  assert.strictEqual(version(db), 3);
});

test('addColumn can run again on a table that has the column', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (id INTEGER)');
  addColumn(db, 't', 'n', 'INTEGER DEFAULT 0');
  addColumn(db, 't', 'n', 'INTEGER DEFAULT 0');
  assert.deepStrictEqual(columnsOf(db, 't'), ['id', 'n']);
});

test('tx commits, and rolls back when the function throws', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (x)');
  assert.strictEqual(tx(db, () => { db.exec('INSERT INTO t VALUES (1)'); return 'ok'; }), 'ok');
  assert.throws(() => tx(db, () => { db.exec('INSERT INTO t VALUES (2)'); throw new Error('no'); }), /no/);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM t').get().n, 1);
});
