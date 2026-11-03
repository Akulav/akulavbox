const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');

// sharp is optional. Without it the browser makes thumbnails once and uploads
// them (PUT /api/files/:id/thumb), so grids are still fast after the first visit.
let sharp = null;
try { sharp = require('sharp'); sharp.cache(false); }
catch (e) { console.warn('[thumbs] "sharp" is not installed. Run `npm install` for server-made photo thumbnails (the browser will make them meanwhile).'); }

const WIDTHS = [240, 480, 960];
const MAX_SOURCE = 200 * 1024 * 1024;
const cacheRoot = config.thumbsDir;
const PARALLEL = Math.max(2, Math.min(6, os.cpus().length - 1));

const pickWidth = (w) => {
  const n = parseInt(w, 10) || 480;
  return WIDTHS.find(x => x >= n) || WIDTHS[WIDTHS.length - 1];
};
const cachePath = (ownerId, fileId, width) => path.join(cacheRoot, ownerId, `${fileId}_${width}.bin`);

let running = 0;
const waiting = [];
async function gate(fn) {
  if (running >= PARALLEL) await new Promise(r => waiting.push(r));
  running++;
  try { return await fn(); }
  finally { running--; const next = waiting.shift(); if (next) next(); }
}
const inflight = new Map();

function encrypt(buf, key) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-ctr', key, iv);
  return Buffer.concat([iv, c.update(buf), c.final()]);
}
function decrypt(buf, key) {
  const d = crypto.createDecipheriv('aes-256-ctr', key, buf.subarray(0, 16));
  return Buffer.concat([d.update(buf.subarray(16)), d.final()]);
}
const typeOf = (buf) => (buf[0] === 0xFF && buf[1] === 0xD8 ? 'image/jpeg' : buf.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : buf[0] === 0x89 ? 'image/png' : 'image/webp');

/** Remember an image's real size (used to lay photos out at their natural shape) */
function saveDims(fileId, ownerId, width, height) {
  if (!(width > 0 && height > 0)) return;
  db.prepare(`
    INSERT INTO media_meta (file_id, owner_id, width, height, participants, tags) VALUES (?, ?, ?, ?, '[]', '[]')
    ON CONFLICT(file_id) DO UPDATE SET width = excluded.width, height = excluded.height
  `).run(fileId, ownerId, Math.round(width), Math.round(height));
}

async function readSource(file, filePath, key) {
  const raw = await fs.promises.readFile(filePath);
  if (!file.is_encrypted) return raw;
  const d = crypto.createDecipheriv('aes-256-ctr', key, Buffer.from(file.iv_hex, 'hex'));
  return Buffer.concat([d.update(raw), d.final()]);
}

/** Cached thumbnail only (never generates). Returns { buf, type } or null. */
async function cached(file, width, key) {
  try {
    const buf = decrypt(await fs.promises.readFile(cachePath(file.owner_id, file.id, width)), key);
    return { buf, type: typeOf(buf) };
  } catch (e) { return null; }
}

/**
 * Cached thumbnail, generating it with sharp if possible.
 * When a bigger size is generated the smaller ones come along for free.
 */
async function get(file, filePath, width, key) {
  const hit = await cached(file, width, key);
  if (hit || !sharp || file.size_bytes > MAX_SOURCE) return hit;

  const k = file.id;
  if (!inflight.has(k)) {
    const job = gate(async () => {
      try {
        const src = await readSource(file, filePath, key);
        const base = sharp(src, { failOn: 'none', limitInputPixels: 268402689, animated: false }).rotate();
        const meta = await sharp(src, { failOn: 'none' }).metadata();
        const swap = (meta.orientation || 1) >= 5;
        saveDims(file.id, file.owner_id, swap ? meta.height : meta.width, swap ? meta.width : meta.height);
        // One decode, three sizes
        const outs = await Promise.all(WIDTHS.map(w => base.clone()
          .resize({ width: w, height: w * 3, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: w <= 240 ? 68 : 74, effort: 2 }).toBuffer()));
        await fs.promises.mkdir(path.dirname(cachePath(file.owner_id, file.id, 240)), { recursive: true });
        await Promise.all(WIDTHS.map((w, i) => fs.promises.writeFile(cachePath(file.owner_id, file.id, w), encrypt(outs[i], key))));
        return true;
      } catch (e) { return false; }
    }).finally(() => inflight.delete(k));
    inflight.set(k, job);
  }
  const ok = await inflight.get(k);
  return ok ? cached(file, width, key) : null;
}

/** Store a thumbnail the browser made (used when sharp isn't available) */
async function store(file, width, buf, key, dims) {
  await fs.promises.mkdir(path.dirname(cachePath(file.owner_id, file.id, width)), { recursive: true });
  await fs.promises.writeFile(cachePath(file.owner_id, file.id, width), encrypt(buf, key));
  if (dims) saveDims(file.id, file.owner_id, dims.width, dims.height);
}

/** Make thumbnails right after upload so the first look at a new photo is instant */
function warm(file, filePath, key) {
  if (!sharp) return;
  setTimeout(() => { get(file, filePath, 480, key).catch(() => {}); }, 50);
}

function purge(ownerId, fileId) {
  for (const w of WIDTHS) { try { fs.unlinkSync(cachePath(ownerId, fileId, w)); } catch (e) { /* none */ } }
}
function purgeUser(ownerId) {
  try { fs.rmSync(path.join(cacheRoot, ownerId), { recursive: true, force: true }); } catch (e) { /* none */ }
}

module.exports = { get, cached, store, warm, saveDims, purge, purgeUser, pickWidth, available: () => !!sharp, WIDTHS };
