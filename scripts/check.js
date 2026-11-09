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
let base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  STORAGE_DIR: tmp, PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'error',
  MASTER_KEY: crypto.randomBytes(16).toString('hex'),   // 32 characters
  JWT_SECRET: crypto.randomBytes(32).toString('hex'),
  DISK_RESERVE_MB: '0',
  YTDLP_PATH: path.join(__dirname, 'test', 'fake-yt-dlp.js'),   // no network: a stand-in answers like yt-dlp
  FFMPEG_PATH: path.join(__dirname, 'test', 'fake-ffmpeg.js'),  // and ffprobe
  AUTO_INSTALL_TOOLS: '0',
  UPDATES: 'off',   // never ask GitHub during the test
  DOWNLOAD_STALL_SECONDS: '5',
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

      console.log('\nLink downloads & collections');
      const waitJobs = async (kind) => {
        for (let i = 0; i < 80; i++) {
          const jobs = (await api(`/api/downloads?kind=${kind}`)).data;
          if (jobs.length && jobs.every(j => !['queued', 'probing', 'downloading', 'encode_wait', 'converting', 'processing'].includes(j.status))) return jobs;
          await new Promise(r => setTimeout(r, 250));
        }
        return (await api(`/api/downloads?kind=${kind}`)).data;
      };
      const st = await api('/api/downloads/status');
      ok(st.data.available && st.data.ytdlp, 'downloader detected (stand-in yt-dlp)');
      ok((await api('/api/downloads', { method: 'POST', body: { url: 'http://127.0.0.1/x', kind: 'video' } })).status === 400, 'links into the server’s own network are refused');
      ok((await api('/api/downloads', { method: 'POST', body: { url: 'https://example.com/v/clip1', kind: 'video' } })).status === 200, 'paste a video link');
      let jobs = await waitJobs('video');
      ok(jobs[0].status === 'done' && jobs[0].file_id && jobs[0].creator === 'Test Creator', 'video downloaded', JSON.stringify(jobs[0]));
      const vids = (await api('/api/library/videos')).data.items;
      const v = vids.find(x => x.id === jobs[0].file_id);
      ok(v && v.title === 'Test video clip1' && v.participants[0] === 'Test Creator' && v.duration === 42 && v.thumb_file_id && v.date === '2026-01-02', 'title, creator, date, length and cover filled in');
      ok(v && ['demo', 'test', 'Cooking', 'Education'].every(t => v.tags.includes(t)) && !v.tags.includes('2026') && !v.tags.includes('anchor'),
        'tags come from the site, the description’s #hashtags and its categories', JSON.stringify(v?.tags));
      ok(!(await api('/api/media-collections?kind=videos')).data.length, 'downloads don’t create collections (Creators groups them)');
      await api('/api/downloads', { method: 'POST', body: { url: 'https://example.com/v/clip1', kind: 'video' } });
      jobs = await waitJobs('video');
      ok(jobs[0].error === 'Already in your library' && jobs[0].file_id === v.id, 'the same link twice isn’t downloaded again');
      await api('/api/downloads', { method: 'POST', body: { url: 'https://example.com/playlist/p1', kind: 'video' } });
      jobs = await waitJobs('video');
      ok(jobs.some(j => j.status === 'expanded') && jobs.filter(j => j.status === 'done').length >= 4, 'a playlist link downloads every entry');
      const jobsBefore = jobs.length;
      await api('/api/downloads', { method: 'POST', body: { url: 'https://example.com/playlist/p2', kind: 'video' } });
      jobs = await waitJobs('video');
      const p2 = jobs.find(j => j.url.endsWith('/p2'));
      ok(p2 && /1 new, 2 already in your library/.test(p2.title) && jobs.length === jobsBefore + 2 && jobs.some(j => j.url.endsWith('/third') && j.status === 'done'),
        'pasting a playlist again only downloads what’s new', p2?.title);
      await api('/api/downloads', { method: 'POST', body: { url: 'https://example.com/v/flaky', kind: 'video' } });
      jobs = await waitJobs('video');
      ok(jobs.find(j => j.url.endsWith('/flaky'))?.status === 'done', 'a dropped connection is retried', JSON.stringify(jobs.find(j => j.url.endsWith('/flaky'))));
      await api('/api/downloads', { method: 'POST', body: { url: 'https://example.com/v/stall', kind: 'video' } });
      jobs = await waitJobs('video');
      ok(jobs.find(j => j.url.endsWith('/stall'))?.status === 'done', 'a stalled download is stopped and retried', JSON.stringify(jobs.find(j => j.url.endsWith('/stall'))));
      await api('/api/downloads', { method: 'POST', body: { url: 'https://example.com/v/fail', kind: 'video' } });
      jobs = await waitJobs('video');
      ok(jobs.find(j => j.url.endsWith('/fail'))?.error === 'This video is unavailable', 'failures show yt-dlp’s reason');
      await api('/api/downloads', { method: 'POST', body: { url: 'https://example.com/v/song1', kind: 'audio' } });
      jobs = await waitJobs('audio');
      ok(jobs[0].status === 'done', 'audio downloaded');
      const song = (await api('/api/music/songs')).data.songs.find(s => s.id === jobs[0].file_id);
      ok(song && song.cover_file_id && song.series === 'Test Album' && song.participants[0] === 'Test Artist', 'song gets artist, album and artwork');
      ok(!(await api('/api/music/playlists')).data.some(p => p.title === 'Test Artist'), 'downloads don’t create playlists (Artists groups them)');
      await api('/api/downloads', { method: 'POST', body: { url: 'https://example.com/v/clip1', kind: 'audio' } });
      jobs = await waitJobs('audio');
      ok(jobs[0].status === 'done' && !jobs[0].error && jobs[0].file_id !== v.id, 'the audio of a link already saved as video still downloads', JSON.stringify(jobs[0]));

      const second = (await api('/api/library/videos')).data.items.find(x => x.title === 'Test video second');
      const conv = await api('/api/downloads/from-videos', { method: 'POST', body: { file_ids: [second.id] } });
      ok(conv.status === 200 && conv.data.ids.length === 1, 'save a video as a song');
      jobs = await waitJobs('audio');
      const convJob = jobs.find(j => j.id === conv.data.ids[0]);
      ok(convJob && convJob.status === 'done', 'conversion finished', JSON.stringify(convJob));
      const converted = (await api('/api/music/songs')).data.songs.find(s => s.id === convJob?.file_id);
      ok(converted && converted.title === 'Test video second' && converted.participants[0] === 'Test Creator' && converted.tags.includes('demo') && converted.cover_file_id && /\.m4a$/.test(converted.filename),
        'the song keeps the title, creator, tags and artwork', JSON.stringify(converted));
      ok(!(await api('/api/music/playlists')).data.some(p => p.title === 'Test Creator'), 'and no playlist is made for the creator');
      const myList = (await api('/api/music/playlists', { method: 'POST', body: { title: 'Road trip' } })).data;
      await api(`/api/music/playlists/${myList.id}/songs/bulk`, { method: 'POST', body: { file_ids: [converted.id, song.id] } });
      const rm = await api(`/api/music/playlists/${myList.id}/songs/remove`, { method: 'POST', body: { file_ids: [converted.id] } });
      ok(rm.data.removed === 1 && (await api(`/api/music/playlists/${myList.id}/songs`)).data.length === 1, 'remove several songs from a playlist at once');
      await api(`/api/music/playlists/${myList.id}/songs/bulk`, { method: 'POST', body: { file_ids: [converted.id] } });
      const shownList = (await api('/api/music/playlists')).data.find(p => p.id === myList.id);
      ok(shownList && !shownList.cover_file_id && shownList.display_cover_id === song.cover_file_id, 'a playlist without artwork shows its first song’s', JSON.stringify(shownList));
      await api('/api/downloads/from-videos', { method: 'POST', body: { file_ids: [second.id] } });
      jobs = await waitJobs('audio');
      ok(jobs[0].error === 'Already in your music', 'converting the same video twice is skipped');
      ok((await api('/api/downloads/from-videos', { method: 'POST', body: { file_ids: ['not-mine'] } })).status === 400, 'only your own videos can be converted');

      console.log('\nTrim');
      ok((await api('/api/downloads/trim', { method: 'POST', body: { file_id: second.id, start: 10, end: 5 } })).status === 400, 'an end before the start is refused');
      ok((await api('/api/downloads/trim', { method: 'POST', body: { file_id: 'not-mine', start: 0, end: 5 } })).status === 400, 'only your own videos can be trimmed');
      const clips = await api('/api/media-collections', { method: 'POST', body: { kind: 'videos', title: 'Clips', file_ids: [second.id] } });
      const tc = await api('/api/downloads/trim', { method: 'POST', body: { file_id: second.id, start: 2, end: 12, copy: true } });
      ok(tc.status === 200, 'trim into a copy');
      jobs = await waitJobs('video');
      const tcJob = jobs.find(j => j.id === tc.data.id);
      const allV = (await api('/api/library/videos')).data.items;
      const trimmedCopy = allV.find(x => x.id === tcJob?.file_id);
      ok(tcJob?.status === 'done' && trimmedCopy && trimmedCopy.id !== second.id && trimmedCopy.title === 'Test video second (trimmed)' && trimmedCopy.duration === 10 && trimmedCopy.participants[0] === 'Test Creator',
        'the copy keeps the details, with the new length', JSON.stringify(tcJob));
      ok(allV.some(x => x.id === second.id && x.duration === 42), 'the original is untouched');
      ok((await api(`/api/media-collections/${clips.data.id}/items`)).data.some(x => x.id === trimmedCopy?.id), 'the copy joins the original’s collections');
      const usedBefore = (await api('/api/user/profile')).data.used_bytes;
      const tr = await api('/api/downloads/trim', { method: 'POST', body: { file_id: second.id, start: 0, end: 20, exact: true } });
      jobs = await waitJobs('video');
      const replaced = (await api('/api/library/videos')).data.items.find(x => x.id === second.id);
      ok(jobs.find(j => j.id === tr.data.id)?.status === 'done' && replaced && replaced.duration === 20 && replaced.size_bytes === 8192, 'trim in place (same video, new length)', JSON.stringify(replaced));
      ok((await api('/api/user/profile')).data.used_bytes === usedBefore - (64 * 1024 - 8192), 'storage used follows the new size');
      const back = await api(`/api/files/${second.id}/view`, { raw: true });
      ok(back.status === 200 && Buffer.from(await back.arrayBuffer()).equals(Buffer.alloc(8192, 3)), 'the trimmed video decrypts');

      const songToTrim = (await api('/api/music/songs')).data.songs.find(s => s.id === converted.id);
      const ts = await api('/api/downloads/trim', { method: 'POST', body: { file_id: songToTrim.id, start: 1, end: 9, copy: true, exact: true } });
      jobs = await waitJobs('audio');
      const trimmedSong = (await api('/api/music/songs')).data.songs.find(s => s.id === jobs.find(j => j.id === ts.data?.id)?.file_id);
      ok(trimmedSong && trimmedSong.id !== songToTrim.id && /\.m4a$/.test(trimmedSong.filename) && trimmedSong.duration === 8 && trimmedSong.cover_file_id === songToTrim.cover_file_id && trimmedSong.participants[0] === 'Test Creator',
        'trim a song into a copy (same artist and artwork)', JSON.stringify(trimmedSong));
      const inList = (await api(`/api/music/playlists/${myList.id}/songs`)).data;
      ok(inList.some(s => s.id === trimmedSong?.id), 'the trimmed song joins the original’s playlists');

      const sized = await api(`/api/library/meta/${second.id}`, { method: 'PATCH', body: { width: 1920, height: 1080 } });
      ok(sized.status === 200 && sized.data.width === 1920 && sized.data.height === 1080 && sized.data.duration === 20, 'store a video’s resolution (keeps the other details)');
      ok((await api('/api/library/videos')).data.items.find(x => x.id === second.id)?.height === 1080, 'the library lists the resolution');

      console.log('\nYouTube format fallback');
      await api('/api/downloads', { method: 'POST', body: { url: 'https://www.youtube.com/watch?v=noformat', kind: 'video' } });
      jobs = await waitJobs('video');
      ok(jobs[0].status === 'done', 'a video without the preferred formats downloads in the best available one', jobs[0].error);

      console.log('\nSign-in cookies');
      await api('/api/downloads', { method: 'POST', body: { url: 'https://www.youtube.com/watch?v=agegate', kind: 'video' } });
      jobs = await waitJobs('video');
      ok(jobs[0].status === 'error' && /Profile → Link downloads/.test(jobs[0].error) && !/--cookies/.test(jobs[0].error), 'age-restricted videos explain how to add cookies', jobs[0].error);
      ok((await api('/api/downloads/cookies', { method: 'PUT', body: { text: 'not a cookie file' } })).status === 400, 'a non-cookie file is refused');
      const cookieText = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID\tsecret-value\n';
      const saved = await api('/api/downloads/cookies', { method: 'PUT', body: { text: cookieText } });
      ok(saved.status === 200 && saved.data.sites.includes('youtube.com'), 'save cookies (only the sites are shown back)');
      const onDisk = fs.readdirSync(path.join(tmp, 'private', 'cookies')).map(n => fs.readFileSync(path.join(tmp, 'private', 'cookies', n), 'latin1')).join('');
      ok(onDisk.length > 0 && !onDisk.includes('secret-value'), 'cookies are encrypted at rest');
      await api('/api/downloads', { method: 'POST', body: { url: 'https://www.youtube.com/watch?v=agegate', kind: 'video' } });
      jobs = await waitJobs('video');
      ok(jobs[0].status === 'done', 'with cookies the age-restricted video downloads', jobs[0].error);
      ok(!fs.readdirSync(path.join(tmp, 'temp')).some(n => n.startsWith('dl-')), 'no plain cookie copy is left behind');
      const json = await api('/api/downloads/cookies', { method: 'PUT', body: { text: JSON.stringify([{ domain: '.example.org', name: 'a', value: 'b', path: '/', secure: true, expirationDate: 1893456000 }]) } });
      ok(json.status === 200 && json.data.sites.includes('example.org'), 'JSON cookie exports are accepted too');
      await api('/api/downloads/cookies', { method: 'DELETE' });
      ok((await api('/api/downloads/cookies')).data.saved === false, 'remove saved cookies');
      ok((await api('/api/downloads/clear', { method: 'POST' })).data.removed > 0, 'clear finished downloads');
      const videosFolder = (await api('/api/library/folder/videos')).data.id;
      const inFiles = await api(`/api/directory/${videosFolder}`);
      ok(!inFiles.data.folders.length && inFiles.data.files.length > 0, 'Files shows just the videos, not the Covers folder');
      ok(!(await api('/api/folders/all')).data.some(d => d.system_key === 'video_covers'), 'cover folders are hidden from Move');
      ok(!(await api('/api/search?q=cover')).data.files.length, 'cover images are hidden from search');

      const vc = await api('/api/media-collections', { method: 'POST', body: { kind: 'videos', title: 'Favourites', file_ids: vids.map(x => x.id).slice(0, 1) } });
      ok(vc.status === 200 && vc.data.added === 1, 'create a video collection with items');
      const allVids = (await api('/api/library/videos')).data.items.map(x => x.id);
      await api(`/api/media-collections/${vc.data.id}/items`, { method: 'POST', body: { file_ids: allVids } });
      await api(`/api/media-collections/${vc.data.id}/order`, { method: 'PUT', body: { file_ids: [...allVids].reverse() } });
      let items = (await api(`/api/media-collections/${vc.data.id}/items`)).data;
      ok(items.length === allVids.length && items[0].id === allVids[allVids.length - 1], 'add more and reorder');
      await api('/api/items/trash', { method: 'POST', body: { files: [items[0].id] } });
      items = (await api(`/api/media-collections/${vc.data.id}/items`)).data;
      ok(items.length === allVids.length - 1, 'trashed videos leave the collection view');
      ok((await api(`/api/media-collections/${vc.data.id}`, { method: 'PATCH', body: { title: 'Best' } })).status === 200, 'rename a collection');
      ok((await api(`/api/media-collections/${vc.data.id}`, { method: 'DELETE' })).status === 200, 'delete a collection (videos stay)');
      ok((await api('/api/library/videos')).data.items.length === allVids.length - 1, 'videos are still in the library');

      console.log('\nXXX section');
      ok((await api('/api/user/profile')).data.show_xxx === false, 'off by default');
      ok((await api('/api/library/xxx')).status === 403, 'its library is closed while off');
      ok((await api('/api/library/folder/xxx')).status === 403, 'its folder isn’t created while off');
      ok((await api('/api/downloads', { method: 'POST', body: { url: 'https://example.com/v/x1', kind: 'xxx' } })).status === 403, 'no downloads into it while off');
      ok((await api('/api/user/settings', { method: 'PATCH', body: { show_xxx: true } })).data.show_xxx === true, 'turn it on');
      const xxxLib = await api('/api/library/xxx');
      ok(xxxLib.status === 200 && !xxxLib.data.items.length, 'an empty section of its own');
      const xxxFolder = xxxLib.data.folderId;
      ok((await upload(Buffer.from('not a video'), 'notes.txt', xxxFolder)).status === 400, 'it only accepts videos');
      const xUp = await upload(crypto.randomBytes(4096), 'private clip.mp4', xxxFolder);
      ok(xUp.status === 200, 'upload a video into it');
      await api('/api/downloads', { method: 'POST', body: { url: 'https://example.com/v/x1', kind: 'xxx' } });
      jobs = await waitJobs('xxx');
      const xJob = jobs.find(j => j.url.endsWith('/x1'));
      ok(xJob?.status === 'done', 'download a link into it', JSON.stringify(xJob));
      const xItems = (await api('/api/library/xxx')).data.items;
      const xDl = xItems.find(x => x.id === xJob?.file_id);
      ok(xItems.length === 2 && xDl && xDl.thumb_file_id && xDl.participants[0] === 'Test Creator', 'downloads land here with title, creator and cover');
      const xCovers = (await api('/api/library/folder/xxx_covers')).data.id;
      ok((await api(`/api/directory/${xCovers}`)).data.files.some(f => f.id === xDl?.thumb_file_id), 'its covers go to XXX/Covers, not Videos/Covers');
      ok(!(await api('/api/library/videos')).data.items.some(x => x.id === xDl?.id || x.id === xUp.data.fileId), 'nothing shows up in Videos');
      ok(!(await api('/api/downloads?kind=video')).data.some(j => j.url.endsWith('/x1')), 'its downloads are listed separately');
      const xCol = await api('/api/media-collections', { method: 'POST', body: { kind: 'xxx', title: 'Private', file_ids: [xUp.data.fileId] } });
      ok(xCol.status === 200 && xCol.data.added === 1 && (await api('/api/media-collections?kind=xxx')).data.length === 1 && !(await api('/api/media-collections?kind=videos')).data.some(c => c.id === xCol.data.id), 'collections of its own');
      ok((await api('/api/directory')).data.folders.some(d => d.system_key === 'xxx') && (await api('/api/search?q=private clip')).data.files.length === 1, 'while on, Files and search show it');
      await api('/api/user/settings', { method: 'PATCH', body: { show_xxx: false } });
      ok(!(await api('/api/directory')).data.folders.some(d => d.system_key === 'xxx'), 'turned off, Files hides the folder');
      ok((await api(`/api/directory/${xxxFolder}`)).status === 404, 'and the folder can’t be opened');
      ok(!(await api('/api/search?q=private clip')).data.files.length && !(await api('/api/folders/all')).data.some(d => d.system_key === 'xxx'), 'search and Move leave it out');
      await api('/api/user/settings', { method: 'PATCH', body: { show_xxx: true } });
      ok((await api('/api/library/xxx')).data.items.length === 2, 'turned on again, everything is still there');
      ok((await api('/api/folders', { method: 'POST', body: { name: 'XXX' } })).status === 200 && (await api('/api/directory')).data.folders.filter(d => d.name === 'XXX').length === 2, 'a user folder named XXX stays a normal folder');

      console.log('\nSecurity');
      const htmlUp = await upload(Buffer.from('<script>alert(1)</script>'), 'page.html', null);
      const htmlView = await api(`/api/files/${htmlUp.data.fileId}/view`, { raw: true });
      ok(/sandbox/.test(htmlView.headers.get('content-security-policy') || ''), 'uploaded HTML is sandboxed');
      const fd = new FormData();
      fd.append('upload_id', crypto.randomUUID()); fd.append('chunk_index', '0'); fd.append('total_chunks', '1'); fd.append('offset', '0'); fd.append('total_size', '4');
      fd.append('file', new Blob([Buffer.from('<b>x')], { type: 'text/plain' }), 'odd.bin');
      const oddUp = await api('/api/files/upload', { method: 'POST', body: fd });
      const oddView = await api(`/api/files/${oddUp.data.fileId}/view`, { raw: true });
      ok(/sandbox/.test(oddView.headers.get('content-security-policy') || ''), 'every opened file is sandboxed, whatever type the browser claimed');
      ok(!(await api('/api/health', { headers: { Origin: 'https://evil.example' }, auth: false })).headers.get('access-control-allow-origin'), 'other sites get no CORS access');
      const forged = require('jsonwebtoken').sign({ id: 'admin-uuid-0000', username: 'admin', role: 'admin', tv: 0 }, '', { algorithm: 'none' });
      ok((await api('/api/user/profile', { headers: { Authorization: `Bearer ${forged}` }, auth: false })).status === 401, 'unsigned tokens are refused');
      ok((await api('/api/downloads', { method: 'POST', body: { url: 'http://[::ffff:127.0.0.1]/x', kind: 'video' } })).status === 400, 'IPv4-mapped loopback links are refused');
      ok((await api('/api/downloads', { method: 'POST', body: { url: 'http://100.64.0.1/x', kind: 'video' } })).status === 400, 'shared-address-space links are refused');
      ok((await api('/api/downloads', { method: 'POST', body: { url: 'http://router.lan/x', kind: 'video' } })).status === 400, 'LAN names are refused');

      console.log('\nAccounts');
      const u = await api('/api/admin/users', { method: 'POST', body: { username: 'checker', password: 'secret123', quota: 1024 * 1024 } });
      ok(u.status === 200, 'admin creates a user');
      ok((await api('/api/admin/users', { method: 'POST', body: { username: 'CHECKER', password: 'secret123' } })).status === 400, 'usernames are unique regardless of case');
      ok((await api('/api/admin/users', { method: 'POST', body: { username: 'shorty', password: 'abc12' } })).status === 400, 'short passwords are refused');
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

      console.log('\nUpdates');
      const upd = await api('/api/admin/updates');
      ok(upd.status === 200 && upd.data.enabled === false && upd.data.repo === 'Akulav/akulavbox' && upd.data.current === health.data.version, 'update info (repo from package.json, off in tests)');
      ok((await api('/api/admin/updates/apply', { method: 'POST' })).status === 400, 'nothing to install without a newer version');
      ok((await api('/api/admin/updates/rollback', { method: 'POST' })).status === 400, 'no rollback before an update');
      process.env.STORAGE_DIR = tmp; // the module loads config, which must not touch the real storage/
      const { newer, notesSince } = require('../src/core/updater');
      ok(newer('2.10.0', '2.9.9') && !newer('2.2.0', '2.2.0') && !newer('1.9.9', '2.0.0'), 'version comparison');
      ok(notesSince('# C\n\n## 2.3.0 (x)\n- new\n\n## 2.2.0 (y)\n- old\n', '2.2.0') === '## 2.3.0 (x)\n- new', 'release notes since the installed version');

      console.log('\nStorage check');
      const adminDir = path.join(tmp, 'users', 'admin-uuid-0000');
      const old = new Date(Date.now() - 2 * 3600 * 1000);
      const orphanEnc = path.join(adminDir, `${crypto.randomUUID()}.enc`);
      const orphanPlain = path.join(adminDir, `${crypto.randomUUID()}.plain`);
      fs.writeFileSync(orphanEnc, crypto.randomBytes(5000));
      fs.writeFileSync(orphanPlain, Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100)]));
      fs.mkdirSync(path.join(tmp, 'users', 'gone-user'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'users', 'gone-user', 'x.enc'), Buffer.alloc(3000));
      for (const p of [orphanEnc, orphanPlain, path.join(tmp, 'users', 'gone-user', 'x.enc')]) fs.utimesSync(p, old, old);
      const lost = await upload(Buffer.from('soon gone'), 'lost.txt', null);
      const lostRow = fs.readdirSync(adminDir).find(n => n.startsWith(lost.data.fileId));
      fs.unlinkSync(path.join(adminDir, lostRow));
      const sdb = new (require('node:sqlite').DatabaseSync)(path.join(tmp, 'akulavbox.db'));
      sdb.prepare("UPDATE users SET used_bytes = used_bytes + 999999 WHERE id = 'admin-uuid-0000'").run();
      sdb.close();
      const scan = (await api('/api/admin/storage-check')).data;
      ok(scan.orphans.length === 3 && scan.orphan_bytes === 5000 + 109 + 3000 && scan.recoverable === 1, 'finds files the database doesn’t know', JSON.stringify(scan.orphans));
      ok(scan.missing.length === 1 && scan.missing[0].id === lost.data.fileId, 'finds files missing on disk');
      ok(scan.usage.some(u => u.id === 'admin-uuid-0000' && u.recorded - u.actual === 999999), 'finds drifted usage counters');
      const cleaned = (await api('/api/admin/storage-check/clean', { method: 'POST', body: {} })).data;
      ok(cleaned.deleted === 2 && cleaned.recovered === 1 && cleaned.removed_rows === 1 && cleaned.usage_fixed >= 1, 'clean up', JSON.stringify(cleaned));
      const after = (await api('/api/admin/storage-check')).data;
      ok(!after.orphans.length && !after.missing.length && !after.usage.length, 'nothing left to fix', JSON.stringify(after).slice(0, 300));
      const recFolder = (await api('/api/directory')).data.folders.find(d => d.name === 'Recovered files');
      const rec = recFolder && (await api(`/api/directory/${recFolder.id}`)).data.files;
      ok(rec && rec.length === 1 && /\.pdf$/.test(rec[0].filename), 'a readable lost file is recovered with its type');
      ok(!fs.existsSync(path.join(tmp, 'users', 'gone-user')), 'leftovers of deleted accounts are removed');

      console.log('\nBackup and restore');
      const marker = crypto.randomBytes(300 * 1024);
      const kept = await upload(marker, 'keep-me.bin', null);
      const form = new URLSearchParams({ token, passphrase: 'correct horse battery' });
      ok((await api('/api/admin/backup/export', { method: 'POST', body: new URLSearchParams({ token, passphrase: 'short' }).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status === 400, 'export needs a real passphrase');
      const exp = await api('/api/admin/backup/export', { method: 'POST', body: form.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, raw: true });
      const archive = Buffer.from(await exp.arrayBuffer());
      const backupFile = path.join(tmp, 'temp', 'test-backup.akbx');
      fs.writeFileSync(backupFile, archive);
      ok(exp.status === 200 && archive.subarray(0, 4).toString() === 'AKBX', `export a full backup (${Math.round(archive.length / 1024)} KB)`);
      ok(!archive.includes(marker.subarray(0, 64)) && !archive.includes(Buffer.from('admin-uuid-0000')), 'the backup is encrypted');

      // restore into a second, empty server that uses a different MASTER_KEY
      const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'akulavbox-check2-'));
      const env2 = { ...env, STORAGE_DIR: tmp2, PORT: String(port + 1), MASTER_KEY: crypto.randomBytes(16).toString('hex') };
      const base1 = base;
      const boot2 = async () => {
        const s = spawn(process.execPath, ['src/server.js'], { cwd: root, env: env2, stdio: ['ignore', 'pipe', 'pipe'] });
        s.stdout.on('data', d => { log += d; }); s.stderr.on('data', d => { log += d; });
        base = `http://127.0.0.1:${port + 1}`;
        for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch (e) { /* not yet */ } await new Promise(r => setTimeout(r, 250)); }
        return s;
      };
      let s2 = await boot2();
      try {
        token = (await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin' } })).data.token;
        const uploadId = crypto.randomUUID();
        const half = Math.floor(archive.length / 2);
        await api(`/api/admin/backup/upload?id=${uploadId}&offset=0`, { method: 'PUT', body: archive.subarray(0, half), headers: { 'Content-Type': 'application/octet-stream' } });
        const up2 = await api(`/api/admin/backup/upload?id=${uploadId}&offset=${half}`, { method: 'PUT', body: archive.subarray(half), headers: { 'Content-Type': 'application/octet-stream' } });
        ok(up2.status === 200 && up2.data.size === archive.length, 'upload a backup in chunks');
        ok((await api('/api/admin/backup/import', { method: 'POST', body: { id: uploadId, passphrase: 'wrong passphrase' } })).status === 400, 'a wrong passphrase is refused at once');
        const imp = await api('/api/admin/backup/import', { method: 'POST', body: { id: uploadId, passphrase: 'correct horse battery' } });
        let st2;
        for (let i = 0; i < 80; i++) { st2 = (await api('/api/admin/backup')).data; if (!st2.import.running) break; await new Promise(r => setTimeout(r, 250)); }
        ok(imp.status === 200 && st2.import.pending && st2.import.pending.rekeyed, 'the backup is verified and staged', JSON.stringify(st2.import));
        const restart = await api('/api/admin/restart', { method: 'POST' });
        await new Promise(r => s2.once('exit', r));
        ok(restart.status === 200, 'restart to apply it');
        s2 = await boot2();
        token = (await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'admin' } })).data.token;
        const st3 = (await api('/api/admin/backup')).data;
        ok(st3.restored && st3.restored.files > 0 && !st3.import.pending, 'restored on start');
        const back = await api(`/api/files/${kept.data.fileId}/view`, { raw: true });
        ok(back.status === 200 && Buffer.from(await back.arrayBuffer()).equals(marker), 'files open on a server with a different key');
        ok((await api('/api/music/playlists')).data.some(p => p.title === 'Road trip'), 'playlists and library details came along');
        ok(fs.readdirSync(path.join(tmp2, 'backups')).some(n => n.startsWith('pre-import-')), 'the replaced data is kept in backups/');
      } finally {
        s2.kill();
        base = base1;
        await new Promise(r => setTimeout(r, 300));
        try { fs.rmSync(tmp2, { recursive: true, force: true }); } catch (e) { /* Windows may still hold files */ }
      }
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
