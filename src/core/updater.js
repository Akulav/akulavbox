const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const config = require('./config');

// ---------------------------------------------------------------------------
// Updates straight from GitHub. The newest version is whatever package.json says
// on the update branch (default `main`), so every released commit counts and no
// GitHub release or tag is needed.
//
// Two ways to apply it, picked automatically:
//   git      the app folder is a git clone and git works: fetch, then a
//            fast-forward merge. Refused if tracked files were edited by hand.
//   archive  anything else (a copied folder, a zip): download the commit's
//            tarball, back the current code up to data/updates/, copy the new
//            code over. The data folder, .env, node_modules and .git are never touched.
// Then `npm install` runs when dependencies changed. A failure puts the old code
// back. The new code runs after a restart; Roll back undoes the last update.
//
// UPDATES=off turns this off. UPDATE_REPO (owner/name), UPDATE_BRANCH and
// GITHUB_TOKEN (for a private fork) override the defaults.
// ---------------------------------------------------------------------------

const APP_DIR = path.join(__dirname, '..', '..');
const DIR = path.join(config.storageDir, 'updates');
const STATE_FILE = path.join(DIR, 'state.json');
const ENABLED = process.env.UPDATES !== 'off';
const BRANCH = (process.env.UPDATE_BRANCH || 'main').trim();
const TOKEN = (process.env.GITHUB_TOKEN || '').trim();
const GIT = process.env.GIT_PATH || 'git';
// never replaced or deleted by an update (data/ and the older storage/, plus STORAGE_DIR when it sits in the app folder)
const KEEP = new Set(['data', 'storage', 'node_modules', '.git', '.env', 'logs', '.claude']);
const insideApp = path.relative(APP_DIR, config.storageDir);
if (insideApp && !insideApp.startsWith('..') && !path.isAbsolute(insideApp)) KEEP.add(insideApp.split(path.sep)[0]);
// folders that hold only shipped code: files missing from the new version are removed
const CODE_DIRS = ['src', 'frontend', 'scripts', 'docs'];

function repo() {
  const fromEnv = (process.env.UPDATE_REPO || '').trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(fromEnv)) return fromEnv;
  const pkg = require('../../package.json');
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  let m = url && /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url);
  if (m) return m[1];
  try {
    const cfg = fs.readFileSync(path.join(APP_DIR, '.git', 'config'), 'utf-8');
    m = /url\s*=\s*.*github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/m.exec(cfg);
    if (m) return m[1];
  } catch (e) { /* not a clone */ }
  return null;
}

// --- versions ---------------------------------------------------------------
const parse = (v) => String(v || '').replace(/^v/, '').split(/[.+-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
function newer(a, b) { // is a > b
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
/** Does this Node satisfy a simple ">=x.y" engines range? */
function nodeOk(range) {
  const m = /^\s*>=\s*v?(\d+(?:\.\d+){0,2})\s*$/.exec(range || '');
  return !m || !newer(m[1], process.versions.node);
}

/** Changelog sections newer than `since`, from a CHANGELOG.md text */
function notesSince(changelog, since) {
  const parts = String(changelog || '').split(/^## /m).slice(1);
  return parts.map(p => {
    const v = (/^(\d+\.\d+\.\d+)/.exec(p) || [])[1];
    return v && newer(v, since) ? `## ${p.trim()}` : null;
  }).filter(Boolean).join('\n\n').slice(0, 20000);
}

// --- GitHub ---------------------------------------------------------------------
async function gh(url, { raw = false } = {}) {
  const headers = { 'User-Agent': 'AkulavBox-updater', Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (res.status === 404) throw new Error(`GitHub can’t find ${repo()}${TOKEN ? '' : ' (a private repository needs GITHUB_TOKEN)'}.`);
  if (res.status === 403 || res.status === 429) throw new Error('GitHub is rate limiting this server. Try again in an hour.');
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
  return res;
}
const api = (p) => `https://api.github.com/repos/${repo()}${p}`;

// --- state -----------------------------------------------------------------------
const state = { checking: false, applying: false, step: '', error: null, latest: null, checked_at: null, ready: null };
function saved() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); } catch (e) { return {}; } }
function save(s) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { cwd: APP_DIR, timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout, stderr) => {
    if (err) reject(new Error((String(stderr || '').trim().split('\n').pop() || err.message).slice(0, 400)));
    else resolve(String(stdout).trim());
  });
});

let gitOk = null;
async function mode() {
  if (!fs.existsSync(path.join(APP_DIR, '.git'))) return 'archive';
  if (gitOk === null) gitOk = await run(GIT, ['--version']).then(() => true, () => false);
  return gitOk ? 'git' : 'archive';
}

/** Look on GitHub for a newer version. Cached; `force` asks again. */
async function check({ force = false } = {}) {
  if (!ENABLED) throw new Error('Updates are turned off on this server (UPDATES=off).');
  if (!repo()) throw new Error('Set UPDATE_REPO (owner/name) so AkulavBox knows where to look.');
  if (!force && state.latest && Date.now() - Date.parse(state.checked_at) < 30 * 60 * 1000) return info();
  state.checking = true; state.error = null;
  try {
    const commit = await (await gh(api(`/commits/${encodeURIComponent(BRANCH)}`))).json();
    const sha = commit.sha;
    const pkg = JSON.parse(await (await gh(api(`/contents/package.json?ref=${sha}`), { raw: true })).text());
    let changelog = '';
    try { changelog = await (await gh(api(`/contents/CHANGELOG.md?ref=${sha}`), { raw: true })).text(); } catch (e) { /* optional */ }
    state.latest = {
      version: pkg.version, sha, short: sha.slice(0, 7), date: commit.commit?.committer?.date || null,
      message: String(commit.commit?.message || '').split('\n')[0].slice(0, 200),
      node: pkg.engines?.node || null, node_ok: nodeOk(pkg.engines?.node),
      notes: notesSince(changelog, config.version),
    };
    state.checked_at = new Date().toISOString();
    return info();
  } catch (e) { state.error = e.message; throw e; }
  finally { state.checking = false; }
}

function info() {
  const s = saved();
  return {
    enabled: ENABLED, repo: repo(), branch: BRANCH, current: config.version,
    latest: state.latest, available: !!(state.latest && newer(state.latest.version, config.version)),
    checked_at: state.checked_at, checking: state.checking, applying: state.applying, step: state.step, error: state.error,
    ready: state.ready, // updated on disk, waiting for a restart
    rollback: s.previous ? { version: s.previous.version, mode: s.previous.mode, applied_at: s.applied_at } : null,
    mode: gitOk === false || !fs.existsSync(path.join(APP_DIR, '.git')) ? 'archive' : 'git',
  };
}

// --- applying -----------------------------------------------------------------------
const depsOf = (dir) => {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    return JSON.stringify([p.dependencies || {}, p.optionalDependencies || {}]);
  } catch (e) { return ''; }
};

async function npmInstall() {
  state.step = 'Installing dependencies';
  const win = process.platform === 'win32';
  // npm is a .cmd on Windows, which needs a shell; the arguments are fixed
  await run(win ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], win ? { shell: true } : {});
}

/** Every shipped file under dir (relative paths), skipping KEEP at the top level */
function walk(dir, rel = '', out = []) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (!rel && KEEP.has(e.name)) continue;
    if (!rel && e.name.startsWith('.env') && e.name !== '.env.example') continue; // secrets stay as they are
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) walk(dir, r, out);
    else if (e.isFile()) out.push(r);
  }
  return out;
}
function copyTree(from, to, files) {
  for (const f of files) {
    const dest = path.join(to, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(from, f), dest);
  }
}

async function applyGit(target) {
  const head = await run(GIT, ['rev-parse', 'HEAD']);
  const dirty = await run(GIT, ['status', '--porcelain', '--untracked-files=no']);
  // porcelain lines are "XY path"; the output was trimmed, so the first line may have lost its leading space
  if (dirty) throw new Error(`Files in the app folder were changed by hand, so git won’t update over them: ${dirty.split('\n').slice(0, 5).map(l => l.replace(/^\s*\S{1,2}\s+/, '')).join(', ')}. Commit or undo those changes first.`);
  state.step = 'Fetching from GitHub';
  await run(GIT, ['fetch', '--quiet', 'origin', BRANCH]);
  const before = depsOf(APP_DIR);
  state.step = 'Updating the code';
  try { await run(GIT, ['merge', '--ff-only', '--quiet', target.sha]); }
  catch (e) { throw new Error(`This copy has its own commits, so it can’t simply move to the GitHub version (${e.message}).`); }
  return { previous: { mode: 'git', sha: head }, depsChanged: before !== depsOf(APP_DIR) };
}

async function applyArchive(target) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const work = path.join(DIR, `download-${target.short}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  state.step = 'Downloading from GitHub';
  const tgz = path.join(work, 'code.tar.gz');
  const res = await gh(api(`/tarball/${target.sha}`));
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tgz));
  state.step = 'Unpacking';
  await run('tar', ['-xzf', tgz, '-C', work]);
  const top = fs.readdirSync(work, { withFileTypes: true }).find(e => e.isDirectory());
  if (!top) throw new Error('The download from GitHub was empty.');
  const src = path.join(work, top.name);
  const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf-8'));
  if (pkg.version !== target.version) throw new Error('The downloaded code doesn’t match the version GitHub reported. Try again.');

  // back up the current code, then copy the new code over it
  state.step = 'Backing up the current version';
  const backup = path.join(DIR, `backup-${config.version}-${stamp}`);
  const oldFiles = walk(APP_DIR);
  copyTree(APP_DIR, backup, oldFiles);
  fs.writeFileSync(path.join(backup, '.files.json'), JSON.stringify(oldFiles));
  const before = depsOf(APP_DIR);
  state.step = 'Installing the new version';
  const newFiles = walk(src);
  try {
    copyTree(src, APP_DIR, newFiles);
    const keep = new Set(newFiles.map(f => f.split(path.sep).join('/')));
    for (const f of oldFiles) {
      const norm = f.split(path.sep).join('/');
      if (CODE_DIRS.includes(norm.split('/')[0]) && !keep.has(norm)) fs.rmSync(path.join(APP_DIR, f), { force: true });
    }
  } catch (e) {
    restoreBackup(backup);
    throw new Error(`Couldn’t write the new files (${e.message}). The previous version was put back.`);
  }
  fs.rmSync(work, { recursive: true, force: true });
  return { previous: { mode: 'archive', backup }, depsChanged: before !== depsOf(APP_DIR) };
}

function restoreBackup(backup) {
  const files = JSON.parse(fs.readFileSync(path.join(backup, '.files.json'), 'utf-8'));
  const known = new Set(files.map(f => f.split(path.sep).join('/')));
  for (const f of walk(APP_DIR)) {
    const norm = f.split(path.sep).join('/');
    if (CODE_DIRS.includes(norm.split('/')[0]) && !known.has(norm)) fs.rmSync(path.join(APP_DIR, f), { force: true });
  }
  copyTree(backup, APP_DIR, files);
}

/** Download and install the latest version. It runs after the next restart. */
async function apply() {
  if (state.applying) throw new Error('An update is already running.');
  const target = state.latest;
  if (!target || !newer(target.version, config.version)) throw new Error('There is no newer version to install.');
  if (!target.node_ok) throw new Error(`AkulavBox ${target.version} needs Node.js ${target.node}; this server runs ${process.version}. Update Node.js first.`);
  state.applying = true; state.error = null; state.ready = null;
  try {
    const m = await mode();
    const { previous, depsChanged } = m === 'git' ? await applyGit(target) : await applyArchive(target);
    previous.version = config.version;
    try { if (depsChanged || !fs.existsSync(path.join(APP_DIR, 'node_modules'))) await npmInstall(); }
    catch (e) {
      await undo(previous).catch(() => {});
      throw new Error(`npm install failed (${e.message}). The previous version was put back.`);
    }
    save({ previous, applied_at: new Date().toISOString(), version: target.version });
    state.ready = { version: target.version, mode: m };
    state.step = '';
    return info();
  } catch (e) { state.error = e.message; state.step = ''; throw e; }
  finally { state.applying = false; }
}

async function undo(previous) {
  if (previous.mode === 'git') await run(GIT, ['reset', '--hard', '--quiet', previous.sha]);
  else restoreBackup(previous.backup);
}

/** Put the code from before the last update back (runs after a restart) */
async function rollback() {
  if (state.applying) throw new Error('An update is running.');
  const s = saved();
  if (!s.previous) throw new Error('There is no earlier version to go back to.');
  state.applying = true; state.error = null;
  try {
    const before = depsOf(APP_DIR);
    state.step = 'Restoring the previous version';
    await undo(s.previous);
    if (before !== depsOf(APP_DIR)) await npmInstall();
    save({});
    state.ready = { version: s.previous.version, mode: s.previous.mode, rollback: true };
    state.step = '';
    return info();
  } catch (e) { state.error = e.message; state.step = ''; throw e; }
  finally { state.applying = false; }
}

/** Look for updates now and then, so admins see them without asking */
function start() {
  if (!ENABLED || !repo()) return;
  const tick = () => check({ force: true }).catch(() => {});
  setTimeout(tick, 60 * 1000).unref();
  setInterval(tick, 6 * 60 * 60 * 1000).unref();
}

module.exports = { check, apply, rollback, info, start, newer, notesSince, nodeOk, repo, ENABLED };
