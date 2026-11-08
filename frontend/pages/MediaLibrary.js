import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import Icon from '../components/Icon.js';
import FileViewer from '../components/FileViewer.js';
import Downloads from '../components/Downloads.js';
import { Thumb, Stars, MetaEditor, LibraryFilters, labelsFor } from '../components/Library.js';
import { api, fileUrl, formatBytes, formatDate, downloadUrl, refreshAccount } from '../lib/api.js';
import { toast, confirmDialog, promptDialog, attempt } from '../lib/ui.js';
import { uploadMany } from '../lib/upload.js';
import { useLibraryFilter, displayTitle, formatDuration, autoCover, backfillCovers, setCover, thumbUrl, preload } from '../lib/library.js';
import { kindOf } from '../lib/filetypes.js';
import { moveToTrash } from '../lib/trash.js';

const CONFIG = {
  videos: {
    title: 'Videos', icon: 'film', aspect: 'aspect-video', coverKind: 'video', uploadLabel: 'Upload videos', collections: true, downloads: 'video',
    accept: 'video/*,.mkv,.avi,.mov,.wmv,.flv,.m4v,.3gp,.ts',
    grid: 'grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
    empty: 'Upload videos or paste a link above, then add participants, tags and details so you can sort and find them later.',
    sorts: [['added', 'Recently added'], ['oldest', 'Oldest added'], ['title', 'Title'], ['date', 'Date recorded'], ['people', 'Participants'], ['series', 'Series'], ['rating', 'Rating'], ['longest', 'Longest'], ['shortest', 'Shortest'], ['size', 'Largest file']],
  },
  books: {
    title: 'Books', icon: 'file-text', aspect: 'aspect-[2/3]', coverKind: 'book', uploadLabel: 'Add books', collections: false, downloads: null,
    accept: '.pdf,.epub,.mobi,.azw,.azw3,.djvu,.fb2,.cbz,.cbr,.txt,application/pdf,application/epub+zip',
    grid: 'grid-cols-2 min-[520px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7',
    empty: 'Add PDF or EPUB books. EPUBs open in the built-in reader, which remembers where you stopped.',
    sorts: [['recent', 'Recently read'], ['added', 'Recently added'], ['title', 'Title'], ['people', 'Author'], ['series', 'Series'], ['date', 'Published'], ['rating', 'Rating'], ['size', 'Largest file']],
  },
};
const TILE_GRID = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 stagger';

export default {
  components: { Icon, FileViewer, Thumb, Stars, MetaEditor, LibraryFilters, Downloads },
  // args: [] = everything, ['collections'] / ['collections', id], ['creators']
  props: { kind: { type: String, required: true }, args: { type: Array, default: () => [] } },
  template: /*html*/`
    <div @dragenter="onDragEnter" @dragover.prevent @dragleave="onDragLeave" @drop.prevent="onDrop">
      <div class="flex flex-col gap-4 mb-6">
        <div class="flex items-end gap-3 flex-wrap">
          <div class="flex-1 min-w-0">
            <nav v-if="openCol" class="text-[13px] text-muted mb-1.5 flex items-center gap-1"><a :href="'#/' + kind + '/collections'" class="hover:text-fg">Collections</a></nav>
            <div class="flex items-center gap-3">
              <a v-if="openCol" :href="'#/' + kind + '/collections'" class="icon-btn -ml-2" title="Back"><Icon name="arrow-left" :size="19" /></a>
              <h1 class="title text-[28px] md:text-[32px] leading-tight truncate">{{ openCol ? openCol.title : C.title }}</h1>
            </div>
            <p class="text-muted text-[13.5px]">
              <template v-if="openCol">{{ colItems.length }} video{{ colItems.length === 1 ? '' : 's' }}<template v-if="colDuration">, {{ colDuration }}</template><template v-if="colItems.length > 1"> · drag to reorder</template></template>
              <template v-else-if="loaded">{{ f.filtered.value.length === items.length ? items.length : f.filtered.value.length + ' of ' + items.length }} {{ kind === 'videos' ? (items.length === 1 ? 'video' : 'videos') : (items.length === 1 ? 'book' : 'books') }}<template v-if="totalDuration">, {{ totalDuration }}</template></template>
              <template v-else>&nbsp;</template>
            </p>
          </div>
          <div class="flex gap-2 flex-wrap">
            <template v-if="openCol">
              <button v-if="colItems.length" class="btn btn-primary" @click="playCollection(false)"><Icon name="play" :size="14" />Play all</button>
              <button v-if="colItems.length > 1" class="btn" @click="playCollection(true)"><Icon name="shuffle" :size="16" /><span class="hidden sm:inline">Shuffle</span></button>
              <button class="btn" @click="openColMenu($event, openCol)"><Icon name="more" :size="16" /></button>
            </template>
            <template v-else-if="view === 'collections'">
              <button class="btn btn-primary" @click="newCollection()"><Icon name="plus" :size="16" />New collection</button>
            </template>
            <template v-else-if="view === 'all'">
              <button v-if="items.length" class="btn" :class="selecting ? '!border-accent text-accent' : ''" @click="toggleSelecting"><Icon name="check" :size="16" />{{ selecting ? 'Done' : 'Select' }}</button>
              <button class="btn btn-primary" @click="fileInput.click()"><Icon name="upload" :size="16" />{{ C.uploadLabel }}</button>
            </template>
            <input ref="fileInput" type="file" multiple :accept="C.accept" class="hidden" @change="onPick">
          </div>
        </div>

        <div v-if="C.collections && !openCol" class="seg self-start" role="tablist" aria-label="View">
          <a :href="'#/' + kind" :class="{ on: view === 'all' }" role="tab"><Icon :name="C.icon" :size="14" />All {{ kind }}</a>
          <a :href="'#/' + kind + '/collections'" :class="{ on: view === 'collections' }" role="tab"><Icon name="list-music" :size="14" />Collections<span v-if="collections.length" class="text-faint tabular-nums">{{ collections.length }}</span></a>
          <a :href="'#/' + kind + '/creators'" :class="{ on: view === 'creators' }" role="tab"><Icon name="users" :size="14" />Creators<span v-if="f.people.value.length" class="text-faint tabular-nums">{{ f.people.value.length }}</span></a>
        </div>
        <LibraryFilters v-if="view === 'all' && items.length" :f="f" :kind="kind" :sorts="C.sorts" />
      </div>

      <Downloads v-if="C.downloads && !openCol && view !== 'creators'" :kind="C.downloads" @finished="onDownloaded" @open="openById" />

      <!-- ===== Collections ===== -->
      <template v-if="view === 'collections' && !openCol">
        <div v-if="!collectionsLoaded" :class="TILE_GRID"><div v-for="i in 8" :key="i" class="aspect-square rounded-xl skeleton"></div></div>
        <div v-else-if="!collections.length" class="panel py-16 px-6 text-center rise">
          <span class="w-14 h-14 rounded-2xl bg-accent/10 text-accent grid place-items-center mx-auto mb-4"><Icon name="list-music" :size="24" /></span>
          <p class="title text-lg mb-1">No collections yet</p>
          <p class="text-muted text-[13.5px] mb-5 max-w-md mx-auto">Group videos like a playlist: a series, a trip, a course. Downloads from a link are filed into a collection named after their creator automatically.</p>
          <button class="btn btn-primary" @click="newCollection()"><Icon name="plus" :size="16" />New collection</button>
        </div>
        <div v-else :class="TILE_GRID">
          <a v-for="c in collections" :key="c.id" :href="'#/' + kind + '/collections/' + c.id" class="group tile lift" :class="c.display_cover_id ? 'tile-media tile-cap-on' : 'tile-folder'" :title="c.title">
            <div v-if="c.display_cover_id" class="absolute inset-0 zoom-media"><Thumb :file-id="c.display_cover_id" :w="480" :icon="C.icon" /></div>
            <Icon v-else name="list-music" size="100%" :stroke="1.25" class="tile-mark" />
            <span class="tile-badge" :class="c.display_cover_id ? 'bg-black/55 text-white backdrop-blur' : 'bg-accent/15 text-accent'"><Icon :name="C.icon" :size="11" :stroke="2.25" />{{ c.item_count }}</span>
            <span v-if="!c.display_cover_id" class="tile-count">{{ c.item_count }}</span>
            <span class="absolute z-[2] inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" v-if="c.item_count">
              <span class="w-11 h-11 rounded-full bg-accent text-accent-fg grid place-items-center shadow-lg"><Icon name="play" :size="16" class="translate-x-[1px]" /></span>
            </span>
            <div class="tile-cap">
              <p class="truncate text-[13.5px] font-semibold leading-tight">{{ c.title }}</p>
              <p class="text-[11px] leading-tight mt-0.5 tile-sub truncate">{{ c.item_count }} video{{ c.item_count === 1 ? '' : 's' }}<template v-if="c.total_duration"> · {{ formatDuration(c.total_duration) }}</template></p>
            </div>
            <button class="absolute z-[3] bottom-2 right-2 w-7 h-7 rounded-full grid place-items-center bg-black/45 backdrop-blur transition-opacity"
                    :class="c.is_favorite ? 'text-accent opacity-100' : 'text-white/80 opacity-0 group-hover:opacity-100'"
                    @click.prevent.stop="toggleColFavorite(c)" :title="c.is_favorite ? 'Remove from favorites' : 'Add to favorites'"><Icon :name="c.is_favorite ? 'star-fill' : 'star'" :size="14" /></button>
            <button class="tile-more" @click.prevent.stop="openColMenu($event, c)" :aria-label="'Actions for ' + c.title"><Icon name="more" :size="16" /></button>
          </a>
        </div>
      </template>

      <!-- ===== Creators ===== -->
      <template v-else-if="view === 'creators'">
        <div v-if="!loaded" :class="TILE_GRID"><div v-for="i in 8" :key="i" class="aspect-square rounded-xl skeleton"></div></div>
        <div v-else-if="!creators.length" class="panel py-16 px-6 text-center rise">
          <span class="w-14 h-14 rounded-2xl bg-accent/10 text-accent grid place-items-center mx-auto mb-4"><Icon name="users" :size="24" /></span>
          <p class="title text-lg mb-1">No creators yet</p>
          <p class="text-muted text-[13.5px] max-w-md mx-auto">Creators come from the {{ L.people.toLowerCase() }} on your {{ kind }}. Downloads from a link fill this in for you.</p>
        </div>
        <div v-else :class="TILE_GRID">
          <a v-for="p in creators" :key="p.value" :href="'#/' + kind" class="group tile lift" :class="p.cover ? 'tile-media tile-cap-on' : ''" :style="p.cover ? '' : { '--tint': p.tint }" :title="p.value" @click="showCreator(p.value)">
            <div v-if="p.cover" class="absolute inset-0 zoom-media"><Thumb :file-id="p.cover" :w="480" :icon="C.icon" /></div>
            <template v-else>
              <Icon name="user" size="100%" :stroke="1.25" class="tile-mark" />
              <span class="tile-count">{{ p.value.charAt(0).toUpperCase() }}</span>
            </template>
            <span class="tile-badge" :class="p.cover ? 'bg-black/55 text-white backdrop-blur' : 'tile-ext'"><Icon name="users" :size="11" :stroke="2.25" />{{ p.count }}</span>
            <div class="tile-cap">
              <p class="truncate text-[13.5px] font-semibold leading-tight">{{ p.value }}</p>
              <p class="text-[11px] leading-tight mt-0.5 tile-sub">{{ p.count }} video{{ p.count === 1 ? '' : 's' }}<template v-if="p.duration"> · {{ formatDuration(p.duration) }}</template></p>
            </div>
          </a>
        </div>
      </template>

      <!-- ===== Items (everything, or one collection) ===== -->
      <template v-else>
        <!-- quick filter chips for the most used tags -->
        <div v-if="!openCol && items.length && f.tags.value.length" class="flex gap-1.5 overflow-x-auto no-scrollbar -mt-2 mb-5">
          <button v-for="t in f.tags.value.slice(0, 14)" :key="t.value" class="chip !h-7 !px-3 shrink-0 hover:text-fg" :class="f.tag.value === t.value ? 'chip-accent' : ''"
                  @click="f.tag.value = f.tag.value === t.value ? '' : t.value">#{{ t.value }}</button>
        </div>

        <div v-if="openCol ? !colLoaded : !loaded" class="grid gap-x-4 gap-y-6" :class="C.grid">
          <div v-for="i in 10" :key="i"><div class="rounded-xl skeleton" :class="C.aspect"></div><div class="h-4 w-3/4 rounded skeleton mt-3"></div></div>
        </div>

        <div v-else-if="openCol && !colItems.length" class="panel py-16 px-6 text-center rise">
          <span class="w-14 h-14 rounded-2xl bg-accent/10 text-accent grid place-items-center mx-auto mb-4"><Icon name="list-music" :size="24" /></span>
          <p class="title text-lg mb-1">This collection is empty</p>
          <p class="text-muted text-[13.5px] max-w-md mx-auto">Add videos from <a :href="'#/' + kind" class="text-accent hover:underline">All {{ kind }}</a> with “Add to collection”.</p>
        </div>

        <div v-else-if="!openCol && !items.length" class="panel py-16 px-6 text-center">
          <span class="w-14 h-14 rounded-2xl bg-elevated grid place-items-center mx-auto mb-4 text-muted"><Icon :name="C.icon" :size="24" /></span>
          <p class="title text-lg mb-1">No {{ kind }} yet</p>
          <p class="text-muted text-[13.5px] mb-5 max-w-md mx-auto">{{ C.empty }}</p>
          <button class="btn btn-primary" @click="fileInput.click()"><Icon name="upload" :size="16" />{{ C.uploadLabel }}</button>
          <p class="text-faint text-xs mt-4">They’re stored in the locked “{{ kind === 'videos' ? 'Videos' : 'Books' }}” folder in Files.</p>
        </div>

        <div v-else-if="!list.length" class="panel py-12 px-6 text-center">
          <p class="title text-lg mb-1">Nothing matches these filters</p>
          <button class="btn mt-3" @click="f.reset()">Clear filters</button>
        </div>

        <div v-else class="grid gap-x-4 gap-y-6 stagger" :class="C.grid">
          <div v-for="(it, i) in list" :key="it.id" class="group relative cursor-pointer" :class="[dragIndex === i ? 'opacity-40' : '', dragOverIndex === i ? 'ring-2 ring-accent ring-offset-4 ring-offset-bg rounded-xl' : '']"
               :draggable="!!openCol" @dragstart="onCardDragStart($event, i)" @dragover.prevent="openCol && (dragOverIndex = i)" @dragleave="dragOverIndex = null" @drop.prevent.stop="onCardDrop(i)" @dragend="dragIndex = dragOverIndex = null"
               @click="onCardClick(i, it)" @contextmenu.prevent="openMenu($event, it)">
            <div class="relative rounded-xl overflow-hidden ring-2 lift zoom-media" :class="[C.aspect, isSel(it.id) ? 'ring-accent' : 'ring-transparent']">
              <Thumb :file-id="it.id" :w="480" :version="it.thumb_file_id || 'none'" :icon="C.icon" />
              <span v-if="openCol" class="absolute top-2 left-2 min-w-[22px] h-[22px] px-1.5 rounded-full bg-black/65 text-white text-[11px] font-semibold grid place-items-center tabular-nums">{{ i + 1 }}</span>
              <span v-if="kind === 'videos' && it.duration" class="absolute bottom-2 right-2 px-1.5 h-5 rounded bg-black/75 text-white text-[11px] font-medium tabular-nums grid place-items-center">{{ formatDuration(it.duration) }}</span>
              <span v-if="kind === 'videos'" class="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <span class="w-12 h-12 rounded-full bg-black/55 backdrop-blur grid place-items-center text-white"><Icon name="play" :size="18" class="translate-x-[1px]" /></span>
              </span>
              <span v-if="kind === 'books'" class="absolute top-2 left-2 chip !bg-black/60 !text-white uppercase !text-[10px] tracking-wide">{{ ext(it) }}</span>
              <div v-if="kind === 'books' && progressOf(it) > 0" class="absolute inset-x-0 bottom-0 h-1 bg-black/40"><div class="h-full bg-accent" :style="{ width: Math.round(progressOf(it) * 100) + '%' }"></div></div>
              <input v-if="!openCol" type="checkbox" class="checkbox absolute top-2 right-11 !w-5 !h-5 bg-black/30 border-white/80" :class="selecting || isSel(it.id) ? '' : 'opacity-0 group-hover:opacity-100'"
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
      </template>

      <!-- Selection bar -->
      <Transition name="pop">
        <div v-if="selected.length" class="fixed z-[170] left-1/2 -translate-x-1/2 bottom-[76px] md:bottom-6 panel glass flex items-center gap-1 p-1.5 pl-4 max-w-[calc(100vw-1rem)] overflow-x-auto no-scrollbar">
          <span class="text-[13.5px] font-medium mr-2 whitespace-nowrap">{{ selected.length }} selected</span>
          <button class="btn btn-ghost btn-sm" @click="selectAll">All</button>
          <button v-if="C.collections" class="btn btn-ghost btn-sm" @click="openPicker($event, selected)"><Icon name="list-music" :size="15" /><span class="whitespace-nowrap">Add to collection</span></button>
          <button class="btn btn-ghost btn-sm" @click="editSelected"><Icon name="pencil" :size="15" /><span class="hidden sm:inline">Edit details</span></button>
          <button class="btn btn-ghost btn-sm !text-danger" @click="deleteSelected"><Icon name="trash" :size="15" /><span class="hidden sm:inline">Delete</span></button>
          <button class="icon-btn icon-btn-sm shrink-0" @click="selected = []; selecting = false" title="Clear"><Icon name="x" :size="15" /></button>
        </div>
      </Transition>

      <!-- Card menu -->
      <div v-if="menu" class="fixed inset-0 z-[230]" @click="menu = null">
        <div class="menu fixed" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
          <button class="menu-item" @click="run(open)"><Icon :name="kind === 'videos' ? 'play' : 'eye'" :size="kind === 'videos' ? 14 : 16" />{{ kind === 'videos' ? 'Play' : 'Read' }}</button>
          <button class="menu-item" @click="run(it => editors = [it])"><Icon name="pencil" :size="16" />Edit details</button>
          <button v-if="C.collections" class="menu-item" @click="pickerFromMenu($event)"><Icon name="list-music" :size="16" />Add to collection<Icon name="chevron-right" :size="15" class="ml-auto text-faint" /></button>
          <template v-if="openCol">
            <button class="menu-item" @click="run(setColCover)"><Icon name="image" :size="16" />Use as collection cover</button>
            <button class="menu-item" @click="run(removeFromCol)"><Icon name="x" :size="16" />Remove from collection</button>
          </template>
          <button class="menu-item" @click="run(it => downloadUrl(fileUrl(it.id, { download: true })))"><Icon name="download" :size="16" />Download</button>
          <a class="menu-item" :href="'#/files/' + folderId" @click="menu = null"><Icon name="folder" :size="16" />Show in Files</a>
          <div class="menu-sep"></div>
          <button class="menu-item danger" @click="run(remove)"><Icon name="trash" :size="16" />Move to trash</button>
        </div>
      </div>

      <!-- "Add to collection" picker -->
      <div v-if="picker" class="fixed inset-0 z-[231]" @click="picker = null">
        <div class="menu fixed max-h-[60vh] overflow-y-auto w-[240px]" :style="{ left: picker.x + 'px', top: picker.y + 'px' }" @click.stop>
          <p class="px-2.5 py-1.5 text-xs text-muted">Add {{ picker.ids.length === 1 ? 'to' : picker.ids.length + ' ' + kind + ' to' }}</p>
          <button v-for="c in collections" :key="c.id" class="menu-item" @click="addTo(c)"><Icon name="list-music" :size="16" /><span class="truncate">{{ c.title }}</span><span class="ml-auto text-faint text-xs tabular-nums">{{ c.item_count }}</span></button>
          <div v-if="collections.length" class="menu-sep"></div>
          <button class="menu-item" @click="newCollection(picker.ids)"><Icon name="plus" :size="16" />New collection…</button>
        </div>
      </div>

      <!-- Collection menu -->
      <div v-if="colMenu" class="fixed inset-0 z-[230]" @click="colMenu = null">
        <div class="menu fixed" :style="{ left: colMenu.x + 'px', top: colMenu.y + 'px' }" @click.stop>
          <button v-if="colMenu.c.item_count || openCol" class="menu-item" @click="runCol(c => playCollectionById(c))"><Icon name="play" :size="14" />Play</button>
          <button class="menu-item" @click="runCol(toggleColFavorite)"><Icon :name="colMenu.c.is_favorite ? 'star-fill' : 'star'" :size="16" />{{ colMenu.c.is_favorite ? 'Remove from favorites' : 'Add to favorites' }}</button>
          <button class="menu-item" @click="runCol(renameCollection)"><Icon name="pencil" :size="16" />Rename</button>
          <div class="menu-sep"></div>
          <button class="menu-item danger" @click="runCol(deleteCollection)"><Icon name="trash" :size="16" />Delete collection</button>
        </div>
      </div>

      <!-- Drop overlay -->
      <Transition name="fade">
        <div v-if="dragOver" class="fixed inset-0 z-[190] pointer-events-none p-4">
          <div class="w-full h-full rounded-2xl border-2 border-dashed border-accent bg-accent/[0.06] grid place-items-center">
            <div class="panel px-6 py-4 flex items-center gap-3"><Icon name="upload" :size="22" class="text-accent" /><span class="font-medium">Drop to add to {{ C.title }}</span></div>
          </div>
        </div>
      </Transition>

      <MetaEditor v-if="editors" :kind="kind" :items="editors" :all-items="items" @close="editors = null" @saved="onSaved" />

      <FileViewer v-if="viewer" :files="viewer.files" :start-index="viewer.index" :info-open="true" :autoplay-next="!!viewer.autoplay" @close="viewer = null">
        <template #details="{ file }">
          <div class="p-5 border-b border-line space-y-3">
            <div class="flex items-start gap-2">
              <p class="title text-lg leading-snug flex-1">{{ displayTitle(file) }}</p>
              <button class="btn btn-sm" @click="editors = [file]"><Icon name="pencil" :size="14" />Edit</button>
            </div>
            <p v-if="viewer.autoplay" class="text-xs text-accent flex items-center gap-1.5"><Icon name="list-music" :size="13" />Playing {{ viewer.label }}, the next video starts automatically</p>
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

    // ---------- view (from the route: #/videos[/collections[/id]|/creators]) ----------
    const view = computed(() => (C.value.collections && ['collections', 'creators'].includes(props.args[0]) ? props.args[0] : 'all'));
    const openColId = computed(() => (view.value === 'collections' ? props.args[1] || null : null));
    const collections = ref([]);
    const collectionsLoaded = ref(false);
    const colItems = ref([]);
    const colLoaded = ref(false);
    const openCol = computed(() => (openColId.value ? collections.value.find(c => c.id === openColId.value) || { id: openColId.value, title: 'Collection', item_count: colItems.value.length } : null));
    const list = computed(() => (openCol.value ? colItems.value : f.filtered.value));

    const fmtTotal = (s) => { if (!s) return ''; if (s < 60) return formatDuration(s); const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };
    const totalDuration = computed(() => (props.kind === 'videos' ? fmtTotal(f.filtered.value.reduce((a, it) => a + (it.duration || 0), 0)) : ''));
    const colDuration = computed(() => fmtTotal(colItems.value.reduce((a, it) => a + (it.duration || 0), 0)));

    // one tile per creator, with the cover of their newest video
    const TINTS = ['#E8A33D', '#5fb3a1', '#6ea8e6', '#c78bd8', '#d0806b', '#60c798', '#e0655a'];
    const creators = computed(() => f.people.value.map((p, i) => {
      const mine = items.value.filter(it => (it.participants || []).some(x => x.toLowerCase() === p.value.toLowerCase()));
      const newest = [...mine].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
      return { ...p, cover: newest && newest.thumb_file_id ? newest.id : null, duration: mine.reduce((a, it) => a + (it.duration || 0), 0), tint: TINTS[i % TINTS.length] };
    }));

    async function load() {
      try {
        const r = await api(`/api/library/${props.kind}`);
        items.value = r.items;
        folderId.value = r.folderId;
        loaded.value = true;
        startBackfill();
      } catch (e) { toast.error(e.message); }
    }
    async function loadCollections() {
      if (!C.value.collections) return;
      try { collections.value = await api(`/api/media-collections?kind=${props.kind}`); collectionsLoaded.value = true; } catch (e) { toast.error(e.message); }
    }
    async function loadCollection() {
      if (!openColId.value) return;
      colLoaded.value = false;
      try { colItems.value = await api(`/api/media-collections/${openColId.value}/items`); colLoaded.value = true; }
      catch (e) { toast.error(e.message); location.hash = `#/${props.kind}/collections`; }
    }
    const reloadAll = () => Promise.all([load(), loadCollections(), loadCollection()]);
    watch(openColId, () => { colItems.value = []; loadCollection(); });
    watch(view, () => { selected.value = []; selecting.value = false; });

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
    watch(list, (l) => { preload(l.slice(12, 60).map(it => thumbUrl(it.id, 480, it.thumb_file_id || 'none'))); });

    const ext = (it) => (it.filename.split('.').pop() || '').slice(0, 4);
    const progressOf = (it) => { try { return JSON.parse(it.progress || 'null')?.pct || 0; } catch (e) { return 0; } };

    // ---------- selection ----------
    const isSel = (id) => selected.value.includes(id);
    const toggleSel = (id) => { const i = selected.value.indexOf(id); if (i === -1) selected.value.push(id); else selected.value.splice(i, 1); };
    const toggleSelecting = () => { selecting.value = !selecting.value; if (!selecting.value) selected.value = []; };
    const selectAll = () => { selected.value = list.value.map(i => i.id); };
    const editSelected = () => { editors.value = items.value.filter(i => selected.value.includes(i.id)); };

    function onCardClick(i, it) {
      if (!openCol.value && (selecting.value || selected.value.length)) { toggleSel(it.id); return; }
      open(it);
    }
    function open(it) {
      const l = list.value;
      viewer.value = { files: l, index: Math.max(0, l.indexOf(it)), autoplay: !!openCol.value, label: openCol.value?.title };
    }
    function openById(id) {
      const it = items.value.find(x => x.id === id);
      if (it) viewer.value = { files: [it], index: 0 };
      else load().then(() => { const x = items.value.find(y => y.id === id); if (x) viewer.value = { files: [x], index: 0 }; });
    }
    function filterBy(which, value) {
      viewer.value = null;
      if (props.args.length) location.hash = `#/${props.kind}`;
      f.reset();
      if (which === 'person') f.person.value = value; else f.tag.value = value;
    }
    const showCreator = (name) => { f.reset(); f.person.value = name; };

    // ---------- collections ----------
    function playCollection(shuffle) {
      let l = [...colItems.value];
      if (shuffle) for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
      if (l.length) viewer.value = { files: l, index: 0, autoplay: true, label: openCol.value.title };
    }
    async function playCollectionById(c) {
      const l = await attempt(() => api(`/api/media-collections/${c.id}/items`));
      if (l && l.length) viewer.value = { files: l, index: 0, autoplay: true, label: c.title };
      else if (l) toast('This collection is empty');
    }
    async function newCollection(ids = []) {
      picker.value = null;
      const title = await promptDialog({ title: 'New collection', placeholder: 'e.g. Cooking series', confirmText: ids.length ? 'Create and add' : 'Create' });
      if (!title) return;
      const r = await attempt(() => api('/api/media-collections', { method: 'POST', body: { kind: props.kind, title, file_ids: ids } }), ids.length ? `Added to ${title}` : 'Collection created');
      if (!r) return;
      selected.value = []; selecting.value = false;
      await loadCollections();
      if (!ids.length) location.hash = `#/${props.kind}/collections/${r.id}`;
    }
    async function renameCollection(c) {
      const title = await promptDialog({ title: 'Rename collection', value: c.title, confirmText: 'Rename' });
      if (!title || title === c.title) return;
      await attempt(async () => { await api(`/api/media-collections/${c.id}`, { method: 'PATCH', body: { title } }); await loadCollections(); });
    }
    async function deleteCollection(c) {
      if (!await confirmDialog({ title: `Delete “${c.title}”?`, message: `The ${props.kind} themselves stay in your library.`, confirmText: 'Delete', danger: true })) return;
      await attempt(async () => { await api(`/api/media-collections/${c.id}`, { method: 'DELETE' }); await loadCollections(); }, 'Collection deleted');
      if (openColId.value === c.id) location.hash = `#/${props.kind}/collections`;
    }
    async function toggleColFavorite(c) {
      c.is_favorite = c.is_favorite ? 0 : 1;
      await attempt(async () => { await api(`/api/media-collections/${c.id}/favorite`, { method: 'PATCH' }); await loadCollections(); });
    }
    const removeFromCol = (it) => attempt(async () => {
      await api(`/api/media-collections/${openColId.value}/items/remove`, { method: 'POST', body: { file_ids: [it.id] } });
      colItems.value = colItems.value.filter(x => x.id !== it.id);
      loadCollections();
    }, 'Removed from collection');
    const setColCover = (it) => attempt(async () => { await api(`/api/media-collections/${openColId.value}`, { method: 'PATCH', body: { cover_file_id: it.id } }); await loadCollections(); }, 'Collection cover updated');

    const colMenu = ref(null);
    function openColMenu(e, c) {
      const r = e.currentTarget.getBoundingClientRect();
      colMenu.value = { c, x: Math.max(8, Math.min(r.right - 210, window.innerWidth - 218)), y: Math.min(r.bottom + 4, window.innerHeight - 200) };
    }
    const runCol = (fn) => { const c = colMenu.value.c; colMenu.value = null; fn(c); };

    const picker = ref(null);
    function openPicker(e, ids) {
      const r = e.currentTarget.getBoundingClientRect();
      picker.value = { ids: [...ids], x: Math.max(8, Math.min(r.left, window.innerWidth - 250)), y: Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 320)) };
      if (!collectionsLoaded.value) loadCollections();
    }
    function pickerFromMenu(e) {
      const it = menu.value.item;
      menu.value = null;
      openPicker(e, [it.id]);
    }
    async function addTo(c) {
      const ids = picker.value.ids;
      picker.value = null;
      const r = await attempt(() => api(`/api/media-collections/${c.id}/items`, { method: 'POST', body: { file_ids: ids } }));
      if (!r) return;
      toast.success(r.added ? `Added ${r.added} to ${c.title}` : `Already in ${c.title}`);
      selected.value = []; selecting.value = false;
      loadCollections();
    }

    // drag to reorder inside a collection
    const dragIndex = ref(null);
    const dragOverIndex = ref(null);
    function onCardDragStart(e, i) { if (!openCol.value) return e.preventDefault(); dragIndex.value = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }
    async function onCardDrop(to) {
      const from = dragIndex.value;
      dragIndex.value = dragOverIndex.value = null;
      if (!openCol.value || from === null || from === to) return;
      const l = [...colItems.value];
      const [moved] = l.splice(from, 1);
      l.splice(to, 0, moved);
      colItems.value = l;
      try { await api(`/api/media-collections/${openColId.value}/order`, { method: 'PUT', body: { file_ids: l.map(x => x.id) } }); }
      catch (e) { toast.error(e.message); loadCollection(); }
    }

    // ---------- actions ----------
    function openMenu(e, it) {
      const r = e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : { right: e.clientX, bottom: e.clientY };
      const x = e.type === 'contextmenu' ? e.clientX : r.right - 200;
      const y = e.type === 'contextmenu' ? e.clientY : r.bottom + 4;
      menu.value = { item: it, x: Math.max(8, Math.min(x, window.innerWidth - 210)), y: Math.min(y, window.innerHeight - 330) };
    }
    const run = (fn) => { const it = menu.value.item; menu.value = null; fn(it); };

    const remove = (it) => moveToTrash({ files: [it.id] }, `“${displayTitle(it)}”`, reloadAll);
    async function deleteSelected() {
      const ids = [...selected.value];
      selected.value = []; selecting.value = false;
      await moveToTrash({ files: ids }, `${ids.length} item${ids.length > 1 ? 's' : ''}`, reloadAll);
    }
    function onSaved() {
      // single edits are applied in place by the editor; bulk edits need a reload
      if (editors.value && editors.value.length > 1) { load(); selected.value = []; selecting.value = false; }
    }
    const onDownloaded = () => { load(); loadCollections(); refreshAccount(); };

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
    async function upload(fileList) {
      const fitting = fileList.filter(fl => {
        const k = kindOf({ filename: fl.name, mime_type: fl.type });
        return props.kind === 'videos' ? k === 'video' : (['pdf', 'epub', 'text'].includes(k) || /\.(mobi|azw3?|djvu|fb2|cbz|cbr)$/i.test(fl.name));
      });
      const skipped = fileList.length - fitting.length;
      if (skipped) toast(`${skipped} file${skipped > 1 ? 's' : ''} skipped: only ${props.kind === 'videos' ? 'videos' : 'books'} can go here. Use Files for anything else.`);
      if (!fitting.length) return;
      if (!folderId.value) await load();
      const colId = openColId.value;
      const res = await uploadMany(fitting, folderId.value, {
        onEach: async (fileId, file) => {
          // make the cover (and read the length) from the local copy, which is fast
          await autoCover({ id: fileId, filename: file.name, size_bytes: file.size }, file, C.value.coverKind).catch(() => null);
        },
      });
      // dropped onto an open collection: add them there too
      if (colId && res.length) await api(`/api/media-collections/${colId}/items`, { method: 'POST', body: { file_ids: res.map(r => r.fileId) } }).catch(() => {});
      await reloadAll(); refreshAccount();
      if (res.length) toast.success(`Added ${res.length} ${props.kind === 'videos' ? (res.length === 1 ? 'video' : 'videos') : (res.length === 1 ? 'book' : 'books')}`);
    }
    async function onPick(e) { const l = Array.from(e.target.files || []); e.target.value = ''; if (l.length) await upload(l); }
    const isFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    function onDragEnter(e) { if (isFiles(e)) { dragDepth++; dragOver.value = true; } }
    function onDragLeave(e) { if (isFiles(e)) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dragOver.value = false; } }
    async function onDrop(e) { dragOver.value = false; dragDepth = 0; if (isFiles(e) && e.dataTransfer.files.length) await upload(Array.from(e.dataTransfer.files)); }

    const onKey = (e) => {
      if (e.key !== 'Escape' || viewer.value || editors.value) return;
      if (picker.value) picker.value = null; else if (colMenu.value) colMenu.value = null;
      else if (menu.value) menu.value = null; else if (selected.value.length) { selected.value = []; selecting.value = false; }
    };
    watch(() => props.kind, () => { loaded.value = false; items.value = []; selected.value = []; f.reset(); collections.value = []; reloadAll(); });
    onMounted(() => { reloadAll(); window.addEventListener('keydown', onKey); });
    onUnmounted(() => { if (stopBackfill) stopBackfill(); window.removeEventListener('keydown', onKey); });

    return {
      C, L, TILE_GRID, items, loaded, folderId, fileInput, f, selecting, selected, menu, editors, viewer, dragOver, totalDuration,
      view, openCol, collections, collectionsLoaded, colItems, colLoaded, colDuration, list, creators,
      isSel, toggleSel, toggleSelecting, selectAll, editSelected, onCardClick, open, openById, filterBy, showCreator, openMenu, run, remove, deleteSelected, onSaved, onDownloaded,
      playCollection, playCollectionById, newCollection, renameCollection, deleteCollection, toggleColFavorite, removeFromCol, setColCover,
      colMenu, openColMenu, runCol, picker, openPicker, pickerFromMenu, addTo, dragIndex, dragOverIndex, onCardDragStart, onCardDrop,
      frameAsCover, onPick, onDragEnter, onDragLeave, onDrop, ext, progressOf,
      displayTitle, formatDuration, formatBytes, formatDate, fileUrl, downloadUrl,
    };
  },
};
