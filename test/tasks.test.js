// Tasks: repeat rules (apps/tasks/server/repeat.js) and quick add (apps/tasks/public/js/quick.js)
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const repeat = require('../apps/tasks/server/repeat');

const quick = () => import(pathToFileURL(path.join(__dirname, '../apps/tasks/public/js/quick.js')).href);

test('repeat: days, weeks, months and years', () => {
  assert.strictEqual(repeat.next('2026-11-20', { every: 3, unit: 'day' }), '2026-11-23');
  assert.strictEqual(repeat.next('2026-11-20', { every: 2, unit: 'week' }), '2026-12-04');
  assert.strictEqual(repeat.next('2026-12-15', { every: 1, unit: 'month' }), '2027-01-15');
  assert.strictEqual(repeat.next('2028-02-29', { every: 1, unit: 'year' }), '2029-02-28');
});

test('repeat: a monthly day that a month doesn’t have falls on its last day, then comes back', () => {
  const rule = { every: 1, unit: 'month', day: 31 };
  assert.strictEqual(repeat.next('2026-01-31', rule), '2026-02-28');
  assert.strictEqual(repeat.next('2026-02-28', rule), '2026-03-31');
});

test('repeat: on weekdays, and every other week on chosen days', () => {
  const weekdays = { every: 1, unit: 'week', weekdays: [1, 2, 3, 4, 5] };
  assert.strictEqual(repeat.next('2026-11-20', weekdays), '2026-11-23'); // Friday → Monday
  const monThu = { every: 2, unit: 'week', weekdays: [1, 4] };
  assert.strictEqual(repeat.next('2026-11-23', monThu), '2026-11-26'); // Mon → Thu, same week
  assert.strictEqual(repeat.next('2026-11-26', monThu), '2026-12-07'); // Thu → Mon two weeks on
});

test('repeat: a task done late comes back in the future, not overdue', () => {
  assert.strictEqual(repeat.nextDue('2026-11-01', { every: 1, unit: 'week' }, '2026-11-20'), '2026-11-22');
  assert.strictEqual(repeat.nextDue(null, { every: 1, unit: 'day' }, '2026-11-20'), '2026-11-21');
});

test('repeat: input is checked', () => {
  assert.strictEqual(repeat.clean(null), null);
  assert.deepStrictEqual(repeat.clean({ every: '2', unit: 'week', weekdays: [5, 1, 1, 9] }), { every: 2, unit: 'week', weekdays: [1, 5] });
  assert.deepStrictEqual(repeat.clean({ unit: 'month' }, '2026-03-07'), { every: 1, unit: 'month', day: 7 });
  assert.throws(() => repeat.clean({ every: 0, unit: 'day' }), /1 to 365/);
  assert.throws(() => repeat.clean({ every: 1, unit: 'hour' }), /day, week, month or year/);
});

test('quick add: dates, times, tags, priority, flag and list', async () => {
  const { parseQuick } = await quick();
  const ctx = { today: '2026-11-20', lists: [{ id: 1, name: 'Work stuff' }, { id: 2, name: 'Home' }] };
  const a = parseQuick('Email Ana tomorrow at 5pm #report !2 @work *', ctx);
  assert.deepStrictEqual(
    { title: a.title, dueDate: a.dueDate, dueTime: a.dueTime, tags: a.tags, priority: a.priority, listId: a.listId, flagged: a.flagged },
    { title: 'Email Ana', dueDate: '2026-11-21', dueTime: '17:00', tags: ['report'], priority: 2, listId: 1, flagged: true },
  );
  assert.strictEqual(parseQuick('Report dec 5', ctx).dueDate, '2026-12-05');
  assert.strictEqual(parseQuick('Party jan 3', ctx).dueDate, '2027-01-03'); // already passed this year
  assert.strictEqual(parseQuick('Trip in 2 weeks', ctx).dueDate, '2026-12-04');
  assert.strictEqual(parseQuick('Review on fri', ctx).dueDate, '2026-11-27'); // the next Friday, not today
  assert.strictEqual(parseQuick('Launch 2026-12-01 !high', ctx).priority, 3);
});

test('quick add: repeats, and the first date they fall on', async () => {
  const { parseQuick } = await quick();
  const ctx = { today: '2026-11-20' }; // a Friday
  assert.deepStrictEqual(parseQuick('Standup every weekday', ctx).repeat, { every: 1, unit: 'week', weekdays: [1, 2, 3, 4, 5] });
  const gym = parseQuick('Gym every monday and thursday 7am', ctx);
  assert.deepStrictEqual([gym.title, gym.dueDate, gym.dueTime, gym.repeat.weekdays], ['Gym', '2026-11-23', '07:00', [1, 4]]);
  const rent = parseQuick('Pay rent monthly', ctx);
  assert.deepStrictEqual([rent.dueDate, rent.repeat], ['2026-11-20', { every: 1, unit: 'month', day: 20 }]);
  assert.deepStrictEqual(parseQuick('Water plants every 3 days', ctx).repeat, { every: 3, unit: 'day' });
});

test('quick add: ordinary words stay in the title', async () => {
  const { parseQuick } = await quick();
  const ctx = { today: '2026-11-20', lists: [] };
  for (const s of ['Buy sun cream sat', 'Fix the may release', 'Book #1 in series', 'Email boss@example.com']) {
    const r = parseQuick(s, ctx);
    assert.strictEqual(r.dueDate, null, s);
  }
  assert.strictEqual(parseQuick('Buy sun cream sat', ctx).title, 'Buy sun cream sat');
  assert.deepStrictEqual(parseQuick('Book #1 in series', ctx).tags, []);
  assert.strictEqual(parseQuick('@nolist here', ctx).title, '@nolist here'); // no such list: kept
  assert.strictEqual(parseQuick('Plain', { ...ctx }).title, 'Plain');
});
