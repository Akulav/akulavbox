import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import Icon from '../components/Icon.js';
import FileViewer from '../components/FileViewer.js';
import { Thumb, JustifiedGrid } from '../components/Library.js';
import { api, formatBytes, downloadUrl, downloadZip, session, refreshAccount, storage } from '../lib/api.js';
import { toast, confirmDialog, promptDialog, attempt } from '../lib/ui.js';
import { uploadMany } from '../lib/upload.js';
import { systemFolder, thumbUrl, preload, rememberDims } from '../lib/library.js';
import { fileUrl } from '../lib/api.js';

// Survives switching tabs: lists render instantly when you come back, and each
// page remembers how far down you had scrolled.
const cache = { collections: null, albums: {}, images: {} };
const scrollMemory = new Map();

export default {
  components: { Icon, FileViewer, Thumb, JustifiedGrid },
  props: { args: { type: Array, default: () => [] } },
  template: /*html*/`
    <div @dragenter="onDragEnter" @dragover.prevent @dragleave="onDragLeave" @drop.prevent="onDrop">
      <!-- Header -->
      <div class="flex flex-col gap-4 mb-6">
        <div>
          <nav v-if="level !== 'collections'" class="flex items-center gap-1 text-[13px] text-muted mb-1.5 overflow-x-auto no-scrollbar" aria-label="Breadcrumb">
            <a href="#/albums" class="hover:text-fg shrink-0">Photos</a>
            <template v-if="level === 'images' && collection">
              <Icon name="chevron-right" :size="14" class="text-faint shrink-0" />
              <a :href="'#/albums/' + collection.id" class="hover:text-fg truncate max-w-[200px]">{{ collection.title }}</a>
            </template>
          </nav>
          <div class="flex items-center gap-3">
            <button v-if="level !== 'collections'" class="icon-btn -ml-2" @click="goBack" title="Back"><Icon name="arrow-left" :size="19" /></button>
            <h1 class="title text-[28px] md:text-[32px] leading-tight truncate">{{ heading }}</h1>
          </div>
          <p v-if="currentNotes" class="text-muted text-[13.5px] mt-1.5 max-w-2xl whitespace-pre-line">{{ currentNotes }}</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div v-if="level !== 'images'" class="relative flex-1 min-w-[180px] max-w-sm">
            <Icon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
            <input v-model="search" type="search" title="Search (press / to jump here)" :placeholder="level === 'collections' ? 'Search collections' : 'Search albums'" class="input pl-9">
          </div>
          <select v-if="level !== 'images'" v-model="groupSort" class="input w-auto" aria-label="Sort">
            <option value="favorites">Favorites first</option>
            <option value="alpha">A to Z</option>
            <option value="count">Most photos</option>
          </select>
          <template v-else>
            <select v-model="imageSort" class="input w-auto" aria-label="Sort photos">
              <option value="default">Date added</option>
              <option value="name">Name</option>
              <option value="size_desc">Largest first</option>
              <option value="size_asc">Smallest first</option>
            </select>
            <div class="seg" role="group" aria-label="Layout">
              <button :class="{ on: layout === 'justified' }" @click="layout = 'justified'" title="Natural shape (rows)"><Icon name="images" :size="15" /><span class="hidden sm:inline">Rows</span></button>
              <button :class="{ on: layout === 'square' }" @click="layout = 'square'" title="Square tiles"><Icon name="grid" :size="15" /><span class="hidden sm:inline">Squares</span></button>
            </div>
            <div class="seg" role="group" aria-label="Size">
              <button :class="{ on: density === 'small' }" @click="density = 'small'" title="Smaller">S</button>
              <button :class="{ on: density === 'large' }" @click="density = 'large'" title="Larger">L</button>
            </div>
            <button v-if="sortedImages.length" class="btn" :class="selecting ? '!border-accent text-accent' : ''" @click="toggleSelecting"><Icon name="check" :size="16" />{{ selecting ? 'Done' : 'Select' }}</button>
          </template>

          <div class="flex gap-2 ml-auto">
            <template v-if="level === 'collections'">
              <button class="btn btn-ghost" @click="migrateImages" title="Move album photos stored at the top of Files into the locked Photos folder"><Icon name="folder-input" :size="16" /><span class="hidden lg:inline">Tidy uploads</span></button>
              <button class="btn btn-primary" @click="createCollection"><Icon name="plus" :size="16" />New collection</button>
            </template>
            <template v-else-if="level === 'albums'">
              <a class="btn" :href="'#/albums/' + collection?.id + '/all'"><Icon name="images" :size="16" /><span class="hidden sm:inline">All photos</span></a>
              <button class="btn btn-primary" @click="createAlbum"><Icon name="plus" :size="16" />New album</button>
            </template>
            <template v-else-if="album">
              <button class="btn" @click="downloadAlbum(album)"><Icon name="download" :size="16" /><span class="hidden sm:inline">Download</span></button>
              <input ref="uploadInput" type="file" multiple accept="image/*" class="hidden" @change="onPick">
              <button class="btn btn-primary" @click="uploadInput.click()" :disabled="uploading"><Icon :name="uploading ? 'loader' : 'upload'" :size="16" />{{ uploading ? 'Uploading…' : 'Add photos' }}</button>
            </template>
          </div>
        </div>
      </div>

      <div v-if="loading" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        <div v-for="i in 10" :key="i"><div class="aspect-[4/3] rounded-xl skeleton"></div><div class="h-4 w-2/3 rounded skeleton mt-3"></div></div>
      </div>

      <!-- COLLECTIONS & ALBUMS -->
      <template v-else-if="level !== 'images'">
        <div v-if="!groups.length" class="panel py-16 px-6 text-center">
          <span class="w-14 h-14 rounded-2xl bg-elevated grid place-items-center mx-auto mb-4 text-muted"><Icon name="images" :size="24" /></span>
          <p class="title text-lg mb-1">{{ search ? 'Nothing matches your search' : (level === 'collections' ? 'No collections yet' : 'No albums in this collection yet') }}</p>
          <p v-if="!search" class="text-muted text-[13.5px] mb-5">{{ level === 'collections' ? 'A collection groups related albums, like a trip or a year.' : 'Create an album, then add photos to it.' }}</p>
          <button v-if="!search" class="btn btn-primary" @click="level === 'collections' ? createCollection() : createAlbum()"><Icon name="plus" :size="16" />{{ level === 'collections' ? 'New collection' : 'New album' }}</button>
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 stagger">
          <a v-for="g in groups" :key="g.id" class="group tile lift" :class="g.display_cover_id ? 'tile-media tile-cap-on' : 'tile-folder'"
             :href="level === 'collections' ? '#/albums/' + g.id : '#/albums/' + collection.id + '/' + g.id" :title="g.title">
            <div v-if="g.display_cover_id" class="absolute inset-0 zoom-media"><Thumb :file-id="g.display_cover_id" :w="480" icon="images" /></div>
            <Icon v-else :name="level === 'collections' ? 'box' : 'images'" size="100%" :stroke="1.25" class="tile-mark" />
            <span class="tile-badge" :class="g.display_cover_id ? 'bg-black/55 text-white backdrop-blur' : 'bg-accent/15 text-accent'">
              <Icon :name="level === 'collections' ? 'box' : 'images'" :size="11" :stroke="2.25" />{{ level === 'collections' ? (g.album_count || 0) + ' album' + (g.album_count === 1 ? '' : 's') : (g.image_count || 0) }}
            </span>
            <span v-if="!g.display_cover_id" class="tile-count">{{ g.image_count || 0 }}</span>
            <div class="tile-cap">
              <p class="truncate text-[13.5px] font-semibold leading-tight">{{ g.title }}</p>
              <p class="text-[11px] leading-tight mt-0.5 tile-sub truncate">{{ g.image_count || 0 }} photo{{ g.image_count === 1 ? '' : 's' }}<template v-if="g.notes"> · {{ g.notes }}</template></p>
            </div>
            <button class="absolute z-[3] bottom-2 right-2 w-7 h-7 rounded-full grid place-items-center bg-black/45 backdrop-blur transition-opacity"
                    :class="g.is_favorite ? 'text-accent opacity-100' : 'text-white/80 opacity-0 group-hover:opacity-100'"
                    @click.prevent.stop="toggleFavorite(g)" :title="g.is_favorite ? 'Remove from favorites' : 'Add to favorites'">
              <Icon :name="g.is_favorite ? 'star-fill' : 'star'" :size="14" />
            </button>
            <button class="tile-more" @click.prevent.stop="openMenu($event, g)" :aria-label="'Actions for ' + g.title"><Icon name="more" :size="16" /></button>
          </a>
        </div>
      </template>

      <!-- PHOTOS -->
      <template v-else>
        <div v-if="!sortedImages.length" class="panel py-16 px-6 text-center">
          <span class="w-14 h-14 rounded-2xl bg-elevated grid place-items-center mx-auto mb-4 text-muted"><Icon name="image" :size="24" /></span>
          <p class="title text-lg mb-1">No photos here yet</p>
          <p class="text-muted text-[13.5px] mb-5">{{ album ? 'Add photos from your device to fill this album.' : 'Photos added to albums in this collection appear here.' }}</p>
          <button v-if="album" class="btn btn-primary" @click="uploadInput.click()"><Icon name="upload" :size="16" />Add photos</button>
        </div>
        <JustifiedGrid v-else-if="layout === 'justified'" :items="sortedImages" :row-height="density === 'small' ? 160 : 250" :gap="density === 'small' ? 4 : 6">
          <template #default="{ item, index }">
            <div class="group absolute inset-0 rounded-md overflow-hidden" :class="[selecting ? 'cursor-pointer' : 'cursor-zoom-in', isSel(item.id) ? 'ring-[3px] ring-accent ring-inset' : '']" @click="onTileClick(item, index)">
              <Thumb :file-id="item.id" :w="density === 'small' ? 240 : 480" :eager="index < 12" @dims="d => onDims(item, d)" />
              <div v-if="isSel(item.id)" class="absolute inset-0 bg-accent/20 pointer-events-none"></div>
              <span class="absolute top-1.5 left-1.5 w-6 h-6 rounded-full grid place-items-center border-2 transition-opacity"
                    :class="[isSel(item.id) ? 'bg-accent border-accent text-accent-fg opacity-100' : 'border-white/90 bg-black/25 text-transparent', selecting || isSel(item.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100']"
                    @click.stop="toggleSel(item.id)" role="checkbox" :aria-checked="isSel(item.id)"><Icon name="check" :size="13" :stroke="3" /></span>
              <div v-if="album && !selecting" class="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button class="h-7 px-2 rounded-md bg-black/60 backdrop-blur text-white text-[11.5px] font-medium hover:bg-black/80" @click.stop="setCover(item)">Make cover</button>
              </div>
            </div>
          </template>
        </JustifiedGrid>
        <div v-else class="grid gap-1.5 sm:gap-2" :class="density === 'small' ? 'grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10' : 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'">
          <div v-for="(img, i) in sortedImages" :key="img.id" class="group relative aspect-square rounded-md overflow-hidden"
               :class="[selecting ? 'cursor-pointer' : 'cursor-zoom-in', isSel(img.id) ? 'ring-[3px] ring-accent ring-inset' : '']"
               style="content-visibility: auto; contain-intrinsic-size: 220px;" @click="onTileClick(img, i)">
            <Thumb :file-id="img.id" :w="density === 'small' ? 240 : 480" :eager="i < 12" @dims="d => onDims(img, d)" />
            <div v-if="isSel(img.id)" class="absolute inset-0 bg-accent/20 pointer-events-none"></div>
            <span class="absolute top-1.5 left-1.5 w-6 h-6 rounded-full grid place-items-center border-2 transition-opacity"
                  :class="[isSel(img.id) ? 'bg-accent border-accent text-accent-fg opacity-100' : 'border-white/90 bg-black/25 text-transparent', selecting || isSel(img.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100']"
                  @click.stop="toggleSel(img.id)" role="checkbox" :aria-checked="isSel(img.id)"><Icon name="check" :size="13" :stroke="3" /></span>
            <div v-if="album && !selecting" class="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button class="h-7 px-2 rounded-md bg-black/60 backdrop-blur text-white text-[11.5px] font-medium hover:bg-black/80" @click.stop="setCover(img)">Make cover</button>
            </div>
          </div>
        </div>
        <p v-if="sortedImages.length" class="text-faint text-xs mt-3">{{ sortedImages.length }} photo{{ sortedImages.length === 1 ? '' : 's' }}, {{ formatBytes(sortedImages.reduce((s, i) => s + (i.size_bytes || 0), 0)) }}</p>
      </template>

      <!-- Photo selection -->
      <Transition name="pop">
        <div v-if="selected.length" class="fixed z-[170] left-1/2 -translate-x-1/2 bottom-[76px] md:bottom-6 panel flex items-center gap-1 p-1.5 pl-4 max-w-[calc(100vw-1rem)] overflow-x-auto no-scrollbar">
          <span class="text-[13.5px] font-medium mr-2 whitespace-nowrap">{{ selected.length }} selected</span>
          <button class="btn btn-ghost btn-sm" @click="selected = sortedImages.map(i => i.id)">All</button>
          <button class="btn btn-ghost btn-sm" @click="openAddTo($event)"><Icon name="plus" :size="15" /><span class="whitespace-nowrap">Add to album</span></button>
          <button class="btn btn-ghost btn-sm" @click="downloadSelected"><Icon name="download" :size="15" /><span class="hidden sm:inline">Download</span></button>
          <button v-if="album" class="btn btn-ghost btn-sm !text-danger" @click="removeSelected"><Icon name="x" :size="15" /><span class="whitespace-nowrap">Remove</span></button>
          <button class="icon-btn icon-btn-sm shrink-0" @click="clearSelection" title="Clear (Esc)"><Icon name="x" :size="15" /></button>
        </div>
      </Transition>
      <div v-if="addTo" class="fixed inset-0 z-[230]" @click="addTo = null">
        <div class="menu fixed max-h-[60vh] overflow-y-auto" :style="{ left: addTo.x + 'px', top: addTo.y + 'px' }" @click.stop>
          <p class="px-2.5 py-1.5 text-xs text-muted">Add {{ selected.length }} photo{{ selected.length === 1 ? '' : 's' }} to</p>
          <button v-for="a in albums.filter(a => !album || a.id !== album.id)" :key="a.id" class="menu-item" @click="addSelectedTo(a)"><Icon name="images" :size="16" /><span class="truncate">{{ a.title }}</span></button>
          <div class="menu-sep"></div>
          <button class="menu-item" @click="addSelectedToNew"><Icon name="plus" :size="16" />New album…</button>
        </div>
      </div>
      <Transition name="fade">
        <div v-if="dragOver" class="fixed inset-0 z-[190] pointer-events-none p-4">
          <div class="w-full h-full rounded-2xl border-2 border-dashed border-accent bg-accent/[0.06] grid place-items-center">
            <div class="panel px-6 py-4 flex items-center gap-3"><Icon name="upload" :size="22" class="text-accent" /><span class="font-medium">Drop photos to add them to {{ album ? album.title : 'an album' }}</span></div>
          </div>
        </div>
      </Transition>

      <!-- Card menu -->
      <div v-if="menu" class="fixed inset-0 z-[230]" @click="menu = null">
        <div class="menu fixed" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
          <button class="menu-item" @click="run(rename)"><Icon name="pencil" :size="16" />Rename</button>
          <button class="menu-item" @click="run(editNotes)"><Icon name="note" :size="16" />Edit notes</button>
          <button class="menu-item" @click="run(g => level === 'collections' ? downloadCollection(g) : downloadAlbum(g))"><Icon name="download" :size="16" />Download as zip</button>
          <div class="menu-sep"></div>
          <button class="menu-item danger" @click="run(remove)"><Icon name="trash" :size="16" />Delete</button>
        </div>
      </div>

      <!-- Notes editor -->
      <Transition name="fade">
        <div v-if="notes.open" class="fixed inset-0 z-[240] bg-black/50 flex items-end sm:items-center justify-center p-4" @mousedown.self="notes.open = false">
          <form class="panel w-full max-w-lg p-5" @submit.prevent="saveNotes">
            <h3 class="title text-lg mb-3">Notes for {{ notes.item.title }}</h3>
            <textarea v-model="notes.text" rows="6" class="input resize-none" placeholder="Where, when, who was there…"></textarea>
            <div class="flex justify-end gap-2 mt-4">
              <button type="button" class="btn" @click="notes.open = false">Cancel</button>
              <button type="submit" class="btn btn-primary">Save notes</button>
            </div>
          </form>
        </div>
      </Transition>

      <FileViewer v-if="viewerIndex !== null" :files="sortedImages" :start-index="viewerIndex" @close="viewerIndex = null" />
    </div>
  `,
  setup(props) {
    const collections = ref(cache.collections || []);
    const albums = ref([]);
    const images = ref([]);
    const loading = ref(false);
    const uploading = ref(false);
    const uploadInput = ref(null);
    const search = ref('');
    const groupSort = ref(storage.read('akulavAlbumSort') || 'favorites');
    const imageSort = ref('default');
    const density = ref(storage.read('akulavPhotoDensity') || 'large');
    const layout = ref(storage.read('akulavPhotoLayout') || 'justified');
    watch(layout, v => storage.write('akulavPhotoLayout', v));
    const selecting = ref(false);
    const selected = ref([]);
    const addTo = ref(null);
    const dragOver = ref(false);
    let dragDepth = 0;
    const viewerIndex = ref(null);
    const menu = ref(null);
    const notes = reactive({ open: false, item: null, text: '' });
    watch(groupSort, v => storage.write('akulavAlbumSort', v));
    watch(density, v => storage.write('akulavPhotoDensity', v));

    // ---------- route: #/albums[/collectionId[/albumId|all]] ----------
    const colId = computed(() => props.args[0] || null);
    const albId = computed(() => props.args[1] || null);
    const level = computed(() => !colId.value ? 'collections' : !albId.value ? 'albums' : 'images');
    const routeKey = computed(() => props.args.join('/') || 'root');

    const collection = computed(() => collections.value.find(c => c.id === colId.value) || null);
    const album = computed(() => albId.value && albId.value !== 'all' ? (albums.value.find(a => a.id === albId.value) || null) : null);

    const heading = computed(() => level.value === 'collections' ? 'Photos'
      : level.value === 'albums' ? (collection.value?.title || 'Collection')
      : album.value ? album.value.title : 'All photos');
    const currentNotes = computed(() => level.value === 'albums' ? collection.value?.notes : level.value === 'images' ? album.value?.notes : '');

    const groups = computed(() => {
      const src = level.value === 'collections' ? collections.value : albums.value;
      const q = search.value.trim().toLowerCase();
      const list = q ? src.filter(g => g.title.toLowerCase().includes(q) || (g.notes || '').toLowerCase().includes(q)) : src;
      return [...list].sort((a, b) => {
        if (groupSort.value === 'count') return (b.image_count || 0) - (a.image_count || 0);
        if (groupSort.value === 'favorites' && (b.is_favorite || 0) !== (a.is_favorite || 0)) return (b.is_favorite || 0) - (a.is_favorite || 0);
        return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
      });
    });

    const sortedImages = computed(() => {
      const list = [...images.value];
      if (imageSort.value === 'size_desc') list.sort((a, b) => b.size_bytes - a.size_bytes);
      else if (imageSort.value === 'size_asc') list.sort((a, b) => a.size_bytes - b.size_bytes);
      else if (imageSort.value === 'name') list.sort((a, b) => (a.filename || '').localeCompare(b.filename || '', undefined, { numeric: true }));
      return list;
    });

    // ---------- loading (cache first, then refresh) ----------
    const fetchCollections = async () => { collections.value = cache.collections = await api('/api/collections'); };
    const fetchAlbums = async (id) => { albums.value = cache.albums[id] = await api(`/api/collections/${id}/albums`); };
    const fetchImages = async (cid, aid) => {
      const key = `${cid}/${aid}`;
      images.value = cache.images[key] = aid === 'all' ? await api(`/api/collections/${cid}/images`) : await api(`/api/albums/${aid}/images`);
    };

    let loadSeq = 0;
    async function show() {
      const my = ++loadSeq;
      const cid = colId.value, aid = albId.value;
      // Render from cache straight away so the page has its full height for scroll restoration
      const hasCache = level.value === 'collections' ? !!cache.collections
        : level.value === 'albums' ? !!cache.albums[cid] && !!cache.collections
        : !!cache.images[`${cid}/${aid}`] && !!cache.albums[cid] && !!cache.collections;
      if (hasCache) {
        if (cache.collections) collections.value = cache.collections;
        if (cid && cache.albums[cid]) albums.value = cache.albums[cid];
        if (aid) images.value = cache.images[`${cid}/${aid}`];
      } else {
        loading.value = true;
      }
      restoreScroll(my);
      try {
        const jobs = [fetchCollections()];
        if (cid) jobs.push(fetchAlbums(cid));
        if (aid) jobs.push(fetchImages(cid, aid));
        await Promise.all(jobs);
      } catch (e) { if (my === loadSeq) toast.error(e.message); }
      if (my !== loadSeq) return;
      if (loading.value) { loading.value = false; restoreScroll(my); }
      if (level.value === 'images') preload(sortedImages.value.slice(30, 120).map(i => thumbUrl(i.id, density.value === 'small' ? 240 : 480)));
    }

    function restoreScroll(my) {
      const y = scrollMemory.get(routeKey.value) || 0;
      nextTick(() => requestAnimationFrame(() => { if (my === loadSeq) window.scrollTo({ top: y, behavior: 'instant' }); }));
    }

    // Remember the scroll position of the page we're leaving
    let lastY = 0;
    const onScroll = () => { lastY = window.scrollY; };
    watch(routeKey, (next, prev) => {
      if (prev !== undefined) scrollMemory.set(prev, lastY);
      search.value = '';
      selected.value = []; selecting.value = false;
      show();
    }, { flush: 'pre' });

    // ---------- photo selection ----------
    const isSel = (id) => selected.value.includes(id);
    const toggleSel = (id) => { const i = selected.value.indexOf(id); if (i === -1) selected.value.push(id); else selected.value.splice(i, 1); };
    const clearSelection = () => { selected.value = []; selecting.value = false; };
    const toggleSelecting = () => { if (selecting.value) clearSelection(); else selecting.value = true; };
    function onTileClick(img, index) {
      if (selecting.value || selected.value.length) toggleSel(img.id);
      else viewerIndex.value = index;
    }
    function onDims(img, d) {
      if (img.width && img.height) return;
      img.width = d.w; img.height = d.h;           // re-flows the row with the real shape
      rememberDims(img.id, d.w, d.h);
    }
    function openAddTo(e) {
      const r = e.currentTarget.getBoundingClientRect();
      addTo.value = { x: Math.max(8, Math.min(r.left, window.innerWidth - 230)), y: Math.max(8, r.top - 300) };
    }
    async function addSelectedTo(a) {
      addTo.value = null;
      const ids = [...selected.value];
      await attempt(async () => {
        await api(`/api/albums/${a.id}/images/bulk`, { method: 'POST', body: { file_ids: ids } });
        await fetchAlbums(colId.value);
        delete cache.images[`${colId.value}/${a.id}`];
      }, `Added ${ids.length} photo${ids.length === 1 ? '' : 's'} to ${a.title}`);
      clearSelection();
    }
    async function addSelectedToNew() {
      addTo.value = null;
      const title = await promptDialog({ title: 'New album', placeholder: 'Album name', confirmText: 'Create and add' });
      if (!title) return;
      const r = await attempt(() => api(`/api/collections/${colId.value}/albums`, { method: 'POST', body: { title } }));
      if (r) await addSelectedTo({ id: r.id, title });
    }
    async function removeSelected() {
      const ids = [...selected.value];
      if (!await confirmDialog({ title: `Remove ${ids.length} photo${ids.length === 1 ? '' : 's'} from this album?`, message: 'The photos stay in Files and in other albums.', confirmText: 'Remove' })) return;
      await attempt(async () => {
        await api(`/api/albums/${album.value.id}/images/remove`, { method: 'POST', body: { file_ids: ids } });
        images.value = cache.images[`${colId.value}/${albId.value}`] = images.value.filter(i => !ids.includes(i.id));
        fetchAlbums(colId.value);
      }, 'Removed from album');
      clearSelection();
    }
    function downloadSelected() {
      if (selected.value.length === 1) return downloadUrl(fileUrl(selected.value[0], { download: true }));
      downloadZip({ files: selected.value, name: heading.value });
    }

    // ---------- drag & drop upload into the open album ----------
    const isFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    function onDragEnter(e) { if (isFiles(e) && album.value) { dragDepth++; dragOver.value = true; } }
    function onDragLeave(e) { if (isFiles(e)) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dragOver.value = false; } }
    async function onDrop(e) {
      dragOver.value = false; dragDepth = 0;
      if (!isFiles(e) || !album.value) return;
      const list = Array.from(e.dataTransfer.files).filter(f => /^image\//.test(f.type) || /\.(heic|heif|avif|webp|jpe?g|png|gif|bmp|tiff?)$/i.test(f.name));
      if (!list.length) { toast('Only photos can be added to albums.'); return; }
      await uploadInto(list);
    }

    const goBack = () => { location.hash = level.value === 'images' ? `#/albums/${colId.value}` : '#/albums'; };

    // ---------- create / edit ----------
    async function createCollection() {
      const title = await promptDialog({ title: 'New collection', placeholder: 'e.g. Summer 2026', confirmText: 'Create' });
      if (!title) return;
      await attempt(async () => { await api('/api/collections', { method: 'POST', body: { title } }); await fetchCollections(); });
    }
    async function createAlbum() {
      const title = await promptDialog({ title: 'New album', placeholder: 'Album name', confirmText: 'Create' });
      if (!title) return;
      await attempt(async () => { await api(`/api/collections/${colId.value}/albums`, { method: 'POST', body: { title } }); await fetchAlbums(colId.value); });
    }
    const base = (g) => level.value === 'collections' ? `/api/collections/${g.id}` : `/api/albums/${g.id}`;
    const refreshGroups = () => level.value === 'collections' ? fetchCollections() : fetchAlbums(colId.value);

    async function toggleFavorite(g) {
      g.is_favorite = g.is_favorite ? 0 : 1;
      await attempt(() => api(`${base(g)}/favorite`, { method: 'PATCH' }));
    }
    async function rename(g) {
      const title = await promptDialog({ title: 'Rename', value: g.title, confirmText: 'Rename' });
      if (!title || title === g.title) return;
      await attempt(async () => { await api(`${base(g)}/title`, { method: 'PATCH', body: { title } }); await refreshGroups(); });
    }
    function editNotes(g) { Object.assign(notes, { open: true, item: g, text: g.notes || '' }); }
    async function saveNotes() {
      const g = notes.item;
      const url = (collections.value.includes(g) ? `/api/collections/${g.id}` : `/api/albums/${g.id}`) + '/notes';
      await attempt(async () => { await api(url, { method: 'PATCH', body: { notes: notes.text } }); g.notes = notes.text; notes.open = false; }, 'Notes saved');
    }
    async function remove(g) {
      const isCol = level.value === 'collections';
      const ok = await confirmDialog({
        title: `Delete “${g.title}”?`,
        message: isCol ? 'Its albums are deleted too. The photos themselves stay in Files.' : 'The photos themselves stay in Files.',
        confirmText: 'Delete', danger: true,
      });
      if (!ok) return;
      await attempt(async () => { await api(base(g), { method: 'DELETE' }); await refreshGroups(); }, 'Deleted');
    }

    const dl = (path) => downloadUrl(`${path}?token=${encodeURIComponent(session.token)}`);
    const downloadCollection = (c) => dl(`/api/collections/${c.id}/download`);
    const downloadAlbum = (a) => dl(`/api/albums/${a.id}/download`);

    function openMenu(e, g) {
      const r = e.currentTarget.getBoundingClientRect();
      menu.value = { x: Math.max(8, Math.min(r.right - 200, window.innerWidth - 208)), y: Math.min(r.bottom + 4, window.innerHeight - 190), item: g };
    }
    const run = (fn) => { const g = menu.value.item; menu.value = null; fn(g); };

    // ---------- photos ----------
    async function onPick(e) {
      const list = Array.from(e.target.files || []);
      e.target.value = '';
      if (list.length) await uploadInto(list);
    }
    async function uploadInto(list) {
      if (!list.length || !album.value) return;
      uploading.value = true;
      try {
        const folderId = await systemFolder('gallery');
        const albumId = album.value.id;
        const res = await uploadMany(list, folderId, {
          onEach: (fileId) => api(`/api/albums/${albumId}/images`, { method: 'POST', body: { file_id: fileId } }),
        });
        await Promise.all([fetchImages(colId.value, albId.value), fetchAlbums(colId.value)]);
        refreshAccount();
        if (res.length < list.length) toast.error(`${list.length - res.length} photo(s) failed to upload`);
        else toast.success(`Added ${res.length} photo${res.length > 1 ? 's' : ''}`);
      } catch (err) { toast.error(err.message); }
      finally { uploading.value = false; }
    }
    async function removeImage(img) {
      if (!await confirmDialog({ title: 'Remove this photo from the album?', message: 'The photo stays in Files.', confirmText: 'Remove' })) return;
      await attempt(async () => {
        await api(`/api/albums/${album.value.id}/images/${img.id}`, { method: 'DELETE' });
        images.value = cache.images[`${colId.value}/${albId.value}`] = images.value.filter(i => i.id !== img.id);
      });
    }
    async function setCover(img) {
      await attempt(async () => { await api(`/api/albums/${album.value.id}/cover`, { method: 'PATCH', body: { file_id: img.id } }); album.value.cover_file_id = img.id; album.value.display_cover_id = img.id; }, 'Album cover updated');
    }
    async function migrateImages() {
      const ok = await confirmDialog({ title: 'Tidy album uploads?', message: 'Album photos that sit at the top level of Files are moved into the locked “Photos” folder. Nothing is deleted.', confirmText: 'Move photos' });
      if (!ok) return;
      await attempt(async () => { const r = await api('/api/albums/migrate', { method: 'POST' }); toast.success(`Moved ${r.moved} photo${r.moved === 1 ? '' : 's'}`); });
    }

    const onKey = (e) => {
      if (e.key !== 'Escape' || viewerIndex.value !== null) return;
      if (menu.value) menu.value = null; else if (addTo.value) addTo.value = null; else if (selected.value.length || selecting.value) clearSelection();
    };
    onMounted(() => {
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('keydown', onKey);
      show();
    });
    onUnmounted(() => {
      scrollMemory.set(routeKey.value, lastY);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('keydown', onKey);
    });

    return {
      level, collections, albums, images, collection, album, loading, uploading, uploadInput, search, groupSort, imageSort, density,
      heading, currentNotes, groups, sortedImages, viewerIndex, menu, notes, layout, selecting, selected, addTo, dragOver,
      isSel, toggleSel, clearSelection, toggleSelecting, onTileClick, onDims, openAddTo, addSelectedTo, addSelectedToNew, removeSelected, downloadSelected,
      onDragEnter, onDragLeave, onDrop,
      goBack, createCollection, createAlbum, toggleFavorite, rename, editNotes, saveNotes, remove, downloadCollection, downloadAlbum,
      openMenu, run, onPick, removeImage, setCover, migrateImages, formatBytes,
    };
  },
};
