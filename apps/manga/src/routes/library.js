'use strict';
// Koma Shelf: your own works. The library, uploading, editing, deleting, and the progress poll.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { readForm, removeFiles, UploadError } = require('../uploads');
const { startUpload, VISIBILITY, str } = require('../works');
const { libraryPage, uploadPage, editPage } = require('../views/library');
const { errorPage } = require('../views/admin');

module.exports = async function library(app, { ctx }) {
  const { db, send, go, LIST_COLS, getWork, isOwner, chaptersOf } = ctx;
  const auth = { preHandler: ctx.requireUser };
  const ownWork = async (req, reply) => {
    const w = getWork(req.params.id);
    if (!w || !isOwner(req, w)) return send(reply, errorPage(req, 404), 404);
    req.work = w;
  };
  const own = { preHandler: [ctx.requireUser, ownWork] };
  // multipart forms carry their CSRF token as a field, so it is checked once the form is read
  const csrfOk = (req, body) => {
    req.body = body;
    return ctx.auth.tokenOk(req);
  };

  app.get('/me', auth, async (req, reply) => {
    const works = db.all(`SELECT ${LIST_COLS} FROM works w JOIN users u ON u.id = w.user_id WHERE w.user_id = ? ORDER BY w.created DESC`, req.user.id);
    const filter = ['private', 'unlisted', 'public'].includes(req.query.show) ? req.query.show : 'all';
    reply.header('Cache-Control', 'private, no-cache');
    return send(reply, libraryPage(req, { works, filter }));
  });

  const uploadView = (req, error, values) => uploadPage(req, { error, values, maxMb: ctx.site.maxUploadMb });
  app.get('/upload', auth, async (req, reply) => send(reply, uploadView(req)));
  app.post('/upload', auth, async (req, reply) => {
    let form;
    try { form = await readForm(req, { tmpDir: ctx.tmpDir, fields: { files: 3000, cover: 1 }, maxMb: ctx.site.maxUploadMb }); } catch (e) {
      if (e instanceof UploadError) return send(reply, uploadView(req, e.message), e.status);
      throw e;
    }
    if (!csrfOk(req, form.body)) {
      removeFiles(form.files);
      return send(reply, errorPage(req, 403, 'This form expired. Reload the page and try again.'), 403);
    }
    const r = startUpload(ctx, req.user, form);
    if (r.error) return send(reply, uploadView(req, r.error, r.values), r.status);
    return go(reply, `/w/${r.id}`, 303);
  });

  app.get('/api/works/:id/status', async (req, reply) => {
    const w = getWork(req.params.id);
    if (!w || !isOwner(req, w)) return reply.code(404).send({ error: 'not found' });
    reply.header('Cache-Control', 'no-store');
    return { status: w.status, progress: w.progress, error: w.error };
  });

  app.get('/w/:id/edit', own, async (req, reply) => send(reply, editPage(req, { work: req.work, chapters: chaptersOf(req.work.id) })));
  app.post('/w/:id/edit', own, async (req, reply) => {
    const w = req.work;
    const fail = (msg, status = 400) => send(reply, editPage(req, { work: w, chapters: chaptersOf(w.id), error: msg }), status);
    let form;
    try { form = await readForm(req, { tmpDir: ctx.tmpDir, fields: { cover: 1 }, maxMb: ctx.site.maxUploadMb }); } catch (e) {
      if (e instanceof UploadError) return fail(e.message, e.status);
      throw e;
    }
    const { body, files } = form;
    if (!csrfOk(req, body)) {
      removeFiles(files);
      return send(reply, errorPage(req, 403, 'This form expired. Reload the page and try again.'), 403);
    }
    const title = str(body.title, 120) || w.title;
    const visibility = VISIBILITY.has(body.visibility) ? body.visibility : w.visibility;
    const published = visibility === 'public' && !w.published && w.status === 'ready' ? Date.now() : w.published;
    let coverChanged = 0;
    const cover = files.cover[0];
    if (cover) {
      try {
        const dir = path.join(ctx.worksDir, w.id);
        await fs.promises.mkdir(dir, { recursive: true });
        const buf = await sharp(cover.path, { limitInputPixels: 150_000_000 }).rotate().resize(600, 800, { fit: 'cover', position: sharp.strategy.attention }).png().toBuffer();
        await sharp(buf).webp({ quality: 84 }).toFile(path.join(dir, 'cover.webp'));
        await sharp(buf).resize(300, 400).webp({ quality: 80 }).toFile(path.join(dir, 'cover-s.webp'));
        coverChanged = 1;
      } catch {
        removeFiles(files);
        return fail('That cover image could not be read.');
      }
      removeFiles(files);
    }
    db.tx(() => {
      db.run('UPDATE works SET title = ?, description = ?, visibility = ?, published = ?, cover_rev = cover_rev + ?, updated = ? WHERE id = ?', title, str(body.description, 4000), visibility, published, coverChanged, Date.now(), w.id);
      for (const c of chaptersOf(w.id)) {
        const t = str(body[`chapter_${c.idx}`], 120);
        if (t && t !== c.title) db.run('UPDATE chapters SET title = ? WHERE work_id = ? AND idx = ?', t, w.id, c.idx);
      }
    });
    ctx.flash(reply, 'ok', visibility === 'public' && w.visibility !== 'public' ? 'Saved — it’s on the shelf now.' : 'Saved.');
    return go(reply, `/w/${w.id}`);
  });

  app.post('/w/:id/delete', own, async (req, reply) => {
    await ctx.deleteWork(req.work.id);
    ctx.flash(reply, 'ok', `Deleted “${req.work.title}”.`);
    return go(reply, '/me');
  });
};
