const fs = require('fs');
const path = require('path');
const config = require('./config');

// The server's disk: free space for every app (uploads, backups, restores), and folder sizes.

function diskSpace() {
  try {
    const s = fs.statfsSync(config.storageDir);
    const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
    return { total, free, used: total - s.bfree * s.bsize };
  } catch (e) { return null; }
}

/** Is there room for `bytes` more, keeping the configured reserve free? */
function hasRoomFor(bytes) {
  const d = diskSpace();
  return !d || d.free - bytes >= config.diskReserveBytes;
}

async function dirSize(dir) {
  let bytes = 0, files = 0;
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return { bytes, files }; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const s = await dirSize(p); bytes += s.bytes; files += s.files; }
    else { try { bytes += (await fs.promises.stat(p)).size; files++; } catch (err) { /* vanished */ } }
  }
  return { bytes, files };
}

module.exports = { diskSpace, hasRoomFor, dirSize };
