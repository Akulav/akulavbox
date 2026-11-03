#!/usr/bin/env node
// End-to-end smoke test. Boots a throwaway server (temporary storage, random
// port, test keys), exercises the API like the app does, then cleans up.
// Your real storage/ folder is never touched.
//
//   npm run check
//   node scripts/check.js --db path/to/copy.db   also run read-only checks against a copy of a real database

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'akulavbox-check-'));
const port = 4100 + Math.floor(Math.random() * 800);
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  STORAGE_DIR: tmp, PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'error',
  MASTER_KEY: crypto.randomBytes(16).toString('hex'),   // 32 characters
  JWT_SECRET: crypto.randomBytes(32).toString('hex'),
  DISK_RESERVE_MB: '0',
};
const dbArg = process.argv.indexOf('--db');
if (dbArg !== -1) fs.copyFileSync(process.argv[dbArg + 1], path.join(tmp, 'akulavbox.db'));

let passed = 0, failed = 0;
const ok = (cond, label, extra) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};

let token = null;
async function api(p, { method = 'GET', body, headers = {}, raw = false, auth = true } = {}) {
  const h = { ...headers };
  if (auth && token) h.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !(body instanceof FormData) && typeof body !== 'string' && !(body instanceof Uint8Array)) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + p, { method, headers: h, body: payload });
  if (raw) return res;
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (e) { data = text; }
  return { status: res.status, data, headers: res.headers };
}

async function upload(bytes, name, folderId, chunk = 64 * 1024) {
  const uploadId = crypto.randomUUID();
  const total = Math.max(1, Math.ceil(bytes.length / chunk));
  let last;
  for (let i = 0; i < total; i++) {
    const fd = new FormData();
    fd.append('upload_id', uploadId); fd.append('chunk_index', String(i)); fd.append('total_chunks', String(total));
    fd.append('offset', String(i * chunk)); fd.append('total_size', String(bytes.length));
    if (folderId) fd.append('folder_id', folderId);
    fd.append('file', new Blob([bytes.subarray(i * chunk, (i + 1) * chunk)]), name);
    last = await api('/api/files/upload', { method: 'POST', body: fd });
    if (last.status !== 200) return last;
  }
  return last;
}

async function main() {
  console.log(`AkulavBox check — temporary instance on ${base}`);
  const server = spawn(process.execPath, ['src/server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  const stop = () => { try { server.kill(); } catch (e) { /* ignore */ } };
  process.on('exit', stop);

  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) break; } catch (e) { /* not yet */ }
    await new Promise(r => setTimeout(r, 250));
  }

  try {
    console.log('\nServer');
    const health = await api('/api/health', { auth: false });
    ok(health.status === 200 && health.data.version, `health endpoint (v${health.data.version})`);
    ok((await api('/index.html', { auth: false })).status === 200, 'serves the app');
    ok((await api('/api/files/nope/view')).status === 401, 'rejects requests without a token');

    if (dbArg !== -1) {
      console.log('\nExisting database (copy)');
      const db = new (require('node:sqlite').DatabaseSync)(path.join(tmp, 'akulavbox.db'));
      ok(db.prepare('PRAGMA user_version').get().user_version >= 6, 'migrated to the latest schema');
      const admin = db.prepare("SELECT id, username, role, token_version FROM users WHERE role = 'admin' LIMIT 1").get();
      token = require('jsonwebtoken').sign({ id: admin.id, username: admin.username, role: admin.role, tv: admin.token_version || 0 }, env.JWT_SECRET);
      for (const p of ['/api/directory', '/api/library/photos', '/api/library/videos', '/api/library/books', '/api/music/songs', '/api/music/playlists', '/api/collections', '/api/trash', '/api/admin/users', '/api/admin/system', '/api/chat/friends']) {
        const r = await api(p);
        ok(r.status === 200, `GET ${p}`, `${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
      }
      const cols = await api('/api/collections');
      for (const c of (cols.data || []).slice(0, 3)) ok((await api(`/api/collections/${c.id}/albums`)).status === 200, `albums of “${c.title}”`);
      db.close();
    } else {
      console.log('\nSign in');
      ok((await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } })).status === 401, 'wrong password is refused');
      const login = await api('/api/login', { method: 'POST', body: { username: 'ADMIN', password: 'admin' } });
      ok(login.status === 200 && login.data.token, 'default admin signs in (case-insensitive username)');
      ok(login.data.weak_password === true, 'weak default password is flagged');
      token = login.data.token;

      console.log('\nFiles');
      const dir = await api('/api/directory');
      ok(dir.status === 200 && Array.isArray(dir.data.folders), 'list the top folder');
      const folder = await api('/api/folders', { method: 'POST', body: { name: 'Check folder' } });
      ok(folder.status === 200, 'create a folder');
      const content = crypto.randomBytes(200 * 1024 + 7); // several chunks, not 16-byte aligned
      const up = await upload(content, 'random.bin', folder.data.id);
      ok(up.status === 200 && up.data.fileId, 'chunked upload', JSON.stringify(up.data));
      const fileId = up.data.fileId;
      const enc = fs.readFileSync(path.join(tmp, 'users', 'admin-uuid-0000', `${fileId}.enc`));
      ok(enc.length === content.length && !enc.equals(content), 'stored encrypted at rest');
      const view = Buffer.from(await (await api(`/api/files/${fileId}/view`, { raw: true })).arrayBuffer());
      ok(view.equals(content), 'download decrypts to the original bytes');
      const range = await api(`/api/files/${fileId}/view`, { raw: true, headers: { Range: 'bytes=1000-70011' } });
      const part = Buffer.from(await range.arrayBuffer());
      ok(range.status === 206 && part.equals(content.subarray(1000, 70012)), 'range request at an unaligned offset');

      const txt = await upload(Buffer.from('hello world'), 'note.txt', null);
      const edit = await api(`/api/files/${txt.data.fileId}/content`, { method: 'PUT', body: { content: 'hello again', base_size: 11 } });
      ok(edit.status === 200 && edit.data.size_bytes === 11, 'edit a text file in place');
      ok((await (await api(`/api/files/${txt.data.fileId}/view`, { raw: true })).text()) === 'hello again', 'edited contents read back');
      const share = await api(`/api/files/${txt.data.fileId}/share`, { method: 'PATCH', body: { is_shared: true } });
      ok(share.status === 200 && share.data.public_hash, 'create a public link');
      ok((await (await api(`/shared/${share.data.public_hash}`, { raw: true, auth: false })).text()) === 'hello again', 'public link works without signing in');
      ok((await api(`/api/files/${txt.data.fileId}/share`, { method: 'PATCH', body: { is_shared: false } })).status === 200, 'stop sharing (re-encrypts)');
      ok((await api(`/shared/${share.data.public_hash}`, { auth: false })).status === 404, 'old public link stops working');

      const sub = await api('/api/folders/path', { method: 'POST', body: { parent_id: folder.data.id, path: 'a/b' } });
      ok(sub.status === 200 && sub.data.id, 'create nested folders for a folder upload');
      const again = await api('/api/folders/path', { method: 'POST', body: { parent_id: folder.data.id, path: 'a/b' } });
      ok(again.data.id === sub.data.id, 'folder upload reuses existing folders');
      const listed = await api(`/api/directory/${folder.data.id}`);
      ok(listed.data.files.length === 1 && listed.data.folders.length === 1, 'folder contents');
      const top = await api('/api/directory');
      const mine = top.data.folders.find(f => f.id === folder.data.id);
      ok(mine && mine.size_bytes === content.length && mine.item_count === 2, 'folder size and item count');
      ok((await api('/api/search?q=random')).data.files.length === 1, 'search finds the file');

      const zip = await api('/api/zip', { method: 'POST', raw: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, folders: folder.data.id, files: txt.data.fileId }).toString() });
      const zipBuf = Buffer.from(await zip.arrayBuffer());
      ok(zip.status === 200 && zipBuf.subarray(0, 2).toString() === 'PK', 'download a selection as zip');

      console.log('\nTrash');
      const before = (await api('/api/user/profile')).data.used_bytes;
      ok((await api(`/api/folders/${folder.data.id}`, { method: 'DELETE' })).status === 200, 'delete a non-empty folder (to trash)');
      ok(!(await api('/api/directory')).data.folders.some(f => f.id === folder.data.id), 'it disappears from Files');
      ok((await api('/api/search?q=random')).data.files.length === 0, 'and from search');
      const t = await api('/api/trash');
      ok(t.data.folders.length === 1 && t.data.folders[0].file_count === 1, 'trash lists the folder with its contents');
      ok((await api('/api/trash/restore', { method: 'POST', body: { folders: [folder.data.id] } })).data.restored === 1, 'restore the folder');
      ok((await api(`/api/directory/${folder.data.id}`)).data.files.length === 1, 'its files come back too');
      await api('/api/items/trash', { method: 'POST', body: { files: [fileId] } });
      ok((await api('/api/trash/delete', { method: 'POST', body: { files: [fileId] } })).data.deleted === 1, 'delete for good');
      ok(!fs.existsSync(path.join(tmp, 'users', 'admin-uuid-0000', `${fileId}.enc`)), 'file removed from disk');
      ok((await api('/api/user/profile')).data.used_bytes === before - content.length, 'storage used goes down');

      console.log('\nPhotos, music, library');
      const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005fe02fea72c2d9c0000000049454e44ae426082', 'hex');
      const gallery = await api('/api/library/folder/gallery');
      ok(gallery.status === 200, 'locked Photos folder');
      const img = await upload(png, 'dot.png', gallery.data.id);
      ok(img.status === 200, 'upload a photo');
      ok((await upload(Buffer.from('x'), 'x.txt', gallery.data.id)).status === 400, 'Photos refuses non-images');
      const col = await api('/api/collections', { method: 'POST', body: { title: 'Trip' } });
      ok((await api('/api/collections', { method: 'POST', body: { title: '  ' } })).status === 400, 'empty titles are refused');
      const alb = await api(`/api/collections/${col.data.id}/albums`, { method: 'POST', body: { title: 'Day 1' } });
      ok((await api(`/api/albums/${alb.data.id}/images/bulk`, { method: 'POST', body: { file_ids: [img.data.fileId] } })).data.added === 1, 'add photos to an album in bulk');
      ok((await api(`/api/albums/${alb.data.id}/images`)).data.length === 1, 'album lists the photo');
      const pl = await api('/api/music/playlists', { method: 'POST', body: { title: 'Mix' } });
      ok(pl.status === 200, 'create a playlist');
      ok((await api(`/api/music/playlists/${pl.data.id}/order`, { method: 'PUT', body: { file_ids: [] } })).status === 200, 'reorder a playlist');
      for (const s of ['photos', 'videos', 'books']) ok((await api(`/api/library/${s}`)).status === 200, `library: ${s}`);

      console.log('\nAccounts');
      const u = await api('/api/admin/users', { method: 'POST', body: { username: 'checker', password: 'secret123', quota: 1024 * 1024 } });
      ok(u.status === 200, 'admin creates a user');
      ok((await api('/api/admin/users', { method: 'POST', body: { username: 'CHECKER', password: 'secret123' } })).status === 400, 'usernames are unique regardless of case');
      const sys = await api('/api/admin/system');
      ok(sys.status === 200 && sys.data.disk && sys.data.disk.free > 0, `disk free space (${Math.round(sys.data.disk?.free / 1e9)} GB free)`);
      const userLogin = await api('/api/login', { method: 'POST', body: { username: 'checker', password: 'secret123' } });
      const adminToken = token;
      token = userLogin.data.token;
      ok((await api('/api/admin/users')).status === 403, 'non-admins can’t use admin endpoints');
      ok((await upload(crypto.randomBytes(2 * 1024 * 1024), 'big.bin', null)).status === 400, 'quota is enforced');
      const tmpLeft = fs.readdirSync(path.join(tmp, 'temp')).length;
      ok(tmpLeft === 0, 'a refused upload leaves nothing behind');
      const pw = await api('/api/user/password', { method: 'PATCH', body: { currentPassword: 'secret123', newPassword: 'secret456' } });
      ok(pw.status === 200 && pw.data.token, 'change password returns a fresh token');
      ok((await api('/api/user/profile')).status === 401, 'old sessions are signed out after a password change');
      token = pw.data.token;
      ok((await api('/api/user/profile')).status === 200, 'the new token works');
      token = adminToken;
      ok((await api(`/api/admin/users/${u.data.id}/role`, { method: 'PATCH', body: { role: 'user' } })).status === 200, 'change a role');
      ok((await api('/api/admin/users/admin-uuid-0000/role', { method: 'PATCH', body: { role: 'user' } })).status === 400, 'can’t demote yourself');
      ok((await api(`/api/admin/users/${u.data.id}`, { method: 'DELETE' })).status === 200, 'delete a user');
      token = pw.data.token;
      ok((await api('/api/user/profile')).status === 401, 'a deleted user’s session stops working');
      token = adminToken;

      let fails = 0;
      for (let i = 0; i < 11; i++) { const r = await api('/api/login', { method: 'POST', body: { username: 'ghost', password: 'x' }, auth: false }); if (r.status === 429) fails++; }
      ok(fails > 0, 'repeated failed sign-ins are rate limited');
    }
  } catch (e) {
    failed++;
    console.error('\nCheck crashed:', e);
  } finally {
    stop();
    await new Promise(r => setTimeout(r, 300));
    if (failed) console.log(`\nServer output:\n${log.trim()}`);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* Windows may still hold the db for a moment */ }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
