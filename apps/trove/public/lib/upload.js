import { reactive, ref, markRaw } from 'vue';
import { session, randomId, waitOnline } from './api.js';

const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB
const PARALLEL = 3;                  // files uploading at the same time

// Global upload queue shown in the shell's upload tray
export const uploads = reactive([]);
// Bumps after every finished upload, so open pages can refresh (e.g. after a retry from the tray)
export const uploadTick = ref(0);
let seq = 0;

class Cancelled extends Error { constructor() { super('Cancelled'); this.cancelled = true; } }


function sendChunk(form, onProgress, item) {
  return new Promise((resolve, reject) => {
    if (item && item.status === 'cancelled') return reject(new Cancelled());
    const xhr = new XMLHttpRequest();
    if (item) item._xhr = markRaw(xhr);
    xhr.open('POST', '/api/files/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${session.token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data || {});
      else reject(Object.assign(new Error((data && data.error) || `Upload failed (${xhr.status})`), { status: xhr.status }));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new Cancelled());
    xhr.send(form);
  });
}

/** Upload one File in chunks. Returns the new file id. */
export async function uploadFile(file, folderId, onProgress = () => {}, item = null) {
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const uploadId = randomId();
  let done = 0, result = null;

  for (let i = 0; i < totalChunks; i++) {
    const chunk = file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size));
    const form = new FormData();
    form.append('upload_id', uploadId);
    form.append('chunk_index', String(i));
    form.append('total_chunks', String(totalChunks));
    form.append('offset', String(i * CHUNK_SIZE));
    form.append('total_size', String(file.size));
    if (folderId) form.append('folder_id', folderId);
    form.append('file', chunk, file.name);

    let attemptNo = 0;
    while (true) {
      try {
        result = await sendChunk(form, (loaded) => onProgress(file.size ? Math.min(1, (done + loaded) / file.size) : 1), item);
        break;
      } catch (e) {
        // retry transient failures (also after the connection comes back), but not quota/validation errors
        if (e.cancelled || (e.status && e.status < 500 && e.status !== 409) || ++attemptNo >= 4) throw e;
        if (e.status === 409) throw e; // out of order: the server lost the earlier chunks
        await waitOnline();
        await new Promise(r => setTimeout(r, 800 * attemptNo));
      }
    }
    done += chunk.size;
    onProgress(file.size ? done / file.size : 1);
  }
  return result && result.fileId;
}

function track(job) {
  const item = reactive({ id: ++seq, name: job.file.name, size: job.file.size, progress: 0, status: 'queued', error: '', startedAt: 0 });
  item._job = markRaw(job);
  uploads.push(item);
  return item;
}

async function runItem(item) {
  const { file, folderId, onEach } = item._job;
  item.status = 'uploading'; item.error = ''; item.progress = 0;
  item.startedAt = Date.now();
  try {
    const fileId = await uploadFile(file, folderId, (p) => { item.progress = p; }, item);
    item.status = 'done'; item.progress = 1;
    if (onEach) await onEach(fileId, file);
    uploadTick.value++;
    setTimeout(() => { const i = uploads.indexOf(item); if (i !== -1 && item.status === 'done') uploads.splice(i, 1); }, 2500);
    return fileId;
  } catch (e) {
    if (e.cancelled || item.status === 'cancelled') { item.status = 'cancelled'; item.error = ''; }
    else { item.status = 'error'; item.error = e.message; }
    return null;
  } finally { item._xhr = null; }
}

/**
 * Upload many files, a few at a time, tracking them in the global tray.
 * `input` is a FileList / File[] (all go to `folderId`) or [{ file, folderId }].
 * Returns [{ file, fileId }] for the ones that succeeded, in the original order.
 */
export async function uploadMany(input, folderId, { onEach } = {}) {
  const jobs = Array.from(input).map(x => (x instanceof Blob ? { file: x, folderId } : x)).map(j => ({ ...j, onEach }));
  const items = jobs.map(track);
  const out = new Array(items.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      if (items[i].status === 'cancelled') continue;
      const fileId = await runItem(items[i]);
      if (fileId) out[i] = { file: jobs[i].file, fileId };
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
  return out.filter(Boolean);
}

export function cancelUpload(item) {
  if (item.status !== 'uploading' && item.status !== 'queued') return;
  item.status = 'cancelled';
  if (item._xhr) item._xhr.abort();
}
export function cancelAllUploads() { for (const u of uploads) cancelUpload(u); }

/** Try a failed or cancelled upload again (same file, same folder) */
export function retryUpload(item) {
  if (item.status !== 'error' && item.status !== 'cancelled') return;
  runItem(item);
}

export function clearFinishedUploads() {
  for (let i = uploads.length - 1; i >= 0; i--) if (uploads[i].status !== 'uploading' && uploads[i].status !== 'queued') uploads.splice(i, 1);
}

/**
 * Turn a drop into [{ file, path }] including files inside dropped folders.
 * `path` is the folder path inside the drop ('' for loose files).
 */
export async function filesFromDrop(dataTransfer) {
  const entries = Array.from(dataTransfer.items || []).map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return Array.from(dataTransfer.files || []).map(file => ({ file, path: '' }));
  const out = [];
  const readAll = (reader) => new Promise((resolve) => {
    const acc = [];
    const step = () => reader.readEntries((batch) => { if (!batch.length) resolve(acc); else { acc.push(...batch); step(); } }, () => resolve(acc));
    step();
  });
  const walk = async (entry, dir) => {
    if (entry.isFile) {
      const file = await new Promise((res) => entry.file(res, () => res(null)));
      if (file) out.push({ file, path: dir });
    } else if (entry.isDirectory) {
      const children = await readAll(entry.createReader());
      for (const c of children) await walk(c, dir ? `${dir}/${entry.name}` : entry.name);
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

/** Files picked with <input webkitdirectory> carry their path in webkitRelativePath */
export const filesFromPicker = (list) => Array.from(list).map(file => {
  const rel = file.webkitRelativePath || '';
  return { file, path: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '' };
});
