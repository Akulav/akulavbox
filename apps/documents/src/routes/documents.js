'use strict';
// Documentele unui spațiu și fișierele lor: /docs/api/s/:store/documents, /files/:id
const path = require('node:path');
const fs = require('node:fs');
const { tx } = require('../db');
const { fail, lastId, paramId } = require('../validate');
const { readDocForm, discardUploads, removeStored } = require('../uploads');
const apps = require('../../../../src/core/apps');
const bus = require('../../../../src/core/bus');

// doar acestea se deschid în browser; restul se descarcă (niciodată SVG sau HTML)
const INLINE_TYPES = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

function saveDocLinks(store, id, doc, saved) {
  const { db } = store;
  db.prepare('DELETE FROM document_tags WHERE document_id = ?').run(id);
  const t = db.prepare('INSERT INTO document_tags (document_id, tag_id) VALUES (?, ?)');
  const f = db.prepare("INSERT INTO document_files (document_id, name, stored, size, created_at) VALUES (?, ?, ?, ?, datetime('now'))");
  doc.tagIds.forEach((x) => t.run(id, x));
  saved.forEach((x) => f.run(id, x.name, x.stored, x.size));
}

// Grupează rândurile după document; elimină coloana document_id din fiecare rând.
function byDocument(rows, pick = (r) => r) {
  const map = new Map();
  for (const { document_id, ...r } of rows) {
    if (!map.has(document_id)) map.set(document_id, []);
    map.get(document_id).push(pick(r));
  }
  return map;
}

// Lista completă se citește cu câte o singură interogare pe tabel, ca pagina să rămână rapidă și cu mii de documente.
function listDocuments({ db }) {
  const rows = db.prepare('SELECT id, title, number, doc_date, description, created_at FROM documents ORDER BY doc_date DESC, id DESC').all();
  if (!rows.length) return [];
  const tags = byDocument(db.prepare('SELECT document_id, tag_id FROM document_tags').all(), (r) => r.tag_id);
  const files = byDocument(db.prepare('SELECT document_id, id, name, size, signed_by_name, created_at FROM document_files ORDER BY id').all());
  return rows.map((d) => ({ ...d, tagIds: tags.get(d.id) || [], files: files.get(d.id) || [] }));
}

module.exports = async function documents(app, { auth, audit, stores }) {
  const S = '/api/s/:store';
  // cât mai încape în spațiul de stocare al contului AkulavBox (comun tuturor aplicațiilor) și,
  // dacă administratorul a stabilit una, în limita proprie a e-Management
  const limits = (req) => ({ room: apps.room(req.user.id, 'documents'), quota: apps.space(req.user.id)?.quota_bytes });
  const changed = (req) => bus.emit('storage.changed', { userId: req.user.id, app: 'documents' });

  app.get(S + '/documents', auth, async (req) => listDocuments(req.store));

  app.post(S + '/documents', auth, async (req) => {
    const store = req.store;
    const { doc, saved } = await readDocForm(req, limits(req));
    try {
      const id = tx(store.db, () => {
        const r = store.db.prepare('INSERT INTO documents (title, number, doc_date, description) VALUES (?, ?, ?, ?)').run(doc.title, doc.number, doc.doc_date, doc.description);
        saveDocLinks(store, lastId(r), doc, saved);
        return lastId(r);
      });
      audit(req, 'document adăugat', `#${id} ${doc.title}`);
      changed(req);
      return { id };
    } catch (e) {
      removeStored(store, saved.map((f) => f.stored));
      throw e;
    }
  });

  app.put(S + '/documents/:id', auth, async (req) => {
    const store = req.store;
    const id = paramId(req);
    if (!store.db.prepare('SELECT 1 FROM documents WHERE id = ?').get(id)) {
      await discardUploads(req);
      throw fail(404, 'Documentul nu a fost găsit.');
    }
    const { doc, saved } = await readDocForm(req, limits(req));
    const removed = [];
    try {
      tx(store.db, () => {
        store.db.prepare("UPDATE documents SET title = ?, number = ?, doc_date = ?, description = ?, updated_at = datetime('now') WHERE id = ?").run(doc.title, doc.number, doc.doc_date, doc.description, id);
        const q = store.db.prepare('SELECT stored FROM document_files WHERE id = ? AND document_id = ?');
        const del = store.db.prepare('DELETE FROM document_files WHERE id = ? AND document_id = ?');
        for (const fid of doc.removeFileIds) {
          const f = q.get(fid, id);
          if (f) {
            removed.push(f.stored);
            del.run(fid, id);
          }
        }
        saveDocLinks(store, id, doc, saved);
      });
    } catch (e) {
      removeStored(store, saved.map((f) => f.stored));
      throw e;
    }
    removeStored(store, removed);
    changed(req);
    audit(req, 'document modificat', `#${id} ${doc.title}`);
    return { ok: true };
  });

  app.delete(S + '/documents/:id', auth, async (req) => {
    const store = req.store;
    const id = paramId(req);
    const old = store.db.prepare('SELECT title FROM documents WHERE id = ?').get(id);
    if (!old) throw fail(404, 'Documentul nu a fost găsit.');
    const stored = store.db.prepare('SELECT stored FROM document_files WHERE document_id = ?').all(id).map((f) => f.stored);
    store.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    removeStored(store, stored);
    changed(req);
    audit(req, 'document șters', `#${id} ${old.title}`);
    return { ok: true };
  });

  app.get(S + '/files/:id', auth, async (req, reply) => {
    const store = req.store;
    const f = store.db.prepare('SELECT name, stored, document_id FROM document_files WHERE id = ?').get(paramId(req));
    const file = f && path.join(store.uploadDir, f.stored);
    if (!f || !fs.existsSync(file)) throw fail(404, 'Fișierul nu a fost găsit.');
    audit(req, 'fișier descărcat', `#${f.document_id} ${f.name}`);
    const inline = INLINE_TYPES[path.extname(f.name).toLowerCase()];
    reply
      .type(inline || 'application/octet-stream')
      .header('Content-Disposition', `${inline && !req.query.download ? 'inline' : 'attachment'}; filename="${f.name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    return reply.send(fs.createReadStream(file));
  });
};
