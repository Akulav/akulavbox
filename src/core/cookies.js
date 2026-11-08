const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const store = require('./storage');

// ---------------------------------------------------------------------------
// Sign-in cookies for link downloads (age-restricted or members-only videos).
// Each user can save a cookies.txt export from their browser. It is kept
// encrypted (16-byte IV, then AES-256-CTR with MASTER_KEY) and only written out
// in plain text into a job's private work folder while yt-dlp runs.
// ---------------------------------------------------------------------------

const MAX_BYTES = 1024 * 1024;
const dir = () => path.join(config.privateDir, 'cookies');
const fileOf = (userId) => path.join(dir(), `${String(userId).replace(/[^\w-]/g, '')}.enc`);

/**
 * Accepts a Netscape cookies.txt or a JSON export (array of { domain, name, value, … }).
 * Returns the Netscape text, or throws a user-facing error.
 */
function normalize(raw) {
  const text = String(raw || '').replace(/^﻿/, '').trim();
  if (!text) throw new Error('Paste the contents of a cookies.txt file.');
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('That cookie file is larger than 1 MB.');
  if (text.startsWith('[') || text.startsWith('{')) {
    let list;
    try { list = JSON.parse(text); } catch (e) { throw new Error('That JSON couldn’t be read.'); }
    if (!Array.isArray(list)) list = list.cookies || [];
    const lines = list.filter(c => c && c.name && c.domain).map(c => {
      const domain = String(c.domain);
      const exp = Math.floor(Number(c.expirationDate || c.expires || 0)) || 0;
      return [domain, domain.startsWith('.') ? 'TRUE' : 'FALSE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', exp, c.name, c.value ?? ''].join('\t');
    });
    if (!lines.length) throw new Error('No cookies found in that JSON.');
    return `# Netscape HTTP Cookie File\n${lines.join('\n')}\n`;
  }
  const rows = text.split(/\r?\n/).filter(l => l && (!l.startsWith('#') || l.startsWith('#HttpOnly_')));
  if (!rows.length || !rows.every(l => l.split('\t').length >= 7)) {
    throw new Error('That isn’t a cookies.txt file. Export one with a browser extension (Netscape format), then paste or upload it.');
  }
  return `# Netscape HTTP Cookie File\n${rows.join('\n')}\n`;
}

const domainsOf = (text) => [...new Set(text.split('\n').filter(l => l && !l.startsWith('# ')).map(l => l.split('\t')[0].replace(/^#HttpOnly_/, '').replace(/^\./, '').replace(/^www\./, '')).filter(Boolean))].sort();

function save(userId, raw) {
  const text = normalize(raw);
  fs.mkdirSync(dir(), { recursive: true });
  const iv = crypto.randomBytes(16);
  const c = store.ctrAt(iv.toString('hex'), 0);
  const tmp = fileOf(userId) + '.tmp';
  fs.writeFileSync(tmp, Buffer.concat([iv, c.update(Buffer.from(text, 'utf-8')), c.final()]), { mode: 0o600 });
  fs.renameSync(tmp, fileOf(userId));
  return info(userId);
}

function read(userId) {
  let buf;
  try { buf = fs.readFileSync(fileOf(userId)); } catch (e) { return null; }
  if (buf.length < 17) return null;
  const c = store.ctrAt(buf.subarray(0, 16).toString('hex'), 0);
  return Buffer.concat([c.update(buf.subarray(16)), c.final()]).toString('utf-8');
}

function info(userId) {
  const text = read(userId);
  if (!text) return { saved: false, sites: [] };
  let updated = null;
  try { updated = fs.statSync(fileOf(userId)).mtime.toISOString(); } catch (e) { /* none */ }
  return { saved: true, sites: domainsOf(text).slice(0, 40), updated_at: updated };
}

function remove(userId) {
  try { fs.unlinkSync(fileOf(userId)); return true; } catch (e) { return false; }
}

/** Write the user's cookies into a job's work folder for yt-dlp; returns the path or null */
function writeFor(userId, workDir) {
  const text = read(userId);
  if (!text) return null;
  const p = path.join(workDir, 'cookies.txt');
  fs.writeFileSync(p, text, { mode: 0o600 });
  return p;
}

module.exports = { normalize, save, read, info, remove, writeFor, fileOf, dir };
