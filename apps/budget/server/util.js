'use strict';
// Input checks for Florin's routes: each throws a 400 with a sentence the page shows as it is.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (msg) => new HttpError(400, msg);

function str(v, { field, min = 0, max = 200, optional = false } = {}) {
  if (v === undefined || v === null) {
    if (optional) return undefined;
    throw bad(`${field} is required`);
  }
  const s = String(v).trim();
  if (s.length < min) throw bad(min <= 1 ? `${field} is required` : `${field} must be at least ${min} characters`);
  if (s.length > max) throw bad(`${field} must be at most ${max} characters`);
  return s;
}

function num(v, { field, min = -Infinity, max = Infinity, optional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return undefined;
    throw bad(`${field} is required`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`${field} must be a number`);
  if (n < min || n > max) throw bad(`${field} is out of range`);
  return n;
}

function date(v, { field = 'Date', optional = false } = {}) {
  if (!v) {
    if (optional) return undefined;
    throw bad(`${field} is required`);
  }
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw bad(`${field} must be YYYY-MM-DD`);
  return s;
}

function oneOf(v, values, { field, optional = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (optional) return undefined;
    throw bad(`${field} is required`);
  }
  if (!values.includes(v)) throw bad(`${field} must be one of: ${values.join(', ')}`);
  return v;
}

const round2 = (n) => Math.round(n * 100) / 100;

module.exports = { HttpError, bad, str, num, date, oneOf, round2 };
