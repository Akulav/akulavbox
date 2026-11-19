const path = require('path');
const fs = require('fs');

const APP_DIR = path.join(__dirname, '../..');

// Loaded once, before anything else touches process.env
require('dotenv').config({ path: path.join(APP_DIR, '.env') });

const pkg = require('../../package.json');

/**
 * Where the database and files live. STORAGE_DIR (or DATA_DIR) wins; otherwise
 * data/ in the app folder. Versions before 3.0 used storage/ in the folder the
 * server was started from: an install that still has one (and no data/) keeps
 * using it, so an upgrade never comes up empty.
 */
function resolveStorage() {
  const fromEnv = process.env.STORAGE_DIR || process.env.DATA_DIR;
  if (fromEnv) return { dir: path.resolve(fromEnv), legacy: false };
  const data = path.join(APP_DIR, 'data');
  for (const legacy of [path.join(process.cwd(), 'storage'), path.join(APP_DIR, 'storage')]) {
    if (!fs.existsSync(data) && fs.existsSync(path.join(legacy, 'akulavbox.db'))) return { dir: legacy, legacy: true };
  }
  return { dir: data, legacy: false };
}
const { dir: STORAGE_DIR, legacy: LEGACY_STORAGE } = resolveStorage();

/**
 * Since 4.0 every app keeps its files in its own folder of the data folder:
 * AkulavBox in box/, the others in documents/, manga/ and budget/. Shared state
 * (the accounts database, backups, temp, tools, updates) stays at the top.
 * Older installs have users/, thumbs/ and private/ at the top: they are moved
 * into box/ here, before anything opens them. A rename on the same drive is
 * instant; when it can't be done (a mounted folder, a file held open on Windows,
 * a second server on the same folder) that folder keeps being used where it is.
 */
const BOX_DIR = path.join(STORAGE_DIR, 'box');
const layoutNotes = [];
function boxFolder(name) {
  const now = path.join(BOX_DIR, name);
  const old = path.join(STORAGE_DIR, name);
  if (fs.existsSync(now) || !fs.existsSync(old)) return now;
  if (otherServerRunning()) { layoutNotes.push(`${old} was not moved to ${now}: another server uses this data folder.`); return old; }
  try {
    fs.mkdirSync(BOX_DIR, { recursive: true });
    fs.renameSync(old, now);
    layoutNotes.push(`Moved ${old} to ${now}.`);
    return now;
  } catch (e) {
    layoutNotes.push(`Couldn’t move ${old} to ${now} (${e.code || e.message}); it stays where it is. Stop the server and move it by hand to finish the change.`);
    return old;
  }
}
// the pid file of core/instance.js (that module needs this one, so it is read here directly)
function otherServerRunning() {
  try {
    const pid = Number(JSON.parse(fs.readFileSync(path.join(STORAGE_DIR, 'akulavbox.pid'), 'utf-8')).pid);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
  } catch (e) { return false; }
}
// command-line tools (scripts/backup.js) run next to a live server and must not move its folders
const MOVE_OK = process.env.AKB_NO_RESTORE !== '1';
const boxPath = (name) => (MOVE_OK ? boxFolder(name) : fs.existsSync(path.join(BOX_DIR, name)) || !fs.existsSync(path.join(STORAGE_DIR, name)) ? path.join(BOX_DIR, name) : path.join(STORAGE_DIR, name));

const config = {
  name: 'AkulavBox',
  author: 'Akulav',
  version: pkg.version,
  appDir: APP_DIR,
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'warn',
  storageDir: STORAGE_DIR,
  // accounts, app access and AkulavBox's own tables
  dbPath: path.join(STORAGE_DIR, 'akulavbox.db'),
  boxDir: BOX_DIR,
  usersDir: boxPath('users'),
  tempDir: path.join(STORAGE_DIR, 'temp'),
  thumbsDir: boxPath('thumbs'),
  backupsDir: path.join(STORAGE_DIR, 'backups'),
  // per-user secrets for link downloads (sign-in cookies), encrypted with MASTER_KEY
  privateDir: boxPath('private'),
  /** The folder of one of the other apps (documents, manga, budget) */
  appDir: (id) => path.join(STORAGE_DIR, id),
  layoutNotes,
  // a restore waiting to be applied on the next start (see core/backup.js)
  importDir: path.join(STORAGE_DIR, 'import-staging'),
  // Days a deleted item stays in the trash before it is removed for good
  trashDays: Math.max(1, Number(process.env.TRASH_DAYS) || 30),
  // Uploads are refused when they would leave less than this much free disk
  diskReserveBytes: Math.max(0, Number(process.env.DISK_RESERVE_MB ?? 512)) * 1024 * 1024,
  tokenTtl: process.env.TOKEN_TTL || '7d',
  trustProxy: process.env.TRUST_PROXY === '1',
  // starting quotas for the other apps (the Admin console changes them per user)
  documentsQuotaBytes: Math.max(1, Number(process.env.DOCUMENTS_QUOTA_MB) || 2048) * 1024 * 1024,
  mangaQuotaBytes: Math.max(1, Number(process.env.MANGA_QUOTA_MB) || 10240) * 1024 * 1024,
  mangaMaxUploadMb: Math.max(1, Number(process.env.MANGA_MAX_UPLOAD_MB) || 1024),
  // public address of the server, e.g. https://cloud.example.com (share links, social previews)
  publicUrl: String(process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  // other origins allowed to call the API from a browser (none by default)
  corsOrigins: String(process.env.CORS_ORIGIN || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean),
};

/** Fail fast with a readable message instead of a crash on the first upload or login */
function validate() {
  const problems = [];
  const warnings = [];
  const key = process.env.MASTER_KEY;
  if (!key) problems.push('MASTER_KEY is not set. Copy .env.example to .env and set a 32-character key.');
  else if (Buffer.byteLength(key, 'utf-8') !== 32) problems.push(`MASTER_KEY must be exactly 32 bytes (it is ${Buffer.byteLength(key, 'utf-8')}).`);
  if (!process.env.JWT_SECRET) problems.push('JWT_SECRET is not set. Use a long random string.');
  else if (process.env.JWT_SECRET === 'change-me' || process.env.JWT_SECRET.length < 16) warnings.push('JWT_SECRET is short or still the example value. Use a long random string.');
  if (key === 'change-me-to-exactly-32-chars!!!') warnings.push('MASTER_KEY is still the example value. Anyone with the example key could decrypt your files.');
  for (const n of layoutNotes) if (!n.startsWith('Moved ')) warnings.push(n);
  if (LEGACY_STORAGE) warnings.push(`Using the old storage folder ${STORAGE_DIR}. Move it to ${path.join(APP_DIR, 'data')} (or set STORAGE_DIR) while the server is stopped.`);
  return { problems, warnings };
}

for (const dir of [config.storageDir, config.usersDir, config.tempDir, config.thumbsDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
// chat was removed in 3.0: its 10-minute attachments have no owner any more
try { fs.rmSync(path.join(STORAGE_DIR, 'chat_temp'), { recursive: true, force: true }); } catch (e) { /* in use or gone */ }

module.exports = { ...config, validate };
