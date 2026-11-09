const crypto = require('crypto');
const db = require('./db');

// ---------------------------------------------------------------------------
// Server-wide settings, stored as JSON in the `settings` table (so they travel
// with full backups). Secrets inside them are sealed with a key derived from
// MASTER_KEY (AES-256-GCM): a database copy alone doesn't reveal them, and after
// a restore onto a server with another key they read as missing, not as garbage.
// ---------------------------------------------------------------------------

const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setStmt = db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);

function get(key, fallback = null) {
  const row = getStmt.get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch (e) { return fallback; }
}

function set(key, value) { setStmt.run(key, JSON.stringify(value)); return value; }

const sealKey = () => crypto.createHash('sha256').update(`akulavbox-settings:${process.env.MASTER_KEY || ''}`).digest();

function seal(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', sealKey(), iv);
  const body = Buffer.concat([c.update(String(text), 'utf-8'), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')}`;
}

/** The sealed text, or null when it is missing or was sealed with another MASTER_KEY */
function open(sealed) {
  if (typeof sealed !== 'string' || !sealed.startsWith('v1:')) return null;
  try {
    const b = Buffer.from(sealed.slice(3), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', sealKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf-8');
  } catch (e) { return null; }
}

module.exports = { get, set, seal, open };
