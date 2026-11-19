'use strict';
// Koma Shelf: your own works (the library, uploading, editing).
const { html, raw, timeAgo, plural, compact, paragraphs } = require('../html.js');
const { layout, card, grid, emptyState, icon, visBadge, csrfField, avatar, media } = require('./layout.js');

function libraryPage(req, { works, filter }) {
  const counts = { all: works.length, private: 0, unlisted: 0, public: 0 };
  for (const w of works) counts[w.visibility]++;
  const shown = filter === 'all' ? works : works.filter((w) => w.visibility === filter);
  const tabs = [
    ['all', 'All'],
    ['private', 'Private'],
    ['unlisted', 'Unlisted'],
    ['public', 'On the shelf'],
  ];
  const body = html`
  <main class="wrap section">
    <div class="page-head">
      <div>
        <p class="eyebrow">My library</p>
        <h1>Your webtoons</h1>
        <p class="muted">Private works are only visible to you. Unlisted ones open for anyone with the link. Public ones are on the shelf.</p>
      </div>
      <a class="btn btn-primary" href="/upload">${icon.upload}Upload</a>
    </div>
    <div class="tabs">
      ${tabs.map(([k, label]) => html`<a class="tab ${filter === k ? 'active' : ''}" href="/me${k === 'all' ? '' : `?show=${k}`}">${label}<span class="count">${counts[k]}</span></a>`)}
    </div>
    ${shown.length
      ? grid(shown, { showVis: true, showAuthor: false })
      : emptyState(works.length ? 'Nothing here' : 'No webtoons yet', works.length ? 'No works with this visibility.' : 'Zip Koma’s “out” folder (or grab the .cbz) and upload it. It stays private until you choose otherwise.', html`<a class="btn btn-primary" href="/upload">Upload your first</a>`)}
  </main>`;
  return layout(req, { title: 'My library', body, active: 'me', og: { noindex: true } });
}

// --- upload & edit -----------------------------------------------------------

const visField = (current) => html`<fieldset class="vis-pick">
  <legend>Who can see it</legend>
  ${[
    ['private', icon.lock, 'Private', 'Only you.'],
    ['unlisted', icon.link, 'Unlisted', 'Anyone with the link.'],
    ['public', icon.globe, 'Public', 'On the shelf for everyone.'],
  ].map(
    ([v, ic, label, hint]) => html`<label class="vis-option">
      <input type="radio" name="visibility" value="${v}" ${current === v ? raw('checked') : ''}>
      <span class="vis-card">${ic}<strong>${label}</strong><small>${hint}</small></span>
    </label>`,
  )}
</fieldset>`;

function uploadPage(req, { error, values = {}, maxMb }) {
  const body = html`
  <main class="wrap narrow section">
    <p class="eyebrow">Upload</p>
    <h1>Add a webtoon</h1>
    <p class="muted">In Koma, open the finished manga’s folder and zip its <code>out</code> folder — chapter titles come along. The <code>.cbz</code> or a set of images works too.</p>
    ${error ? html`<div class="notice notice-error" role="alert">${error}</div>` : ''}
    <form class="form" method="post" action="/upload" enctype="multipart/form-data" data-upload>
      ${csrfField(req)}
      <label class="dropzone" data-dropzone>
        <input type="file" name="files" accept=".zip,.cbz,image/*" multiple required data-file-input>
        <span class="dz-icon">${icon.upload}</span>
        <strong data-dz-label>Drop a .zip, .cbz or images here</strong>
        <small>or click to choose · up to ${maxMb >= 1024 ? `${(maxMb / 1024).toFixed(maxMb % 1024 ? 1 : 0)} GB` : `${maxMb} MB`}</small>
      </label>
      <label class="field">
        <span>Title <small class="muted">— leave empty to use the book’s title</small></span>
        <input name="title" maxlength="120" value="${values.title || ''}" placeholder="e.g. The Count of Monte Cristo">
      </label>
      <label class="field">
        <span>Description <small class="muted">— optional</small></span>
        <textarea name="description" rows="4" maxlength="4000" placeholder="What’s it about? Which style did you use?">${values.description || ''}</textarea>
      </label>
      ${visField(values.visibility || 'private')}
      <details class="field more">
        <summary>Custom cover image <small class="muted">(optional — otherwise one is cropped from the first panel)</small></summary>
        <input type="file" name="cover" accept="image/*">
      </details>
      <div class="upload-progress" hidden data-upload-progress><div class="bar"><span></span></div><small>Uploading… <span data-upload-pct>0%</span></small></div>
      <div class="form-actions"><button class="btn btn-primary btn-lg" type="submit">${icon.upload}Upload</button><a class="btn btn-ghost" href="/me">Cancel</a></div>
    </form>
  </main>`;
  return layout(req, { title: 'Upload', body, og: { noindex: true }, scripts: [] });
}

function editPage(req, { work, chapters, error }) {
  const body = html`
  <main class="wrap narrow section">
    <p class="eyebrow"><a href="/w/${work.id}">${icon.arrowL}${work.title}</a></p>
    <h1>Edit</h1>
    ${error ? html`<div class="notice notice-error" role="alert">${error}</div>` : ''}
    <form class="form" method="post" action="/w/${work.id}/edit" enctype="multipart/form-data">
      ${csrfField(req)}
      <label class="field"><span>Title</span><input name="title" maxlength="120" required value="${work.title}"></label>
      <label class="field"><span>Description</span><textarea name="description" rows="5" maxlength="4000">${work.description}</textarea></label>
      ${visField(work.visibility)}
      ${chapters.length
        ? html`<fieldset class="field">
            <legend>Chapter titles</legend>
            <div class="chapter-edit">
              ${chapters.map((c) => html`<label><span class="ch-num">${String(c.idx).padStart(2, '0')}</span><input name="chapter_${c.idx}" maxlength="120" value="${c.title}" aria-label="Title of chapter ${c.idx}"></label>`)}
            </div>
          </fieldset>`
        : ''}
      <label class="field"><span>Replace cover <small class="muted">(optional)</small></span><input type="file" name="cover" accept="image/*"></label>
      <div class="form-actions"><button class="btn btn-primary" type="submit">Save changes</button><a class="btn btn-ghost" href="/w/${work.id}">Cancel</a></div>
    </form>
    <section class="danger-zone">
      <h2>Delete this webtoon</h2>
      <p class="muted">Removes it and all its images from the site. This can’t be undone.</p>
      <form method="post" action="/w/${work.id}/delete" data-confirm="Delete “${work.title}” for good?">${csrfField(req)}<button class="btn btn-danger" type="submit">${icon.trash}Delete</button></form>
    </section>
  </main>`;
  return layout(req, { title: `Edit ${work.title}`, body, og: { noindex: true } });
}

// --- accounts ----------------------------------------------------------------

module.exports = { libraryPage, uploadPage, editPage };
