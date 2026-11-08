const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const db = require('./db');
const config = require('./config');
const lib = require('./library');
const store = require('./storage');
const thumbs = require('./thumbs');
const col = require('./collections');
const { guessMime } = require('./mime');

// ---------------------------------------------------------------------------
// Link downloads (YouTube, Vimeo, SoundCloud, … anything yt-dlp supports).
// Jobs live in the `downloads` table so they survive restarts. Each job:
//   queued → probing (read the link's details) → downloading → processing → done | error | cancelled
// A playlist or channel link turns into one job per entry. Finished media is
// encrypted into the Videos or Music folder, gets its title, creator, date,
// length and cover, and is filed by creator: a video collection or a playlist
// named after the channel / artist.
//
// Needs yt-dlp (YTDLP_PATH or on PATH). ffmpeg (FFMPEG_PATH or on PATH) is
// optional: with it you get HD video and m4a audio; without it, single-file formats.
// ---------------------------------------------------------------------------

const installer = require('./tools');

const PARALLEL = Math.max(1, Number(process.env.DOWNLOAD_PARALLEL) || 2);
// AV1 is roughly half the size of H.264 at the same quality; VIDEO_AV1=off keeps whatever the site serves
const AV1 = process.env.VIDEO_AV1 !== 'off';
const PLAYLIST_MAX = Math.max(1, Number(process.env.DOWNLOAD_PLAYLIST_MAX) || 200);
const ENABLED = process.env.DOWNLOADS !== 'off';

// --- tools -----------------------------------------------------------------
// A YTDLP_PATH ending in .js runs with Node (used by the self-test's stand-in).
function command(bin) {
  return /\.(c?js|mjs)$/i.test(bin) ? [process.execPath, [bin]] : [bin, []];
}
function probeTool(bin, args) {
  try {
    const [cmd, pre] = command(bin);
    return execFileSync(cmd, [...pre, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).split('\n')[0].trim();
  } catch (e) { return null; }
}
let tools = null;
function detect(force = false) {
  if (tools && !force) return tools;
  const { ytdlp, ffmpeg } = installer.paths();
  const ytVersion = probeTool(ytdlp, ['--version']);
  const ffVersion = probeTool(ffmpeg, ['-version']);
  let av1 = null;
  if (ffVersion) {
    try {
      const enc = execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 });
      av1 = /libsvtav1/.test(enc) ? 'libsvtav1' : /libaom-av1/.test(enc) ? 'libaom-av1' : null;
    } catch (e) { /* no encoder list */ }
  }
  const ffprobe = /ffmpeg(\.exe)?$/i.test(ffmpeg) ? ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m, x) => `ffprobe${x || ''}`) : 'ffprobe';
  tools = { ytdlp, ffmpeg, ffprobe, ytVersion, ffVersion: ffVersion ? ffVersion.replace(/^ffmpeg version\s*/, '').split(' ')[0] : null, av1 };
  return tools;
}
const status = () => {
  const t = detect();
  const s = installer.state;
  return { enabled: ENABLED, available: ENABLED && !!t.ytVersion, ytdlp: t.ytVersion, ffmpeg: t.ffVersion, av1: AV1 && !!t.av1,
    installing: s.installing, step: s.step, error: s.error, autoInstall: installer.auto };
};

// --- link checks ------------------------------------------------------------
// Only public http(s) links: no local files, and no addresses inside the server's own network.
const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^::1$/, /^f[cd]/i, /^fe80/i];
function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (e) { return 'That doesn’t look like a link.'; }
  if (!['http:', 'https:'].includes(u.protocol)) return 'Only http and https links can be downloaded.';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return 'Links to this server’s own network can’t be downloaded.';
  if (net.isIP(host) && PRIVATE.some(re => re.test(host))) return 'Links to this server’s own network can’t be downloaded.';
  return null;
}

// --- jobs --------------------------------------------------------------------
const COLS = 'id, url, kind, status, progress, title, creator, file_id, error, speed, created_at, updated_at';
const update = (id, fields) => {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE downloads SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map(k => fields[k]), id);
};
const getJob = (id) => db.prepare('SELECT * FROM downloads WHERE id = ?').get(id);

function addJob(ownerId, url, kind, title = null) {
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO downloads (id, owner_id, url, kind, status, progress, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'queued', 0, ?, datetime('now'), datetime('now'))`).run(id, ownerId, url, kind, title);
  return id;
}

function listJobs(ownerId, kind) {
  return kind
    ? db.prepare(`SELECT ${COLS} FROM downloads WHERE owner_id = ? AND kind = ? ORDER BY created_at DESC, rowid DESC LIMIT 60`).all(ownerId, kind)
    : db.prepare(`SELECT ${COLS} FROM downloads WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 60`).all(ownerId);
}

const running = new Map(); // job id -> child process
let active = 0;

function pump() {
  if (!status().available) return;
  while (active < PARALLEL) {
    const next = db.prepare("SELECT id FROM downloads WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1").get();
    if (!next) return;
    update(next.id, { status: 'probing' }); // claim it before the async work starts
    active++;
    run(next.id).catch((e) => { if (!e.cancelled && getJob(next.id)?.status !== 'cancelled') update(next.id, { status: 'error', error: String(e.message || e).slice(0, 500) }); })
      .finally(() => { active--; running.delete(next.id); setImmediate(pump); });
  }
}

function cancel(id, ownerId) {
  const job = db.prepare('SELECT * FROM downloads WHERE id = ? AND owner_id = ?').get(id, ownerId);
  if (!job) return false;
  if (['queued', 'probing', 'downloading', 'converting', 'processing'].includes(job.status)) {
    update(id, { status: 'cancelled', error: null });
    const child = running.get(id);
    if (child) child.kill();
  } else {
    db.prepare('DELETE FROM downloads WHERE id = ?').run(id);
  }
  return true;
}

function clearFinished(ownerId) {
  return db.prepare("DELETE FROM downloads WHERE owner_id = ? AND status IN ('done', 'error', 'cancelled', 'expanded')").run(ownerId).changes;
}

// --- running yt-dlp -------------------------------------------------------------
function ytdlp(jobId, args, onLine) {
  const t = detect();
  const [cmd, pre] = command(t.ytdlp);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...pre, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    running.set(jobId, child);
    let out = '', err = '', buf = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      if (!onLine) { out += s; return; }
      buf += s;
      let i;
      while ((i = buf.indexOf('\n')) !== -1) { onLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
    });
    child.stderr.on('data', (d) => { err = (err + d.toString()).slice(-4000); });
    child.on('error', (e) => reject(new Error(`Couldn’t run yt-dlp: ${e.message}`)));
    child.on('close', (code) => {
      if (getJob(jobId)?.status === 'cancelled') return reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
      if (code === 0) return resolve(out);
      const last = err.split('\n').map(l => l.trim()).filter(Boolean).reverse().find(l => /ERROR/.test(l)) || err.trim().split('\n').pop() || `yt-dlp exited with ${code}`;
      reject(new Error(last.replace(/^ERROR:\s*/, '').replace(/^\[[^\]]+\]\s*/, '').slice(0, 400)));
    });
  });
}

const cleanTitle = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Download';
const isoDate = (d) => (/^\d{8}$/.test(String(d || '')) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null);

function creatorOf(info, kind) {
  const c = kind === 'audio'
    ? (info.artist || info.creator || info.uploader || info.channel)
    : (info.channel || info.uploader || info.creator || info.artist);
  return String(c || 'Unknown').split(',')[0].trim().slice(0, 120) || 'Unknown';
}

async function run(id) {
  const job = getJob(id);
  const kind = job.kind === 'audio' ? 'audio' : 'video';
  const ownerId = job.owner_id;
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(ownerId)) { db.prepare('DELETE FROM downloads WHERE id = ?').run(id); return; }

  // 1. read the link's details (playlists only list their entries)
  const info = JSON.parse(await ytdlp(id, ['-J', '--flat-playlist', '--no-warnings', '--', job.url]));
  if (info._type === 'playlist' || Array.isArray(info.entries)) {
    const entries = (info.entries || []).filter(Boolean).slice(0, PLAYLIST_MAX);
    db.tx(() => {
      for (const e of entries) {
        const url = e.webpage_url || (/^https?:/.test(e.url || '') ? e.url : null) || (e.ie_key === 'Youtube' && e.id ? `https://www.youtube.com/watch?v=${e.id}` : null);
        if (url) addJob(ownerId, url, kind, e.title || null);
      }
    });
    update(id, { status: 'expanded', progress: 1, title: `${info.title || 'Playlist'} (${entries.length} item${entries.length === 1 ? '' : 's'})`, creator: creatorOf(info, kind) });
    return;
  }

  const title = cleanTitle(kind === 'audio' ? (info.track || info.title) : info.title);
  const creator = creatorOf(info, kind);
  const sourceId = `${info.extractor_key || info.extractor || 'web'}:${info.id || job.url}`;
  update(id, { title, creator, status: 'downloading' });

  // already have it? link the existing copy instead of downloading again
  const existing = db.prepare(`SELECT f.id FROM media_meta m JOIN files f ON f.id = m.file_id
    WHERE m.owner_id = ? AND m.source_id = ? AND f.trashed_at IS NULL LIMIT 1`).get(ownerId, sourceId);
  if (existing) { update(id, { status: 'done', progress: 1, file_id: existing.id, error: 'Already in your library' }); return; }

  const u = db.prepare('SELECT quota_bytes, used_bytes FROM users WHERE id = ?').get(ownerId);
  const left = u.quota_bytes - u.used_bytes;
  const approx = info.filesize || info.filesize_approx || 0;
  if (approx && approx > left) throw new Error('Not enough storage left for this download');

  // 2. download into a private work folder
  const work = path.join(config.tempDir, `dl-${id}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  try {
    const t = detect();
    const ff = !!t.ffVersion;
    const args = ['--no-playlist', '--no-warnings', '--newline', '--no-mtime', '--no-part',
      '-o', path.join(work, 'media.%(ext)s'), '-o', `thumbnail:${path.join(work, 'thumb.%(ext)s')}`, '--write-thumbnail',
      '--max-filesize', String(Math.max(1, left)),
      '--progress-template', 'download:AKP %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s'];
    if (ff) args.push('--ffmpeg-location', t.ffmpeg, '--convert-thumbnails', 'jpg');
    // with ffmpeg: an AV1 stream when the site has one (YouTube usually does), up to 1080p
    const VIDEO_FORMAT = (AV1 ? 'bv*[vcodec^=av01][height<=1080]+ba[ext=m4a]/bv*[vcodec^=av01][height<=1080]+ba/' : '')
      + 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*[height<=1080]+ba/b';
    if (kind === 'video') args.push(...(ff ? ['-f', VIDEO_FORMAT, '--merge-output-format', 'mp4'] : ['-f', 'b[ext=mp4]/b']));
    else args.push(...(ff ? ['-x', '--audio-format', 'm4a', '--audio-quality', '0'] : ['-f', 'ba[ext=m4a]/ba[ext=mp3]/ba']));
    args.push('--', job.url);

    let lastWrite = 0;
    await ytdlp(id, args, (line) => {
      const m = /^AKP (\S+) (\S+) (\S+) (\S+)/.exec(line);
      if (!m) return;
      const done = Number(m[1]) || 0, total = Number(m[2]) || Number(m[3]) || 0;
      if (Date.now() - lastWrite < 700) return; // don't hammer the database
      lastWrite = Date.now();
      update(id, { progress: total ? Math.min(0.99, done / total) : 0, speed: Number(m[4]) || null });
    });

    // 3. store it
    update(id, { status: 'processing', progress: 0.99, speed: null });
    const files = fs.readdirSync(work).map(n => ({ n, p: path.join(work, n), s: fs.statSync(path.join(work, n)).size }));
    const media = files.filter(f => f.n.startsWith('media.')).sort((a, b) => b.s - a.s)[0];
    if (!media) throw new Error('The download didn’t produce a file (it may be larger than your free space)');
    if (kind === 'video' && AV1 && t.av1) {
      const smaller = await toAv1(id, media.p, Number(info.duration) || 0);
      if (getJob(id)?.status === 'cancelled') throw Object.assign(new Error('Cancelled'), { cancelled: true });
      if (smaller) { media.p = smaller; media.n = path.basename(smaller); }
      update(id, { status: 'processing', progress: 0.99 });
    }
    const ext = path.extname(media.n).slice(1).toLowerCase();
    const filename = `${title}.${ext}`;
    const key = kind === 'video' ? 'videos' : 'music';
    const folderId = lib.ensureSystemFolder(ownerId, key);
    const file = await store.storeFile({ ownerId, folderId, srcPath: media.p, filename, mime: guessMime(filename) });

    // cover image next to what it belongs to
    let coverId = null;
    const thumb = files.find(f => f.n.startsWith('thumb.') && f.s > 0);
    if (thumb) {
      try {
        const coverName = `${title} cover${path.extname(thumb.n).toLowerCase() || '.jpg'}`;
        const cover = await store.storeFile({ ownerId, folderId: lib.ensureSystemFolder(ownerId, kind === 'video' ? 'video_covers' : 'music_art'), srcPath: thumb.p, filename: coverName, mime: guessMime(coverName) });
        coverId = cover.id;
        thumbs.warm(cover, store.diskPathOf(cover), store.MASTER_KEY);
      } catch (e) { /* a missing cover is fine */ }
    }

    // 4. details + filing by creator
    const tags = (Array.isArray(info.tags) ? info.tags : []).map(t => String(t).trim().slice(0, 80)).filter(Boolean).slice(0, 6);
    const date = kind === 'audio' ? (info.release_year ? String(info.release_year) : isoDate(info.upload_date)) : isoDate(info.upload_date);
    db.prepare(`INSERT INTO media_meta (file_id, owner_id, title, participants, tags, details, date, series, duration, thumb_file_id, source_url, source_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).run(
      file.id, ownerId, title, JSON.stringify([creator]), JSON.stringify(tags),
      info.description ? String(info.description).slice(0, 4000) : null, date,
      kind === 'audio' ? (info.album ? String(info.album).slice(0, 300) : null) : null,
      Number(info.duration) > 0 ? Number(info.duration) : null,
      kind === 'video' ? coverId : null, info.webpage_url || job.url, sourceId);
    if (kind === 'video') col.addToCollection(col.collectionByTitle(ownerId, 'videos', creator), ownerId, [file.id]);
    else {
      if (coverId) db.prepare('INSERT OR REPLACE INTO song_covers (file_id, cover_file_id) VALUES (?, ?)').run(file.id, coverId);
      col.addToPlaylist(col.playlistByTitle(ownerId, creator), file.id);
    }
    update(id, { status: 'done', progress: 1, file_id: file.id, error: null });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// --- AV1 conversion ---------------------------------------------------------------
const execText = (bin, args) => { try { return execFileSync(bin, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 }).trim(); } catch (e) { return ''; } };
let encodeChain = Promise.resolve(); // one encode at a time: AV1 encoding uses every CPU core

/**
 * Re-encode a video to AV1 (audio is copied). Returns the new file's path when it
 * came out smaller, otherwise null and the original is kept. Already-AV1 files are skipped.
 */
function toAv1(jobId, src, duration) {
  const t = detect();
  const codec = execText(t.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', src]);
  if (!codec || codec === 'av1') return Promise.resolve(null);
  const out = path.join(path.dirname(src), 'av1.mp4');
  const encoder = t.av1 === 'libsvtav1'
    ? ['-c:v', 'libsvtav1', '-preset', '8', '-crf', '35', '-g', '240']
    : ['-c:v', 'libaom-av1', '-crf', '34', '-b:v', '0', '-cpu-used', '8', '-row-mt', '1'];
  const job = encodeChain.then(() => new Promise((resolve) => {
    if (getJob(jobId)?.status === 'cancelled') return resolve(null);
    update(jobId, { status: 'converting', progress: 0, speed: null });
    const child = spawn(t.ffmpeg, ['-hide_banner', '-nostats', '-y', '-i', src, '-map', '0:v:0', '-map', '0:a?', ...encoder, '-pix_fmt', 'yuv420p',
      '-c:a', 'copy', '-movflags', '+faststart', '-progress', 'pipe:1', out], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    running.set(jobId, child);
    let buf = '', last = 0;
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/out_time_us=(\d+)/g);
      buf = buf.slice(-200);
      if (!m || !duration || Date.now() - last < 1000) return;
      last = Date.now();
      const secs = Number(m[m.length - 1].split('=')[1]) / 1e6;
      update(jobId, { progress: Math.min(0.99, secs / duration) });
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(out)) return resolve(null);
      // only worth keeping when it actually saves space
      resolve(fs.statSync(out).size < fs.statSync(src).size ? out : null);
    });
  }));
  encodeChain = job.catch(() => {});
  return job;
}

// Jobs that were running when the server stopped start over
function resume() {
  db.prepare("UPDATE downloads SET status = 'queued', progress = 0, speed = NULL WHERE status IN ('probing', 'downloading', 'converting', 'processing')").run();
  try { for (const n of fs.readdirSync(config.tempDir)) if (n.startsWith('dl-')) fs.rmSync(path.join(config.tempDir, n), { recursive: true, force: true }); } catch (e) { /* ignore */ }
  pump();
}

module.exports = { status, detect, checkUrl, addJob, listJobs, cancel, clearFinished, pump, resume, toAv1, PLAYLIST_MAX };
