// The webtoon reader: progress bar, auto-hiding toolbar, keyboard, wide mode, remembered position.
(() => {
  const reader = document.querySelector('[data-reader]');
  if (!reader) return;
  const [work, chapterStr] = reader.dataset.reader.split(':');
  const chapter = Number(chapterStr);
  const bar = document.querySelector('[data-reader-bar]');
  const progress = document.querySelector('[data-reader-progress]');
  const strip = document.getElementById('strip');
  const store = window.komaStore;
  const posKey = `koma:pos:${work}:${chapter}`;

  // wide mode
  const setWide = (on) => {
    reader.classList.toggle('wide', on);
    store?.set('koma:wide', on);
  };
  setWide(Boolean(store?.get('koma:wide')));
  document.querySelector('[data-width-toggle]')?.addEventListener('click', () => setWide(!reader.classList.contains('wide')));

  // chapter picker
  document.querySelector('[data-chapter-select]')?.addEventListener('change', (e) => location.assign(e.target.value));

  // restore position (image sizes are known up front, so the layout is already final)
  const saved = store?.get(posKey);
  if (typeof saved === 'number' && saved > 0.01 && saved < 0.98 && !location.hash) {
    requestAnimationFrame(() => window.scrollTo(0, saved * (strip.offsetHeight - innerHeight)));
  }
  store?.set(`koma:last:${work}`, chapter);

  let lastY = scrollY;
  let ticking = false;
  let saveTimer = 0;
  const update = () => {
    ticking = false;
    const max = Math.max(1, strip.offsetTop + strip.offsetHeight - innerHeight);
    const ratio = Math.min(1, Math.max(0, scrollY / max));
    progress.style.width = `${(ratio * 100).toFixed(2)}%`;
    const y = scrollY;
    if (y > 120 && y > lastY + 4) bar.classList.add('hidden');
    else if (y < lastY - 4 || y < 120 || ratio >= 1) bar.classList.remove('hidden');
    lastY = y;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      store?.set(posKey, ratio);
      if (ratio > 0.97) {
        const done = new Set(store?.get(`koma:done:${work}`) || []);
        done.add(chapter);
        store?.set(`koma:done:${work}`, [...done]);
      }
    }, 300);
  };
  addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  addEventListener('resize', update, { passive: true });
  update();

  // tap the strip to show/hide the toolbar
  strip.addEventListener('click', () => bar.classList.toggle('hidden'));

  // keyboard: ← → chapters, W wide, J/K small steps
  addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const go = (rel) => {
      const a = document.querySelector(`a[rel=${rel}]`);
      if (a) location.assign(a.href);
    };
    if (e.key === 'ArrowRight') go('next');
    else if (e.key === 'ArrowLeft') go('prev');
    else if (e.key === 'w' || e.key === 'W') setWide(!reader.classList.contains('wide'));
    else if (e.key === 'j') scrollBy({ top: innerHeight * 0.4, behavior: 'smooth' });
    else if (e.key === 'k') scrollBy({ top: -innerHeight * 0.4, behavior: 'smooth' });
  });

  // warm up the next chapter's first image when the reader nears the end
  const next = document.querySelector('a[rel=next]');
  if (next && 'IntersectionObserver' in window) {
    const end = document.querySelector('.reader-end');
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) {
        const l = document.createElement('link');
        l.rel = 'prefetch';
        l.href = next.href;
        document.head.appendChild(l);
        io.disconnect();
      }
    }, { rootMargin: '1500px' });
    io.observe(end);
  }
})();
