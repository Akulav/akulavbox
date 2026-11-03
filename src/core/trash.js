const db = require('./db');
const config = require('./config');
const { purgeFile } = require('./storage');

// ---------------------------------------------------------------------------
// Trash. Deleting a file or folder only marks it (trashed_at). Everything inside
// a trashed folder is marked too, with trash_root = that folder, so the whole
// tree comes back (or goes away) together. Items are removed for good when the
// trash is emptied or after TRASH_DAYS.
// ---------------------------------------------------------------------------

function trashFile(fileId, userId) {
  return db.prepare("UPDATE files SET trashed_at = datetime('now'), trash_root = NULL WHERE id = ? AND owner_id = ? AND trashed_at IS NULL")
    .run(fileId, userId).changes > 0;
}

function trashFolder(folderId, userId) {
  const f = db.prepare('SELECT id, system_key FROM folders WHERE id = ? AND owner_id = ? AND trashed_at IS NULL').get(folderId, userId);
  if (!f || f.system_key) return false;
  const tree = `WITH RECURSIVE tree(id) AS (
      SELECT ? UNION SELECT c.id FROM folders c JOIN tree t ON c.parent_id = t.id WHERE c.trashed_at IS NULL)`;
  // files first: the tree walk only follows folders that aren't trashed yet
  db.tx(() => {
    db.prepare(`${tree} UPDATE files SET trashed_at = datetime('now'), trash_root = ?
      WHERE folder_id IN (SELECT id FROM tree) AND owner_id = ? AND trashed_at IS NULL`).run(f.id, f.id, userId);
    db.prepare(`${tree} UPDATE folders SET trashed_at = datetime('now'), trash_root = CASE WHEN id = ? THEN NULL ELSE ? END
      WHERE id IN (SELECT id FROM tree) AND owner_id = ?`).run(f.id, f.id, f.id, userId);
  });
  return true;
}

const liveFolder = (id, userId) => id && db.prepare('SELECT 1 FROM folders WHERE id = ? AND owner_id = ? AND trashed_at IS NULL').get(id, userId);

function restoreFile(fileId, userId) {
  const f = db.prepare('SELECT id, folder_id FROM files WHERE id = ? AND owner_id = ? AND trashed_at IS NOT NULL AND trash_root IS NULL').get(fileId, userId);
  if (!f) return false;
  // back where it was, or to the top level if that folder is gone
  const folder = liveFolder(f.folder_id, userId) ? f.folder_id : null;
  db.prepare('UPDATE files SET trashed_at = NULL, trash_root = NULL, folder_id = ? WHERE id = ?').run(folder, f.id);
  return true;
}

function restoreFolder(folderId, userId) {
  const f = db.prepare('SELECT id, parent_id FROM folders WHERE id = ? AND owner_id = ? AND trashed_at IS NOT NULL AND trash_root IS NULL').get(folderId, userId);
  if (!f) return false;
  const parent = liveFolder(f.parent_id, userId) ? f.parent_id : null;
  db.tx(() => {
    db.prepare('UPDATE folders SET trashed_at = NULL, trash_root = NULL, parent_id = ? WHERE id = ?').run(parent, f.id);
    db.prepare('UPDATE folders SET trashed_at = NULL, trash_root = NULL WHERE trash_root = ? AND owner_id = ?').run(f.id, userId);
    db.prepare('UPDATE files SET trashed_at = NULL, trash_root = NULL WHERE trash_root = ? AND owner_id = ?').run(f.id, userId);
  });
  return true;
}

function purgeTrashedFile(fileId, userId) {
  const f = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ? AND trashed_at IS NOT NULL').get(fileId, userId);
  if (!f) return false;
  purgeFile(f);
  return true;
}

function purgeTrashedFolder(folderId, userId) {
  const f = db.prepare('SELECT id FROM folders WHERE id = ? AND owner_id = ? AND trashed_at IS NOT NULL AND trash_root IS NULL').get(folderId, userId);
  if (!f) return false;
  for (const file of db.prepare('SELECT * FROM files WHERE trash_root = ? AND owner_id = ?').all(f.id, userId)) purgeFile(file);
  db.prepare('DELETE FROM folders WHERE (trash_root = ? OR id = ?) AND owner_id = ?').run(f.id, f.id, userId);
  return true;
}

function listTrash(userId) {
  const files = db.prepare(`
    SELECT f.id, f.filename, f.size_bytes, f.mime_type, f.is_encrypted, f.created_at, f.trashed_at, f.folder_id, d.name AS folder_name
    FROM files f LEFT JOIN folders d ON d.id = f.folder_id
    WHERE f.owner_id = ? AND f.trashed_at IS NOT NULL AND f.trash_root IS NULL ORDER BY f.trashed_at DESC`).all(userId);
  const folders = db.prepare(`
    SELECT d.id, d.name, d.trashed_at, d.parent_id,
      (SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE trash_root = d.id) AS size_bytes,
      (SELECT COUNT(*) FROM files WHERE trash_root = d.id) AS file_count
    FROM folders d WHERE d.owner_id = ? AND d.trashed_at IS NOT NULL AND d.trash_root IS NULL ORDER BY d.trashed_at DESC`).all(userId);
  const total = db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS bytes, COUNT(*) AS n FROM files WHERE owner_id = ? AND trashed_at IS NOT NULL').get(userId);
  return { files, folders, total_bytes: total.bytes, total_files: total.n, days: config.trashDays };
}

function emptyTrash(userId) {
  let n = 0;
  for (const f of db.prepare('SELECT id FROM folders WHERE owner_id = ? AND trashed_at IS NOT NULL AND trash_root IS NULL').all(userId)) { purgeTrashedFolder(f.id, userId); n++; }
  for (const f of db.prepare('SELECT * FROM files WHERE owner_id = ? AND trashed_at IS NOT NULL').all(userId)) { purgeFile(f); n++; }
  db.prepare('DELETE FROM folders WHERE owner_id = ? AND trashed_at IS NOT NULL').run(userId);
  return n;
}

/** Remove everything that has been in the trash longer than TRASH_DAYS */
function purgeExpired() {
  const cutoff = `-${config.trashDays} days`;
  let n = 0;
  for (const f of db.prepare("SELECT id, owner_id FROM folders WHERE trashed_at IS NOT NULL AND trash_root IS NULL AND trashed_at < datetime('now', ?)").all(cutoff)) {
    purgeTrashedFolder(f.id, f.owner_id); n++;
  }
  for (const f of db.prepare("SELECT * FROM files WHERE trashed_at IS NOT NULL AND trash_root IS NULL AND trashed_at < datetime('now', ?)").all(cutoff)) {
    purgeFile(f); n++;
  }
  return n;
}

module.exports = { trashFile, trashFolder, restoreFile, restoreFolder, purgeTrashedFile, purgeTrashedFolder, listTrash, emptyTrash, purgeExpired };
