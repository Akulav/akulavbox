const db = require('../../../src/core/db');
const fs = require('fs');
const { ZipArchive } = require('archiver');
const { verifyUser, fromForm } = require('../../../src/core/auth');
const store = require('../lib/storage');
const { serveFile, cleanName } = require('../lib/serve');

const { diskPathOf } = store;

// Zip downloads of folders and selections, and public share links (/shared/<hash>).

module.exports = async function (fastify) {
  const filesIn = db.prepare('SELECT * FROM files WHERE folder_id = ? AND owner_id = ? AND trashed_at IS NULL');
  const subfoldersOf = db.prepare('SELECT id, name FROM folders WHERE parent_id = ? AND owner_id = ? AND trashed_at IS NULL');
  const liveFolderOf = db.prepare('SELECT id, name FROM folders WHERE id = ? AND owner_id = ? AND trashed_at IS NULL');
  function folderEntries(userId, rootId, prefix, out, seen = new Set()) {
    if (seen.has(rootId)) return;
    seen.add(rootId);
    for (const f of filesIn.all(rootId, userId)) out.push({ file: f, name: prefix + f.filename });
    for (const sub of subfoldersOf.all(rootId, userId)) folderEntries(userId, sub.id, `${prefix}${sub.name}/`, out, seen);
  }

  function sendZip(reply, name, entries) {
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}.zip`);
    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.on('error', (err) => fastify.log.error(err));
    reply.send(archive);
    store.appendToZip(archive, entries);
    archive.finalize();
    return reply;
  }

  // Download a whole folder (recursively) as a zip
  fastify.get('/api/folders/:id/download', { preHandler: verifyUser }, async (request, reply) => {
    const root = liveFolderOf.get(request.params.id, request.user.id);
    if (!root) return reply.code(404).send({ error: 'Folder not found' });
    const entries = [];
    folderEntries(request.user.id, root.id, '', entries);
    return sendZip(reply, root.name, entries);
  });

  // Download a selection (files and folders) as one zip. A form POST, so the
  // browser streams it straight to disk: fields token, files, folders (comma separated), name.
  fastify.post('/api/zip', { preHandler: fromForm(verifyUser) }, async (request, reply) => {
    const ids = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 10000);
    const uid = request.user.id;
    const entries = [];
    const fileStmt = db.prepare('SELECT * FROM files WHERE id = ? AND owner_id = ? AND trashed_at IS NULL');
    for (const id of ids(request.body?.files)) { const f = fileStmt.get(id, uid); if (f) entries.push({ file: f, name: f.filename }); }
    for (const id of ids(request.body?.folders)) {
      const d = liveFolderOf.get(id, uid);
      if (d) folderEntries(uid, d.id, `${d.name}/`, entries);
    }
    if (!entries.length) return reply.code(404).send({ error: 'Nothing to download' });
    return sendZip(reply, cleanName(request.body?.name) || 'AkulavBox download', entries);
  });

  fastify.get('/shared/:hash', async (request, reply) => {
    const file = db.prepare('SELECT * FROM files WHERE public_hash = ?').get(request.params.hash);
    if (!file || file.is_encrypted || file.trashed_at) return reply.code(404).type('text/plain').send('File not found or is private.');
    if (!fs.existsSync(diskPathOf(file))) return reply.code(404).type('text/plain').send('Missing on disk');
    return serveFile(request, reply, file);
  });
};
