'use strict';
// Turns an upload into a readable work.
//
// Accepted: Koma's `out` folder zipped (chapter-001/001.jpg ... + reader.html), Koma's .cbz, any
// .zip/.cbz of images, or a handful of loose images. Images are grouped into chapters by the folder
// they sit in; chapter titles come from Koma's reader.html (or project.json) when present.
//
// Every strip is re-encoded as WebP, cut into slices (so the reader streams a long strip piece by
// piece instead of one 12000 px image) with a half-width copy for phones, and a 3:4 cover is cropped
// from the first panel. Jobs run one at a time in the background; the work page polls for progress.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const yauzl = require('yauzl');
const sharp = require('sharp');

sharp.cache(false);

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif|bmp|tiff?)$/i;
const ARCHIVE_EXT = /\.(zip|cbz)$/i;
const MAX_WIDTH = 1440; // stored strip width
const SMALL_WIDTH = 720; // phones
const SLICE = 1800; // target slice height at MAX_WIDTH
const COVER = [600, 800];
const LIMITS = { entries: 20000, entryBytes: 200 * 1024 * 1024, totalBytes: 6 * 1024 * 1024 * 1024, pixels: 150_000_000 };

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

class IngestError extends Error {}

// --- zip reading ------------------------------------------------------------

function openZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true, decodeStrings: true }, (err, zip) => (err ? reject(new IngestError('That archive could not be opened - is it a real .zip/.cbz?')) : resolve(zip)));
  });
}

function listEntries(zip) {
  return new Promise((resolve, reject) => {
    const entries = [];
    let total = 0;
    zip.on('entry', (e) => {
      if (!/\/$/.test(e.fileName)) {
        entries.push(e);
        total += e.uncompressedSize;
      }
      if (entries.length > LIMITS.entries) return reject(new IngestError('That archive has too many files.'));
      if (total > LIMITS.totalBytes) return reject(new IngestError('That archive unpacks to more than 6 GB.'));
      zip.readEntry();
    });
    zip.on('end', () => resolve(entries));
    zip.on('error', () => reject(new IngestError('That archive is damaged.')));
    zip.readEntry();
  });
}

function readEntry(zip, entry) {
  if (entry.uncompressedSize > LIMITS.entryBytes) throw new IngestError(`${entry.fileName} is larger than 200 MB.`);
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err) return reject(new IngestError(`Couldn't read ${entry.fileName} from the archive.`));
      const chunks = [];
      let size = 0;
      stream.on('data', (c) => {
        size += c.length;
        if (size > LIMITS.entryBytes) stream.destroy(new IngestError(`${entry.fileName} is larger than 200 MB.`));
        else chunks.push(c);
      });
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', (e) => reject(e instanceof IngestError ? e : new IngestError(`Couldn't read ${entry.fileName} from the archive.`)));
    });
  });
}

// --- metadata from Koma's files --------------------------------------------

const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

function parseReaderHtml(text) {
  const title = text.match(/<title>([^<]*)<\/title>/i)?.[1];
  const chapters = [...text.matchAll(/<section id="c\d+"><h2>([^<]*)<\/h2>/gi)].map((m) => decodeEntities(m[1]).trim());
  return { title: title ? decodeEntities(title).trim() : '', chapters };
}

function parseProjectJson(text) {
  try {
    const p = JSON.parse(text);
    const chapters = [];
    for (const s of p.scenes ?? []) {
      const t = String(s.chapter_title ?? '').trim();
      if (t && chapters[chapters.length - 1] !== t) chapters.push(t);
    }
    return { title: String(p.title ?? '').trim(), chapters };
  } catch {
    return { title: '', chapters: [] };
  }
}

const isJunk = (name) => name.split('/').some((p) => p.startsWith('.') || p === '__MACOSX' || p === 'Thumbs.db');

/**
 * Groups image paths into chapters. Returns [{ key, items: [name...] }] in reading order.
 * Files in the root of an archive that also has chapter folders are ignored only if they look like
 * extras (cover/thumbnail); otherwise the root becomes its own chapter.
 */
function groupChapters(names) {
  const groups = new Map();
  for (const n of names) {
    const dir = path.posix.dirname(n);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(n);
  }
  if (groups.size > 1 && groups.has('.')) {
    const root = groups.get('.').filter((n) => !/^(cover|thumb|thumbnail|folder)\./i.test(n));
    if (root.length) groups.set('.', root);
    else groups.delete('.');
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] === '.' ? -1 : b[0] === '.' ? 1 : collator.compare(a[0], b[0])))
    .map(([key, items]) => ({ key, items: items.sort(collator.compare) }));
}

// --- image work -------------------------------------------------------------

const hex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Re-encodes one strip into slices. Returns { pages: [[w,h,small]], raw, info } (raw kept for the cover). */
async function processStrip(input, dir, startIndex, keepRaw) {
  let src;
  let meta;
  try {
    src = sharp(input, { limitInputPixels: LIMITS.pixels, failOn: 'error' });
    meta = await src.metadata();
    if (!meta.width || !meta.height) throw new Error('no size');
  } catch {
    return null; // not an image sharp can read; skip it
  }
  const { data, info } = await src
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const target = Math.round(SLICE * (W / MAX_WIDTH)) || SLICE;
  const n = Math.max(1, Math.round(H / target));
  const pages = [];
  let y = 0;
  for (let i = 0; i < n; i++) {
    const h = i === n - 1 ? H - y : Math.round(H / n);
    const idx = startIndex + i;
    const name = String(idx).padStart(4, '0');
    const piece = sharp(data, { raw: info }).extract({ left: 0, top: y, width: W, height: h });
    await piece.clone().webp({ quality: 82, effort: 4, smartSubsample: true }).toFile(path.join(dir, `${name}.webp`));
    const small = W > SMALL_WIDTH * 1.25;
    if (small) await piece.clone().resize({ width: SMALL_WIDTH }).webp({ quality: 78, effort: 4, smartSubsample: true }).toFile(path.join(dir, `${name}-s.webp`));
    pages.push([W, h, small ? 1 : 0]);
    y += h;
  }
  return { pages, raw: keepRaw ? data : null, info, scale: W / meta.width };
}

/** Background colour of a strip: the colour of its top-left corner (Koma's gutter). */
function edgeColour(raw, info) {
  return info.channels >= 3 ? hex(raw[0], raw[1], raw[2]) : hex(raw[0], raw[0], raw[0]);
}

async function makeCover(input, outDir, rawCrop) {
  const [w, h] = COVER;
  const base = rawCrop ? sharp(rawCrop.data, { raw: rawCrop.info }).extract(rawCrop.box) : sharp(input, { limitInputPixels: LIMITS.pixels }).rotate();
  const { data, info } = await base.resize(w, h, { fit: 'cover', position: sharp.strategy.attention }).raw().toBuffer({ resolveWithObject: true });
  await sharp(data, { raw: info }).webp({ quality: 84 }).toFile(path.join(outDir, 'cover.webp'));
  await sharp(data, { raw: info })
    .resize(w / 2, h / 2)
    .webp({ quality: 80 })
    .toFile(path.join(outDir, 'cover-s.webp'));
}

// --- the job ----------------------------------------------------------------

/** Bytes of every file under a folder */
async function folderBytes(dir) {
  let total = 0;
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await folderBytes(p);
    else total += (await fsp.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

function createIngest({ db, config, log = console }) {
  const worksDir = path.join(config.dataDir, 'works');
  let chain = Promise.resolve();
  let pending = 0;

  function setProgress(id, p) {
    db.run('UPDATE works SET progress = ? WHERE id = ?', Math.min(0.99, p), id);
  }

  async function sourcesFor(job) {
    // -> { items: [{ name, read() }], close(), meta: { title, chapters } }
    const archive = job.files.find((f) => ARCHIVE_EXT.test(f.originalname));
    if (archive) {
      const zip = await openZip(archive.path);
      try {
        const entries = (await listEntries(zip)).map((e) => ({ e, name: e.fileName.replace(/\\/g, '/').replace(/^\/+/, '') })).filter((x) => !isJunk(x.name));
        let meta = { title: '', chapters: [] };
        const reader = entries.find((x) => /(^|\/)reader\.html$/i.test(x.name));
        const project = entries.find((x) => /(^|\/)project\.json$/i.test(x.name));
        if (reader) meta = parseReaderHtml((await readEntry(zip, reader.e)).toString('utf8'));
        if (project && !meta.chapters.length) meta = parseProjectJson((await readEntry(zip, project.e)).toString('utf8'));
        const items = entries.filter((x) => IMAGE_EXT.test(x.name)).map((x) => ({ name: x.name, read: () => readEntry(zip, x.e) }));
        // a Koma .cbz next to its chapter folders would double everything: prefer the folders
        return { items, meta, koma: Boolean(reader) || items.some((x) => /(^|\/)chapter-\d+\//.test(x.name)), close: () => zip.close() };
      } catch (e) {
        zip.close();
        throw e;
      }
    }
    const items = job.files.filter((f) => IMAGE_EXT.test(f.originalname)).map((f) => ({ name: path.basename(f.originalname), read: () => fsp.readFile(f.path) }));
    return { items, meta: { title: '', chapters: [] }, koma: false, close() {} };
  }

  async function run(id, job) {
    const outDir = path.join(worksDir, id);
    await fsp.rm(outDir, { recursive: true, force: true });
    await fsp.mkdir(outDir, { recursive: true });
    const src = await sourcesFor(job);
    try {
      if (!src.items.length) throw new IngestError('No images found. Upload Koma\'s "out" folder as a .zip, the .cbz, or image files.');
      const groups = groupChapters(src.items.map((i) => i.name));
      const byName = new Map(src.items.map((i) => [i.name, i]));
      const titles = src.meta.chapters.length === groups.length ? src.meta.chapters : null;
      const total = src.items.length;
      let done = 0;
      let pageCount = 0;
      let bg = null;
      let coverCrop = null;
      let firstImage = null;
      const chapters = [];
      for (let ci = 0; ci < groups.length; ci++) {
        const folder = `c${String(ci + 1).padStart(3, '0')}`;
        const dir = path.join(outDir, folder);
        await fsp.mkdir(dir, { recursive: true });
        const pages = [];
        for (const name of groups[ci].items) {
          const buf = await byName.get(name).read();
          const first = !firstImage;
          const r = await processStrip(buf, dir, pages.length + 1, first);
          done++;
          setProgress(id, done / total);
          if (!r) continue;
          if (first) {
            firstImage = buf;
            bg = edgeColour(r.raw, r.info);
            const { width: W, height: H } = r.info;
            // Koma strips open with a title card (0.55 x width) and a gap: crop the cover below it
            const y0 = src.koma ? Math.round(W * 0.55 + 80 * r.scale) : 0;
            const top = H - y0 > W * 0.6 ? y0 : 0;
            coverCrop = { data: r.raw, info: r.info, box: { left: 0, top, width: W, height: Math.min(H - top, Math.round(W * 1.6)) } };
          }
          pages.push(...r.pages);
        }
        if (!pages.length) {
          await fsp.rm(dir, { recursive: true, force: true });
          continue;
        }
        pageCount += pages.length;
        chapters.push({ folder, title: titles?.[ci] || (groups.length === 1 ? 'Chapter 1' : prettyFolder(groups[ci].key, chapters.length + 1)), pages });
      }
      if (!chapters.length) throw new IngestError('None of the files could be read as images.');
      // folders must be numbered by final chapter index (some groups may have been dropped)
      for (let i = 0; i < chapters.length; i++) {
        const want = `c${String(i + 1).padStart(3, '0')}`;
        if (chapters[i].folder !== want) {
          await fsp.rename(path.join(outDir, chapters[i].folder), path.join(outDir, want));
          chapters[i].folder = want;
        }
      }
      if (job.cover) await makeCover(await fsp.readFile(job.cover.path), outDir, null).catch(() => makeCover(firstImage, outDir, coverCrop));
      else await makeCover(firstImage, outDir, coverCrop);

      const now = Date.now();
      db.tx(() => {
        db.run('DELETE FROM chapters WHERE work_id = ?', id);
        chapters.forEach((c, i) => db.run('INSERT INTO chapters (work_id, idx, title, pages) VALUES (?, ?, ?, ?)', id, i + 1, c.title.slice(0, 120), JSON.stringify(c.pages)));
        const work = db.get('SELECT title, visibility, published FROM works WHERE id = ?', id);
        const title = job.autoTitle && src.meta.title ? src.meta.title.slice(0, 120) : work.title;
        const published = work.visibility === 'public' && !work.published ? now : work.published;
        db.run("UPDATE works SET status = 'ready', progress = 1, error = NULL, pages = ?, chapters = ?, bg = ?, title = ?, cover_rev = cover_rev + 1, updated = ?, published = ? WHERE id = ?", pageCount, chapters.length, bg || '#0e0d12', title, now, published, id);
      });
      // what the work takes on disk counts towards its creator's storage (the account's one space)
      db.run('UPDATE works SET bytes = ? WHERE id = ?', await folderBytes(outDir), id);
      require('../../../src/core/bus').emit('storage.changed', { app: 'manga' });
      log.info?.(`[ingest] ${id}: ${chapters.length} chapter(s), ${pageCount} slices`);
    } finally {
      src.close();
    }
  }

  function prettyFolder(key, n) {
    const base = path.posix.basename(key);
    if (!base || base === '.' || /^(chapter|ch|c)?[-_ ]?\d+$/i.test(base)) return `Chapter ${n}`;
    return base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  async function cleanupFiles(job) {
    for (const f of [...job.files, job.cover].filter(Boolean)) await fsp.rm(f.path, { force: true }).catch(() => {});
  }

  function enqueue(id, job) {
    pending++;
    chain = chain.then(async () => {
      try {
        await run(id, job);
      } catch (e) {
        const msg = e instanceof IngestError ? e.message : 'Something went wrong while processing this upload.';
        if (!(e instanceof IngestError)) log.error?.(`[ingest] ${id}:`, e);
        db.run("UPDATE works SET status = 'failed', error = ? WHERE id = ?", msg, id);
        await fsp.rm(path.join(worksDir, id), { recursive: true, force: true }).catch(() => {});
      } finally {
        pending--;
        await cleanupFiles(job);
      }
    });
    return chain;
  }

  /** After a restart: anything mid-processing is lost (its upload temp files are gone). */
  function recover() {
    db.run("UPDATE works SET status = 'failed', error = 'The server restarted while this was being processed. Please upload it again.' WHERE status = 'processing'");
    const tmp = path.join(config.dataDir, 'tmp');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
  }

  return { enqueue, recover, idle: () => chain, get pending() { return pending; } };
}

module.exports = { MAX_WIDTH, IngestError, parseReaderHtml, parseProjectJson, groupChapters, folderBytes, createIngest };
