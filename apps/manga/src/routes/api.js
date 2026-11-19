'use strict';
// Koma Shelf: the API for Koma and scripts (Authorization: Bearer ks_…).
const { readForm, UploadError } = require('../uploads');
const { startUpload } = require('../works');

module.exports = async function api(app, { ctx }) {
  const requireToken = async (req, reply) => {
    if (!req.user || !req.viaToken) return reply.code(401).send({ error: 'Send an API token: Authorization: Bearer ks_… (create one under Account on the site).' });
  };
  const opts = { preHandler: requireToken };
  const workJson = (req, w) => ({ id: w.id, title: w.title, visibility: w.visibility, status: w.status, progress: w.progress, error: w.error, chapters: w.chapters, url: `${ctx.origin(req)}${ctx.B}/w/${w.id}` });

  app.get('/api/v1/me', opts, async (req) => ({ username: req.user.username, role: req.user.role, site: ctx.site.siteName, version: ctx.site.version, maxUploadMb: ctx.site.maxUploadMb }));

  app.post('/api/v1/works', opts, async (req, reply) => {
    let form;
    try { form = await readForm(req, { tmpDir: ctx.tmpDir, fields: { files: 3000, cover: 1 }, maxMb: ctx.site.maxUploadMb }); } catch (e) {
      if (e instanceof UploadError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
    const r = startUpload(ctx, req.user, form);
    if (r.error) return reply.code(r.status).send({ error: r.error });
    return reply.code(202).send(workJson(req, ctx.getWork(r.id)));
  });

  app.get('/api/v1/works/:id', opts, async (req, reply) => {
    const w = ctx.getWork(req.params.id);
    if (!w || !ctx.isOwner(req, w)) return reply.code(404).send({ error: 'not found' });
    reply.header('Cache-Control', 'no-store');
    return workJson(req, w);
  });
};
