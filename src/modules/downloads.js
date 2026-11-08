const { verifyUser, verifyAdmin } = require('../core/auth');
const dl = require('../core/downloader');
const tools = require('../core/tools');

module.exports = async function (fastify) {
  // Is the downloader ready? (yt-dlp, ffmpeg, AV1, and whether they're being installed right now)
  fastify.get('/api/downloads/status', { preHandler: verifyUser }, async () => dl.status());

  // My recent downloads: ?kind=video|audio
  fastify.get('/api/downloads', { preHandler: verifyUser }, async (request) => {
    const kind = ['video', 'audio'].includes(request.query.kind) ? request.query.kind : null;
    return dl.listJobs(request.user.id, kind);
  });

  // { url, kind: 'video' | 'audio' }. Playlist and channel links become one download per entry.
  fastify.post('/api/downloads', { preHandler: verifyUser }, async (request, reply) => {
    const s = dl.status();
    if (!s.enabled) return reply.code(403).send({ error: 'Link downloads are turned off on this server.' });
    if (!s.available) return reply.code(503).send({ error: s.installing ? 'The downloader is still being set up. Try again in a minute.' : 'The downloader isn’t available on this server.' });
    const urls = String(request.body?.url || '').split(/\s+/).map(x => x.trim()).filter(Boolean).slice(0, 50);
    const kind = request.body?.kind === 'audio' ? 'audio' : 'video';
    if (!urls.length) return reply.code(400).send({ error: 'Paste a link first.' });
    for (const u of urls) { const problem = dl.checkUrl(u); if (problem) return reply.code(400).send({ error: problem }); }
    const ids = urls.map(u => dl.addJob(request.user.id, u, kind));
    dl.pump();
    return { success: true, ids };
  });

  // Cancel a running download, or remove a finished one from the list
  fastify.delete('/api/downloads/:id', { preHandler: verifyUser }, async (request, reply) => {
    return dl.cancel(request.params.id, request.user.id) ? { success: true } : reply.code(404).send({ error: 'Download not found' });
  });

  fastify.post('/api/downloads/clear', { preHandler: verifyUser }, async (request) => ({ success: true, removed: dl.clearFinished(request.user.id) }));

  // Admin: reinstall the tools, or update yt-dlp now. Runs in the background; poll /status.
  fastify.post('/api/downloads/tools', { preHandler: verifyAdmin }, async (request) => {
    const action = request.body?.action === 'update' ? 'update' : 'install';
    const done = () => { dl.detect(true); dl.pump(); };
    (action === 'update' ? tools.update() : tools.ensure({ force: true })).then(done, done);
    return { success: true, started: action };
  });

  fastify.addHook('onReady', async () => {
    dl.detect();
    dl.resume();
    // fetch yt-dlp and ffmpeg in the background on first start; queued downloads begin once they're in
    if (!dl.status().available || !dl.status().ffmpeg) tools.ensure().then(() => { dl.detect(true); dl.pump(); });
    tools.start();
  });
};
