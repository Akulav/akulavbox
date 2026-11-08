import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import Icon from './Icon.js';
import { thumbUrl, saveMeta, bulkMeta, setCover, captureVideoFrame, autoCover, displayTitle, serverMakesThumbs, makeThumb } from '../lib/library.js';
import { toast } from '../lib/ui.js';
import { fileUrl } from '../lib/api.js';

// One observer for every thumbnail on the page instead of one each (a grid can hold thousands)
const nearView = new Map(); // element -> callback
let thumbObserver = null;
function whenNearView(el, fn) {
  if (!thumbObserver) {
    thumbObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const cb = nearView.get(e.target);
        nearView.delete(e.target);
        thumbObserver.unobserve(e.target);
        if (cb) cb();
      }
    }, { rootMargin: '900px 0px' });
  }
  nearView.set(el, fn);
  thumbObserver.observe(el);
  return () => { if (nearView.delete(el)) thumbObserver.unobserve(el); };
}

/**
 * Lazy thumbnail: a placeholder until it scrolls near the viewport, then the
 * server-made preview fades in. Falls back to an icon when there's no preview.
 */
export const Thumb = {
  components: { Icon },
  props: {
    fileId: String, w: { type: Number, default: 480 }, version: [String, Number],
    icon: { type: String, default: 'image' }, fit: { type: String, default: 'cover' }, src: String,
    eager: Boolean,
  },
  emits: ['failed', 'dims'],
  template: /*html*/`
    <div ref="el" class="relative w-full h-full overflow-hidden bg-elevated">
      <img v-if="current && !failed" :src="current" alt="" decoding="async" draggable="false" :fetchpriority="eager ? 'high' : 'auto'"
           class="absolute inset-0 w-full h-full transition-opacity duration-200" :class="[loaded ? 'opacity-100' : 'opacity-0', fit === 'contain' ? 'object-contain' : 'object-cover']"
           @load="onLoad" @error="onError">
      <div v-if="!loaded" class="absolute inset-0 grid place-items-center text-faint" :class="{ skeleton: visible && !failed }">
        <Icon v-if="failed || !visible" :name="icon" :size="28" :stroke="1.4" />
      </div>
    </div>`,
  setup(props, { emit }) {
    const el = ref(null);
    const visible = ref(false);
    const loaded = ref(false);
    const failed = ref(false);
    const current = ref('');
    let fallbackTried = false;
    let cachedOnly = false;

    async function pick() {
      loaded.value = false; failed.value = false; fallbackTried = false;
      if (props.src) { current.value = props.src; return; }
      if (!props.fileId) { failed.value = true; return; }
      // Without server thumbnails, ask for the cached one and make it ourselves if it's missing
      cachedOnly = !(await serverMakesThumbs());
      current.value = thumbUrl(props.fileId, props.w, props.version) + (cachedOnly ? '&cached=1' : '');
    }
    function onLoad(e) {
      loaded.value = true;
      const img = e.target;
      if (img.naturalWidth) emit('dims', { w: img.naturalWidth, h: img.naturalHeight });
    }
    async function onError() {
      if (cachedOnly && !fallbackTried && props.fileId) {
        fallbackTried = true;
        const url = await makeThumb(props.fileId, props.w);
        if (url) { current.value = url; return; }
      }
      failed.value = true;
      emit('failed');
    }
    watch(() => [props.fileId, props.w, props.version, props.src], () => { if (visible.value) pick(); });

    let stopWatching = null;
    onMounted(() => {
      if (props.eager) { visible.value = true; pick(); return; }
      stopWatching = whenNearView(el.value, () => { stopWatching = null; visible.value = true; pick(); });
    });
    onUnmounted(() => { if (stopWatching) stopWatching(); });
    return { el, visible, loaded, failed, current, onLoad, onError };
  },
};

/**
 * Justified rows (like Google Photos): every photo keeps its real shape and
 * each row exactly fills the width. Items need { width, height }; unknown sizes
 * count as square until measured.
 */
export const JustifiedGrid = {
  props: { items: { type: Array, required: true }, rowHeight: { type: Number, default: 220 }, gap: { type: Number, default: 6 } },
  template: /*html*/`
    <div ref="el" class="w-full">
      <div v-for="row in rows" :key="row.key" class="flex" :style="{ gap: gap + 'px', marginBottom: gap + 'px', height: row.h + 'px', contentVisibility: 'auto', containIntrinsicSize: 'auto ' + row.h + 'px' }">
        <div v-for="cell in row.cells" :key="cell.item.id" class="relative shrink-0" :style="{ width: cell.w + 'px', height: row.h + 'px' }">
          <slot :item="cell.item" :index="cell.index"></slot>
        </div>
      </div>
    </div>`,
  setup(props) {
    const el = ref(null);
    const width = ref(0);
    let ro = null;
    onMounted(() => {
      width.value = el.value.clientWidth;
      ro = new ResizeObserver(([e]) => { const w = Math.floor(e.contentRect.width); if (Math.abs(w - width.value) > 1) width.value = w; });
      ro.observe(el.value);
    });
    onUnmounted(() => ro && ro.disconnect());

    const rows = computed(() => {
      const W = width.value;
      if (!W) return [];
      const target = W < 520 ? Math.round(props.rowHeight * 0.62) : props.rowHeight;
      const out = [];
      let cur = [], sum = 0;
      const ratio = (it) => {
        const r = it.width && it.height ? it.width / it.height : 1;
        return Math.min(4, Math.max(0.25, r));
      };
      const flush = (last) => {
        if (!cur.length) return;
        const gaps = props.gap * (cur.length - 1);
        let h = (W - gaps) / sum;
        if (last && h > target * 1.25) h = target;        // don't blow up a short last row
        h = Math.min(h, target * 2.2);
        let used = 0;
        const cells = cur.map((c, i) => {
          let w = Math.floor(c.r * h);
          if (!last || h < target) { if (i === cur.length - 1) w = Math.max(1, Math.floor(W - gaps - used)); }
          used += w;
          return { item: c.item, index: c.index, w };
        });
        out.push({ key: cur[0].item.id, h: Math.round(h), cells });
        cur = []; sum = 0;
      };
      props.items.forEach((item, index) => {
        const r = ratio(item);
        cur.push({ item, index, r }); sum += r;
        if (sum * target + props.gap * (cur.length - 1) >= W) flush(false);
      });
      flush(true);
      return out;
    });
    return { el, rows };
  },
};

export const Stars = {
  components: { Icon },
  props: { modelValue: { type: Number, default: 0 }, size: { type: Number, default: 16 }, readonly: Boolean },
  emits: ['update:modelValue'],
  template: /*html*/`
    <span class="inline-flex items-center" :class="readonly ? '' : 'gap-0.5'" role="radiogroup" aria-label="Rating">
      <button v-for="n in 5" :key="n" type="button" :disabled="readonly" class="disabled:cursor-default"
              :class="(hover || modelValue || 0) >= n ? 'text-accent' : 'text-faint'"
              @mouseenter="!readonly && (hover = n)" @mouseleave="hover = 0"
              @click="$emit('update:modelValue', modelValue === n ? 0 : n)" :aria-label="n + ' star' + (n > 1 ? 's' : '')">
        <Icon :name="(hover || modelValue || 0) >= n ? 'star-fill' : 'star'" :size="size" />
      </button>
    </span>`,
  setup() { return { hover: ref(0) }; },
};

/** Tag-style input: Enter or comma adds, Backspace removes the last one */
export const ChipInput = {
  components: { Icon },
  props: { modelValue: { type: Array, default: () => [] }, suggestions: { type: Array, default: () => [] }, placeholder: String, id: String },
  emits: ['update:modelValue'],
  template: /*html*/`
    <div class="input !h-auto min-h-[38px] flex flex-wrap items-center gap-1.5 py-1.5 cursor-text" @click="inputEl.focus()">
      <span v-for="(v, i) in modelValue" :key="v + i" class="chip chip-accent !h-6 pr-1">
        {{ v }}
        <button type="button" class="w-4 h-4 grid place-items-center rounded-full hover:bg-accent/20" @click.stop="remove(i)" :aria-label="'Remove ' + v"><Icon name="x" :size="11" /></button>
      </span>
      <input ref="inputEl" :id="id" v-model="text" :list="listId" :placeholder="modelValue.length ? '' : placeholder"
             class="flex-1 min-w-[120px] bg-transparent outline-none text-[14px] h-6" @keydown="onKey" @blur="commit" @change="onPick">
      <datalist :id="listId"><option v-for="s in available" :key="s" :value="s"></option></datalist>
    </div>`,
  setup(props, { emit }) {
    const text = ref('');
    const inputEl = ref(null);
    const listId = 'dl-' + Math.random().toString(36).slice(2, 9);
    const available = computed(() => props.suggestions.filter(s => !props.modelValue.some(v => v.toLowerCase() === s.toLowerCase())).slice(0, 200));
    function add(raw) {
      const parts = String(raw).split(',').map(s => s.trim()).filter(Boolean);
      if (!parts.length) return;
      const next = [...props.modelValue];
      for (const p of parts) if (!next.some(v => v.toLowerCase() === p.toLowerCase())) next.push(p);
      emit('update:modelValue', next);
    }
    function commit() { if (text.value.trim()) { add(text.value); text.value = ''; } }
    function remove(i) { const next = [...props.modelValue]; next.splice(i, 1); emit('update:modelValue', next); }
    function onKey(e) {
      if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab' && text.value.trim()) { e.preventDefault(); commit(); }
      else if (e.key === 'Backspace' && !text.value && props.modelValue.length) remove(props.modelValue.length - 1);
    }
    // picking from the datalist fires change with an exact suggestion
    function onPick() { if (props.suggestions.includes(text.value)) commit(); }
    return { text, inputEl, listId, available, onKey, commit, remove, onPick };
  },
};

const LABELS = {
  videos: { people: 'Participants', series: 'Series or collection', date: 'Date recorded', details: 'Details', peoplePh: 'Add a person and press Enter' },
  music: { people: 'Artists', series: 'Album', date: 'Year', details: 'Notes', peoplePh: 'Add an artist and press Enter' },
  books: { people: 'Authors', series: 'Series', date: 'Published', details: 'Description', peoplePh: 'Add an author and press Enter' },
};
export const labelsFor = (kind) => LABELS[kind] || LABELS.videos;

/** Edit details of one item, or add/remove details on many at once */
export const MetaEditor = {
  components: { Icon, ChipInput, Stars, Thumb },
  props: {
    kind: { type: String, required: true },          // videos | music | books
    items: { type: Array, required: true },
    allItems: { type: Array, default: () => [] },    // for suggestions
  },
  emits: ['close', 'saved'],
  template: /*html*/`
    <Teleport to="body">
      <div class="fixed inset-0 z-[245] bg-black/55 flex items-end sm:items-center justify-center sm:p-4" @mousedown.self="$emit('close')">
        <form class="panel w-full sm:max-w-2xl max-h-[92vh] flex flex-col rounded-b-none sm:rounded-b-2xl" @submit.prevent="save">
          <div class="px-5 pt-5 pb-3 flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <h3 class="title text-lg">{{ bulk ? 'Edit ' + items.length + ' items' : 'Edit details' }}</h3>
              <p class="text-muted text-[13px] truncate">{{ bulk ? 'Changes are added to every selected item.' : items[0].filename }}</p>
            </div>
            <button type="button" class="icon-btn" @click="$emit('close')" aria-label="Close"><Icon name="x" :size="18" /></button>
          </div>

          <div class="px-5 pb-4 overflow-y-auto flex-1 space-y-4">
            <!-- Single item -->
            <template v-if="!bulk">
              <div class="grid sm:grid-cols-[1fr_auto] gap-4">
                <div class="space-y-4 min-w-0">
                  <div>
                    <label class="label" for="me-title">Title</label>
                    <input id="me-title" v-model="form.title" class="input" :placeholder="displayTitle({ filename: items[0].filename })">
                  </div>
                  <div>
                    <label class="label" for="me-people">{{ L.people }}</label>
                    <ChipInput id="me-people" v-model="form.participants" :suggestions="peopleSuggestions" :placeholder="L.peoplePh" />
                  </div>
                </div>
                <div v-if="kind !== 'music'" class="w-full sm:w-40">
                  <p class="label">Cover</p>
                  <div class="rounded-lg overflow-hidden border border-line" :class="kind === 'books' ? 'aspect-[2/3]' : 'aspect-video'">
                    <Thumb :file-id="items[0].id" :w="480" :version="coverVersion" :icon="kind === 'books' ? 'file-text' : 'film'" />
                  </div>
                  <div class="flex flex-wrap gap-1 mt-2">
                    <input ref="coverInput" type="file" accept="image/*" class="hidden" @change="onCoverPicked">
                    <button type="button" class="btn btn-sm flex-1" @click="coverInput.click()" :disabled="coverBusy">{{ coverBusy ? 'Saving…' : 'Upload' }}</button>
                    <button type="button" class="btn btn-sm flex-1" @click="regenerate" :disabled="coverBusy" :title="kind === 'videos' ? 'Grab a frame from the video' : 'Use the book’s own cover'">Auto</button>
                  </div>
                </div>
              </div>
              <div>
                <label class="label" for="me-tags">Tags</label>
                <ChipInput id="me-tags" v-model="form.tags" :suggestions="tagSuggestions" placeholder="e.g. holiday, family, 2026" />
              </div>
              <div class="grid sm:grid-cols-3 gap-4">
                <div class="sm:col-span-2">
                  <label class="label" for="me-series">{{ L.series }}</label>
                  <input id="me-series" v-model="form.series" class="input" :list="seriesListId">
                  <datalist :id="seriesListId"><option v-for="s in seriesSuggestions" :key="s" :value="s"></option></datalist>
                </div>
                <div>
                  <label class="label" for="me-date">{{ L.date }}</label>
                  <input id="me-date" v-model="form.date" class="input" placeholder="2026-07-14">
                </div>
              </div>
              <div>
                <p class="label">Rating</p>
                <Stars v-model="form.rating" :size="20" />
              </div>
              <div>
                <label class="label" for="me-details">{{ L.details }}</label>
                <textarea id="me-details" v-model="form.details" rows="4" class="input resize-y" placeholder="Anything worth remembering"></textarea>
              </div>
            </template>

            <!-- Many items -->
            <template v-else>
              <div>
                <label class="label">Add {{ L.people.toLowerCase() }}</label>
                <ChipInput v-model="bulkForm.add_participants" :suggestions="peopleSuggestions" :placeholder="L.peoplePh" />
              </div>
              <div>
                <label class="label">Add tags</label>
                <ChipInput v-model="bulkForm.add_tags" :suggestions="tagSuggestions" placeholder="Add a tag and press Enter" />
              </div>
              <details class="rounded-xl border border-line px-4 py-3">
                <summary class="cursor-pointer text-[13.5px] font-medium">Remove {{ L.people.toLowerCase() }} or tags</summary>
                <div class="space-y-4 mt-3">
                  <div>
                    <label class="label">Remove {{ L.people.toLowerCase() }}</label>
                    <ChipInput v-model="bulkForm.remove_participants" :suggestions="selectionPeople" placeholder="Pick from the selection" />
                  </div>
                  <div>
                    <label class="label">Remove tags</label>
                    <ChipInput v-model="bulkForm.remove_tags" :suggestions="selectionTags" placeholder="Pick from the selection" />
                  </div>
                </div>
              </details>
              <div class="grid sm:grid-cols-3 gap-4">
                <div class="sm:col-span-2">
                  <label class="label">Set {{ L.series.toLowerCase() }}</label>
                  <input v-model="bulkForm.series" class="input" :list="seriesListId" placeholder="Leave empty to keep as is">
                  <datalist :id="seriesListId"><option v-for="s in seriesSuggestions" :key="s" :value="s"></option></datalist>
                </div>
                <div>
                  <label class="label">Set {{ L.date.toLowerCase() }}</label>
                  <input v-model="bulkForm.date" class="input" placeholder="Keep as is">
                </div>
              </div>
              <div>
                <p class="label">Set rating</p>
                <Stars v-model="bulkForm.rating" :size="20" />
              </div>
            </template>
          </div>

          <div class="flex justify-end gap-2 p-4 border-t border-line">
            <button type="button" class="btn" @click="$emit('close')">Cancel</button>
            <button type="submit" class="btn btn-primary" :disabled="busy"><Icon v-if="busy" name="loader" :size="15" />Save</button>
          </div>
        </form>
      </div>
    </Teleport>`,
  setup(props, { emit }) {
    const L = computed(() => labelsFor(props.kind));
    const bulk = computed(() => props.items.length > 1);
    const it = props.items[0] || {};
    const form = reactive({
      title: it.title || '', participants: [...(it.participants || [])], tags: [...(it.tags || [])],
      series: it.series || '', date: it.date || '', rating: it.rating || 0, details: it.details || '',
    });
    const bulkForm = reactive({ add_participants: [], add_tags: [], remove_participants: [], remove_tags: [], series: '', date: '', rating: 0 });
    const busy = ref(false);
    const coverBusy = ref(false);
    const coverInput = ref(null);
    const coverVersion = ref(it.thumb_file_id || '');
    const seriesListId = 'sl-' + Math.random().toString(36).slice(2, 8);

    const uniq = (arr) => [...new Map(arr.filter(Boolean).map(v => [v.toLowerCase(), v])).values()].sort((a, b) => a.localeCompare(b));
    const pool = computed(() => props.allItems.length ? props.allItems : props.items);
    const peopleSuggestions = computed(() => uniq(pool.value.flatMap(i => i.participants || [])));
    const tagSuggestions = computed(() => uniq(pool.value.flatMap(i => i.tags || [])));
    const seriesSuggestions = computed(() => uniq(pool.value.map(i => i.series)));
    const selectionPeople = computed(() => uniq(props.items.flatMap(i => i.participants || [])));
    const selectionTags = computed(() => uniq(props.items.flatMap(i => i.tags || [])));

    async function save() {
      busy.value = true;
      try {
        if (!bulk.value) {
          const meta = await saveMeta(it.id, { ...form, rating: form.rating || null });
          Object.assign(it, meta);
        } else {
          const set = {};
          if (bulkForm.series.trim()) set.series = bulkForm.series;
          if (bulkForm.date.trim()) set.date = bulkForm.date;
          if (bulkForm.rating) set.rating = bulkForm.rating;
          await bulkMeta({ file_ids: props.items.map(i => i.id), add_participants: bulkForm.add_participants, add_tags: bulkForm.add_tags,
            remove_participants: bulkForm.remove_participants, remove_tags: bulkForm.remove_tags, set });
        }
        toast.success(bulk.value ? `Updated ${props.items.length} items` : 'Details saved');
        emit('saved');
        emit('close');
      } catch (e) { toast.error(e.message); }
      finally { busy.value = false; }
    }

    async function onCoverPicked(e) {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      coverBusy.value = true;
      try { const meta = await setCover(it.id, f, {}, props.kind === 'books' ? 'book' : 'video'); Object.assign(it, { thumb_file_id: meta.thumb_file_id }); coverVersion.value = meta.thumb_file_id; emit('saved'); }
      catch (err) { toast.error(err.message); }
      finally { coverBusy.value = false; }
    }
    async function regenerate() {
      coverBusy.value = true;
      try {
        const meta = await autoCover(it, null, props.kind === 'videos' ? 'video' : 'book');
        if (meta) { Object.assign(it, { thumb_file_id: meta.thumb_file_id, duration: meta.duration ?? it.duration }); coverVersion.value = meta.thumb_file_id; emit('saved'); }
        else toast.error(props.kind === 'videos' ? 'Couldn’t read a frame from this video in your browser.' : 'This book doesn’t include a cover image that can be read here.');
      } finally { coverBusy.value = false; }
    }

    const onKey = (e) => { if (e.key === 'Escape') emit('close'); };
    onMounted(() => window.addEventListener('keydown', onKey));
    onUnmounted(() => window.removeEventListener('keydown', onKey));

    return { L, bulk, form, bulkForm, busy, coverBusy, coverInput, coverVersion, seriesListId, peopleSuggestions, tagSuggestions, seriesSuggestions,
      selectionPeople, selectionTags, save, onCoverPicked, regenerate, displayTitle };
  },
};

/** Search + filters + sort row used by Videos, Music and Books */
export const LibraryFilters = {
  components: { Icon },
  props: { f: { type: Object, required: true }, kind: String, sorts: { type: Array, required: true }, placeholder: String },
  template: /*html*/`
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative flex-1 min-w-[200px] max-w-sm">
        <Icon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input v-model="f.search.value" type="search" title="Search (press / to jump here)" :placeholder="placeholder || 'Search titles, people, tags'" class="input pl-9">
      </div>
      <select v-if="f.people.value.length" v-model="f.person.value" class="input w-auto max-w-[180px]" :class="f.person.value ? '!border-accent' : ''" :aria-label="L.people">
        <option value="">All {{ L.people.toLowerCase() }}</option>
        <option v-for="p in f.people.value" :key="p.value" :value="p.value">{{ p.value }} ({{ p.count }})</option>
      </select>
      <select v-if="f.tags.value.length" v-model="f.tag.value" class="input w-auto max-w-[160px]" :class="f.tag.value ? '!border-accent' : ''" aria-label="Tag">
        <option value="">All tags</option>
        <option v-for="t in f.tags.value" :key="t.value" :value="t.value">{{ t.value }} ({{ t.count }})</option>
      </select>
      <select v-if="f.seriesList.value.length" v-model="f.series.value" class="input w-auto max-w-[180px]" :class="f.series.value ? '!border-accent' : ''" :aria-label="L.series">
        <option value="">Any {{ L.series.toLowerCase() }}</option>
        <option v-for="s in f.seriesList.value" :key="s" :value="s">{{ s }}</option>
      </select>
      <select v-model="f.sort.value" class="input w-auto" aria-label="Sort by">
        <option v-for="s in sorts" :key="s[0]" :value="s[0]">{{ s[1] }}</option>
      </select>
      <button v-if="f.active.value" class="btn btn-ghost btn-sm" @click="f.reset()"><Icon name="x" :size="14" />Clear</button>
    </div>`,
  setup(props) { return { L: computed(() => labelsFor(props.kind)) }; },
};
