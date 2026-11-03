import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import Icon from '../components/Icon.js';
import FileViewer from '../components/FileViewer.js';
import { Thumb, Stars, MetaEditor, LibraryFilters, labelsFor } from '../components/Library.js';
import { api, fileUrl, formatBytes, formatDate, downloadUrl, refreshAccount } from '../lib/api.js';
import { toast, confirmDialog, attempt } from '../lib/ui.js';
import { uploadMany } from '../lib/upload.js';
import { useLibraryFilter, displayTitle, formatDuration, autoCover, backfillCovers, captureVideoFrame, setCover, thumbUrl, preload } from '../lib/library.js';
import { kindOf } from '../lib/filetypes.js';

const CONFIG = {
  videos: {
    title: 'Videos', icon: 'film', aspect: 'aspect-video', coverKind: 'video', uploadLabel: 'Upload videos',
    accept: 'video/*,.mkv,.avi,.mov,.wmv,.flv,.m4v,.3gp,.ts',
    grid: 'grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
    empty: 'Upload videos, then add participants, tags and details so you can sort and find them later.',
    sorts: [['added', 'Recently added'], ['oldest', 'Oldest added'], ['title', 'Title'], ['date', 'Date recorded'], ['people', 'Participants'], ['series', 'Series'], ['rating', 'Rating'], ['longest', 'Longest'], ['shortest', 'Shortest'], ['size', 'Largest file']],
  },
  books: {
    title: 'Books', icon: 'file-text', aspect: 'aspect-[2/3]', coverKind: 'book', uploadLabel: 'Add books',
    accept: '.pdf,.epub,.mobi,.azw,.azw3,.djvu,.fb2,.cbz,.cbr,.txt,application/pdf,application/epub+zip',
    grid: 'grid-cols-2 min-[520px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7',
    empty: 'Add PDF or EPUB books. EPUBs open in the built-in reader, which remembers where you stopped.',
    sorts: [['recent', 'Recently read'], ['added', 'Recently added'], ['title', 'Title'], ['people', 'Author'], ['series', 'Series'], ['date', 'Published'], ['rating', 'Rating'], ['size', 'Largest file']],
  },
};

export default {
  components: { Icon, FileViewer, Thumb, Stars, MetaEditor, LibraryFilters },
  props: { kind: { type: String, required: true } },
  template: /*html*/`
    <div @dragenter="onDragEnter" @dragover.prevent @dragleave="onDragLeave" @drop.prevent="onDrop">
      <div class="flex flex-col gap-4 mb-6">
        <div class="flex items-end gap-3 flex-wrap">
          <div class="flex-1 min-w-0">
            <h1 class="title text-[28px] md:text-[32px] leading-tight">{{ C.title }}</h1>
            <p class="text-muted text-[13.5px]">
              <template v-if="loaded">{{ f.filtered.value.length === items.length ? items.length : f.filtered.value.length + ' of ' + items.length }} {{ kind === 'videos' ? (items.length === 1 ? 'video' : 'videos') : (items.length === 1 ? 'book' : 'books') }}<template v-if="totalDuration">, {{ totalDuration }}</template></template>
              <template v-else>&nbsp;</template>
            </p>
          </div>
          <div class="flex gap-2">
            <button v-if="items.length" class="btn" :class="selecting ? '!border-accent text-accent' : ''" @click="toggleSelecting"><Icon name="check" :size="16" />{{ selecting ? 'Done' : 'Select' }}</button>
            <input ref="fileInput" type="file" multiple :accept="C.accept" class="hidden" @change="onPick">
            <button class="btn btn-primary" @click="fileInput.click()"><Icon name="upload" :size="16" />{{ C.uploadLabel }}</button>
          </div>
        </div>
        <LibraryFilters v-if="items.length" :f="f" :kind="kind" :sorts="C.sorts" />
      </div>

      <!-- quick filter chips for the most used tags -->
      <div v-if="items.length && f.tags.value.length" class="flex gap-1.5 overflow-x-auto no-scrollbar -mt-2 mb-5">
        <button v-for="t in f.tags.value.slice(0, 14)" :key="t.value" class="chip !h-7 !px-3 shrink-0 hover:text-fg" :class="f.tag.value === t.value ? 'chip-accent' : ''"
                @click="f.tag.value = f.tag.value === t.value ? '' : t.value">#{{ t.value }}</button>
      </div>

      <div v-if="!loaded" class="grid gap-x-4 gap-y-6" :class="C.grid">
        <div v-for="i in 10" :key="i"><div class="rounded-xl skeleton" :class="C.aspect"></div><div class="h-4 w-3/4 rounded skeleton mt-3"></div></div>
      </div>

      <div v-else-if="!items.length" class="panel py-16 px-6 text-center">
        <span class="w-14 h-14 rounded-2xl bg-elevated grid place-items-center mx-auto mb-4 text-muted"><Icon :name="C.icon" :size="24" /></span>
        <p class="title text-lg mb-1">No {{ kind }} yet</p>
        <p class="text-muted text-[13.5px] mb-5 max-w-md mx-auto">{{ C.empty }}</p>
        <button class="btn btn-primary" @click="fileInput.click()"><Icon name="upload" :size="16" />{{ C.uploadLabel }}</button>
        <p class="text-faint text-xs mt-4">They’re stored in the locked “{{ kind === 'videos' ? 'Videos' : 'Books' }}” folder in Files.</p>
      </div>

      <div v-else-if="!f.filtered.value.length" class="panel py-12 px-6 text-center">
        <p class="title text-lg mb-1">Nothing matches these filters</p>
        <button class="btn mt-3" @click="f.reset()">Clear filters</button>
      </div>

      <div v-else class="grid gap-x-4 gap-y-6" :class="C.grid">
        <div v-for="(it, i) in f.filtered.value" :key="it.id" class="group relative cursor-pointer" @click="onCardClick(i, it)" @contextmenu.prevent="openMenu($event, it)">
          <div class="relative rounded-xl overflow-hidden ring-2 transition-shadow" :class="[C.aspect, isSel(it.id) ? 'ring-accent' : 'ring-transparent']">
            <Thumb :file-id="it.id" :w="kind === 'books' ? 480 : 480" :version="it.thumb_file_id || 'none'" :icon="C.icon" />
            <span v-if="kind === 'videos' && it.duration" class="absolute bottom-2 right-2 px-1.5 h-5 rounded bg-black/75 text-white text-[11px] font-medium tabular-nums grid place-items-center">{{ formatDuration(it.duration) }}</span>
            <span v-if="kind === 'videos'" class="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <span class="w-12 h-12 rounded-full bg-black/55 backdrop-blur grid place-items-center text-white"><Icon name="play" :size="18" class="translate-x-[1px]" /></span>
            </span>
            <span v-if="kind === 'books'" class="absolute top-2 left-2 chip !bg-black/60 !text-white uppercase !text-[10px] tracking-wide">{{ ext(it) }}</span>
            <div v-if="kind === 'books' && progressOf(it) > 0" class="absolute inset-x-0 bottom-0 h-1 bg-black/40"><div class="h-full bg-accent" :style="{ width: Math.round(progressOf(it) * 100) + '%' }"></div></div>
            <input type="checkbox" class="checkbox absolute top-2 right-11 !w-5 !h-5 bg-black/30 border-white/80" :class="selecting || isSel(it.id) ? '' : 'opacity-0 group-hover:opacity-100'"
                   :checked="isSel(it.id)" @click.stop="toggleSel(it.id)" :aria-label="'Select ' + displayTitle(it)">
            <button class="absolute top-1.5 right-1.5 w-8 h-8 rounded-full grid place-items-center bg-black/50 backdrop-blur text-white opacity-0 group-hover:opacity-100 focus:opacity-100"
                    @click.stop="openMenu($event, it)" :aria-label="'Actions for ' + displayTitle(it)"><Icon name="more" :size="17" /></button>
          </div>
          <div class="mt-2.5 px-0.5 min-w-0">
            <p class="font-medium text-[14px] leading-snug line-clamp-2" :title="displayTitle(it)">{{ displayTitle(it) }}</p>
            <p v-if="it.participants.length" class="text-[12.5px] text-muted truncate">{{ it.participants.join(', ') }}</p>
            <p class="text-xs text-faint flex items-center gap-1.5 mt-0.5">
              <span v-if="it.date">{{ it.date }}</span><span v-if="it.series" class="truncate">{{ it.series }}</span>
              <span v-if="kind === 'books' && progressOf(it) > 0" class="text-accent">{{ Math.round(progressOf(it) * 100) }}% read</span>
              <Stars v-if="it.rating" :model-value="it.rating" :size="11" readonly class="ml-auto" />
            </p>
            <div v-if="it.tags.length" class="flex flex-wrap gap-1 mt-1.5">
              <span v-for="t in it.tags.slice(0, 3)" :key="t" class="chip !h-5 !text-[11px]">#{{ t }}</span>
              <span v-if="it.tags.length > 3" class="text-[11px] text-faint">+{{ it.tags.length - 3 }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Selection bar -->
      <Transition name="pop">
        <div v-if="selected.length" class="fixed z-[170] left-1/2 -translate-x-1/2 bottom-[76px] md:bottom-6 md:ml-[124px] panel flex items-center gap-1 p-1.5 pl-4">
          <span class="text-[13.5px] font-medium mr-2 whitespace-nowrap">{{ selected.length }} selected</span>
          <button class="btn btn-ghost btn-sm" @click="selectAll">All</button>
          <button class="btn btn-ghost btn-sm" @click="editSelected"><Icon name="pencil" :size="15" />Edit details</button>
          <button class="btn btn-ghost btn-sm !text-danger" @click="deleteSelected"><Icon name="trash" :size="15" /><span class="hidden sm:inline">Delete</span></button>
          <button class="icon-btn icon-btn-sm" @click="selected = []; selecting = false" title="Clear"><Icon name="x" :size="15" /></button>
        </div>
      </Transition>

      <!-- Card menu -->
      <div v-if="menu" class="fixed inset-0 z-[230]" @click="menu = null">
        <div class="menu fixed" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
          <button class="menu-item" @click="run(open)"><Icon :name="kind === 'videos' ? 'play' : 'eye'" :size="kind === 'videos' ? 14 : 16" />{{ kind === 'videos' ? 'Play' : 'Read' }}</button>
          <button class="menu-item" @click="run(it => editors = [it])"><Icon name="pencil" :size="16" />Edit details</button>
          <button class="menu-item" @click="run(it => downloadUrl(fileUrl(it.id, { download: true })))"><Icon name="download" :size="16" />Download</button>
          <a class="menu-item" :href="'#/files/' + folderId" @click="menu = null"><Icon name="folder" :size="16" />Show in Files</a>
          <div class="menu-sep"></div>
          <button class="menu-item danger" @click="run(remove)"><Icon name="trash" :size="16" />Delete</button>
        </div>
      </div>

      <!-- Drop overlay -->
      <Transition name="fade">
        <div v-if="dragOver" class="fixed inset-0 z-[190] pointer-events-none md:left-[248px] p-4">
          <div class="w-full h-full rounded-2xl border-2 border-dashed border-accent bg-accent/[0.06] grid place-items-center">
            <div class="panel px-6 py-4 flex items-center gap-3"><Icon name="upload" :size="22" class="text-accent" /><span class="font-medium">Drop to add to {{ C.title }}</span></div>
          </div>
        </div>
      </Transition>

      <MetaEditor v-if="editors" :kind="kind" :items="editors" :all-items="items" @close="editors = null" @saved="onSaved" />

      <FileViewer v-if="viewer" :files="viewer.files" :start-index="viewer.index" :info-open="true" @close="viewer = null">
        <template #details="{ file }">
          <div class="p-5 border-b border-line space-y-3">
            <div class="flex items-start gap-2">
              <p class="title text-lg leading-snug flex-1">{{ displayTitle(file) }}</p>
              <button class="btn btn-sm" @click="editors = [file]"><Icon name="pencil" :size="14" />Edit</button>
            </div>
            <div v-if="file.participants && file.participants.length">
              <p class="label !mb-1.5">{{ L.people }}</p>
              <div class="flex flex-wrap gap-1.5"><button v-for="p in file.participants" :key="p" class="chip chip-accent hover:brightness-110" @click="filterBy('person', p)">{{ p }}</button></div>
            </div>
            <div v-if="file.tags && file.tags.length">
              <p class="label !mb-1.5">Tags</p>
              <div class="flex flex-wrap gap-1.5"><button v-for="t in file.tags" :key="t" class="chip hover:text-fg" @click="filterBy('tag', t)">#{{ t }}</button></div>
            </div>
            <dl class="grid grid-cols-[100px_1fr] gap-y-2 text-[13px]">
              <template v-if="file.series"><dt class="text-muted">{{ L.series }}</dt><dd>{{ file.series }}</dd></template>
              <template v-if="file.date"><dt class="text-muted">{{ L.date }}</dt><dd>{{ file.date }}</dd></template>
              <template v-if="file.duration"><dt class="text-muted">Length</dt><dd class="tabular-nums">{{ formatDuration(file.duration) }}</dd></template>
              <template v-if="file.rating"><dt class="text-muted">Rating</dt><dd><Stars :model-value="file.rating" :size="14" readonly /></dd></template>
            </dl>
            <p v-if="file.details" class="text-[13.5px] whitespace-pre-line leading-relaxed">{{ file.details }}</p>
            <p v-if="!file.participants?.length && !file.tags?.length && !file.details && !file.series && !file.date" class="text-muted text-[13px]">No details yet. Add {{ L.people.toLowerCase() }}, tags and notes to sort and find this later.</p>
            <button v-if="kind === 'videos'" class="btn btn-sm w-full" @click="frameAsCover(file)"><Icon name="image" :size="14" />Use current frame as cover</button>
          </div>
        </template>
      </FileViewer>
    </div>
  `,
  setup(props) {
    const C = computed(() => CONFIG[props.kind]);
    const L = computed(() => labelsFor(props.kind));
    const items = ref([]);
    const loaded = ref(false);
    const folderId = ref('');
    const fileInput = ref(null);
    const selecting = ref(false);
    const selected = ref([]);
    const menu = ref(null);
    const editors = ref(null);
    const viewer = ref(null);
    const dragOver = ref(false);
    let dragDepth = 0;
    let stopBackfill = null;

    const f = useLibraryFilter(items, props.kind, props.kind === 'books' ? 'recent' : 'added');

    const totalDuration = computed(() => {
      if (props.kind !== 'videos') return '';
      const s = f.filtered.value.reduce((a, it) => a + (it.duration || 0), 0);
      if (!s) return '';
      const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
      return h ? `${h} h ${m} min` : `${m} min`;
    });

    async function load() {
      try {
        const r = await api(`/api/library/${props.kind}`);
        items.value = r.items;
        folderId.value = r.folderId;
        loaded.value = true;
        startBackfill();
      } catch (e) { toast.error(e.message); }
    }

    // Generate missing covers quietly in the background
    function startBackfill() {
      if (stopBackfill) stopBackfill();
      const missing = items.value.filter(it => !it.thumb_file_id && (props.kind === 'videos' || /\.(pdf|epub)$/i.test(it.filename)));
      if (!missing.length) return;
      stopBackfill = backfillCovers(missing, C.value.coverKind, (it, meta) => {
        it.thumb_file_id = meta.thumb_file_id;
        if (meta.duration && !it.duration) it.duration = meta.duration;
      });
    }

    // Warm thumbnails for everything after the first screenful
    watch(() => f.filtered.value, (list) => { preload(list.slice(12, 60).map(it => thumbUrl(it.id, 480, it.thumb_file_id || 'none'))); });

    const ext = (it) => (it.filename.split('.').pop() || '').slice(0, 4);
    const progressOf = (it) => { try { return JSON.parse(it.progress || 'null')?.pct || 0; } catch (e) { return 0; } };

    // ---------- selection ----------
    const isSel = (id) => selected.value.includes(id);
    const toggleSel = (id) => { const i = selected.value.indexOf(id); if (i === -1) selected.value.push(id); else selected.value.splice(i, 1); };
    const toggleSelecting = () => { selecting.value = !selecting.value; if (!selecting.value) selected.value = []; };
    const selectAll = () => { selected.value = f.filtered.value.map(i => i.id); };
    const editSelected = () => { editors.value = items.value.filter(i => selected.value.includes(i.id)); };

    function onCardClick(i, it) {
      if (selecting.value || selected.value.length) { toggleSel(it.id); return; }
      open(it);
    }
    function open(it) {
      const list = f.filtered.value;
      viewer.value = { files: list, index: Math.max(0, list.indexOf(it)) };
    }
    function filterBy(which, value) {
      viewer.value = null;
      f.reset();
      if (which === 'person') f.person.value = value; else f.tag.value = value;
    }

    // ---------- actions ----------
    function openMenu(e, it) {
      const r = e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : { right: e.clientX, bottom: e.clientY };
      const x = e.type === 'contextmenu' ? e.clientX : r.right - 200;
      const y = e.type === 'contextmenu' ? e.clientY : r.bottom + 4;
      menu.value = { item: it, x: Math.max(8, Math.min(x, window.innerWidth - 210)), y: Math.min(y, window.innerHeight - 250) };
    }
    const run = (fn) => { const it = menu.value.item; menu.value = null; fn(it); };

    async function remove(it) {
      if (!await confirmDialog({ title: `Delete “${displayTitle(it)}”?`, message: 'The file and its details are deleted permanently.', confirmText: 'Delete', danger: true })) return;
      await attempt(async () => { await api(`/api/files/${it.id}`, { method: 'DELETE' }); items.value = items.value.filter(x => x.id !== it.id); refreshAccount(); }, 'Deleted');
    }
    async function deleteSelected() {
      const n = selected.value.length;
      if (!await confirmDialog({ title: `Delete ${n} item${n > 1 ? 's' : ''}?`, message: 'The files and their details are deleted permanently.', confirmText: 'Delete', danger: true })) return;
      let failed = 0;
      for (const id of selected.value) { try { await api(`/api/files/${id}`, { method: 'DELETE' }); } catch (e) { failed++; } }
      selected.value = []; selecting.value = false;
      await load(); refreshAccount();
      if (failed) toast.error(`${failed} couldn’t be deleted`); else toast.success('Deleted');
    }
    function onSaved() {
      // single edits are applied in place by the editor; bulk edits need a reload
      if (editors.value && editors.value.length > 1) { load(); selected.value = []; selecting.value = false; }
    }

    async function frameAsCover(file) {
      const video = document.querySelector('[role=dialog] video');
      if (!video || !video.videoWidth) return toast('Play the video to the frame you want first.');
      try {
        const scale = Math.min(1, 960 / video.videoWidth);
        const c = document.createElement('canvas');
        c.width = Math.round(video.videoWidth * scale); c.height = Math.round(video.videoHeight * scale);
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
        const meta = await setCover(file.id, blob, isFinite(video.duration) ? { duration: video.duration } : {}, 'video');
        file.thumb_file_id = meta.thumb_file_id;
        toast.success('Cover updated');
      } catch (e) { toast.error(e.message || 'Couldn’t capture this frame'); }
    }

    // ---------- upload ----------
    async function upload(list) {
      const fitting = list.filter(fl => {
        const k = kindOf({ filename: fl.name, mime_type: fl.type });
        return props.kind === 'videos' ? k === 'video' : (['pdf', 'epub', 'text'].includes(k) || /\.(mobi|azw3?|djvu|fb2|cbz|cbr)$/i.test(fl.name));
      });
      const skipped = list.length - fitting.length;
      if (skipped) toast(`${skipped} file${skipped > 1 ? 's' : ''} skipped: only ${props.kind === 'videos' ? 'videos' : 'books'} can go here. Use Files for anything else.`);
      if (!fitting.length) return;
      if (!folderId.value) await load();
      const res = await uploadMany(fitting, folderId.value, {
        onEach: async (fileId, file) => {
          // make the cover (and read the length) from the local copy, which is fast
          await autoCover({ id: fileId, filename: file.name, size_bytes: file.size }, file, C.value.coverKind).catch(() => null);
        },
      });
      await load(); refreshAccount();
      if (res.length) toast.success(`Added ${res.length} ${props.kind === 'videos' ? (res.length === 1 ? 'video' : 'videos') : (res.length === 1 ? 'book' : 'books')}`);
    }
    async function onPick(e) { const list = Array.from(e.target.files || []); e.target.value = ''; if (list.length) await upload(list); }
    const isFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    function onDragEnter(e) { if (isFiles(e)) { dragDepth++; dragOver.value = true; } }
    function onDragLeave(e) { if (isFiles(e)) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dragOver.value = false; } }
    async function onDrop(e) { dragOver.value = false; dragDepth = 0; if (isFiles(e) && e.dataTransfer.files.length) await upload(Array.from(e.dataTransfer.files)); }

    const onKey = (e) => {
      if (e.key !== 'Escape' || viewer.value || editors.value) return;
      if (menu.value) menu.value = null; else if (selected.value.length) { selected.value = []; selecting.value = false; }
    };
    watch(() => props.kind, () => { loaded.value = false; items.value = []; selected.value = []; f.reset(); load(); });
    onMounted(() => { load(); window.addEventListener('keydown', onKey); });
    onUnmounted(() => { if (stopBackfill) stopBackfill(); window.removeEventListener('keydown', onKey); });

    return {
      C, L, items, loaded, folderId, fileInput, f, selecting, selected, menu, editors, viewer, dragOver, totalDuration,
      isSel, toggleSel, toggleSelecting, selectAll, editSelected, onCardClick, open, filterBy, openMenu, run, remove, deleteSelected, onSaved,
      frameAsCover, onPick, onDragEnter, onDragLeave, onDrop, ext, progressOf,
      displayTitle, formatDuration, formatBytes, formatDate, fileUrl, downloadUrl,
    };
  },
};
