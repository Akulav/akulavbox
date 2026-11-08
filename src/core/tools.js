const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const config = require('./config');

// ---------------------------------------------------------------------------
// External tools for link downloads, installed by AkulavBox itself into
// storage/tools/ so nothing has to be set up by hand, on Windows or Linux:
//   yt-dlp  official standalone build (github.com/yt-dlp/yt-dlp), kept up to date
//   ffmpeg  static build from github.com/yt-dlp/FFmpeg-Builds (has the AV1 encoder)
// Every download is checked against the SHA-256 list published with the release.
// YTDLP_PATH / FFMPEG_PATH, or copies already on PATH, take precedence.
// AUTO_INSTALL_TOOLS=0 turns the installer off.
// ---------------------------------------------------------------------------

const DIR = path.join(config.storageDir, 'tools');
const EXE = process.platform === 'win32' ? '.exe' : '';
const local = { ytdlp: path.join(DIR, `yt-dlp${EXE}`), ffmpeg: path.join(DIR, `ffmpeg${EXE}`) };
const AUTO = process.env.AUTO_INSTALL_TOOLS !== '0';

const YTDLP_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const FFMPEG_BASE = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/';

function assets() {
  const arm = process.arch === 'arm64';
  if (process.platform === 'win32') return { ytdlp: arm ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe', ffmpeg: arm ? 'ffmpeg-master-latest-winarm64-gpl.zip' : 'ffmpeg-master-latest-win64-gpl.zip' };
  if (process.platform === 'linux') return { ytdlp: arm ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux', ffmpeg: arm ? 'ffmpeg-master-latest-linuxarm64-gpl.tar.xz' : 'ffmpeg-master-latest-linux64-gpl.tar.xz' };
  if (process.platform === 'darwin') return { ytdlp: 'yt-dlp_macos', ffmpeg: null }; // no static ffmpeg build for macOS: use Homebrew's
  return { ytdlp: null, ffmpeg: null };
}

const state = { installing: false, step: '', error: null, lastUpdate: null };

const onPath = (bin, arg) => { try { execFileSync(bin, [arg], { stdio: 'ignore', timeout: 15000 }); return true; } catch (e) { return false; } };

/** Which binaries to use: explicit env path → installed copy → PATH */
function paths() {
  return {
    ytdlp: process.env.YTDLP_PATH || (fs.existsSync(local.ytdlp) ? local.ytdlp : 'yt-dlp'),
    ffmpeg: process.env.FFMPEG_PATH || (fs.existsSync(local.ffmpeg) ? local.ffmpeg : 'ffmpeg'),
  };
}

async function fetchTo(url, dest) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'AkulavBox' } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${path.basename(url)}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
}

async function verify(file, sumsUrl, name) {
  const res = await fetch(sumsUrl, { redirect: 'follow', headers: { 'User-Agent': 'AkulavBox' } });
  if (!res.ok) throw new Error('Couldn’t get the checksum list to verify the download');
  const line = (await res.text()).split('\n').find(l => l.trim().endsWith(` ${name}`) || l.trim().endsWith(`*${name}`));
  if (!line) throw new Error(`No checksum published for ${name}`);
  const want = line.trim().split(/\s+/)[0].toLowerCase();
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  if (hash.digest('hex') !== want) throw new Error(`${name} failed its checksum check, so it wasn’t installed`);
}

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { stdio: 'ignore', windowsHide: true, ...opts });
  p.on('error', reject);
  p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
});

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const hit = findFile(p, name); if (hit) return hit; }
    else if (e.name === name) return p;
  }
  return null;
}

async function installYtdlp(name) {
  state.step = 'Downloading yt-dlp…';
  const tmp = `${local.ytdlp}.download`;
  await fetchTo(YTDLP_BASE + name, tmp);
  state.step = 'Checking yt-dlp…';
  await verify(tmp, YTDLP_BASE + 'SHA2-256SUMS', name);
  fs.renameSync(tmp, local.ytdlp);
  if (process.platform !== 'win32') fs.chmodSync(local.ytdlp, 0o755);
}

async function installFfmpeg(name) {
  state.step = 'Downloading ffmpeg (about 100 MB)…';
  const archive = path.join(DIR, name);
  const work = path.join(DIR, 'ffmpeg-unpack');
  try {
    await fetchTo(FFMPEG_BASE + name, archive);
    state.step = 'Checking ffmpeg…';
    await verify(archive, FFMPEG_BASE + 'checksums.sha256', name);
    state.step = 'Unpacking ffmpeg…';
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    // tar reads .tar.xz on Linux and .zip on Windows 10+ (bsdtar)
    await run('tar', ['-xf', archive, '-C', work]);
    for (const bin of ['ffmpeg', 'ffprobe']) {
      const found = findFile(work, bin + EXE);
      if (!found) { if (bin === 'ffmpeg') throw new Error('ffmpeg wasn’t found inside the download'); continue; }
      const dest = path.join(DIR, bin + EXE);
      fs.copyFileSync(found, dest);
      if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(archive, { force: true });
  }
}

/**
 * Install whatever is missing (in the background at startup). `force` reinstalls
 * both. Returns when done; errors are kept in state.error for the Admin page.
 */
async function ensure({ force = false } = {}) {
  if (state.installing || process.env.DOWNLOADS === 'off') return;
  const a = assets();
  const needYt = !process.env.YTDLP_PATH && a.ytdlp && (force || (!fs.existsSync(local.ytdlp) && !onPath('yt-dlp', '--version')));
  const needFf = !process.env.FFMPEG_PATH && a.ffmpeg && (force || (!fs.existsSync(local.ffmpeg) && !onPath('ffmpeg', '-version')));
  if (!needYt && !needFf) return;
  state.installing = true; state.error = null;
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (needYt) await installYtdlp(a.ytdlp);
    if (needFf) await installFfmpeg(a.ffmpeg);
    state.step = '';
    console.log('[tools] Link-download tools installed in', DIR);
  } catch (e) {
    state.error = e.message;
    console.warn('[tools] Couldn’t install download tools:', e.message);
  } finally { state.installing = false; }
}

/** yt-dlp breaks when sites change, so the installed copy updates itself about once a day */
async function update() {
  if (!fs.existsSync(local.ytdlp) || process.env.YTDLP_PATH || state.installing) return;
  try {
    await run(local.ytdlp, ['-U'], { timeout: 120000 });
    state.lastUpdate = new Date().toISOString();
  } catch (e) { /* keep the current version */ }
}

function start() {
  if (!AUTO) return;
  ensure().then(() => setTimeout(update, 60 * 1000).unref());
  setInterval(update, 24 * 3600 * 1000).unref();
}

module.exports = { paths, ensure, update, start, state, DIR, auto: AUTO, assets };
