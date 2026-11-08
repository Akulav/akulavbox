const path = require('path');
const fs = require('fs');

// Loaded once, before anything else touches process.env
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const pkg = require('../../package.json');

// Storage stays relative to the working directory by default (that is where
// earlier versions put it), but can be moved with STORAGE_DIR.
const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || path.join(process.cwd(), 'storage'));

const config = {
  name: 'AkulavBox',
  author: 'Akulav',
  version: pkg.version,
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'warn',
  storageDir: STORAGE_DIR,
  dbPath: path.join(STORAGE_DIR, 'akulavbox.db'),
  usersDir: path.join(STORAGE_DIR, 'users'),
  tempDir: path.join(STORAGE_DIR, 'temp'),
  chatDir: path.join(STORAGE_DIR, 'chat_temp'),
  thumbsDir: path.join(STORAGE_DIR, 'thumbs'),
  backupsDir: path.join(STORAGE_DIR, 'backups'),
  // per-user secrets for link downloads (sign-in cookies), encrypted with MASTER_KEY
  privateDir: path.join(STORAGE_DIR, 'private'),
  // a restore waiting to be applied on the next start (see core/backup.js)
  importDir: path.join(STORAGE_DIR, 'import-staging'),
  // Days a deleted item stays in the trash before it is removed for good
  trashDays: Math.max(1, Number(process.env.TRASH_DAYS) || 30),
  // Uploads are refused when they would leave less than this much free disk
  diskReserveBytes: Math.max(0, Number(process.env.DISK_RESERVE_MB ?? 512)) * 1024 * 1024,
  tokenTtl: process.env.TOKEN_TTL || '7d',
};

/** Fail fast with a readable message instead of a crash on the first upload or login */
function validate() {
  const problems = [];
  const warnings = [];
  const key = process.env.MASTER_KEY;
  if (!key) problems.push('MASTER_KEY is not set. Copy .env.example to .env and set a 32-character key.');
  else if (Buffer.byteLength(key, 'utf-8') !== 32) problems.push(`MASTER_KEY must be exactly 32 bytes (it is ${Buffer.byteLength(key, 'utf-8')}).`);
  if (!process.env.JWT_SECRET) problems.push('JWT_SECRET is not set. Use a long random string.');
  else if (process.env.JWT_SECRET === 'change-me' || process.env.JWT_SECRET.length < 16) warnings.push('JWT_SECRET is short or still the example value. Use a long random string.');
  if (key === 'change-me-to-exactly-32-chars!!!') warnings.push('MASTER_KEY is still the example value. Anyone with the example key could decrypt your files.');
  return { problems, warnings };
}

for (const dir of [config.storageDir, config.usersDir, config.tempDir, config.chatDir, config.thumbsDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

module.exports = { ...config, validate };
