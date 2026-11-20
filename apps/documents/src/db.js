'use strict';
// Bazele de date SQLite (modulul integrat node:sqlite): pentru fiecare cont, două spații de stocare.
//
// DATA_DIR/documents/<cont>/work/ansc.db         documentele de serviciu și jurnalul de activitate
// DATA_DIR/documents/<cont>/work/uploads/        fișierele lor
// DATA_DIR/documents/<cont>/personal/ansc.db     documentele personale
// DATA_DIR/documents/<cont>/personal/uploads/    fișierele lor
//
// Contul este cel din AkulavBox (o singură autentificare pentru toate aplicațiile), deci aici nu există
// utilizatori, parole sau sesiuni. Folderul unui cont apare la prima folosire.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
// tranzacții și coloane adăugate după prima versiune (addColumn verifică înainte, deci pasul se poate repeta)
const { tx, addColumn } = require('../../../src/core/sqlite');

function openDb(dir) {
  const uploadDir = path.join(dir, 'uploads');
  const file = path.join(dir, 'ansc.db');
  const fresh = !fs.existsSync(file);
  fs.mkdirSync(uploadDir, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#1d4e89',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  number TEXT NOT NULL DEFAULT '',
  doc_date TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(doc_date);
CREATE TABLE IF NOT EXISTS document_files (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stored TEXT NOT NULL,
  size INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS document_tags (
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, tag_id)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  username TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT ''
);
`);
  addColumn(db, 'document_files', 'signed_by_name', 'TEXT'); // versiuni semnate din bazele vechi, doar afișate
  addColumn(db, 'document_files', 'created_at', 'TEXT');
  return { db, uploadDir, fresh };
}

function seedCategories(db, seed) {
  tx(db, () => {
    const cat = db.prepare('INSERT INTO categories (name, color, sort) VALUES (?, ?, ?)');
    const tag = db.prepare('INSERT INTO tags (category_id, name) VALUES (?, ?)');
    seed.forEach(([name, color, tags], i) => {
      const id = Number(cat.run(name, color, i).lastInsertRowid);
      for (const t of tags) tag.run(id, t);
    });
  });
}

const SEED = {
  personal: [
    ['Acte personale', '#1d4e89', ['Identitate', 'Studii', 'Stare civilă']],
    ['Sănătate', '#0f766e', ['Analize', 'Rețete', 'Asigurări']],
    ['Finanțe', '#9a3412', ['Facturi', 'Bancă', 'Impozite', 'Contracte']],
    ['Locuință și auto', '#6d28d9', ['Locuință', 'Automobil', 'Garanții']],
  ],
  work: [
    ['Resurse umane', '#0f766e', ['Contract de muncă', 'Concedii', 'Fișa postului']],
    ['Documente de lucru', '#1d4e89', ['Ordine', 'Proceduri', 'Rapoarte']],
  ],
};
const LABELS = { personal: 'Personal', work: 'Serviciu' };

/** Spațiile de stocare ale conturilor, deschise la cerere și păstrate deschise */
function createStores(root) {
  fs.mkdirSync(root, { recursive: true });
  const open = new Map(); // id cont -> { personal, work }

  // Id-urile vin din baza AkulavBox (UUID); orice altceva devine un nume sigur de folder.
  const folderOf = (userId) => path.join(root, /^[\w-]{1,64}$/.test(String(userId)) ? String(userId) : 'u-' + crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 32));

  function forUser(userId) {
    let s = open.get(userId);
    if (s) return s;
    const base = folderOf(userId);
    s = {};
    for (const key of ['personal', 'work']) {
      const dir = path.join(base, key);
      const o = openDb(dir);
      if (o.fresh) seedCategories(o.db, SEED[key]);
      s[key] = { key, label: LABELS[key], db: o.db, uploadDir: o.uploadDir, dir };
      cleanupLeftovers(s[key]);
    }
    open.set(userId, s);
    return s;
  }

  const has = (userId) => open.has(userId) || fs.existsSync(folderOf(userId));

  /** Octeții fișierelor din ambele spații (zero pentru un cont care nu a folosit aplicația) */
  function usage(userId) {
    if (!has(userId)) return 0;
    const s = forUser(userId);
    return ['personal', 'work'].reduce((n, k) => n + Number(s[k].db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM document_files').get().n), 0);
  }

  function counts(userId) {
    if (!has(userId)) return { documents: 0, files: 0 };
    const s = forUser(userId);
    const one = (sql) => ['personal', 'work'].reduce((n, k) => n + Number(s[k].db.prepare(sql).get().n), 0);
    return { documents: one('SELECT COUNT(*) AS n FROM documents'), files: one('SELECT COUNT(*) AS n FROM document_files') };
  }

  function closeUser(userId) {
    const s = open.get(userId);
    if (!s) return;
    for (const st of Object.values(s)) {
      try { st.db.close(); } catch {}
    }
    open.delete(userId);
  }

  function deleteUser(userId) {
    closeUser(userId);
    fs.rmSync(folderOf(userId), { recursive: true, force: true });
  }

  function closeAll() {
    for (const id of [...open.keys()]) closeUser(id);
  }

  /** Toate conturile care au un folder aici (pentru totaluri) */
  const folders = () => {
    try { return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  };

  return { forUser, has, usage, counts, deleteUser, closeAll, folders, folderOf };
}

// Un import întrerupt (oprirea serverului, pana de curent) lasă în urmă un folder temporar, uneori mare.
function cleanupLeftovers(store) {
  try {
    for (const n of fs.readdirSync(store.dir)) {
      if (/^import-/.test(n)) fs.rmSync(path.join(store.dir, n), { recursive: true, force: true });
    }
  } catch (e) {
    console.error(`Verificarea folderului de date (${store.label}) a eșuat:`, e.message);
  }
}

module.exports = { tx, createStores };
