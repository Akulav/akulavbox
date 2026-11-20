const db = require('../core/db');
const fs = require('fs');
const path = require('path');
const config = require('../core/config');
const { verifyAdmin, fromForm } = require('../core/auth');
const activity = require('../core/activity');
const schedule = require('../core/schedule');
const store = require('../core/disk');
const backup = require('../core/backup');
const { LATEST } = require('../core/migrations');

// Admin → Backup and restore: full backups (export, scheduled ones, restore staged for the next start)

module.exports = async function (fastify) {
  // --- Full backup and restore ---
  fastify.get('/api/admin/backup', { preHandler: verifyAdmin }, async () => ({
    estimate: backup.estimate(db), import: { ...backup.state, staging: backup.stagingBy(), pending: backup.pending() }, restored: db.restored || null,
    schedule: schedule.status(),
  }));

  // Scheduled backups: { enabled, every, hour, weekday, keep, dir, passphrase? }
  fastify.put('/api/admin/backup/schedule', { preHandler: verifyAdmin }, async (request, reply) => {
    let s;
    try { s = schedule.save(request.body); } catch (e) { return reply.code(400).send({ error: e.message }); }
    activity.log(request, 'backup.schedule_changed', { detail: s.enabled ? `${s.every === 'weekly' ? 'Weekly' : 'Daily'} at ${String(s.hour).padStart(2, '0')}:00, keep ${s.keep}, in ${s.dir || s.default_dir}` : 'Off' });
    return s;
  });
  // Make a scheduled-style backup now; poll GET /api/admin/backup for progress
  fastify.post('/api/admin/backup/schedule/run', { preHandler: verifyAdmin }, async (request, reply) => {
    if (schedule.state.running) return reply.code(409).send({ error: 'A scheduled backup is already running.' });
    schedule.run({ request }).catch(() => { /* recorded in the status */ });
    return { success: true, started: true };
  });

  // Export is a form post (token, passphrase) so the browser streams the file straight to disk.
  fastify.post('/api/admin/backup/export', { preHandler: fromForm(verifyAdmin) }, async (request, reply) => {
    let stream;
    try { stream = backup.exportStream(db, request.body?.passphrase); }
    catch (e) { return reply.code(400).type('text/plain; charset=utf-8').send(e.message); }
    const name = `akulavbox-backup-${new Date().toISOString().slice(0, 10)}.akbx`;
    activity.log(request, 'backup.exported', { target: name });
    stream.on('error', (e) => fastify.log.error(e, 'backup export failed'));
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    reply.header('Cache-Control', 'no-store');
    return reply.send(stream);
  });

  // Upload a backup in raw chunks (proxies often cap request size): PUT ?id=&offset=
  const IMPORT_ID = /^[\w-]{8,64}$/;
  const importPath = (id) => path.join(config.tempDir, `import-${id}.akbx`);
  fastify.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 32 * 1024 * 1024 }, (req, body, done) => done(null, body));
  const uploadedSize = (id) => { try { return fs.statSync(importPath(id)).size; } catch (e) { return 0; } };
  // How much of an upload the server has, so a dropped connection or a reload resumes instead of starting over
  fastify.get('/api/admin/backup/upload', { preHandler: verifyAdmin }, async (request, reply) => {
    const id = String(request.query.id || '');
    if (!IMPORT_ID.test(id)) return reply.code(400).send({ error: 'Bad upload id' });
    return { size: uploadedSize(id) };
  });
  fastify.put('/api/admin/backup/upload', { preHandler: verifyAdmin, bodyLimit: 32 * 1024 * 1024 }, async (request, reply) => {
    const id = String(request.query.id || '');
    const offset = Number(request.query.offset);
    if (!IMPORT_ID.test(id) || !Number.isSafeInteger(offset) || offset < 0) return reply.code(400).send({ error: 'Bad upload id or offset' });
    const p = importPath(id);
    const current = uploadedSize(id);
    // the answer carries the size, so the page can carry on from there
    if (offset > current) return reply.code(409).send({ error: 'Upload chunk out of order', size: current });
    const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    if (!store.hasRoomFor(body.length * 2)) return reply.code(507).send({ error: 'The server’s disk is full.' });
    fs.mkdirSync(config.tempDir, { recursive: true });
    if (offset === 0) fs.writeFileSync(p, body);
    else { if (offset < current) fs.truncateSync(p, offset); fs.appendFileSync(p, body); }
    return { success: true, size: offset + body.length };
  });

  // Unpack and verify an uploaded backup ({ id }) or one already on the server ({ server_path }).
  // Runs in the background; poll GET /api/admin/backup. The swap happens on the next restart.
  fastify.post('/api/admin/backup/import', { preHandler: verifyAdmin }, async (request, reply) => {
    const { id, server_path: serverPath, passphrase } = request.body || {};
    const file = serverPath ? path.resolve(String(serverPath)) : (IMPORT_ID.test(String(id || '')) ? importPath(id) : null);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return reply.code(400).send({ error: serverPath ? 'No file at that path on the server.' : 'Upload the backup first.' });
    if (backup.state.running || backup.stagingBy()) return reply.code(409).send({ error: 'An import is already running.' });
    try { await backup.openHeader(file, passphrase || ''); } // fail fast on a wrong passphrase or a wrong file
    catch (e) { return reply.code(400).send({ error: e.message }); }
    // the upload is kept when the check fails (full disk, say), so a retry needn't send it again;
    // the hourly temp sweep removes it after a day
    backup.stageImport(file, passphrase, { currentSchema: LATEST })
      .then((r) => {
        if (!serverPath) fs.rmSync(file, { force: true });
        activity.log(request, 'backup.import_staged', { detail: `Backup from ${r.created_at}: ${r.users} accounts, ${r.files} files. Applied at the next restart.` });
      })
      .catch((e) => {
        fastify.log.warn(`backup import failed: ${e.message}`);
        activity.log(request, 'backup.import_failed', { detail: e.message });
        if (!serverPath && /damaged|incomplete|changed/.test(e.message)) fs.rmSync(file, { force: true }); // bad bytes: a retry must upload again
      });
    return { success: true, started: true };
  });

  fastify.delete('/api/admin/backup/import', { preHandler: verifyAdmin }, async (request, reply) => {
    if (!backup.cancelPending()) return reply.code(409).send({ error: 'The import is still running.' });
    activity.log(request, 'backup.import_cancelled');
    return { success: true };
  });
};
