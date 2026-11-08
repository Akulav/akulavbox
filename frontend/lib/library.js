import { ref, computed, watch } from 'vue';
import { api, session, fileUrl, storage } from './api.js';
import { uploadFile } from './upload.js';
import { lib } from './cdn.js';

// ---------- locked library folders ----------
const folderCache = {};
export async function systemFolder(key) {
  if (!folderCache[key]) folderCache[key] = api(`/api/library/folder/${key}`).then(r => r.id).catch(e => { delete folderCache[key]; throw e; });
  return folderCache[key];
}
export function forgetFolders() { for (const k of Object.keys(folderCache)) delete folderCache[k]; }

export const SECTION_OF = { gallery: 'Photos', music: 'Music', music_art: 'Music', videos: 'Videos', video_covers: 'Videos', books: 'Books', book_covers: 'Books' };
export const ROUTE_OF = { gallery: 'albums', music: 'music', music_art: 'music', videos: 'videos', video_covers: 'videos', books: 'books', book_covers: 'books' };
export const ACCEPTS_LABEL = { image: 'images', audio: 'audio files', video: 'videos', book: 'books (PDF, EPUB, …)' };

// ---------- thumbnails ----------
export const thumbUrl = (id, w = 480, v = '') =>
  `/api/files/${id}/thumb?w=${w}&token=${encodeURIComponent(session.token || '')}${v ? `&v=${encodeURIComponent(v)}` : ''}`;

// Background preloader: warms the browser cache for thumbnails just beyond the viewport
const preQueue = [];
const preDone = new Set();
let preActive = 0;
function pump() {
  while (preActive < 3 && preQueue.length) {
    const url = preQueue.shift();
    preActive++;
    const img = new Image();
    img.decoding = 'async';
    img.onload = img.onerror = () => { preActive--; schedule(); };
    img.src = url;
  }
}
const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 120));
function schedule() { idle(pump); }
export function preload(urls) {
  for (const u of urls) if (u && !preDone.has(u)) { preDone.add(u); preQueue.push(u); }
  schedule();
}

// ---------- details (media_meta) ----------
export const displayTitle = (item) => (item && (item.title || (item.filename || '').replace(/\.[^/.]+$/, ''))) || '';

export const saveMeta = (fileId, patch) => api(`/api/library/meta/${fileId}`, { method: 'PATCH', body: patch });
export const bulkMeta = (body) => api('/api/library/meta/bulk', { method: 'POST', body });

export function formatDuration(sec) {
  if (!sec || !isFinite(sec)) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

// One collator for every sort: localeCompare with options sets one up on each call,
// which adds up when sorting thousands of items.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const compareText = (a, b) => collator.compare(String(a ?? ''), String(b ?? ''));

/** Unique values of a list field across items, most used first */
export function facet(items, field) {
  const counts = new Map();
  for (const it of items) for (const v of (it[field] || [])) {
    const k = v.toLowerCase();
    const cur = counts.get(k) || { value: v, count: 0 };
    cur.count++; counts.set(k, cur);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || compareText(a.value, b.value));
}
export function distinct(items, field) {
  return [...new Set(items.map(i => i[field]).filter(Boolean))].sort(compareText);
}

/** Tile colors for people without a cover (creators, artists) */
export const TINTS = ['#E8A33D', '#5fb3a1', '#6ea8e6', '#c78bd8', '#d0806b', '#60c798', '#e0655a'];

/**
 * One entry per person (a video's creators, a song's artists) in a single pass:
 * { value, count, duration, newest (their most recently added item that `hasCover`), tint }, most items first.
 */
export function groupByPerson(items, hasCover = () => true) {
  const by = new Map();
  for (const it of items) for (const p of (it.participants || [])) {
    const k = p.toLowerCase();
    let g = by.get(k);
    if (!g) by.set(k, g = { value: p, count: 0, duration: 0, newest: null });
    g.count++;
    g.duration += it.duration || 0;
    if (hasCover(it) && (!g.newest || String(it.created_at) > String(g.newest.created_at))) g.newest = it;
  }
  return [...by.values()].sort((a, b) => b.count - a.count || compareText(a.value, b.value)).map((g, i) => ({ ...g, tint: TINTS[i % TINTS.length] }));
}

/**
 * Search / filter / sort state shared by Videos, Music and Books.
 * `storeKey` remembers the sort choice per section.
 */
export function useLibraryFilter(itemsRef, storeKey, defaultSort = 'added') {
  const search = ref('');
  const person = ref('');
  const tag = ref('');
  const series = ref('');
  const sort = ref(storage.read(`akulavSort_${storeKey}`) || defaultSort);
  watch(sort, (v) => storage.write(`akulavSort_${storeKey}`, v));

  const people = computed(() => facet(itemsRef.value, 'participants'));
  const tags = computed(() => facet(itemsRef.value, 'tags'));
  const seriesList = computed(() => distinct(itemsRef.value, 'series'));

  const cmp = compareText;
  // The searchable text of every item, built once per change to the items rather than
  // on every keystroke (descriptions of downloads can be long).
  const hays = computed(() => {
    const m = new Map();
    for (const it of itemsRef.value) {
      m.set(it.id, [displayTitle(it), it.filename, it.details, it.series, it.date, ...(it.participants || []), ...(it.tags || [])].join(' \u0001 ').toLowerCase());
    }
    return m;
  });
  const filtered = computed(() => {
    const q = search.value.trim().toLowerCase();
    const words = q ? q.split(/\s+/) : [];
    const who = person.value.toLowerCase(), tg = tag.value.toLowerCase();
    const hay = words.length ? hays.value : null;
    const list = itemsRef.value.filter((it) => {
      if (who && !(it.participants || []).some(p => p.toLowerCase() === who)) return false;
      if (tg && !(it.tags || []).some(t => t.toLowerCase() === tg)) return false;
      if (series.value && it.series !== series.value) return false;
      if (!hay) return true;
      const h = hay.get(it.id) || '';
      return words.every(w => h.includes(w));
    });
    const s = sort.value;
    const empties = (v) => v === null || v === undefined || v === '';
    const byTitle = (a, b) => cmp(displayTitle(a), displayTitle(b));
    const sorters = {
      order: () => 0, // keep the server's order (playlist order)
      added: (a, b) => cmp(b.created_at, a.created_at) || byTitle(a, b),
      oldest: (a, b) => cmp(a.created_at, b.created_at) || byTitle(a, b),
      title: byTitle,
      date: (a, b) => (empties(a.date) - empties(b.date)) || cmp(b.date, a.date) || byTitle(a, b),
      people: (a, b) => ((!a.participants?.length) - (!b.participants?.length)) || cmp(a.participants?.[0], b.participants?.[0]) || byTitle(a, b),
      series: (a, b) => (empties(a.series) - empties(b.series)) || cmp(a.series, b.series) || byTitle(a, b),
      rating: (a, b) => (b.rating || 0) - (a.rating || 0) || byTitle(a, b),
      longest: (a, b) => (b.duration || 0) - (a.duration || 0),
      shortest: (a, b) => ((!a.duration) - (!b.duration)) || (a.duration || 0) - (b.duration || 0),
      size: (a, b) => (b.size_bytes || 0) - (a.size_bytes || 0),
      resolution: (a, b) => (Math.min(b.width || 0, b.height || 0) - Math.min(a.width || 0, a.height || 0)) || byTitle(a, b),
      recent: (a, b) => cmp(b.meta_updated_at && b.progress ? b.meta_updated_at : '', a.meta_updated_at && a.progress ? a.meta_updated_at : '') || byTitle(a, b),
    };
    return list.sort(sorters[s] || sorters.added);
  });
  const active = computed(() => !!(search.value.trim() || person.value || tag.value || series.value));
  const reset = () => { search.value = ''; person.value = ''; tag.value = ''; series.value = ''; };
  return { search, person, tag, series, sort, people, tags, seriesList, filtered, active, reset };
}

// ---------- automatic covers ----------
const coverTried = new Set();
export const coverAttempted = (id) => coverTried.has(id);

/** Grab a frame from a video (File or URL). Resolves { blob, duration } or null. */
export function captureVideoFrame(source) {
  return new Promise((resolve) => {
    const url = source instanceof Blob ? URL.createObjectURL(source) : source;
    const v = document.createElement('video');
    let done = false;
    const finish = (val) => {
      if (done) return; done = true;
      clearTimeout(timer);
      v.removeAttribute('src'); v.load();
      if (source instanceof Blob) URL.revokeObjectURL(url);
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), 20000);
    v.muted = true; v.preload = 'metadata'; v.playsInline = true; v.crossOrigin = 'anonymous';
    v.onloadedmetadata = () => {
      const d = v.duration;
      v.currentTime = isFinite(d) && d > 0 ? Math.min(Math.max(d * 0.15, 1), 90, d - 0.1) : 1;
    };
    v.onseeked = () => {
      try {
        const scale = Math.min(1, 960 / (v.videoWidth || 960));
        const c = document.createElement('canvas');
        c.width = Math.round((v.videoWidth || 960) * scale); c.height = Math.round((v.videoHeight || 540) * scale);
        if (!c.width || !c.height) return finish(null);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((blob) => finish(blob ? { blob, duration: isFinite(v.duration) ? v.duration : null, width: v.videoWidth || null, height: v.videoHeight || null } : null), 'image/jpeg', 0.82);
      } catch (e) { finish(null); }
    };
    v.onerror = () => finish(null);
    v.src = url;
  });
}

/** Render the first page of a PDF to a JPEG blob */
export async function pdfCover(source) {
  try {
    const pdfjsLib = await lib('pdfjsLib');
    const data = source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : undefined;
    const doc = await pdfjsLib.getDocument(data ? { data } : { url: source, disableAutoFetch: true, disableStream: false }).promise;
    const page = await doc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 640 / vp1.width) });
    const c = document.createElement('canvas');
    c.width = Math.round(viewport.width); c.height = Math.round(viewport.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    doc.destroy();
    return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  } catch (e) { return null; }
}

/** Extract the cover image declared inside an EPUB */
export async function epubCover(source) {
  try {
    const JSZip = await lib('JSZip');
    const buf = source instanceof Blob ? await source.arrayBuffer() : await (await fetch(source)).arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const container = await zip.file('META-INF/container.xml')?.async('string');
    if (!container) return null;
    const opfPath = new DOMParser().parseFromString(container, 'application/xml').querySelector('rootfile')?.getAttribute('full-path');
    if (!opfPath) return null;
    const opf = new DOMParser().parseFromString(await zip.file(opfPath).async('string'), 'application/xml');
    const items = [...opf.getElementsByTagName('item')];
    let item = items.find(i => (i.getAttribute('properties') || '').split(' ').includes('cover-image'));
    if (!item) {
      const coverId = [...opf.getElementsByTagName('meta')].find(m => m.getAttribute('name') === 'cover')?.getAttribute('content');
      item = items.find(i => i.getAttribute('id') === coverId) || items.find(i => /cover/i.test(i.getAttribute('id') || '') && /image\//.test(i.getAttribute('media-type') || ''));
    }
    if (!item) return null;
    const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const href = decodeURIComponent(item.getAttribute('href'));
    const f = zip.file(base + href) || zip.file(href);
    if (!f) return null;
    return new Blob([await f.async('uint8array')], { type: item.getAttribute('media-type') || 'image/jpeg' });
  } catch (e) { return null; }
}

/** Store a cover image for a video/book and link it */
export async function setCover(fileId, blob, extra = {}, kind = 'video') {
  // covers live next to what they belong to: Videos/Covers or Books/Covers
  const folderId = await systemFolder(kind === 'book' ? 'book_covers' : 'video_covers');
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  const coverId = await uploadFile(new File([blob], `cover-${fileId.slice(0, 8)}.${ext}`, { type: blob.type || 'image/jpeg' }), folderId);
  return saveMeta(fileId, { ...extra, thumb_file_id: coverId });
}

/** Try to make a cover automatically. `source` is the local File (on upload) or the stored file's URL. */
export async function autoCover(item, source, kind) {
  coverTried.add(item.id);
  const ext = (item.filename || '').split('.').pop().toLowerCase();
  if (kind === 'video') {
    const frame = await captureVideoFrame(source || fileUrl(item.id));
    if (!frame) return null;
    const extra = { ...(frame.duration ? { duration: frame.duration } : {}), ...(frame.width ? { width: frame.width, height: frame.height } : {}) };
    return setCover(item.id, frame.blob, extra, 'video');
  }
  if (kind === 'book') {
    if (!source && item.size_bytes > 60 * 1024 * 1024) return null;
    const blob = ext === 'pdf' ? await pdfCover(source || fileUrl(item.id)) : ext === 'epub' ? await epubCover(source || fileUrl(item.id)) : null;
    return blob ? setCover(item.id, blob, {}, 'book') : null;
  }
  return null;
}

/** A video's natural size, read from its header only (no download of the whole file). Resolves { width, height, duration } or null. */
export function readVideoSize(url) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const done = (val) => { clearTimeout(timer); v.removeAttribute('src'); v.load(); resolve(val); };
    const timer = setTimeout(() => done(null), 15000);
    v.preload = 'metadata'; v.muted = true;
    v.onloadedmetadata = () => done(v.videoWidth ? { width: v.videoWidth, height: v.videoHeight, duration: isFinite(v.duration) ? v.duration : null } : null);
    v.onerror = () => done(null);
    v.src = url;
  });
}

/** Label for a resolution: 4K, 1440p, 1080p, 720p… (the short side, so portrait videos read right) */
export function resolutionLabel(w, h) {
  const s = Math.min(w || 0, h || 0);
  if (!s) return '';
  if (s >= 2000) return s >= 4000 ? '8K' : '4K';
  for (const p of [1440, 1080, 720, 480, 360]) if (s >= p * 0.94) return `${p}p`;
  return `${s}p`;
}

/** Fill in the resolution of videos that don't have one yet, a couple at a time. Returns a stop function. */
export function backfillSizes(items, onDone) {
  let stopped = false;
  const queue = [...items];
  const worker = async () => {
    while (!stopped && queue.length) {
      const it = queue.shift();
      const size = await readVideoSize(fileUrl(it.id));
      if (stopped || !size) continue;
      const patch = { width: size.width, height: size.height, ...(!it.duration && size.duration ? { duration: size.duration } : {}) };
      try { await saveMeta(it.id, patch); onDone(it, patch); } catch (e) { /* try again next visit */ }
    }
  };
  worker(); worker();
  return () => { stopped = true; };
}

/** Process items missing a cover one by one in the background. Returns a stop function. */
export function backfillCovers(items, kind, onDone) {
  let stopped = false;
  (async () => {
    for (const it of items) {
      if (stopped) return;
      if (it.thumb_file_id || coverTried.has(it.id)) continue;
      await new Promise(r => idle(r));
      if (stopped) return;
      const meta = await autoCover(it, null, kind).catch(() => null);
      if (meta && !stopped) onDone(it, meta);
    }
  })();
  return () => { stopped = true; };
}

// ---------- thumbnails made in the browser (when the server has no `sharp`) ----------
let thumbMode = null;
/** Resolves true when the server makes thumbnails itself */
export function serverMakesThumbs() {
  if (!thumbMode) thumbMode = api('/api/thumbs/status').then(r => !!r.server).catch(() => true);
  return thumbMode;
}

const madeUrls = new Map();     // `${id}:${w}` -> object URL
const makeQueue = [];
let making = 0;
function nextMake() {
  while (making < 3 && makeQueue.length) {
    const job = makeQueue.shift();
    making++;
    job().finally(() => { making--; nextMake(); });
  }
}

async function encode(canvas) {
  const try1 = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.78));
  if (try1 && try1.type === 'image/webp') return try1;            // Safari can't encode WebP
  return new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.82));
}

/**
 * Make (once) and upload a thumbnail for a file, from its original.
 * Returns an object URL to show right away, or null if the browser can't decode it.
 */
export function makeThumb(id, w) {
  const key = `${id}:${w}`;
  if (madeUrls.has(key)) return Promise.resolve(madeUrls.get(key));
  return new Promise((resolve) => {
    makeQueue.push(async () => {
      try {
        const probe = await fetch(thumbUrl(id, w) + '&cached=1');
        if (probe.ok) { const u = URL.createObjectURL(await probe.blob()); madeUrls.set(key, u); return resolve(u); }
        const info = await probe.json().catch(() => ({}));
        const source = info.source;
        if (!source) return resolve(null);
        const res = await fetch(fileUrl(source));
        if (!res.ok) return resolve(null);
        const bmp = await createImageBitmap(await res.blob(), { imageOrientation: 'from-image' });
        const ow = bmp.width, oh = bmp.height;
        const width = info.width || w;
        const scale = Math.min(1, width / ow, (width * 3) / oh);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(ow * scale)); c.height = Math.max(1, Math.round(oh * scale));
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close && bmp.close();
        const blob = await encode(c);
        if (!blob) return resolve(null);
        fetch(`/api/files/${source}/thumb?w=${width}&ow=${ow}&oh=${oh}`, {
          method: 'PUT', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': blob.type }, body: blob,
        }).catch(() => {});
        const u = URL.createObjectURL(blob);
        madeUrls.set(key, u);
        resolve(u);
      } catch (e) { resolve(null); }
    });
    nextMake();
  });
}

// ---------- natural sizes measured in the browser, saved in batches ----------
const dimsQueue = new Map();
let dimsTimer = null;
export function rememberDims(id, w, h) {
  if (!(w > 0 && h > 0)) return;
  dimsQueue.set(id, { id, w, h });
  clearTimeout(dimsTimer);
  dimsTimer = setTimeout(() => {
    const items = [...dimsQueue.values()];
    dimsQueue.clear();
    if (items.length) api('/api/files/dims', { method: 'POST', body: { items } }).catch(() => {});
  }, 1500);
}
