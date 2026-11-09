const { verifyUser, verifyAdmin } = require('../core/auth');
const dl = require('../core/downloader');
const tools = require('../core/tools');
const cookies = require('../core/cookies');
const lib = require('../core/library');

module.exports = async function (fastify) {
  // Is the downloader ready? (yt-dlp, ffmpeg, AV1, and whether they're being installed right now)
  fastify.get('/api/downloads/status', { preHandler: verifyUser }, async () => dl.status());

  // My recent downloads: ?kind=video|audio|xxx
  fastify.get('/api/downloads', { preHandler: verifyUser }, async (request) => {
    const kind = Object.hasOwn(dl.KINDS, request.query.kind) ? request.query.kind : null;
    return dl.listJobs(request.user.id, kind);
  });

  // { url, kind: 'video' | 'audio' | 'xxx' }. Playlist and channel links become one download per entry.
  // `akulavbox:video/<id>` links (a retried "save as song") are conversions of my own videos.
  fastify.post('/api/downloads', { preHandler: verifyUser }, async (request, reply) => {
    const s = dl.status();
    if (!s.enabled) return reply.code(403).send({ error: 'Link downloads are turned off on this server.' });
    const urls = String(request.body?.url || '').split(/\s+/).map(x => x.trim()).filter(Boolean).slice(0, 50);
    const kind = Object.hasOwn(dl.KINDS, request.body?.kind) ? request.body.kind : 'video';
    if (kind === 'xxx' && !lib.showsXxx(request.user.id)) return reply.code(403).send({ error: 'The XXX section is turned off. Turn it on in Profile.' });
    if (!urls.length) return reply.code(400).send({ error: 'Paste a link first.' });
    const internal = urls.filter(u => dl.isInternal(u));
    const links = urls.filter(u => !dl.isInternal(u));
    if (links.length && !s.available) return reply.code(503).send({ error: s.installing ? 'The downloader is still being set up. Try again in a minute.' : 'The downloader isn’t available on this server.' });
    for (const u of links) { const problem = await dl.checkLink(u); if (problem) return reply.code(400).send({ error: problem }); }
    const ids = [
      ...links.map(u => dl.addJob(request.user.id, u, kind)),
      ...internal.map(u => dl.addInternal(request.user.id, u)).filter(Boolean),
    ];
    if (!ids.length) return reply.code(404).send({ error: 'That video is no longer in your library.' });
    dl.pump();
    return { success: true, ids };
  });

  // Save videos as songs in Music: { file_ids }. Same title, creator, tags and artwork.
  fastify.post('/api/downloads/from-videos', { preHandler: verifyUser }, async (request, reply) => {
    const s = dl.status();
    if (!s.convert) return reply.code(503).send({ error: s.installing ? 'ffmpeg is still being set up. Try again in a minute.' : 'Converting needs ffmpeg, which isn’t available on this server.' });
    const ids = dl.addConversions(request.user.id, [].concat(request.body?.file_ids || []).map(String));
    if (!ids.length) return reply.code(400).send({ error: 'Pick one or more videos from your library.' });
    dl.pump();
    return { success: true, ids };
  });

  // Trim one of my videos or songs: { file_id, start, end (seconds), exact?, copy? }. Runs in the queue.
  fastify.post('/api/downloads/trim', { preHandler: verifyUser }, async (request, reply) => {
    const s = dl.status();
    if (!s.convert) return reply.code(503).send({ error: s.installing ? 'ffmpeg is still being set up. Try again in a minute.' : 'Trimming needs ffmpeg, which isn’t available on this server.' });
    const b = request.body || {};
    const r = dl.addTrim(request.user.id, b.file_id, { start: b.start, end: b.end, exact: !!b.exact, copy: !!b.copy });
    if (r.error) return reply.code(400).send({ error: r.error });
    dl.pump();
    return { success: true, id: r.id };
  });

  // Cancel a running download, or remove a finished one from the list
  fastify.delete('/api/downloads/:id', { preHandler: verifyUser }, async (request, reply) => {
    return dl.cancel(request.params.id, request.user.id) ? { success: true } : reply.code(404).send({ error: 'Download not found' });
  });

  fastify.post('/api/downloads/clear', { preHandler: verifyUser }, async (request) => ({ success: true, removed: dl.clearFinished(request.user.id) }));

  // My sign-in cookies for age-restricted / members-only videos. The values never leave the server.
  fastify.get('/api/downloads/cookies', { preHandler: verifyUser }, async (request) => cookies.info(request.user.id));
  fastify.put('/api/downloads/cookies', { preHandler: verifyUser, bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    try { return { success: true, ...cookies.save(request.user.id, request.body?.text) }; }
    catch (e) { return reply.code(400).send({ error: e.message }); }
  });
  fastify.delete('/api/downloads/cookies', { preHandler: verifyUser }, async (request) => ({ success: cookies.remove(request.user.id) }));

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
