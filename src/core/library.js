const db = require('./db');
const crypto = require('crypto');
const { extOf } = require('./mime');

// ---------------------------------------------------------------------------
// System ("locked") folders. Each section stores its uploads in its own folder,
// and the images that only serve that section (artwork, covers) sit inside it:
//
//   Photos            Music              Videos            Books
//                       └ Artwork          └ Covers          └ Covers
//
// They can't be renamed, moved or deleted, you can't add your own sub-folders,
// and each only accepts files of the matching type.
// ---------------------------------------------------------------------------
const SYSTEM = {
  gallery:      { name: 'Photos',  section: 'Photos', accepts: 'image', legacy: ['Gallery Uploads'] },
  music:        { name: 'Music',   section: 'Music',  accepts: 'audio', legacy: ['Music Library'] },
  music_art:    { name: 'Artwork', section: 'Music',  accepts: 'image', parent: 'music', legacy: ['Music Art'], role: 'Song and playlist artwork' },
  videos:       { name: 'Videos',  section: 'Videos', accepts: 'video' },
  video_covers: { name: 'Covers',  section: 'Videos', accepts: 'image', parent: 'videos', role: 'Video cover images' },
  books:        { name: 'Books',   section: 'Books',  accepts: 'book' },
  book_covers:  { name: 'Covers',  section: 'Books',  accepts: 'image', parent: 'books', role: 'Book cover images' },
};
const ORDER = Object.keys(SYSTEM);
// Covers and artwork are managed by their section, so Files doesn't show them:
// Files shows just Photos, Music, Videos and Books.
const HIDDEN = Object.keys(SYSTEM).filter(k => SYSTEM[k].parent);
const HIDDEN_SQL = `(${HIDDEN.map(k => `'${k}'`).join(', ')})`;

const BOOK_EXT = ['pdf', 'epub', 'mobi', 'azw', 'azw3', 'djvu', 'fb2', 'cbz', 'cbr', 'txt'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'heic', 'heif', 'svg', 'tif', 'tiff'];
const AUDIO_EXT = ['mp3', 'wav', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'weba', 'wma', 'aiff'];
const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv', 'wmv', 'flv', '3gp', 'ts'];

function categoryOf(filename, mime = '') {
  const ext = extOf(filename);
  const m = (mime || '').toLowerCase();
  if (BOOK_EXT.includes(ext) || m === 'application/pdf' || m === 'application/epub+zip') return 'book';
  if (IMAGE_EXT.includes(ext) || m.startsWith('image/')) return 'image';
  if (AUDIO_EXT.includes(ext) || m.startsWith('audio/')) return 'audio';
  if (VIDEO_EXT.includes(ext) || m.startsWith('video/')) return 'video';
  return 'other';
}

// (schema lives in core/migrations.js)

function ensureSystemFolder(userId, key) {
  const def = SYSTEM[key];
  if (!def) throw new Error('Unknown system folder');
  const parentId = def.parent ? ensureSystemFolder(userId, def.parent) : null;
  const row = db.prepare('SELECT id, parent_id, trashed_at FROM folders WHERE owner_id = ? AND system_key = ?').get(userId, key);
  if (row) {
    // keep it where it belongs (older versions put everything at the top level)
    if ((row.parent_id || null) !== parentId) db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(parentId, row.id);
    // locked folders can't be trashed; heal anything an older build may have done
    if (row.trashed_at) db.prepare('UPDATE folders SET trashed_at = NULL, trash_root = NULL WHERE id = ?').run(row.id);
    return row.id;
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO folders (id, owner_id, parent_id, name, system_key) VALUES (?, ?, ?, ?, ?)').run(id, userId, parentId, def.name, key);
  return id;
}

// One-time tidy-up of folders made by older versions:
//  - adopt "Gallery Uploads", "Music Library", "Music Art" by name
//  - give them their new names and nest Artwork inside Music
//  - split the old shared "Covers" folder into Videos/Covers and Books/Covers
(function migrateLayout() {
  db.exec('BEGIN');
  try {
    for (const [key, def] of Object.entries(SYSTEM)) {
      const names = def.parent ? (def.legacy || []) : [def.name, ...(def.legacy || [])];
      for (const legacyName of names) {
        const rows = db.prepare('SELECT id, owner_id FROM folders WHERE name = ? AND parent_id IS NULL AND system_key IS NULL AND trashed_at IS NULL').all(legacyName);
        for (const r of rows) {
          if (db.prepare('SELECT 1 FROM folders WHERE owner_id = ? AND system_key = ?').get(r.owner_id, key)) continue;
          db.prepare('UPDATE folders SET system_key = ? WHERE id = ?').run(key, r.id);
        }
      }
    }
    for (const [key, def] of Object.entries(SYSTEM)) {
      for (const f of db.prepare('SELECT id, owner_id, name FROM folders WHERE system_key = ?').all(key)) {
        if (f.name !== def.name) db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(def.name, f.id);
        if (def.parent) ensureSystemFolder(f.owner_id, key);
      }
    }
    for (const old of db.prepare("SELECT id, owner_id FROM folders WHERE system_key = 'covers'").all()) {
      for (const cover of db.prepare('SELECT id FROM files WHERE folder_id = ?').all(old.id)) {
        // put each cover next to the section of the item that uses it
        const user = db.prepare(`
          SELECT d.system_key FROM media_meta m JOIN files f ON f.id = m.file_id LEFT JOIN folders d ON d.id = f.folder_id
          WHERE m.thumb_file_id = ? LIMIT 1`).get(cover.id);
        const target = ensureSystemFolder(old.owner_id, user && user.system_key === 'books' ? 'book_covers' : 'video_covers');
        db.prepare('UPDATE files SET folder_id = ? WHERE id = ?').run(target, cover.id);
      }
      const left = db.prepare('SELECT (SELECT count(*) FROM files WHERE folder_id = ?) + (SELECT count(*) FROM folders WHERE parent_id = ?) AS n').get(old.id, old.id).n;
      if (!left) db.prepare('DELETE FROM folders WHERE id = ?').run(old.id);
      else db.prepare("UPDATE folders SET system_key = NULL, name = 'Old covers' WHERE id = ?").run(old.id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('[library] folder migration failed:', e.message);
  }
})();

function systemKeyOf(folderId) {
  if (!folderId) return null;
  const row = db.prepare('SELECT system_key FROM folders WHERE id = ?').get(folderId);
  return row ? row.system_key : null;
}

/** Can a file with this name/mime live in the given system folder? */
function accepts(key, filename, mime) {
  const def = SYSTEM[key];
  if (!def) return true;
  return categoryOf(filename, mime) === def.accepts;
}

const ACCEPT_LABEL = { image: 'images', audio: 'audio files', video: 'videos', book: 'books (PDF, EPUB…)' };
function rejectMessage(key) {
  const def = SYSTEM[key];
  return `“${def.name}” only holds ${ACCEPT_LABEL[def.accepts]}. It’s managed by the ${def.section} section.`;
}

// --- media meta helpers ---
const parseList = (s) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };

function withMeta(row) {
  if (!row) return row;
  row.participants = parseList(row.participants);
  row.tags = parseList(row.tags);
  return row;
}

// Columns to select (alias m) for any list joined with media_meta
const META_COLS = `m.title, m.participants, m.tags, m.details, m.date, m.series, m.rating, m.duration, m.thumb_file_id, m.progress, m.updated_at AS meta_updated_at, m.width, m.height`;

function deleteMetaFor(fileId) {
  db.prepare('DELETE FROM media_meta WHERE file_id = ?').run(fileId);
  db.prepare('UPDATE media_meta SET thumb_file_id = NULL WHERE thumb_file_id = ?').run(fileId);
}

module.exports = { SYSTEM, ORDER, HIDDEN, HIDDEN_SQL, categoryOf, ensureSystemFolder, systemKeyOf, accepts, rejectMessage, withMeta, parseList, META_COLS, deleteMetaFor };
