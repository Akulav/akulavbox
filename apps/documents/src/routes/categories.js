'use strict';
// Categorii și etichete ale unui spațiu: /docs/api/s/:store/categories, /tags
const { fail, str, idOrNull, lastId, paramId, readCategory } = require('../validate');

module.exports = async function categories(app, { auth, audit }) {
  const S = '/api/s/:store';

  app.get(S + '/categories', auth, async (req) => {
    const { db } = req.store;
    const tags = db.prepare('SELECT id, category_id, name FROM tags ORDER BY name').all();
    return db
      .prepare('SELECT id, name, color, sort FROM categories ORDER BY sort, name')
      .all()
      .map((c) => ({ ...c, tags: tags.filter((t) => t.category_id === c.id) }));
  });
  app.post(S + '/categories', auth, async (req) => {
    const { db } = req.store;
    const c = readCategory(req.body || {});
    const max = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM categories').get().n;
    const id = lastId(db.prepare('INSERT INTO categories (name, color, sort) VALUES (?, ?, ?)').run(c.name, c.color, max));
    audit(req, 'categorie adăugată', c.name);
    return { id };
  });
  app.put(S + '/categories/:id', auth, async (req) => {
    const c = readCategory(req.body || {});
    const r = req.store.db.prepare('UPDATE categories SET name = ?, color = ?, sort = ? WHERE id = ?').run(c.name, c.color, c.sort, paramId(req));
    if (!r.changes) throw fail(404, 'Categoria nu a fost găsită.');
    audit(req, 'categorie modificată', c.name);
    return { ok: true };
  });
  app.delete(S + '/categories/:id', auth, async (req) => {
    const { db } = req.store;
    const id = paramId(req);
    const old = db.prepare('SELECT name FROM categories WHERE id = ?').get(id);
    if (!old) throw fail(404, 'Categoria nu a fost găsită.');
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    audit(req, 'categorie ștearsă', old.name);
    return { ok: true };
  });

  app.post(S + '/tags', auth, async (req) => {
    const { db } = req.store;
    const name = str(req.body?.name, 80);
    const category_id = idOrNull(req.body?.category_id);
    if (!name) throw fail(400, 'Introduceți denumirea etichetei.');
    if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(category_id)) throw fail(400, 'Categoria nu există.');
    return { id: lastId(db.prepare('INSERT INTO tags (category_id, name) VALUES (?, ?)').run(category_id, name)) };
  });
  app.put(S + '/tags/:id', auth, async (req) => {
    const name = str(req.body?.name, 80);
    if (!name) throw fail(400, 'Introduceți denumirea etichetei.');
    const r = req.store.db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, paramId(req));
    if (!r.changes) throw fail(404, 'Eticheta nu a fost găsită.');
    return { ok: true };
  });
  app.delete(S + '/tags/:id', auth, async (req) => {
    const r = req.store.db.prepare('DELETE FROM tags WHERE id = ?').run(paramId(req));
    if (!r.changes) throw fail(404, 'Eticheta nu a fost găsită.');
    return { ok: true };
  });
};
