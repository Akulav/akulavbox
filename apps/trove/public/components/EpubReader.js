import { ref, onMounted, onUnmounted } from 'vue';
import Icon from './Icon.js';
import { lib } from '../lib/cdn.js';
import { saveMeta } from '../lib/library.js';
import { storage } from '../lib/api.js';

const THEMES = {
  dark: { body: { color: '#e3ebe9 !important', background: '#0d1518 !important' }, 'a, a:link, a:visited': { color: '#e8a33d !important' }, 'p, li, span, div, h1, h2, h3, h4, td': { color: 'inherit !important' } },
  light: { body: { color: '#142120 !important', background: '#ffffff !important' }, 'a, a:link, a:visited': { color: '#a8680e !important' } },
  sepia: { body: { color: '#3b2f22 !important', background: '#f4ecd8 !important' }, 'a, a:link, a:visited': { color: '#8a5a12 !important' } },
};

export default {
  name: 'EpubReader',
  components: { Icon },
  props: { src: { type: String, required: true }, fileId: String, progress: String, editable: { type: Boolean, default: true } },
  emits: ['progress'],
  template: /*html*/`
    <div class="absolute inset-0 flex flex-col" :style="{ background: bg }">
      <div class="shrink-0 h-11 flex items-center gap-2 px-3 border-b border-line bg-surface">
        <select v-if="toc.length" class="input h-8 !text-[13px] max-w-[46%]" @change="goTo($event.target.value)" aria-label="Chapters">
          <option value="">Chapters</option>
          <option v-for="t in toc" :key="t.href" :value="t.href">{{ t.label }}</option>
        </select>
        <span class="flex-1"></span>
        <button class="icon-btn icon-btn-sm" @click="font(-10)" title="Smaller text"><span class="text-[12px] font-semibold">A−</span></button>
        <button class="icon-btn icon-btn-sm" @click="font(10)" title="Larger text"><span class="text-[15px] font-semibold">A+</span></button>
        <div class="seg">
          <button v-for="t in ['light', 'sepia', 'dark']" :key="t" :class="{ on: theme === t }" @click="setTheme(t)" class="capitalize">{{ t }}</button>
        </div>
      </div>
      <div class="relative flex-1 min-h-0">
        <div ref="area" class="absolute inset-0 mx-auto max-w-[900px] px-2 sm:px-10 py-4"></div>
        <div v-if="status !== 'ready'" class="absolute inset-0 grid place-items-center text-muted text-[13px]">
          <div class="flex flex-col items-center gap-3 text-center px-6"><Icon :name="status === 'error' ? 'alert' : 'loader'" :size="24" />{{ message }}</div>
        </div>
        <button class="absolute left-0 top-0 bottom-0 w-[12%] max-w-[90px] group grid place-items-center" @click="prev" aria-label="Previous page">
          <span class="w-9 h-9 rounded-full bg-surface/90 border border-line grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"><Icon name="chevron-left" :size="18" /></span>
        </button>
        <button class="absolute right-0 top-0 bottom-0 w-[12%] max-w-[90px] group grid place-items-center" @click="next" aria-label="Next page">
          <span class="w-9 h-9 rounded-full bg-surface/90 border border-line grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"><Icon name="chevron-right" :size="18" /></span>
        </button>
      </div>
      <div class="shrink-0 h-9 flex items-center gap-3 px-4 border-t border-line bg-surface text-xs text-muted">
        <span class="truncate flex-1">{{ chapter }}</span>
        <span class="tabular-nums">{{ pct === null ? '' : Math.round(pct * 100) + '%' }}</span>
        <div class="meter w-24 sm:w-40" style="height:4px"><span :style="{ width: ((pct || 0) * 100) + '%' }"></span></div>
      </div>
    </div>`,
  setup(props, { emit, expose }) {
    const area = ref(null);
    const status = ref('loading');
    const message = ref('Opening book…');
    const toc = ref([]);
    const chapter = ref('');
    const pct = ref(null);
    const appTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const theme = ref(storage.read('akulavReaderTheme') || appTheme);
    const fontSize = ref(parseInt(storage.read('akulavReaderFont'), 10) || 100);
    const bg = ref('');
    let book = null, rendition = null, saveTimer = null, alive = true;

    const start = (() => { try { return JSON.parse(props.progress || 'null'); } catch (e) { return null; } })();
    if (start && typeof start.pct === 'number') pct.value = start.pct;

    function applyBg() { bg.value = THEMES[theme.value].body.background.replace(' !important', ''); }
    applyBg();
    function setTheme(t) { theme.value = t; storage.write('akulavReaderTheme', t); applyBg(); if (rendition) rendition.themes.select(t); }
    function font(d) { fontSize.value = Math.min(200, Math.max(70, fontSize.value + d)); storage.write('akulavReaderFont', String(fontSize.value)); if (rendition) rendition.themes.fontSize(fontSize.value + '%'); }
    const next = () => rendition && rendition.next();
    const prev = () => rendition && rendition.prev();
    const goTo = (href) => { if (href && rendition) rendition.display(href); };
    expose({ next, prev });

    let pendingCfi = null;
    function flush() {
      if (!pendingCfi) return;
      const progress = JSON.stringify({ cfi: pendingCfi, pct: pct.value });
      pendingCfi = null;
      emit('progress', progress);
      if (props.fileId && props.editable) saveMeta(props.fileId, { progress }).catch(() => {});
    }
    function persist(cfi) {
      pendingCfi = cfi;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, 1200);
    }

    onMounted(async () => {
      try {
        const ePub = await lib('ePub');
        message.value = 'Downloading book…';
        const res = await fetch(props.src);
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        const buf = await res.arrayBuffer();
        if (!alive) return;
        book = ePub(buf);
        rendition = book.renderTo(area.value, { width: '100%', height: '100%', flow: 'paginated', spread: 'auto', allowScriptedContent: false });
        for (const [k, v] of Object.entries(THEMES)) rendition.themes.register(k, v);
        rendition.themes.select(theme.value);
        rendition.themes.fontSize(fontSize.value + '%');
        rendition.on('relocated', (loc) => {
          if (!loc || !loc.start) return;
          if (book.locations.length()) pct.value = book.locations.percentageFromCfi(loc.start.cfi);
          const item = toc.value.find(t => loc.start.href && loc.start.href.split('#')[0].endsWith(t.href.split('#')[0]));
          if (item) chapter.value = item.label;
          persist(loc.start.cfi);
        });
        rendition.on('keyup', (e) => { if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') prev(); });
        book.loaded.navigation.then((nav) => {
          const flat = [];
          const walk = (items, depth) => items.forEach(i => { flat.push({ href: i.href, label: ' '.repeat(depth * 2) + (i.label || '').trim() }); if (i.subitems) walk(i.subitems, depth + 1); });
          walk(nav.toc || [], 0);
          toc.value = flat;
        }).catch(() => {});
        await rendition.display(start && start.cfi ? start.cfi : undefined);
        status.value = 'ready';
        // Page numbers / percentage need a pass over the book; do it after the first page is visible
        book.locations.generate(1200).then(() => {
          if (!alive) return;
          const loc = rendition.currentLocation();
          if (loc && loc.start) pct.value = book.locations.percentageFromCfi(loc.start.cfi);
        }).catch(() => {});
      } catch (e) {
        status.value = 'error';
        message.value = e.message || 'This book couldn’t be opened.';
      }
    });
    onUnmounted(() => { alive = false; clearTimeout(saveTimer); flush(); try { if (book) book.destroy(); } catch (e) { /* ignore */ } });

    return { area, status, message, toc, chapter, pct, theme, bg, setTheme, font, next, prev, goTo };
  },
};
