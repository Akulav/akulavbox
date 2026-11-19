'use strict';
// Validări și utilitare comune rutelor e-Management.

const fail = (code, message) => Object.assign(new Error(message), { statusCode: code, expose: true });
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const str = (v, max) => String(v ?? '').replace(CONTROL, '').trim().slice(0, max);
const isId = (n) => Number.isSafeInteger(n) && n > 0;
const idOrNull = (v) => (v === null || v === undefined || v === '' ? null : isId(Number(v)) ? Number(v) : null);
const idList = (v) => [...new Set((Array.isArray(v) ? v : []).slice(0, 2000).map(Number).filter(isId))];
const lastId = (r) => Number(r.lastInsertRowid);

// Identificatorul din adresă (/api/.../:id); orice altceva decât un număr pozitiv înseamnă „nu există”.
const paramId = (req) => {
  const n = Number(req.params.id);
  if (!isId(n)) throw fail(404, 'Înregistrarea nu a fost găsită.');
  return n;
};

// Data calendaristică reală (respinge 2024-02-31 etc.), într-un interval rezonabil.
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  const y = Number(s.slice(0, 4));
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && y >= 1900 && y <= 2200;
}

function readDoc(store, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw fail(400, 'Date lipsă.');
  const title = str(data.title, 300);
  if (!title) throw fail(400, 'Introduceți denumirea documentului.');
  const doc_date = str(data.doc_date, 10);
  if (!validDate(doc_date)) throw fail(400, 'Indicați o dată validă a documentului.');
  const tagOk = store.db.prepare('SELECT 1 FROM tags WHERE id = ?');
  return {
    title,
    doc_date,
    number: str(data.number, 60),
    description: str(data.description, 5000),
    tagIds: idList(data.tagIds).filter((id) => tagOk.get(id)),
    removeFileIds: idList(data.removeFileIds),
  };
}

function readCategory(body) {
  const name = str(body.name, 80);
  if (!name) throw fail(400, 'Introduceți denumirea categoriei.');
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : '#1d4e89';
  return { name, color, sort: Number.isInteger(Number(body.sort)) ? Number(body.sort) : 0 };
}

const fmtMb = (b) => (b / 1048576).toFixed(b >= 1048576 * 100 ? 0 : 1).replace('.', ',') + ' MB';

/** Data de azi după ceasul local al serverului (YYYY-MM-DD) */
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

module.exports = { fail, str, isId, idOrNull, idList, lastId, paramId, validDate, readDoc, readCategory, fmtMb, today };
