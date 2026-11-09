const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const db = require('./db');
const config = require('./config');
const settings = require('./settings');
const backup = require('./backup');
const activity = require('./activity');

// ---------------------------------------------------------------------------
// Scheduled full backups: daily or weekly at a set hour (server time), written as
// akulavbox-auto-<date>-<time>.akbx into a folder (storage/backups/scheduled unless
// set; another drive is better), keeping the newest `keep`. A missed slot (server
// off at the time) runs once at the next start. A failed run waits for the next slot.
//
// The passphrase is BACKUP_PASSPHRASE from .env when set, otherwise the one saved
// from Admin, sealed with MASTER_KEY in the settings table.
// ---------------------------------------------------------------------------

const KEY = 'backup.schedule', LAST = 'backup.last', LAST_OK = 'backup.last_ok';
const DEFAULTS = { enabled: false, every: 'daily', hour: 3, weekday: 0, keep: 7, dir: null, passphrase: null, saved_at: null };
const defaultDir = path.join(config.backupsDir, 'scheduled');
const NAME_RE = /^akulavbox-auto-\d{8}-\d{6}\.akbx$/;

const state = { running: false, done: 0, total: 0 };
const current = () => ({ ...DEFAULTS, ...settings.get(KEY, {}) });
const passphraseOf = (s) => process.env.BACKUP_PASSPHRASE || settings.open(s.passphrase) || '';
const dirOf = (s) => s.dir || defaultDir;
// server-local time, like the schedule itself, so the 03:00 backup is named …-030000
const stamp = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** The first scheduled time strictly after `after` */
function nextRun(s, after) {
  const d = new Date(after);
  d.setHours(s.hour, 0, 0, 0);
  if (s.every === 'weekly') d.setDate(d.getDate() + ((s.weekday - d.getDay() + 7) % 7));
  while (d <= after) d.setDate(d.getDate() + (s.every === 'weekly' ? 7 : 1));
  return d;
}

/** When the next run is due, or null when the schedule is off */
function dueAt(s = current()) {
  if (!s.enabled) return null;
  // count from the later of the last run and the last change to the schedule
  const from = Math.max(Date.parse(settings.get(LAST)?.at) || 0, Date.parse(s.saved_at) || 0) || Date.now();
  return nextRun(s, new Date(from));
}

/** Delete scheduled backups beyond the newest `keep`, and .part files of runs that died */
function prune(dir, keep) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return 0; }
  let removed = 0;
  for (const n of names.filter(n => NAME_RE.test(n)).sort().reverse().slice(keep)) {
    try { fs.rmSync(path.join(dir, n)); removed++; } catch (e) { /* in use: next time */ }
  }
  for (const n of names.filter(n => /^akulavbox-auto-.+\.part$/.test(n))) {
    const p = path.join(dir, n);
    try { if (!state.running && Date.now() - fs.statSync(p).mtimeMs > 3600e3) fs.rmSync(p); } catch (e) { /* gone */ }
  }
  return removed;
}

/** Make one backup now. `request` is set for a run started from Admin. */
async function run({ request } = {}) {
  if (state.running) throw new Error('A scheduled backup is already running.');
  const s = current();
  const pass = passphraseOf(s);
  const started = new Date();
  const dir = dirOf(s);
  const file = path.join(dir, `akulavbox-auto-${stamp(started)}.akbx`);
  const part = `${file}.part`;
  Object.assign(state, { running: true, done: 0, total: 0 });
  try {
    if (pass.length < 8) throw new Error(s.passphrase ? 'The saved passphrase can’t be read (this server uses another MASTER_KEY). Enter it again.' : 'No passphrase is set for scheduled backups.');
    fs.mkdirSync(dir, { recursive: true });
    const est = backup.estimate(db);
    let free = Infinity;
    try { const st = fs.statfsSync(dir); free = st.bavail * st.bsize; } catch (e) { /* unknown: try anyway */ }
    if (free < est.bytes * 1.1 + 64 * 1024 * 1024) throw new Error(`There isn’t enough free space in ${dir} (about ${Math.round(est.bytes / 1024 ** 2)} MB needed).`);
    state.total = est.bytes;
    await pipeline(backup.exportStream(db, pass, { onProgress: ({ done }) => { state.done = done; } }), fs.createWriteStream(part));
    fs.renameSync(part, file);
    const bytes = fs.statSync(file).size;
    const pruned = prune(dir, s.keep);
    const result = { at: started.toISOString(), ok: true, file, bytes, took_ms: Date.now() - started, pruned, manual: !!request };
    settings.set(LAST, result);
    settings.set(LAST_OK, result);
    const size = bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
    activity.log(request, 'backup.scheduled', { target: path.basename(file), detail: `${size}${pruned ? `, ${pruned} older removed` : ''}${request ? ', started by hand' : ''}` });
    return result;
  } catch (e) {
    try { fs.rmSync(part, { force: true }); } catch (err) { /* never written */ }
    settings.set(LAST, { at: started.toISOString(), ok: false, error: e.message, manual: !!request });
    activity.log(request, 'backup.scheduled_failed', { detail: e.message });
    console.error(`[backup] Scheduled backup failed: ${e.message}`);
    throw e;
  } finally { state.running = false; }
}

function tick() {
  const due = dueAt();
  if (due && !state.running && Date.now() >= due.getTime()) run().catch(() => { /* recorded */ });
}

let timer = null;
/** Server only: checks every minute whether a run is due */
function start() {
  if (timer) return;
  timer = setInterval(tick, 60e3);
  timer.unref();
  setTimeout(tick, 15e3).unref(); // a slot missed while the server was off
}

/** For Admin: everything but the passphrase itself */
function status() {
  const s = current();
  const due = dueAt(s);
  return {
    enabled: s.enabled, every: s.every, hour: s.hour, weekday: s.weekday, keep: s.keep, dir: s.dir, default_dir: defaultDir,
    passphrase_from_env: !!process.env.BACKUP_PASSPHRASE,
    has_passphrase: passphraseOf(s).length >= 8,
    passphrase_unreadable: !!s.passphrase && !settings.open(s.passphrase) && !process.env.BACKUP_PASSPHRASE,
    next_at: due ? due.toISOString() : null,
    last: settings.get(LAST), last_ok: settings.get(LAST_OK),
    running: state.running, done: state.done, total: state.total,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** Validate and save from Admin. Throws user-facing errors. */
function save(input) {
  const s = current();
  const b = input || {};
  const next = { ...s };
  if (b.enabled !== undefined) next.enabled = !!b.enabled;
  if (b.every !== undefined) {
    if (!['daily', 'weekly'].includes(b.every)) throw new Error('Choose daily or weekly.');
    next.every = b.every;
  }
  const int = (v, lo, hi, msg) => { const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(msg); return n; };
  if (b.hour !== undefined) next.hour = int(b.hour, 0, 23, 'The hour must be 0 to 23.');
  if (b.weekday !== undefined) next.weekday = int(b.weekday, 0, 6, 'Choose a day of the week.');
  if (b.keep !== undefined) next.keep = int(b.keep, 1, 100, 'Keep between 1 and 100 backups.');
  if (b.dir !== undefined) {
    const raw = String(b.dir || '').trim();
    if (!raw) next.dir = null;
    else {
      if (!path.isAbsolute(raw)) throw new Error('Use a full folder path, like D:\\Backups or /mnt/backup/akulavbox.');
      const dir = path.resolve(raw);
      const inside = (p) => dir === p || dir.startsWith(p + path.sep);
      if ([config.usersDir, config.importDir, config.tempDir, config.chatDir, config.thumbsDir].some(inside)) throw new Error('Pick a folder outside AkulavBox’s own data folders.');
      try {
        fs.mkdirSync(dir, { recursive: true });
        const probe = path.join(dir, `.akulavbox-write-test-${process.pid}`);
        fs.writeFileSync(probe, 'ok'); fs.rmSync(probe);
      } catch (e) { throw new Error(`AkulavBox can’t write to ${dir} (${e.code || e.message}).`); }
      next.dir = dir;
    }
  }
  if (typeof b.passphrase === 'string' && b.passphrase) {
    if (b.passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
    next.passphrase = settings.seal(b.passphrase);
  }
  if (next.enabled && passphraseOf(next).length < 8) throw new Error('Set a passphrase for scheduled backups first.');
  // turning it on (or changing when) starts counting from now, not from the last run long ago
  if (next.enabled && (!s.enabled || next.every !== s.every || next.hour !== s.hour || next.weekday !== s.weekday)) next.saved_at = new Date().toISOString();
  settings.set(KEY, next);
  return status();
}

module.exports = { start, run, status, save, nextRun, prune, state };
