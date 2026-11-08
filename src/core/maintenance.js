const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const store = require('./storage');
const { guessMime } = require('./mime');

// ---------------------------------------------------------------------------
// Storage check: compares storage/users/ with the database.
//  - orphans:  files on disk that no file row points to (left by crashes, old
//              versions or deleted accounts). Encrypted ones can't be opened
//              any more (their IV was in the missing row), so they are deleted.
//              Plain ones (shared files) are readable and are recovered into a
//              "Recovered files" folder when their owner still exists.
//  - missing:  file rows whose data is gone. Removed with purgeFile() so every
//              album, playlist and cover reference goes too.
//  - usage:    users.used_bytes drifting from the real total, fixed in place.
// Files written in the last hour are left alone: an upload may be finishing.
// ---------------------------------------------------------------------------

const NAME_RE = /^([\w-]{1,64})\.(enc|plain)$/;
const FRESH_MS = 60 * 60 * 1000;

function scan() {
  const users = new Map(db.prepare('SELECT id, username, used_bytes FROM users').all().map(u => [u.id, u]));
  const rows = db.prepare('SELECT id, owner_id, filename, size_bytes, is_encrypted, iv_hex, trashed_at FROM files').all();
  const expected = new Map(rows.map(r => [`${r.owner_id}/${r.id}.${r.is_encrypted ? 'enc' : 'plain'}`, r]));
  const byId = new Map(rows.map(r => [r.id, r]));
  const orphans = [];
  const seen = new Set();
  let diskFiles = 0, diskBytes = 0;
  const now = Date.now();

  let dirs = [];
  try { dirs = fs.readdirSync(config.usersDir, { withFileTypes: true }); } catch (e) { /* no users dir yet */ }
  for (const d of dirs) {
    const dir = path.join(config.usersDir, d.name);
    if (!d.isDirectory()) {
      try { const st = fs.statSync(dir); orphans.push({ owner: null, name: d.name, path: dir, bytes: st.size, reason: 'stray file' }); } catch (e) { /* gone */ }
      continue;
    }
    const owner = users.get(d.name);
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      let st;
      try { st = fs.statSync(p); } catch (e) { continue; }
      if (f.isDirectory()) { orphans.push({ owner: d.name, name: f.name + '/', path: p, bytes: 0, reason: 'unexpected folder', dir: true }); continue; }
      diskFiles++; diskBytes += st.size;
      const key = `${d.name}/${f.name}`;
      if (expected.has(key)) { seen.add(key); continue; }
      if (now - st.mtimeMs < FRESH_MS) continue;
      const m = NAME_RE.exec(f.name);
      const row = m && byId.get(m[1]);
      // the row's own copy is gone but this one has the data: it's how clean() repairs the row
      if (row && row.owner_id === d.name && !fs.existsSync(path.join(dir, `${row.id}.${row.is_encrypted ? 'enc' : 'plain'}`))) continue;
      const reason = !owner ? 'account was deleted'
        : f.name.endsWith('.swap') ? 'unfinished sharing change'
        : !m ? 'unknown file'
        : row ? 'stale copy (the file was shared or unshared)'
        : 'not in the database';
      orphans.push({ owner: d.name, username: owner?.username || null, name: f.name, path: p, bytes: st.size, reason, plain: !!(m && m[2] === 'plain' && !row && owner) });
    }
  }

  const missing = [];
  for (const [key, r] of expected) {
    if (seen.has(key)) continue;
    const other = path.join(config.usersDir, r.owner_id, `${r.id}.${r.is_encrypted ? 'plain' : 'enc'}`);
    missing.push({ id: r.id, owner: r.owner_id, username: users.get(r.owner_id)?.username || null, filename: r.filename, bytes: r.size_bytes,
      trashed: !!r.trashed_at, repairable: fs.existsSync(other) && (r.is_encrypted || !!r.iv_hex) });
  }

  // real usage: every file row (trash included, as quotas count it) + chat files still on disk
  const actual = new Map();
  for (const r of rows) actual.set(r.owner_id, (actual.get(r.owner_id) || 0) + (r.size_bytes || 0));
  for (const m of db.prepare("SELECT sender_id, file_size, file_path FROM messages WHERE type = 'file' AND file_path IS NOT NULL").all()) {
    if (m.file_path && fs.existsSync(m.file_path)) actual.set(m.sender_id, (actual.get(m.sender_id) || 0) + (m.file_size || 0));
  }
  const usage = [...users.values()].map(u => ({ id: u.id, username: u.username, recorded: u.used_bytes || 0, actual: actual.get(u.id) || 0 }))
    .filter(u => u.recorded !== u.actual);

  const sum = (l) => l.reduce((a, x) => a + (x.bytes || 0), 0);
  return {
    disk_files: diskFiles, disk_bytes: diskBytes,
    db_files: rows.length, db_bytes: rows.reduce((a, r) => a + (r.size_bytes || 0), 0),
    orphans: orphans.map(({ path: p, ...o }) => o), orphan_bytes: sum(orphans),
    recoverable: orphans.filter(o => o.plain).length,
    missing, missing_bytes: sum(missing),
    usage,
    checked_at: new Date().toISOString(),
    _orphans: orphans,
  };
}

/** Sniff a file type from its first bytes so recovered files open in the right viewer */
function sniffExt(p) {
  let b;
  try { const fd = fs.openSync(p, 'r'); b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, 0); fs.closeSync(fd); } catch (e) { return 'bin'; }
  const hex = b.toString('hex');
  const ascii = b.toString('latin1');
  if (hex.startsWith('ffd8ff')) return 'jpg';
  if (hex.startsWith('89504e47')) return 'png';
  if (ascii.startsWith('GIF8')) return 'gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'webp';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return 'wav';
  if (ascii.slice(4, 8) === 'ftyp') return /M4A/.test(ascii) ? 'm4a' : /avif/.test(ascii) ? 'avif' : /heic|mif1/.test(ascii) ? 'heic' : 'mp4';
  if (hex.startsWith('1a45dfa3')) return 'mkv';
  if (ascii.startsWith('%PDF')) return 'pdf';
  if (ascii.startsWith('PK')) return 'zip';
  if (ascii.startsWith('ID3') || hex.startsWith('fffb') || hex.startsWith('fff3')) return 'mp3';
  if (ascii.startsWith('fLaC')) return 'flac';
  if (ascii.startsWith('OggS')) return 'ogg';
  return 'bin';
}

/**
 * Fix what scan() found. `what` picks the parts: { orphans, missing, usage } (all default on).
 * Returns counts of what changed.
 */
function clean(what = {}) {
  const opt = { orphans: true, missing: true, usage: true, ...what };
  const report = scan();
  const done = { deleted: 0, freed_bytes: 0, recovered: 0, repaired: 0, removed_rows: 0, usage_fixed: 0 };

  if (opt.orphans) {
    const recoverInto = new Map(); // owner -> folder id
    for (const o of report._orphans) {
      if (o.plain) {
        // a readable shared file that lost its row: give it back to its owner
        try {
          let folderId = recoverInto.get(o.owner);
          if (!folderId) {
            const hit = db.prepare("SELECT id FROM folders WHERE owner_id = ? AND parent_id IS NULL AND name = 'Recovered files' AND trashed_at IS NULL AND system_key IS NULL").get(o.owner);
            folderId = hit ? hit.id : crypto.randomUUID();
            if (!hit) db.prepare("INSERT INTO folders (id, owner_id, parent_id, name) VALUES (?, ?, NULL, 'Recovered files')").run(folderId, o.owner);
            recoverInto.set(o.owner, folderId);
          }
          const ext = sniffExt(o.path);
          const id = path.basename(o.name, '.plain');
          const name = `Recovered ${id.slice(0, 8)}.${ext}`;
          db.prepare(`INSERT INTO files (id, owner_id, folder_id, filename, size_bytes, mime_type, is_encrypted, iv_hex, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, NULL, datetime('now'))`).run(id, o.owner, folderId, name, o.bytes, guessMime(name));
          done.recovered++;
          continue;
        } catch (e) { /* fall through and delete it */ }
      }
      try {
        if (o.dir) fs.rmSync(o.path, { recursive: true, force: true }); else fs.unlinkSync(o.path);
        done.deleted++; done.freed_bytes += o.bytes;
      } catch (e) { /* in use or gone */ }
    }
    // folders of deleted accounts that are now empty
    for (const o of report._orphans) {
      if (o.owner && !db.prepare('SELECT 1 FROM users WHERE id = ?').get(o.owner)) {
        try { fs.rmdirSync(path.join(config.usersDir, o.owner)); } catch (e) { /* not empty or gone */ }
      }
    }
  }

  if (opt.missing) {
    for (const m of report.missing) {
      const row = db.prepare('SELECT * FROM files WHERE id = ?').get(m.id);
      if (!row) continue;
      if (m.repairable) {
        // the data is there under the other name: point the row at it
        db.prepare('UPDATE files SET is_encrypted = ?, public_hash = CASE WHEN ? = 1 THEN NULL ELSE public_hash END WHERE id = ?')
          .run(row.is_encrypted ? 0 : 1, row.is_encrypted ? 0 : 1, row.id);
        done.repaired++;
      } else {
        db.tx(() => store.purgeFile(row));
        done.removed_rows++;
      }
    }
  }

  if (opt.usage) {
    // measured after the steps above, which change the totals
    for (const u of scan().usage) {
      db.prepare('UPDATE users SET used_bytes = ? WHERE id = ?').run(u.actual, u.id);
      done.usage_fixed++;
    }
  }
  return done;
}

function publicScan() {
  const { _orphans, ...r } = scan();
  return r;
}

module.exports = { scan: publicScan, clean, sniffExt };
