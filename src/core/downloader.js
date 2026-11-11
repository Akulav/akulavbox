const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { pipeline } = require('stream/promises');
const db = require('./db');
const config = require('./config');
const lib = require('./library');
const store = require('./storage');
const thumbs = require('./thumbs');
const col = require('./collections');
const cookies = require('./cookies');
const installer = require('./tools');
const { guessMime } = require('./mime');

// ---------------------------------------------------------------------------
// Link downloads (YouTube, Vimeo, SoundCloud, … anything yt-dlp supports) and
// video-to-song conversions. Jobs live in the `downloads` table so they survive
// restarts. Each job:
//   queued → probing → downloading → converting (AV1) → processing → done | error | cancelled
// A playlist or channel link turns into one job per entry. Finished media is
// encrypted into the Videos or Music folder, gets its title, creator, date,
// length and cover. Nothing is filed into a collection or playlist: Videos →
// Creators and Music → Artists already group by channel / artist.
//
// A conversion job has the url `akulavbox:video/<fileId>`: it takes the audio
// out of a video already in the library and saves it to Music with the same details.
// ---------------------------------------------------------------------------

const PARALLEL = Math.max(1, Number(process.env.DOWNLOAD_PARALLEL) || 3);
// finished downloads allowed to wait for the AV1 encoder (each one sits on disk meanwhile)
const ENCODE_BACKLOG = Math.max(1, Number(process.env.ENCODE_BACKLOG) || 4);
// a tool that prints nothing for this long is stuck (a dead connection) and is stopped
const STALL_MS = Math.max(5, Number(process.env.DOWNLOAD_STALL_SECONDS) || 180) * 1000;
// AV1 is roughly half the size of H.264 at the same quality; VIDEO_AV1=off keeps whatever the site serves
const AV1 = process.env.VIDEO_AV1 !== 'off';
const PLAYLIST_MAX = Math.max(1, Number(process.env.DOWNLOAD_PLAYLIST_MAX) || 200);
const ENABLED = process.env.DOWNLOADS !== 'off';
const PROXY = (process.env.DOWNLOAD_PROXY || '').trim();
const CONVERT_RE = /^akulavbox:video\/([\w-]{1,64})$/;

// Job kinds: what is downloaded, and which locked folders it lands in.
// 'xxx' is a video kept in the opt-in XXX section instead of Videos.
const KINDS = {
  video: { media: 'video', folder: 'videos', covers: 'video_covers' },
  xxx:   { media: 'video', folder: 'xxx',    covers: 'xxx_covers' },
  audio: { media: 'audio', folder: 'music',  covers: 'music_art' },
};
const kindOf = (k) => KINDS[k] || KINDS.video;
// akulavbox:trim/<fileId>?s=<start>&e=<end>&exact=0|1&copy=0|1
const TRIM_RE = /^akulavbox:trim\/([\w-]{1,64})\?(s=[\d.]+&e=[\d.]+&exact=[01]&copy=[01])$/;
// akulavbox:av1/<fileId>: re-encode a video already in the library to AV1, in place
const AV1_RE = /^akulavbox:av1\/([\w-]{1,64})$/;

// --- tools -----------------------------------------------------------------
// A YTDLP_PATH ending in .js runs with Node (used by the self-test's stand-in).
const command = (bin) => (/\.(c?js|mjs)$/i.test(bin) ? [process.execPath, [bin]] : [bin, []]);
function execText(bin, args, timeout = 15000) {
  try {
    const [cmd, pre] = command(bin);
    return execFileSync(cmd, [...pre, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout, windowsHide: true }).trim();
  } catch (e) { return ''; }
}

let tools = null;
function detect(force = false) {
  if (tools && !force) return tools;
  const { ytdlp, ffmpeg } = installer.paths();
  const ytVersion = execText(ytdlp, ['--version']).split('\n')[0] || null;
  // yt-dlp 2025.11+ can use Node as its JavaScript runtime; older builds don't know the option
  const jsRuntime = !!ytVersion && execText(ytdlp, ['--help'], 30000).includes('--js-runtimes');
  const ffVersion = execText(ffmpeg, ['-version']).split('\n')[0] || null;
  let av1 = null;
  if (ffVersion) {
    const enc = execText(ffmpeg, ['-hide_banner', '-encoders']);
    av1 = /libsvtav1/.test(enc) ? 'libsvtav1' : /libaom-av1/.test(enc) ? 'libaom-av1' : null;
  }
  // ffprobe sits next to ffmpeg (a .js stand-in answers for both)
  const ffprobe = /\.(c?js|mjs)$/i.test(ffmpeg) ? ffmpeg : /ffmpeg(\.exe)?$/i.test(ffmpeg) ? ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m, x) => `ffprobe${x || ''}`) : 'ffprobe';
  tools = { ytdlp, ffmpeg, ffprobe, ytVersion, jsRuntime, ffVersion: ffVersion ? ffVersion.replace(/^ffmpeg version\s*/, '').split(' ')[0] : null, av1 };
  return tools;
}
const status = () => {
  const t = detect();
  const s = installer.state;
  return { enabled: ENABLED, available: ENABLED && !!t.ytVersion, ytdlp: t.ytVersion, ffmpeg: t.ffVersion, av1: AV1 && !!t.av1,
    // "Convert to AV1" on a library video only needs the encoder (VIDEO_AV1=off is about downloads)
    convert: ENABLED && !!t.ffVersion, encode_av1: ENABLED && !!t.av1, installing: s.installing, step: s.step, error: s.error, autoInstall: installer.auto };
};

// --- link checks ------------------------------------------------------------
// Only public http(s) links: no local files, and no addresses inside the server's own network.
const PRIVATE = new net.BlockList();
for (const [a, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) PRIVATE.addSubnet(a, bits, 'ipv4');
for (const [a, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) PRIVATE.addSubnet(a, bits, 'ipv6');
function isPrivateIp(ip) {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip); // IPv4-mapped IPv6 (::ffff:127.0.0.1)
  if (v4) ip = v4[1];
  const family = net.isIP(ip);
  return !!family && PRIVATE.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}
const LOCAL_LINK = 'Links to this server’s own network can’t be downloaded.';

function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (e) { return 'That doesn’t look like a link.'; }
  if (!['http:', 'https:'].includes(u.protocol)) return 'Only http and https links can be downloaded.';
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return LOCAL_LINK;
  if (net.isIP(host) && isPrivateIp(host)) return LOCAL_LINK;
  return null;
}

/**
 * checkUrl plus DNS: a public-looking name that points into the server's own network
 * (127.0.0.1.nip.io, a LAN router's name) is refused too. Redirects made later by the
 * site itself aren't covered, so DOWNLOAD_PROXY is the way to isolate yt-dlp completely.
 */
async function checkLink(raw) {
  const problem = checkUrl(raw);
  if (problem) return problem;
  const host = new URL(String(raw).trim()).hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) || PROXY) return null; // with a proxy, the proxy resolves names
  try {
    const addrs = await require('dns').promises.lookup(host, { all: true, verbatim: true });
    if (addrs.some(a => isPrivateIp(a.address))) return LOCAL_LINK;
  } catch (e) { /* unknown name: yt-dlp reports it with a clearer message */ }
  return null;
}

// --- jobs --------------------------------------------------------------------
// 'encode_wait': downloaded, waiting for its turn at the AV1 encoder (no download slot held)
const ACTIVE = ['queued', 'probing', 'downloading', 'encode_wait', 'converting', 'processing'];
const ACTIVE_SQL = ACTIVE.map(s => `'${s}'`).join(', ');
const COLS = 'id, url, kind, status, progress, title, creator, file_id, error, speed, created_at, updated_at';
const update = (id, fields) => {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE downloads SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map(k => fields[k]), id);
};
const getJob = (id) => db.prepare('SELECT * FROM downloads WHERE id = ?').get(id);
const cancelled = () => Object.assign(new Error('Cancelled'), { cancelled: true });
const throwIfCancelled = (id) => { if (getJob(id)?.status === 'cancelled') throw cancelled(); };

function addJob(ownerId, url, kind, title = null) {
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO downloads (id, owner_id, url, kind, status, progress, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'queued', 0, ?, datetime('now'), datetime('now'))`).run(id, ownerId, url, kind, title);
  return id;
}

/** Queue "save as song" for videos the user owns; returns the new job ids */
function addConversions(ownerId, fileIds) {
  const videos = lib.ensureSystemFolder(ownerId, 'videos');
  const get = db.prepare(`SELECT f.id, f.filename, m.title FROM files f LEFT JOIN media_meta m ON m.file_id = f.id
    WHERE f.id = ? AND f.owner_id = ? AND f.folder_id = ? AND f.trashed_at IS NULL`);
  const ids = [];
  db.tx(() => {
    for (const fid of [...new Set(fileIds)].slice(0, 500)) {
      const v = get.get(fid, ownerId, videos);
      if (v) ids.push(addJob(ownerId, `akulavbox:video/${v.id}`, 'audio', v.title || v.filename.replace(/\.[^.]+$/, '')));
    }
  });
  return ids;
}

/**
 * Queue a trim of one of my videos or songs: keep start..end (seconds). `exact`
 * re-encodes so the cut lands exactly; otherwise it cuts at the nearest keyframe
 * before `start` (for audio, within a fraction of a second), instant and lossless.
 * `copy` keeps the original and saves a new item. Returns { id } or { error }.
 */
function addTrim(ownerId, fileId, { start, end, exact, copy }) {
  const s = Math.max(0, Number(start) || 0), e = Number(end);
  if (!(e > s + 0.2)) return { error: 'Choose an end after the start (at least a fraction of a second).' };
  const sections = { ...videoSections(ownerId), [lib.ensureSystemFolder(ownerId, 'music')]: 'audio' };
  const v = db.prepare(`SELECT f.id, f.filename, f.folder_id, m.title, m.duration FROM files f LEFT JOIN media_meta m ON m.file_id = f.id
    WHERE f.id = ? AND f.owner_id = ? AND f.trashed_at IS NULL`).get(String(fileId), ownerId);
  const kind = v && sections[v.folder_id];
  if (!kind) return { error: 'That video or song is no longer in your library.' };
  if (v.duration && s >= v.duration) return { error: `The start is after the end of the ${kind === 'audio' ? 'song' : 'video'}.` };
  const url = `akulavbox:trim/${v.id}?s=${s.toFixed(3)}&e=${e.toFixed(3)}&exact=${exact ? 1 : 0}&copy=${copy ? 1 : 0}`;
  return { id: addJob(ownerId, url, kind, v.title || v.filename.replace(/\.[^.]+$/, '')) };
}

/** My video sections: folder id -> job kind (the XXX folder only once the section was used) */
function videoSections(ownerId) {
  const out = { [lib.ensureSystemFolder(ownerId, 'videos')]: 'video' };
  const xxx = db.prepare("SELECT id FROM folders WHERE owner_id = ? AND system_key = 'xxx'").get(ownerId);
  if (xxx) out[xxx.id] = 'xxx';
  return out;
}

/**
 * Queue "convert to AV1" for videos the user owns. Videos already known to be AV1,
 * and ones already waiting for a conversion, are skipped. Returns { ids, skipped }.
 */
function addAv1(ownerId, fileIds) {
  const sections = videoSections(ownerId);
  const get = db.prepare(`SELECT f.id, f.filename, f.folder_id, m.title, m.video_codec FROM files f LEFT JOIN media_meta m ON m.file_id = f.id
    WHERE f.id = ? AND f.owner_id = ? AND f.trashed_at IS NULL`);
  const queued = db.prepare(`SELECT 1 FROM downloads WHERE owner_id = ? AND url = ? AND status IN (${ACTIVE_SQL})`);
  const ids = [];
  let skipped = 0;
  db.tx(() => {
    for (const fid of [...new Set(fileIds)].filter(x => typeof x === 'string').slice(0, 500)) {
      const v = get.get(fid, ownerId);
      const kind = v && sections[v.folder_id];
      if (!kind) continue;
      const url = `akulavbox:av1/${v.id}`;
      if (v.video_codec === 'av1' || queued.get(ownerId, url)) { skipped++; continue; }
      ids.push(addJob(ownerId, url, kind, v.title || v.filename.replace(/\.[^.]+$/, '')));
    }
  });
  return { ids, skipped };
}

/** Re-queue an internal job (a retry from the downloads list) after checking ownership */
function addInternal(ownerId, url) {
  let m;
  if ((m = CONVERT_RE.exec(url))) return addConversions(ownerId, [m[1]])[0] || null;
  if ((m = AV1_RE.exec(url))) return addAv1(ownerId, [m[1]]).ids[0] || null;
  if ((m = TRIM_RE.exec(url))) {
    const q = new URLSearchParams(m[2]);
    const r = addTrim(ownerId, m[1], { start: q.get('s'), end: q.get('e'), exact: q.get('exact') === '1', copy: q.get('copy') === '1' });
    return r.id || null;
  }
  return null;
}
const isInternal = (url) => CONVERT_RE.test(url) || TRIM_RE.test(url) || AV1_RE.test(url);

/** Every unfinished job (a long playlist must not be cut off) plus the 60 most recent finished ones */
function listJobs(ownerId, kind) {
  const k = kind ? 'AND kind = ?' : '';
  const args = kind ? [ownerId, kind] : [ownerId];
  const open = db.prepare(`SELECT ${COLS}, rowid AS _r FROM downloads WHERE owner_id = ? ${k} AND status IN (${ACTIVE_SQL}) LIMIT 2000`).all(...args);
  const done = db.prepare(`SELECT ${COLS}, rowid AS _r FROM downloads WHERE owner_id = ? ${k} AND status NOT IN (${ACTIVE_SQL}) ORDER BY created_at DESC, rowid DESC LIMIT 60`).all(...args);
  return [...open, ...done]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b._r - a._r)
    .map(({ _r, ...j }) => j);
}

const running = new Map(); // job id -> child process
// Jobs holding one of the PARALLEL download slots. A job gives its slot back while it
// waits for the (one-at-a-time) AV1 encoder, so downloads keep flowing meanwhile.
const slots = new Set();
function releaseSlot(id) { if (slots.delete(id)) setImmediate(pump); }

function pump() {
  const s = status();
  if (!s.available && !s.convert) return;
  while (slots.size < PARALLEL) {
    // without yt-dlp (still installing) only conversions can run
    const next = db.prepare(`SELECT id FROM downloads WHERE status = 'queued' ${s.available ? '' : "AND url LIKE 'akulavbox:%'"} ORDER BY created_at, rowid LIMIT 1`).get();
    if (!next) return;
    update(next.id, { status: 'probing' }); // claim it before the async work starts
    slots.add(next.id);
    run(next.id)
      .catch((e) => { if (!e.cancelled && getJob(next.id)?.status !== 'cancelled') update(next.id, { status: 'error', speed: null, error: String(e.message || e).slice(0, 500) }); })
      .finally(() => { running.delete(next.id); releaseSlot(next.id); setImmediate(pump); });
  }
}

function cancel(id, ownerId) {
  const job = db.prepare('SELECT * FROM downloads WHERE id = ? AND owner_id = ?').get(id, ownerId);
  if (!job) return false;
  if (ACTIVE.includes(job.status)) {
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

// --- running tools -------------------------------------------------------------
/** Spawn a tool for a job; resolves with stdout (or streams lines to onLine), rejects with the last error line */
function spawnFor(jobId, bin, args, { onLine, name, stallMs = 0 } = {}) {
  const [cmd, pre] = command(bin);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...pre, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    running.set(jobId, child);
    let out = '', err = '', buf = '';
    // watchdog: no output at all for stallMs means a dead connection, not slow progress
    let stalled = false, timer = null;
    const alive = () => {
      if (!stallMs) return;
      clearTimeout(timer);
      timer = setTimeout(() => { stalled = true; child.kill(); }, stallMs);
    };
    alive();
    child.stdout.on('data', (d) => {
      alive();
      const s = d.toString();
      if (!onLine) { out += s; return; }
      buf += s;
      let i;
      while ((i = buf.indexOf('\n')) !== -1) { onLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
    });
    child.stderr.on('data', (d) => { alive(); err = (err + d.toString()).slice(-4000); });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Couldn’t run ${name}: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (getJob(jobId)?.status === 'cancelled') return reject(cancelled());
      if (stalled) return reject(Object.assign(new Error(`The connection stalled (nothing arrived for ${Math.round(stallMs / 60000)} minutes)`), { network: true }));
      if (code === 0) return resolve(out);
      const last = err.split('\n').map(l => l.trim()).filter(Boolean).reverse().find(l => /ERROR/.test(l)) || err.trim().split('\n').pop() || `${name} exited with ${code}`;
      reject(new Error(last.replace(/^ERROR:\s*/, '').replace(/^\[[^\]]+\]\s*/, '').slice(0, 400)));
    });
  });
}

// yt-dlp asks for cookies on age-restricted, members-only and region-checked videos
const NEEDS_SIGN_IN = /sign in|confirm your age|age[- ]restrict|age[- ]verif|inappropriate|--cookies|log ?in to|login required|members[- ]only|private video|not a bot/i;
function explain(err, hadCookies) {
  const msg = String(err.message || err);
  if (err.cancelled || !NEEDS_SIGN_IN.test(msg)) return err;
  const hint = hadCookies
    ? ' Your saved sign-in cookies may have expired: export fresh ones in Profile → Link downloads.'
    : ' Save your browser’s sign-in cookies in Profile → Link downloads, then try again.';
  return new Error((msg.split(/ Use --cookies| See https?:\/\//)[0].trim() + hint).slice(0, 500));
}

const cleanTitle = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Download';
const isoDate = (d) => (/^\d{8}$/.test(String(d || '')) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null);

/**
 * Tags for a download. yt-dlp's `tags` is only part of it: YouTube shows the
 * description's #hashtags above the title (they're often the only "tags" a video
 * has), and many sites only fill `categories`. Up to 60 unique tags (the editor's
 * limit), the site's own first.
 */
const TAGS_MAX = 60;
function tagsOf(info) {
  const text = `${info.title || ''}\n${info.description || ''}`;
  const hashtags = [...text.matchAll(/(?:^|[^\p{L}\p{N}_&#/])#([\p{L}\p{N}_][\p{L}\p{N}_-]{0,79})/gu)].map(m => m[1]).filter(t => !/^\d+$/.test(t));
  const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []);
  const out = [], seen = new Set();
  for (const raw of [...list(info.tags), ...hashtags, ...list(info.categories), ...list(info.genres)]) {
    const t = String(raw ?? '').replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k); out.push(t);
    if (out.length >= TAGS_MAX) break;
  }
  return out;
}

/** Fill in tags on an item that came from this source before it had any (re-pasting a link repairs it) */
function fillMissingTags(fileId, info) {
  const tags = tagsOf(info);
  if (!tags.length) return;
  db.prepare(`UPDATE media_meta SET tags = ?, updated_at = datetime('now') WHERE file_id = ? AND (tags IS NULL OR tags = '' OR tags = '[]')`).run(JSON.stringify(tags), fileId);
}

function creatorOf(info, kind) {
  const c = kind === 'audio'
    ? (info.artist || info.creator || info.uploader || info.channel)
    : (info.channel || info.uploader || info.creator || info.artist);
  return String(c || 'Unknown').split(',')[0].trim().slice(0, 120) || 'Unknown';
}

/** The library item that already came from this source, in the same section */
function alreadyHave(ownerId, folderId, sourceId) {
  return db.prepare(`SELECT f.id FROM media_meta m JOIN files f ON f.id = m.file_id
    WHERE m.owner_id = ? AND m.source_id = ? AND f.folder_id = ? AND f.trashed_at IS NULL LIMIT 1`).get(ownerId, sourceId, folderId);
}

/** Store a cover image next to the media it belongs to; a missing cover is fine */
async function storeCover(ownerId, key, srcPath, title) {
  try {
    const name = `${title} cover${path.extname(srcPath).toLowerCase() || '.jpg'}`;
    const cover = await store.storeFile({ ownerId, folderId: lib.ensureSystemFolder(ownerId, key), srcPath, filename: name, mime: guessMime(name) });
    thumbs.warm(cover, store.diskPathOf(cover), store.MASTER_KEY);
    return cover.id;
  } catch (e) { return null; }
}

/** Width and height of a video file's first video stream, or {} */
function videoSize(file) {
  const t = detect();
  if (!t.ffVersion) return {};
  const m = /^(\d+)x(\d+)/.exec(execText(t.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file], 30000));
  return m ? { width: Number(m[1]), height: Number(m[2]) } : {};
}

/** Codec of a video file's first video stream ("av1", "h264", …), or '' */
function codecOf(file) {
  const t = detect();
  if (!t.ffVersion) return '';
  return execText(t.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file], 30000).split('\n')[0].trim().slice(0, 32);
}

const insertMeta = (fields) => {
  const keys = Object.keys(fields);
  db.prepare(`INSERT INTO media_meta (${keys.join(', ')}, updated_at) VALUES (${keys.map(() => '?').join(', ')}, datetime('now'))`).run(...keys.map(k => fields[k]));
};

/** Link a song to its artwork. Songs aren't put in a playlist: Music → Artists groups them, playlists are the user's own. */
const setSongCover = (fileId, coverId) => { if (coverId) db.prepare('INSERT OR REPLACE INTO song_covers (file_id, cover_file_id) VALUES (?, ?)').run(fileId, coverId); };

async function run(id) {
  const job = getJob(id);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(job.owner_id)) { db.prepare('DELETE FROM downloads WHERE id = ?').run(id); return; }
  const work = path.join(config.tempDir, `dl-${id}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  try {
    if (CONVERT_RE.test(job.url)) await convertVideo(job, work);
    else if (TRIM_RE.test(job.url)) await trimMedia(job, work);
    else if (AV1_RE.test(job.url)) await encodeAv1(job, work);
    else await download(job, work);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function download(job, work) {
  const { id, owner_id: ownerId } = job;
  const target = kindOf(job.kind);
  const kind = target.media;
  const t = detect();
  if (!t.ytVersion) throw new Error('The downloader isn’t ready yet.');
  const cookieFile = cookies.writeFor(ownerId, work);
  const common = ['--no-warnings', ...(cookieFile ? ['--cookies', cookieFile] : []), ...(PROXY ? ['--proxy', PROXY] : []),
    // YouTube needs a JavaScript runtime to unlock all formats; Node (running this server) is one
    ...(t.jsRuntime ? ['--js-runtimes', `node:${process.execPath}`] : [])];
  // --socket-timeout: a dead connection fails in 30 s instead of yt-dlp's default retry marathon
  const yt = (args, onLine, stallMs = STALL_MS) => spawnFor(id, t.ytdlp, [...common, '--socket-timeout', '30', ...args], { onLine, name: 'yt-dlp', stallMs })
    .catch((e) => { throw explain(e, !!cookieFile); });
  const folderId = lib.ensureSystemFolder(ownerId, target.folder);

  // 1. read the link's details (playlists only list their entries; a big channel can take a while)
  const info = JSON.parse(await yt(['-J', '--flat-playlist', '--', job.url], null, Math.max(STALL_MS, 5 * 60 * 1000)));
  if (info._type === 'playlist' || Array.isArray(info.entries)) {
    const entries = (info.entries || []).filter(Boolean).slice(0, PLAYLIST_MAX);
    // Entries already in the library (or already waiting in my queue) are skipped right here,
    // so re-pasting a playlist only downloads what's new, without looking each one up again.
    const queued = new Set(db.prepare(`SELECT url FROM downloads WHERE owner_id = ? AND status IN (${ACTIVE_SQL})`).all(ownerId).map(r => r.url));
    let fresh = 0, have = 0, waiting = 0;
    db.tx(() => {
      for (const e of entries) {
        const url = e.webpage_url || (/^https?:/.test(e.url || '') ? e.url : null) || (e.ie_key === 'Youtube' && e.id ? `https://www.youtube.com/watch?v=${e.id}` : null);
        if (!url) continue;
        const ie = e.ie_key || info.extractor_key || info.extractor;
        const known = e.id && ie && alreadyHave(ownerId, folderId, `${ie}:${e.id}`);
        // a flat listing rarely carries tags, but when it does they repair older downloads
        if (known) { if (e.tags || e.categories) fillMissingTags(known.id, e); have++; continue; }
        if (queued.has(url)) { waiting++; continue; }
        addJob(ownerId, url, job.kind, e.title || null); // the entries go where the playlist was going
        queued.add(url);
        fresh++;
      }
    });
    const parts = [`${entries.length} item${entries.length === 1 ? '' : 's'}`];
    if (have || waiting) parts.push(`${fresh} new`);
    if (have) parts.push(`${have} already in your library`);
    if (waiting) parts.push(`${waiting} already queued`);
    update(id, { status: 'expanded', progress: 1, title: `${info.title || 'Playlist'} (${parts.join(', ')})`.slice(0, 300), creator: creatorOf(info, kind) });
    return;
  }

  const title = cleanTitle(kind === 'audio' ? (info.track || info.title) : info.title);
  const creator = creatorOf(info, kind);
  const sourceId = `${info.extractor_key || info.extractor || 'web'}:${info.id || job.url}`;
  update(id, { title, creator, status: 'downloading' });

  // already have it? link the existing copy instead of downloading again
  const existing = alreadyHave(ownerId, folderId, sourceId);
  if (existing) {
    fillMissingTags(existing.id, info);
    update(id, { status: 'done', progress: 1, file_id: existing.id, error: 'Already in your library' });
    return;
  }

  const u = db.prepare('SELECT quota_bytes, used_bytes FROM users WHERE id = ?').get(ownerId);
  const left = u.quota_bytes - u.used_bytes;
  const approx = info.filesize || info.filesize_approx || 0;
  if (approx && approx > left) throw new Error('Not enough storage left for this download');

  // 2. download into the job's private work folder
  const ff = !!t.ffVersion;
  const args = ['--no-playlist', '--newline', '--no-mtime', '--no-part',
    '-o', path.join(work, 'media.%(ext)s'), '-o', `thumbnail:${path.join(work, 'thumb.%(ext)s')}`, '--write-thumbnail',
    '--max-filesize', String(Math.max(1, left)),
    '--progress-template', 'download:AKP %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s'];
  if (ff) args.push('--ffmpeg-location', t.ffmpeg, '--convert-thumbnails', 'jpg');
  // with ffmpeg: an AV1 stream when the site has one (YouTube usually does), up to 1080p.
  // Sites that only offer combined streams (HLS, e.g. most adult and news sites) fall through to `b`.
  const VIDEO_FORMAT = (AV1 ? 'bv*[vcodec^=av01][height<=1080]+ba[ext=m4a]/bv*[vcodec^=av01][height<=1080]+ba/' : '')
    + 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b[height<=1080]/b';
  // Format choices, best first. When a video offers none of the preferred ones
  // ("Requested format is not available"), fall back to whatever it does have.
  const attempts = kind === 'video'
    ? (ff ? [['-f', VIDEO_FORMAT], ['-f', 'bv*+ba/b'], []].map(f => [...f, '--merge-output-format', 'mp4']) : [['-f', 'b[ext=mp4]/b'], []])
    : (ff ? [['-f', 'ba/b'], []].map(f => [...f, '-x', '--audio-format', 'm4a', '--audio-quality', '0']) : [['-f', 'ba[ext=m4a]/ba[ext=mp3]/ba/b'], []]);

  let lastWrite = 0;
  const onProgress = (line) => {
    const m = /^AKP (\S+) (\S+) (\S+) (\S+)/.exec(line);
    if (!m || Date.now() - lastWrite < 700) return; // don't hammer the database
    lastWrite = Date.now();
    const done = Number(m[1]) || 0, total = Number(m[2]) || Number(m[3]) || 0;
    update(id, { progress: total ? Math.min(0.99, done / total) : 0, speed: Number(m[4]) || null });
  };
  // dropped or stalled connections are retried twice (with a pause) before the job fails
  const NETWORK = /timed out|stalled|Connection (reset|refused|aborted)|Temporary failure|HTTP Error 5\d\d|IncompleteRead|Read timed out|EOF occurred/i;
  for (let i = 0, netTries = 0; ;) {
    try { await yt([...args, ...attempts[i], '--', job.url], onProgress); break; }
    catch (e) {
      if (e.cancelled) throw e;
      for (const n of fs.readdirSync(work)) if (n.startsWith('media.')) fs.rmSync(path.join(work, n), { force: true });
      if (/Requested format is not available/i.test(e.message) && i < attempts.length - 1) { i++; continue; }
      if ((e.network || NETWORK.test(e.message)) && netTries < 2) {
        netTries++;
        update(id, { status: 'downloading', progress: 0, speed: null, error: `Connection problem, retrying (${netTries} of 2)…` });
        await new Promise(r => setTimeout(r, 5000 * netTries));
        throwIfCancelled(id);
        continue;
      }
      throw e;
    }
  }
  update(id, { error: null });

  // 3. store it
  update(id, { status: 'processing', progress: 0.99, speed: null });
  const files = fs.readdirSync(work).map(n => ({ n, p: path.join(work, n), s: fs.statSync(path.join(work, n)).size }));
  const media = files.filter(f => f.n.startsWith('media.')).sort((a, b) => b.s - a.s)[0];
  if (!media) throw new Error('The download didn’t produce a file (it may be larger than your free space)');
  if (kind === 'video' && AV1 && t.av1) {
    const smaller = await toAv1(id, media.p, Number(info.duration) || 0);
    throwIfCancelled(id);
    if (smaller) { media.p = smaller; media.n = path.basename(smaller); }
    update(id, { status: 'processing', progress: 0.99 });
  }
  const filename = `${title}.${path.extname(media.n).slice(1).toLowerCase()}`;
  const file = await store.storeFile({ ownerId, folderId, srcPath: media.p, filename, mime: guessMime(filename) });
  const thumb = files.find(f => f.n.startsWith('thumb.') && f.s > 0);
  const coverId = thumb ? await storeCover(ownerId, target.covers, thumb.p, title) : null;

  // 4. details + filing by creator
  insertMeta({
    file_id: file.id, owner_id: ownerId, title, participants: JSON.stringify([creator]), tags: JSON.stringify(tagsOf(info)),
    details: info.description ? String(info.description).slice(0, 4000) : null,
    date: kind === 'audio' ? (info.release_year ? String(info.release_year) : isoDate(info.upload_date)) : isoDate(info.upload_date),
    series: kind === 'audio' && info.album ? String(info.album).slice(0, 300) : null,
    duration: Number(info.duration) > 0 ? Number(info.duration) : null,
    thumb_file_id: kind === 'video' ? coverId : null, source_url: info.webpage_url || job.url, source_id: sourceId,
    ...(kind === 'video' ? { ...videoSize(media.p), video_codec: ff ? codecOf(media.p) : null } : {}),
  });
  // grouped by creator in Videos → Creators / Music → Artists; collections and playlists are left to the user
  if (kind === 'audio') setSongCover(file.id, coverId);
  update(id, { status: 'done', progress: 1, file_id: file.id, error: null });
}

// --- video → song ------------------------------------------------------------------
// Audio that browsers play natively is copied as-is (no quality loss, smallest
// result); anything else is encoded to AAC, which every browser plays.
const AUDIO_COPY = { aac: 'm4a', mp3: 'mp3', opus: 'opus', flac: 'flac', vorbis: 'ogg' };

async function convertVideo(job, work) {
  const { id, owner_id: ownerId } = job;
  const t = detect();
  if (!t.ffVersion) throw new Error('Converting needs ffmpeg, which isn’t installed on the server yet.');
  const fileId = CONVERT_RE.exec(job.url)[1];
  const video = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ? AND trashed_at IS NULL').get(fileId, ownerId);
  if (!video) throw new Error('The video is no longer in your library.');
  const meta = lib.withMeta(db.prepare('SELECT * FROM media_meta WHERE file_id = ?').get(fileId)) || { participants: [], tags: [] };
  const title = cleanTitle(meta.title || video.filename.replace(/\.[^.]+$/, ''));
  const artist = meta.participants[0] || null;
  const musicId = lib.ensureSystemFolder(ownerId, 'music');
  const sourceId = meta.source_id || `akulavbox:${fileId}`;
  update(id, { title, creator: artist, status: 'processing', progress: 0.05 });

  const existing = alreadyHave(ownerId, musicId, sourceId);
  if (existing) { update(id, { status: 'done', progress: 1, file_id: existing.id, error: 'Already in your music' }); return; }

  // 1. decrypt the video into the work folder (ffmpeg needs to seek)
  if (!store.hasRoomFor(video.size_bytes * 2)) throw new Error('The server’s disk is too full to convert this video');
  const src = path.join(work, `video${path.extname(video.filename).toLowerCase() || '.mp4'}`);
  const input = store.readAll(video);
  if (!input) throw new Error('The video file is missing on the server.');
  await pipeline(input, fs.createWriteStream(src));
  throwIfCancelled(id);

  // 2. take the audio out
  const codec = execText(t.ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', src]).split('\n')[0].trim();
  if (!codec) throw new Error('This video has no sound to save.');
  const ext = AUDIO_COPY[codec] || 'm4a';
  const out = path.join(work, `song.${ext}`);
  const audio = AUDIO_COPY[codec] ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k'];
  update(id, { status: 'converting', progress: 0.1 });
  const duration = Number(meta.duration) || 0;
  await ffmpegWithProgress(id, ['-i', src, '-map', '0:a:0', '-vn', ...audio,
    ...(ext === 'm4a' ? ['-movflags', '+faststart'] : []), '-map_metadata', '-1', out], duration);
  throwIfCancelled(id);
  if (!fs.existsSync(out) || !fs.statSync(out).size) throw new Error('ffmpeg didn’t produce any audio.');

  // 3. store the song, plus its artwork: the video's cover, or a frame from the video
  update(id, { status: 'processing', progress: 0.97 });
  const song = await store.storeFile({ ownerId, folderId: musicId, srcPath: out, filename: `${title}.${ext}`, mime: guessMime(`${title}.${ext}`) });
  let art = null;
  const cover = meta.thumb_file_id && db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ?').get(meta.thumb_file_id, ownerId);
  if (cover && store.readAll(cover)) {
    art = path.join(work, `art${path.extname(cover.filename).toLowerCase() || '.jpg'}`);
    await pipeline(store.readAll(cover), fs.createWriteStream(art)).catch(() => { art = null; });
  } else {
    const at = duration ? Math.min(10, duration / 10) : 1;
    const frame = path.join(work, 'art.jpg');
    execText(t.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(at), '-i', src, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '3', frame], 60000);
    if (fs.existsSync(frame) && fs.statSync(frame).size) art = frame;
  }
  const coverId = art ? await storeCover(ownerId, 'music_art', art, title) : null;

  insertMeta({
    file_id: song.id, owner_id: ownerId, title, participants: JSON.stringify(meta.participants), tags: JSON.stringify(meta.tags),
    details: meta.details || null, date: meta.date || null, series: meta.series || null, rating: meta.rating || null,
    duration: duration || null, source_url: meta.source_url || null, source_id: sourceId,
  });
  setSongCover(song.id, coverId);
  update(id, { status: 'done', progress: 1, file_id: song.id, error: null });
}

// --- trimming ------------------------------------------------------------------------
/** Run ffmpeg with -progress, reporting progress from `from` to `to` over `seconds` of output */
function ffmpegWithProgress(jobId, args, seconds, from = 0.1, to = 0.95) {
  const t = detect();
  let last = 0;
  return spawnFor(jobId, t.ffmpeg, ['-hide_banner', '-nostats', '-y', ...args.slice(0, -1), '-progress', 'pipe:1', args[args.length - 1]], {
    name: 'ffmpeg',
    onLine: (line) => {
      const m = /^out_time_us=(\d+)/.exec(line);
      if (!m || !seconds || Date.now() - last < 800) return;
      last = Date.now();
      update(jobId, { progress: Math.min(to, from + (to - from) * (Number(m[1]) / 1e6 / seconds)) });
    },
  });
}

async function trimMedia(job, work) {
  const { id, owner_id: ownerId } = job;
  const audio = job.kind === 'audio';
  const noun = audio ? 'song' : 'video';
  const t = detect();
  if (!t.ffVersion) throw new Error('Trimming needs ffmpeg, which isn’t installed on the server yet.');
  const [, fileId, query] = TRIM_RE.exec(job.url);
  const q = new URLSearchParams(query);
  const start = Number(q.get('s')), end = Number(q.get('e'));
  const exact = q.get('exact') === '1', keepOriginal = q.get('copy') === '1';
  const video = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ? AND trashed_at IS NULL').get(fileId, ownerId);
  if (!video) throw new Error(`The ${noun} is no longer in your library.`);
  const meta = lib.withMeta(db.prepare('SELECT * FROM media_meta WHERE file_id = ?').get(fileId));
  update(id, { status: 'processing', progress: 0.02, creator: meta?.participants?.[0] || null });

  if (!store.hasRoomFor(video.size_bytes * 2)) throw new Error(`The server’s disk is too full to trim this ${noun}`);
  const srcExt = path.extname(video.filename).toLowerCase() || (audio ? '.m4a' : '.mp4');
  const src = path.join(work, `source${srcExt}`);
  const input = store.readAll(video);
  if (!input) throw new Error(`The ${noun} file is missing on the server.`);
  await pipeline(input, fs.createWriteStream(src));
  throwIfCancelled(id);

  const length = end - start;
  // a fast cut keeps the container; an exact cut is re-encoded: video to MP4 (AV1 when
  // available, so it stays small), audio to AAC in M4A
  const ext = exact ? (audio ? '.m4a' : '.mp4') : srcExt;
  const out = path.join(work, `trimmed${ext}`);
  const videoEnc = t.av1 === 'libsvtav1' ? ['-c:v', 'libsvtav1', '-preset', '8', '-crf', '35']
    : t.av1 === 'libaom-av1' ? ['-c:v', 'libaom-av1', '-crf', '34', '-b:v', '0', '-cpu-used', '8', '-row-mt', '1']
    : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20'];
  const faststart = ['.mp4', '.m4v', '.mov', '.m4a'].includes(ext) ? ['-movflags', '+faststart'] : [];
  const cut = ['-ss', String(start), '-i', src, '-t', String(length)];
  const args = !exact ? [...cut, '-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero', ...faststart, out]
    : audio ? [...cut, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '192k', ...faststart, out]
    : [...cut, '-map', '0:v:0', '-map', '0:a?', ...videoEnc, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', ...faststart, out];
  update(id, { status: 'converting', progress: 0.1 });
  await ffmpegWithProgress(id, args, length);
  throwIfCancelled(id);
  if (!fs.existsSync(out) || !fs.statSync(out).size) throw new Error(`ffmpeg didn’t produce a ${noun}. Try an exact cut.`);
  const realLength = Number(execText(t.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], 30000)) || length;

  update(id, { status: 'processing', progress: 0.97 });
  const base = video.filename.replace(/\.[^.]+$/, '');
  if (keepOriginal) {
    const name = `${base} (trimmed)${ext}`;
    const copy = await store.storeFile({ ownerId, folderId: video.folder_id, srcPath: out, filename: name, mime: guessMime(name) });
    if (meta) {
      insertMeta({
        file_id: copy.id, owner_id: ownerId, title: meta.title ? `${meta.title} (trimmed)`.slice(0, 300) : null,
        participants: JSON.stringify(meta.participants), tags: JSON.stringify(meta.tags), details: meta.details || null,
        date: meta.date || null, series: meta.series || null, rating: meta.rating || null, duration: realLength,
        thumb_file_id: meta.thumb_file_id || null, source_url: meta.source_url || null,
        ...(audio ? {} : { ...videoSize(out), video_codec: codecOf(out) }),
      });
    }
    // next to the original: same collections (videos) or same playlists and artwork (songs)
    for (const c of db.prepare('SELECT collection_id FROM media_collection_items WHERE file_id = ?').all(video.id)) col.addToCollection(c.collection_id, ownerId, [copy.id]);
    for (const p of db.prepare('SELECT playlist_id FROM playlist_songs WHERE file_id = ?').all(video.id)) col.addToPlaylist(p.playlist_id, copy.id);
    const art = db.prepare('SELECT cover_file_id FROM song_covers WHERE file_id = ?').get(video.id);
    if (art) setSongCover(copy.id, art.cover_file_id);
    update(id, { status: 'done', progress: 1, file_id: copy.id, error: null });
  } else {
    const name = ext === srcExt ? null : `${base}${ext}`;
    await store.replaceFile(video, out, { filename: name, mime: name ? guessMime(name) : null });
    const size = audio ? {} : videoSize(out);
    const codec = audio ? null : (codecOf(out) || null);
    if (meta) db.prepare("UPDATE media_meta SET duration = ?, width = COALESCE(?, width), height = COALESCE(?, height), video_codec = COALESCE(?, video_codec), progress = NULL, updated_at = datetime('now') WHERE file_id = ?")
      .run(realLength, size.width ?? null, size.height ?? null, codec, video.id);
    else insertMeta({ file_id: video.id, owner_id: ownerId, duration: realLength, ...(codec ? { video_codec: codec } : {}) });
    update(id, { status: 'done', progress: 1, file_id: video.id, error: null });
  }
}

// --- AV1 conversion ---------------------------------------------------------------
let encodeChain = Promise.resolve(); // one encode at a time: AV1 encoding uses every CPU core
let encodeWaiting = 0;               // jobs that gave their download slot back while waiting for it

/**
 * Re-encode a video to AV1 (audio is copied). Returns the new file's path when it
 * came out smaller, otherwise null and the original is kept. Already-AV1 files are skipped.
 */
function toAv1(jobId, src, duration, { strict = false } = {}) {
  const t = detect();
  const codec = codecOf(src);
  if (!codec || codec === 'av1') return Promise.resolve(null);
  const out = path.join(path.dirname(src), 'av1.mp4');
  const encoder = t.av1 === 'libsvtav1'
    ? ['-c:v', 'libsvtav1', '-preset', '8', '-crf', '35', '-g', '240']
    : ['-c:v', 'libaom-av1', '-crf', '34', '-b:v', '0', '-cpu-used', '8', '-row-mt', '1'];
  // Waiting for the encoder doesn't need a download slot: give it back so the next
  // download can start. Only a few finished downloads may wait (each sits on disk).
  const released = encodeWaiting < ENCODE_BACKLOG;
  update(jobId, { status: 'encode_wait', progress: 0, speed: null });
  if (released) { encodeWaiting++; releaseSlot(jobId); }
  const job = encodeChain.then(async () => {
    if (released) encodeWaiting--;
    if (getJob(jobId)?.status === 'cancelled') return null;
    update(jobId, { status: 'converting', progress: 0, speed: null });
    let last = 0;
    try {
      await spawnFor(jobId, t.ffmpeg, ['-hide_banner', '-nostats', '-y', '-i', src, '-map', '0:v:0', '-map', '0:a?', ...encoder, '-pix_fmt', 'yuv420p',
        '-c:a', 'copy', '-movflags', '+faststart', '-progress', 'pipe:1', out], {
        name: 'ffmpeg',
        onLine: (line) => {
          const m = /^out_time_us=(\d+)/.exec(line);
          if (!m || !duration || Date.now() - last < 1000) return;
          last = Date.now();
          update(jobId, { progress: Math.min(0.99, Number(m[1]) / 1e6 / duration) });
        },
      });
    } catch (e) {
      // a download keeps its original when the encode fails; an explicit conversion reports why
      if (strict || e.cancelled) throw e;
      return null;
    }
    // only worth keeping when it actually saves space
    return fs.existsSync(out) && fs.statSync(out).size < fs.statSync(src).size ? out : null;
  });
  encodeChain = job.catch(() => {});
  return job;
}

/** Remember a video's codec (videos uploaded by hand have no details row yet) */
const metaRow = db.prepare("INSERT OR IGNORE INTO media_meta (file_id, owner_id, updated_at) VALUES (?, ?, datetime('now'))");
const codecRow = db.prepare('UPDATE media_meta SET video_codec = ? WHERE file_id = ?');
const stillThere = db.prepare('SELECT 1 FROM files WHERE id = ?');
function setCodec(fileId, ownerId, codec) {
  db.tx(() => { metaRow.run(fileId, ownerId); codecRow.run(codec, fileId); });
}

const fmtBytes = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** "Convert to AV1": re-encode a library video in place (same id, details, collections and links) */
async function encodeAv1(job, work) {
  const { id, owner_id: ownerId } = job;
  const t = detect();
  if (!t.av1) throw new Error('Converting to AV1 needs ffmpeg with an AV1 encoder, which this server doesn’t have yet.');
  const fileId = AV1_RE.exec(job.url)[1];
  const video = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ? AND trashed_at IS NULL').get(fileId, ownerId);
  if (!video) throw new Error('The video is no longer in your library.');
  const meta = lib.withMeta(db.prepare('SELECT * FROM media_meta WHERE file_id = ?').get(fileId));
  update(id, { status: 'processing', progress: 0.02, creator: meta?.participants?.[0] || null });

  if (!store.hasRoomFor(video.size_bytes * 2)) throw new Error('The server’s disk is too full to convert this video');
  const src = path.join(work, `source${path.extname(video.filename).toLowerCase() || '.mp4'}`);
  const input = store.readAll(video);
  if (!input) throw new Error('The video file is missing on the server.');
  await pipeline(input, fs.createWriteStream(src));
  throwIfCancelled(id);

  const codec = codecOf(src);
  if (!codec) throw new Error('ffmpeg couldn’t read a video stream in this file.');
  if (codec === 'av1') {
    setCodec(video.id, ownerId, 'av1');
    update(id, { status: 'done', progress: 1, file_id: video.id, error: 'Already AV1' });
    return;
  }
  const out = await toAv1(id, src, Number(meta?.duration) || 0, { strict: true });
  throwIfCancelled(id);
  if (!out) {
    setCodec(video.id, ownerId, codec);
    update(id, { status: 'done', progress: 1, file_id: video.id, error: 'Kept the original: the AV1 version wasn’t smaller' });
    return;
  }

  update(id, { status: 'processing', progress: 0.98 });
  const before = video.size_bytes, after = fs.statSync(out).size;
  // the encoder writes MP4; the name follows so the browser and downloads get the right type
  const name = /\.mp4$/i.test(video.filename) ? null : `${video.filename.replace(/\.[^.]+$/, '')}.mp4`;
  await store.replaceFile(video, out, { filename: name, mime: name ? guessMime(name) : null });
  const size = videoSize(out);
  setCodec(video.id, ownerId, 'av1');
  db.prepare("UPDATE media_meta SET width = COALESCE(?, width), height = COALESCE(?, height), updated_at = datetime('now') WHERE file_id = ?")
    .run(size.width ?? null, size.height ?? null, video.id);
  update(id, { status: 'done', progress: 1, file_id: video.id, error: `${fmtBytes(before)} → ${fmtBytes(after)} (${Math.round((1 - after / before) * 100)}% smaller)` });
}

// --- codec of videos added before 3.1, or uploaded by hand -------------------------
// ffprobe reads the decrypted stream from a pipe (no plain copy on disk). One video at
// a time, in the background; a file it can't read is marked '' so it isn't tried again.
let probing = false, probeTimer = null;
function probeStream(stream) {
  const t = detect();
  return new Promise((resolve) => {
    const [cmd, pre] = command(t.ffprobe);
    // the size comes along in the same read, so browsers needn't fetch the video to measure it
    const child = spawn(cmd, [...pre, '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', 'pipe:0'],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let out = '';
    const timer = setTimeout(() => child.kill(), 5 * 60 * 1000);
    child.stdout.on('data', (d) => { out += d; });
    // ffprobe stops reading as soon as it knows: the rest of the stream is dropped
    child.stdin.on('error', () => {});
    stream.on('error', () => child.kill());
    stream.pipe(child.stdin);
    const done = (codec) => { clearTimeout(timer); stream.unpipe(child.stdin); stream.destroy(); resolve(codec); };
    child.on('error', () => done(null));
    child.on('close', () => {
      const [codec = '', w, h] = out.split('\n')[0].trim().split(',');
      done({ codec: codec.slice(0, 32), width: Number(w) > 0 ? Number(w) : null, height: Number(h) > 0 ? Number(h) : null });
    });
  });
}
const fillSize = db.prepare('UPDATE media_meta SET width = COALESCE(width, ?), height = COALESCE(height, ?) WHERE file_id = ?');

async function probeMissing() {
  if (probing || !detect().ffVersion) return;
  probing = true;
  try {
    const todo = db.prepare(`SELECT f.* FROM files f JOIN folders d ON d.id = f.folder_id LEFT JOIN media_meta m ON m.file_id = f.id
      WHERE d.system_key IN ('videos', 'xxx') AND f.trashed_at IS NULL AND m.video_codec IS NULL ORDER BY f.created_at DESC LIMIT 200`).all();
    for (const f of todo) {
      const stream = store.readAll(f);
      if (!stream) { setCodec(f.id, f.owner_id, ''); continue; }
      const probe = await probeStream(stream);
      if (probe === null) break; // ffprobe can't run: try again later
      if (!stillThere.get(f.id)) continue;
      setCodec(f.id, f.owner_id, probe.codec);
      if (probe.width && probe.height) fillSize.run(probe.width, probe.height, f.id);
    }
  } catch (e) { console.warn(`[downloads] codec check failed: ${e.message}`); }
  finally { probing = false; }
}
/** After an upload into Videos: look at it soon (uploads come in batches) */
function probeSoon() { clearTimeout(probeTimer); probeTimer = setTimeout(probeMissing, 5000); probeTimer.unref?.(); }
setInterval(probeMissing, 30 * 60 * 1000).unref();

// Jobs that were running when the server stopped start over
function resume() {
  db.prepare(`UPDATE downloads SET status = 'queued', progress = 0, speed = NULL WHERE status IN (${ACTIVE_SQL}) AND status != 'queued'`).run();
  try { for (const n of fs.readdirSync(config.tempDir)) if (n.startsWith('dl-')) fs.rmSync(path.join(config.tempDir, n), { recursive: true, force: true }); } catch (e) { /* ignore */ }
  pump();
  probeSoon();
}

module.exports = { status, detect, checkUrl, checkLink, KINDS, addJob, addConversions, addTrim, addAv1, addInternal, isInternal, listJobs, cancel, clearFinished, pump, resume, toAv1, probeMissing, probeSoon, PLAYLIST_MAX, CONVERT_RE };
