// Small progressive enhancements. Every page works without this file.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const store = {
    get(k) {
      try {
        return JSON.parse(localStorage.getItem(k));
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {
        /* private mode */
      }
    },
  };
  window.komaStore = store;

  // theme toggle
  const root = document.documentElement;
  const dark = () => root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  $$('[data-theme-toggle]').forEach((b) =>
    b.addEventListener('click', () => {
      const next = dark() ? 'light' : 'dark';
      root.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
      } catch {
        /* ignore */
      }
    }),
  );

  // account menu: close on outside click / Escape
  const menu = $('.user-menu');
  if (menu) {
    document.addEventListener('click', (e) => {
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') menu.open = false;
    });
  }

  // confirm destructive forms
  $$('form[data-confirm]').forEach((f) =>
    f.addEventListener('submit', (e) => {
      if (!confirm(f.dataset.confirm)) e.preventDefault();
    }),
  );

  // copy share link
  $$('[data-copy]').forEach((b) =>
    b.addEventListener('click', async () => {
      const url = new URL(b.dataset.copy, location.origin).href;
      const label = $('span', b);
      try {
        if (navigator.share && matchMedia('(hover: none)').matches) {
          await navigator.share({ url, title: document.title });
          return;
        }
        await navigator.clipboard.writeText(url);
        label.textContent = 'Copied!';
      } catch {
        prompt('Copy this link:', url);
      }
      setTimeout(() => (label.textContent = 'Copy link'), 1800);
    }),
  );

  // copy a value (API token)
  $$('[data-copy-value]').forEach((b) =>
    b.addEventListener('click', async () => {
      const label = $('span', b);
      try {
        await navigator.clipboard.writeText(b.dataset.copyValue);
        label.textContent = 'Copied!';
      } catch {
        prompt('Copy this token:', b.dataset.copyValue);
      }
      setTimeout(() => (label.textContent = 'Copy'), 1800);
    }),
  );

  // like without a page reload
  $$('form[data-like]').forEach((f) =>
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button', f);
      btn.disabled = true;
      try {
        const r = await fetch(f.action, { method: 'POST', headers: { Accept: 'application/json', 'X-CSRF-Token': f._csrf.value } });
        if (!r.ok) throw new Error(r.status);
        const { liked, likes } = await r.json();
        btn.classList.toggle('liked', liked);
        btn.classList.toggle('pop', liked);
        btn.setAttribute('aria-pressed', liked);
        $('span', btn).textContent = liked ? 'Liked' : 'Like';
        const count = $('[data-like-count]');
        if (count) count.textContent = likes;
      } catch {
        f.submit();
      } finally {
        btn.disabled = false;
      }
    }),
  );

  // processing: poll until ready, then reload
  const poll = $('[data-poll]');
  if (poll) {
    const bar = $('[data-progress]', poll);
    const tick = async () => {
      try {
        const r = await fetch(poll.dataset.poll, { cache: 'no-store' });
        const s = await r.json();
        if (bar) bar.style.width = `${Math.round(s.progress * 100)}%`;
        if (s.status !== 'processing') return location.reload();
      } catch {
        /* retry */
      }
      setTimeout(tick, 1500);
    };
    setTimeout(tick, 1200);
  }

  // reading progress on the work page
  const cont = $('[data-continue]');
  if (cont) {
    const id = cont.dataset.continue;
    const last = store.get(`koma:last:${id}`);
    const done = store.get(`koma:done:${id}`) || [];
    if (last) {
      cont.href = `${document.body.dataset.root || ''}/w/${id}/${last}`;
      cont.lastChild.textContent = `Continue · chapter ${last}`;
    }
    $$('[data-chapter]').forEach((a) => {
      const n = Number(a.dataset.chapter);
      const state = $('[data-chapter-state]', a);
      if (done.includes(n)) {
        state.textContent = 'Read';
        state.classList.add('read');
      } else if (n === last) state.textContent = 'Reading';
    });
  }

  // upload: drag & drop, file summary, progress bar
  const form = $('form[data-upload]');
  if (form) {
    const dz = $('[data-dropzone]', form);
    const input = $('[data-file-input]', form);
    const label = $('[data-dz-label]', form);
    const fmt = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.ceil(b / 1e3)} KB`);
    const show = () => {
      const files = [...input.files];
      if (!files.length) return;
      const size = files.reduce((s, f) => s + f.size, 0);
      label.textContent = files.length === 1 ? `${files[0].name} · ${fmt(size)}` : `${files.length} files · ${fmt(size)}`;
      dz.classList.add('has-files');
      const title = form.elements.title;
      if (!title.value && files.length === 1) title.placeholder = files[0].name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    };
    input.addEventListener('change', show);
    ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => (e.preventDefault(), dz.classList.add('over'))));
    ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, () => dz.classList.remove('over')));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer?.files?.length) {
        input.files = e.dataTransfer.files;
        show();
      }
    });
    form.addEventListener('submit', (e) => {
      if (!input.files.length) return;
      e.preventDefault();
      const box = $('[data-upload-progress]', form);
      const bar = $('.bar span', box);
      const pct = $('[data-upload-pct]', box);
      const submit = $('button[type=submit]', form);
      box.hidden = false;
      submit.disabled = true;
      const xhr = new XMLHttpRequest();
      xhr.open('POST', form.action);
      xhr.upload.onprogress = (ev) => {
        if (!ev.lengthComputable) return;
        const p = Math.round((ev.loaded / ev.total) * 100);
        bar.style.width = `${p}%`;
        pct.textContent = p < 100 ? `${p}%` : 'processing…';
      };
      xhr.onload = () => {
        if (xhr.status < 400 && xhr.responseURL && !xhr.responseURL.endsWith('/upload')) return location.assign(xhr.responseURL);
        document.open();
        document.write(xhr.responseText);
        document.close();
      };
      xhr.onerror = () => {
        submit.disabled = false;
        box.hidden = true;
        alert('The upload was interrupted. Check your connection and try again.');
      };
      xhr.send(new FormData(form));
    });
  }
})();
