const db = require('../core/db');
const { verifyUser } = require('../core/auth');
const lib = require('../core/library');

// Sections backed by a locked folder + per-file details (title, participants, tags…)
const SECTIONS = { videos: 'videos', books: 'books', music: 'music', photos: 'gallery', xxx: 'xxx' };
const XXX_OFF = 'The XXX section is turned off. Turn it on in Profile.';

const TEXT_FIELDS = { title: 300, details: 10000, date: 40, series: 300 };

function cleanList(v) {
  if (!Array.isArray(v)) return undefined;
  const out = [];
  const seen = new Set();
  for (const raw of v) {
    const s = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const k = s.toLowerCase();
    if (s && !seen.has(k)) { seen.add(k); out.push(s); }
    if (out.length >= 60) break;
  }
  return out;
}

function currentMeta(fileId, ownerId) {
  const row = db.prepare('SELECT * FROM media_meta WHERE file_id = ?').get(fileId);
  if (row) return lib.withMeta(row);
  return { file_id: fileId, owner_id: ownerId, title: null, participants: [], tags: [], details: null, date: null, series: null, rating: null, duration: null, thumb_file_id: null, progress: null, width: null, height: null };
}

function saveMeta(m) {
  db.prepare(`
    INSERT INTO media_meta (file_id, owner_id, title, participants, tags, details, date, series, rating, duration, thumb_file_id, progress, width, height, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(file_id) DO UPDATE SET
      title = excluded.title, participants = excluded.participants, tags = excluded.tags, details = excluded.details,
      date = excluded.date, series = excluded.series, rating = excluded.rating, duration = excluded.duration,
      thumb_file_id = excluded.thumb_file_id, progress = excluded.progress, width = excluded.width, height = excluded.height, updated_at = excluded.updated_at
  `).run(m.file_id, m.owner_id, m.title, JSON.stringify(m.participants || []), JSON.stringify(m.tags || []), m.details, m.date, m.series,
    m.rating, m.duration, m.thumb_file_id, m.progress, m.width ?? null, m.height ?? null);
}

/** Apply a patch object to a meta record; returns an error string or null */
function applyPatch(m, body, userId) {
  for (const [f, max] of Object.entries(TEXT_FIELDS)) {
    if (body[f] !== undefined) m[f] = body[f] === null ? null : (String(body[f]).trim().slice(0, max) || null);
  }
  const p = cleanList(body.participants); if (p) m.participants = p;
  const t = cleanList(body.tags); if (t) m.tags = t;
  if (body.rating !== undefined) {
    const r = body.rating === null ? null : Math.round(Number(body.rating));
    if (r !== null && !(r >= 0 && r <= 5)) return 'Rating must be between 0 and 5';
    m.rating = r || null;
  }
  if (body.duration !== undefined) {
    const d = Number(body.duration);
    m.duration = isFinite(d) && d > 0 ? d : null;
  }
  // natural size of a video (the browser reads it while playing or making a cover)
  for (const k of ['width', 'height']) {
    if (body[k] === undefined) continue;
    const n = Math.round(Number(body[k]));
    m[k] = n >= 1 && n <= 20000 ? n : null;
  }
  if (body.progress !== undefined) m.progress = body.progress === null ? null : String(body.progress).slice(0, 4000);
  if (body.thumb_file_id !== undefined) {
    if (body.thumb_file_id === null) m.thumb_file_id = null;
    else {
      if (typeof body.thumb_file_id !== 'string') return 'Cover must be one of your images';
      const img = db.prepare('SELECT filename, mime_type FROM files WHERE id = ? AND owner_id = ?').get(body.thumb_file_id, userId);
      if (!img || lib.categoryOf(img.filename, img.mime_type) !== 'image') return 'Cover must be one of your images';
      m.thumb_file_id = body.thumb_file_id;
    }
  }
  return null;
}

module.exports = async function (fastify) {

  // Folder id for a locked folder (created on first use)
  fastify.get('/api/library/folder/:key', { preHandler: verifyUser }, async (request, reply) => {
    const def = lib.SYSTEM[request.params.key];
    if (!def) return reply.code(404).send({ error: 'Unknown folder' });
    if (def.optIn && !lib.showsXxx(request.user.id)) return reply.code(403).send({ error: XXX_OFF });
    return { id: lib.ensureSystemFolder(request.user.id, request.params.key) };
  });

  // Every item of a section, with its details
  fastify.get('/api/library/:section', { preHandler: verifyUser }, async (request, reply) => {
    const key = SECTIONS[request.params.section];
    if (!key) return reply.code(404).send({ error: 'Unknown section' });
    if (lib.SYSTEM[key].optIn && !lib.showsXxx(request.user.id)) return reply.code(403).send({ error: XXX_OFF });
    const folderId = lib.ensureSystemFolder(request.user.id, key);
    const items = db.prepare(`
      SELECT f.id, f.filename, f.size_bytes, f.mime_type, f.is_encrypted, f.public_hash, f.created_at, ${lib.META_COLS}
      FROM files f LEFT JOIN media_meta m ON m.file_id = f.id
      WHERE f.folder_id = ? AND f.owner_id = ? AND f.trashed_at IS NULL
    `).all(folderId, request.user.id).map(lib.withMeta);
    return { folderId, items };
  });

  fastify.patch('/api/library/meta/:fileId', { preHandler: verifyUser }, async (request, reply) => {
    const file = db.prepare('SELECT id FROM files WHERE id = ? AND owner_id = ?').get(request.params.fileId, request.user.id);
    if (!file) return reply.code(404).send({ error: 'File not found' });
    const m = currentMeta(file.id, request.user.id);
    const err = applyPatch(m, request.body || {}, request.user.id);
    if (err) return reply.code(400).send({ error: err });
    saveMeta(m);
    return lib.withMeta(db.prepare('SELECT * FROM media_meta WHERE file_id = ?').get(file.id));
  });

  // Bulk edit: add/remove participants & tags, or set shared fields, on many files at once
  fastify.post('/api/library/meta/bulk', { preHandler: verifyUser }, async (request, reply) => {
    const b = request.body || {};
    const ids = Array.isArray(b.file_ids) ? b.file_ids.filter(x => typeof x === 'string').slice(0, 2000) : [];
    if (!ids.length) return reply.code(400).send({ error: 'No files selected' });
    const addP = cleanList(b.add_participants) || [], remP = (cleanList(b.remove_participants) || []).map(s => s.toLowerCase());
    const addT = cleanList(b.add_tags) || [], remT = (cleanList(b.remove_tags) || []).map(s => s.toLowerCase());
    const set = b.set && typeof b.set === 'object' ? b.set : {};
    // validate the shared fields once, before touching anything
    const probe = applyPatch(currentMeta('', request.user.id), set, request.user.id);
    if (probe) return reply.code(400).send({ error: probe });
    let updated = 0;
    const owned = db.prepare('SELECT 1 FROM files WHERE id = ? AND owner_id = ?');
    db.tx(() => {
      for (const id of ids) {
        if (!owned.get(id, request.user.id)) continue;
        const m = currentMeta(id, request.user.id);
        applyPatch(m, set, request.user.id);
        m.participants = cleanList([...m.participants.filter(x => !remP.includes(x.toLowerCase())), ...addP]);
        m.tags = cleanList([...m.tags.filter(x => !remT.includes(x.toLowerCase())), ...addT]);
        saveMeta(m);
        updated++;
      }
    });
    return { success: true, updated };
  });
};
