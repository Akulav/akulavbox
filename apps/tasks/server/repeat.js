'use strict';
// Repeating tasks. A rule is { every, unit, weekdays?, day? }:
//   every     1–365
//   unit      'day' | 'week' | 'month' | 'year'
//   weekdays  for 'week': the days it falls on, 0 = Sunday … 6 = Saturday (empty: the due date's)
//   day       for 'month': the day of the month it keeps to (31 → the last day of short months)
// Dates are 'YYYY-MM-DD' strings, computed in UTC so no time zone can shift a day.

const UNITS = ['day', 'week', 'month', 'year'];

const parse = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // m is 0-based

/** A valid rule from user input, or null for "doesn't repeat"; throws on nonsense */
function clean(input, dueDate) {
  if (input === null || input === undefined || input === '' || input === false) return null;
  if (typeof input !== 'object') throw new Error('Repeat must be a rule like { every: 1, unit: "week" }.');
  const every = Math.floor(Number(input.every ?? 1));
  if (!(every >= 1 && every <= 365)) throw new Error('Repeat every 1 to 365 days, weeks, months or years.');
  if (!UNITS.includes(input.unit)) throw new Error('Repeat by day, week, month or year.');
  const rule = { every, unit: input.unit };
  if (input.unit === 'week' && Array.isArray(input.weekdays)) {
    const days = [...new Set(input.weekdays.map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort();
    if (days.length) rule.weekdays = days;
  }
  if (input.unit === 'month') {
    const day = Math.floor(Number(input.day ?? (dueDate ? dueDate.slice(8, 10) : 0)));
    if (day >= 1 && day <= 31) rule.day = day;
  }
  return rule;
}

/** The next date after `from` ('YYYY-MM-DD') that the rule falls on */
function next(from, rule) {
  const d = parse(from);
  const n = rule.every || 1;
  switch (rule.unit) {
    case 'day':
      return iso(addDays(d, n));
    case 'week': {
      if (!rule.weekdays?.length) return iso(addDays(d, 7 * n));
      // weeks start on Monday; only every n-th week counts, counted from the week of `from`
      const monday = (x) => addDays(x, -((x.getUTCDay() + 6) % 7));
      const start = monday(d).getTime();
      for (let i = 1; i <= 7 * n + 7; i++) {
        const c = addDays(d, i);
        const weeks = Math.round((monday(c).getTime() - start) / (7 * 86_400_000));
        if (weeks % n === 0 && rule.weekdays.includes(c.getUTCDay())) return iso(c);
      }
      return iso(addDays(d, 7 * n));
    }
    case 'month': {
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + n;
      const ty = y + Math.floor(m / 12);
      const tm = ((m % 12) + 12) % 12;
      const day = Math.min(rule.day || d.getUTCDate(), daysInMonth(ty, tm));
      return iso(new Date(Date.UTC(ty, tm, day)));
    }
    case 'year': {
      const ty = d.getUTCFullYear() + n;
      const tm = d.getUTCMonth();
      return iso(new Date(Date.UTC(ty, tm, Math.min(d.getUTCDate(), daysInMonth(ty, tm)))));
    }
    default:
      throw new Error(`Unknown repeat unit ${rule.unit}`);
  }
}

/**
 * The due date of the next copy when a repeating task is done: the next date after its due date,
 * and never one that has already passed (a task done late doesn't come back overdue).
 */
function nextDue(dueDate, rule, today) {
  let d = next(dueDate || today, rule);
  for (let guard = 0; d <= today && dueDate && guard < 1000; guard++) d = next(d, rule);
  return d;
}

module.exports = { clean, next, nextDue, UNITS };
