'use strict';
// Input checks for Tasks' routes. Each throws a 400 with a sentence the page shows as it is.
const repeat = require('./repeat');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const STATUSES = ['todo', 'doing', 'done'];

const text = (v, field, max, { required = false } = {}) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (required && !s) throw bad(`${field} can’t be empty.`);
  if (s.length > max) throw bad(`${field} can be at most ${max} characters.`);
  return s;
};
// notes keep their line breaks
const notes = (v) => {
  const s = String(v ?? '').replace(/\r\n?/g, '\n').trim();
  if (s.length > 20000) throw bad('Notes can be at most 20,000 characters.');
  return s;
};
const date = (v, field = 'The date') => {
  if (v === null || v === '' || v === undefined) return null;
  if (!DATE.test(String(v)) || Number.isNaN(Date.parse(v))) throw bad(`${field} must be a date like 2026-03-07.`);
  return String(v);
};
const time = (v) => {
  if (v === null || v === '' || v === undefined) return null;
  if (!TIME.test(String(v))) throw bad('The time must be like 09:30.');
  return String(v);
};
const color = (v) => {
  if (!COLOR.test(String(v ?? ''))) throw bad('Pick a colour like #8b5cf6.');
  return String(v).toLowerCase();
};
const icon = (v) => {
  const s = String(v ?? 'list');
  if (!/^[a-z0-9-]{1,32}$/.test(s)) throw bad('Unknown icon.');
  return s;
};

/** Tags: trimmed, without "#", at most 20 of 40 characters each, no duplicates */
function tags(v) {
  if (!Array.isArray(v)) throw bad('Tags must be a list.');
  const out = [];
  for (const t of v) {
    const s = String(t ?? '').replace(/^#+/, '').replace(/\s+/g, '-').trim().slice(0, 40);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  if (out.length > 20) throw bad('A task can have at most 20 tags.');
  return out;
}

/** Checklist items: [{ text, done }], at most 200 */
function checklist(v) {
  if (!Array.isArray(v)) throw bad('The checklist must be a list.');
  if (v.length > 200) throw bad('A checklist can have at most 200 items.');
  return v.map((i) => ({ text: text(i?.text, 'A checklist item', 500), done: Boolean(i?.done) })).filter((i) => i.text);
}

function priority(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 3) throw bad('Priority is 0 (none) to 3 (high).');
  return n;
}
function status(v) {
  if (!STATUSES.includes(v)) throw bad('Status is todo, doing or done.');
  return v;
}
function rule(v, dueDate) {
  try {
    return repeat.clean(v, dueDate);
  } catch (e) {
    throw bad(e.message);
  }
}
const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'Not found');
  return n;
};

module.exports = { HttpError, bad, text, notes, date, time, color, icon, tags, checklist, priority, status, rule, id, STATUSES };
