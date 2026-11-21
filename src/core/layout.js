const path = require('path');
const fs = require('fs');

/**
 * The data folder's layout, and the move of an older one into it. Runs from config.js on start,
 * before anything opens a file.
 *
 * Since 4.0 every app keeps its files in its own folder: AkulavBox in box/, the others in
 * documents/, budget/ and the other apps' folders (appDataDir). Shared state (the accounts database, backups,
 * temp, tools, updates) stays at the top. Before 4.0, users/, thumbs/ and private/ were at the
 * top: they are renamed into box/, which is instant on the same drive. A folder that can't be
 * moved (a mount, a file held open on Windows, a second server on the same folder) keeps being
 * used where it is, and a note says why.
 *
 * `move: false` is for command-line tools next to a live server (scripts/backup.js): they use
 * the folders where they are and never move them.
 */
function prepare(storageDir, { move = true } = {}) {
  const boxDir = path.join(storageDir, 'box');
  const notes = []; // { warn, text }

  const place = (name) => {
    const now = path.join(boxDir, name);
    const old = path.join(storageDir, name);
    if (fs.existsSync(now) || !fs.existsSync(old)) return now; // already moved, or a new install
    if (!move) return old;
    if (otherServerRunning(storageDir)) {
      notes.push({ warn: true, text: `${old} was not moved to ${now}: another server uses this data folder.` });
      return old;
    }
    try {
      fs.mkdirSync(boxDir, { recursive: true });
      fs.renameSync(old, now);
      notes.push({ warn: false, text: `Moved ${old} to ${now}.` });
      return now;
    } catch (e) {
      notes.push({ warn: true, text: `Couldn’t move ${old} to ${now} (${e.code || e.message}); it stays where it is. Stop the server and move it by hand to finish the change.` });
      return old;
    }
  };

  const dirs = {
    boxDir,
    usersDir: place('users'),
    thumbsDir: place('thumbs'),
    // per-user secrets for link downloads (sign-in cookies), encrypted with MASTER_KEY
    privateDir: place('private'),
  };
  if (move) removeLeftovers(storageDir);
  return { ...dirs, notes };
}

/** Is another server running on this data folder? (the pid file of core/instance.js, which needs config itself) */
function otherServerRunning(storageDir) {
  try {
    const pid = Number(JSON.parse(fs.readFileSync(path.join(storageDir, 'akulavbox.pid'), 'utf-8')).pid);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
  } catch (e) { return false; }
}

/** Folders of removed features. 3.0 removed chat: its 10-minute attachments have no owner any more. */
function removeLeftovers(storageDir) {
  try { fs.rmSync(path.join(storageDir, 'chat_temp'), { recursive: true, force: true }); } catch (e) { /* in use or gone */ }
}

module.exports = { prepare };
