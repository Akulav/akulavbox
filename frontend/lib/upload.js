import { reactive } from 'vue';
import { session } from './api.js';

const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB

// Global upload queue shown in the shell's upload tray
export const uploads = reactive([]);
let seq = 0;

function sendChunk(form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${session.token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data || {});
      else reject(new Error((data && data.error) || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(form);
  });
}

/** Upload one File in chunks. Returns the new file id. */
export async function uploadFile(file, folderId, onProgress = () => {}) {
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const uploadId = crypto.randomUUID();
  let done = 0, result = null;

  for (let i = 0; i < totalChunks; i++) {
    const chunk = file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size));
    const form = new FormData();
    form.append('upload_id', uploadId);
    form.append('chunk_index', String(i));
    form.append('total_chunks', String(totalChunks));
    form.append('offset', String(i * CHUNK_SIZE));
    if (folderId) form.append('folder_id', folderId);
    form.append('file', chunk, file.name);

    let attemptNo = 0;
    while (true) {
      try {
        result = await sendChunk(form, (loaded) => onProgress(file.size ? Math.min(1, (done + loaded) / file.size) : 1));
        break;
      } catch (e) {
        // retry transient failures, but not quota/validation errors
        if (++attemptNo >= 3 || /quota|invalid|not found/i.test(e.message)) throw e;
        await new Promise(r => setTimeout(r, 800 * attemptNo));
      }
    }
    done += chunk.size;
    onProgress(file.size ? done / file.size : 1);
  }
  return result && result.fileId;
}

/**
 * Upload many files sequentially, tracking them in the global tray.
 * Returns [{ file, fileId }] for the ones that succeeded.
 */
export async function uploadMany(fileList, folderId, { onEach } = {}) {
  const items = Array.from(fileList).map(file => {
    const item = reactive({ id: ++seq, name: file.name, size: file.size, progress: 0, status: 'queued', error: '' });
    uploads.push(item);
    return { file, item };
  });

  const results = [];
  for (const { file, item } of items) {
    item.status = 'uploading';
    item.startedAt = Date.now();
    try {
      const fileId = await uploadFile(file, folderId, (p) => { item.progress = p; });
      item.status = 'done'; item.progress = 1;
      results.push({ file, fileId });
      if (onEach) await onEach(fileId, file);
    } catch (e) {
      item.status = 'error'; item.error = e.message;
    }
  }
  // Clear finished items after a moment; keep errors visible until dismissed
  setTimeout(() => {
    for (const { item } of items) {
      if (item.status === 'done') {
        const i = uploads.indexOf(item);
        if (i !== -1) uploads.splice(i, 1);
      }
    }
  }, 2500);
  return results;
}

export function clearFinishedUploads() {
  for (let i = uploads.length - 1; i >= 0; i--) if (uploads[i].status !== 'uploading' && uploads[i].status !== 'queued') uploads.splice(i, 1);
}
