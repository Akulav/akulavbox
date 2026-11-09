const fs = require('fs');
const path = require('path');
const config = require('./config');

// storage/akulavbox.pid names the server that is using this storage folder. A second
// copy started on the same folder (a leftover window, a service plus a manual start)
// must not swap a restore in under the running one.
const pidFile = path.join(config.storageDir, 'akulavbox.pid');

/** True when a process with this id exists (EPERM: it exists, we just can't signal it) */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** The id of another live server on this storage folder, or null */
function otherServer() {
  let pid;
  try { pid = Number(JSON.parse(fs.readFileSync(pidFile, 'utf-8')).pid); } catch (e) { return null; }
  return pid !== process.pid && alive(pid) ? pid : null;
}

function claim() {
  const other = otherServer();
  if (other) { console.warn(`[config] Warning: another AkulavBox (process ${other}) uses this storage folder too. Two servers on one folder can damage data.`); return; }
  try { fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, port: config.port, started_at: new Date().toISOString() })); } catch (e) { /* read-only storage: nothing to guard */ }
}

function release() {
  try { if (Number(JSON.parse(fs.readFileSync(pidFile, 'utf-8')).pid) === process.pid) fs.rmSync(pidFile, { force: true }); } catch (e) { /* already gone */ }
}

module.exports = { pidFile, alive, otherServer, claim, release };
