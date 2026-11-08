import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import Icon from '../components/Icon.js';
import FileViewer from '../components/FileViewer.js';
import { Thumb } from '../components/Library.js';
import { api, fileUrl, sharedUrl, formatBytes, formatDate, copyText, downloadUrl, downloadZip, refreshAccount, storage, session, account } from '../lib/api.js';
import { toast, confirmDialog, promptDialog, attempt } from '../lib/ui.js';
import { uploadMany, uploadFile, uploadTick, filesFromDrop, filesFromPicker } from '../lib/upload.js';
import { moveToTrash, countLabel } from '../lib/trash.js';
import { kindOf, iconFor, tintFor, isImageKind } from '../lib/filetypes.js';
import { thumbUrl, SECTION_OF, ROUTE_OF, ACCEPTS_LABEL, compareText } from '../lib/library.js';
import { useRenderLimit } from '../lib/lists.js';

const SYS_ICON = { gallery: 'images', music: 'music', music_art: 'image', videos: 'film', video_covers: 'image', books: 'file-text', book_covers: 'image' };
const SYS_ORDER = ['gallery', 'music', 'music_art', 'videos', 'video_covers', 'books', 'book_covers'];

// Locked library folders get a solid tile, their section's icon and a lock badge
const FolderGlyph = {
  props: { size: { type: Number, default: 34 }, systemKey: String },
  components: { Icon },
  template: `<span class="relative rounded-lg grid place-items-center shrink-0" :class="systemKey ? 'bg-accent text-accent-fg' : 'bg-accent-soft/15 text-accent'" :style="{ width: size + 'px', height: size + 'px' }">
    <Icon :name="systemKey ? (icons[systemKey] || 'box') : 'folder'" :size="Math.round(size * 0.5)" />
    <span v-if="systemKey" class="absolute -bottom-1 -right-1 rounded-full bg-surface text-fg grid place-items-center border border-line" :style="{ width: Math.round(size * 0.5) + 'px', height: Math.round(size * 0.5) + 'px' }"><Icon name="lock" :size="Math.max(9, Math.round(size * 0.28))" :stroke="2.25" /></span>
  </span>`,
  setup() { return { icons: SYS_ICON }; },
};

export default {
  components: { Icon, FileViewer, FolderGlyph, Thumb },
  props: { folderId: { type: String, default: null } },
  emits: ['navigate'],
  template: /*html*/`
    <div class="relative" @dragenter="onDragEnter" @dragover.prevent="onDragOverPage" @dragleave="onDragLeave" @drop.prevent="onDropPage">

      <!-- Header -->
      <div class="flex flex-col gap-4 mb-5">
        <div class="min-w-0">
          <nav v-if="currentPath.length" class="flex items-center gap-1 text-[13px] text-muted mb-1.5 overflow-x-auto no-scrollbar" aria-label="Breadcrumb">
            <button class="hover:text-fg px-1 -mx-1 rounded flex items-center gap-1 shrink-0" :class="dropTarget === 'root' ? 'bg-accent/15 text-accent' : ''"
                    @click="navigate(null)" @dragover.prevent="dropTarget = 'root'" @dragleave="dropTarget = null" @drop.stop.prevent="onDropOnFolder($event, null)">
              <Icon name="home" :size="14" />Files
            </button>
            <template v-for="(seg, i) in currentPath.slice(0, -1)" :key="seg.id">
              <Icon name="chevron-right" :size="14" class="text-faint shrink-0" />
              <button class="hover:text-fg px-1 -mx-1 rounded truncate max-w-[180px] shrink-0" :class="dropTarget === seg.id ? 'bg-accent/15 text-accent' : ''"
                      @click="navigate(seg.id)" @dragover.prevent="dropTarget = seg.id" @dragleave="dropTarget = null" @drop.stop.prevent="onDropOnFolder($event, seg.id)">{{ seg.name }}</button>
            </template>
          </nav>
          <div class="flex items-center gap-3">
            <button v-if="currentPath.length" class="icon-btn -ml-2" @click="goUp" title="Up one level"><Icon name="arrow-left" :size="19" /></button>
            <h1 class="title text-[28px] md:text-[32px] leading-tight truncate">{{ searching ? 'Search' : (currentPath.length ? currentPath[currentPath.length - 1].name : 'Files') }}</h1>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="relative flex-1 min-w-[200px] max-w-md">
            <Icon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
            <input v-model="query" type="search" title="Search (press / to jump here)" placeholder="Search all files" class="input pl-9" aria-label="Search all files" @keydown.esc="query = ''">
          </div>
          <select v-model="sortKey" class="input w-auto" aria-label="Sort by">
            <option value="name">Name</option>
            <option value="date">Newest</option>
            <option value="size">Largest</option>
            <option value="type">Type</option>
          </select>
          <div class="seg" role="group" aria-label="Layout">
            <button :class="{ on: layout === 'list' }" @click="layout = 'list'" title="List"><Icon name="list" :size="16" /></button>
            <button :class="{ on: layout === 'grid' }" @click="layout = 'grid'" title="Grid"><Icon name="grid" :size="16" /></button>
          </div>
          <div class="flex gap-2 ml-auto">
            <a href="#/trash" class="btn btn-ghost hidden lg:inline-flex" title="Deleted items"><Icon name="trash" :size="16" />Trash<span v-if="account.trash_bytes" class="text-faint text-xs tabular-nums">{{ formatBytes(account.trash_bytes) }}</span></a>
            <div class="relative">
              <button class="btn" @click="newMenu = !newMenu" :disabled="searching" aria-haspopup="menu" :aria-expanded="newMenu"><Icon name="plus" :size="16" /><span class="hidden sm:inline">New</span><Icon name="chevron-down" :size="14" class="text-faint" /></button>
              <div v-if="newMenu" class="fixed inset-0 z-[229]" @click="newMenu = false"></div>
              <Transition name="pop">
                <div v-if="newMenu" class="menu absolute right-0 top-11 z-[230]" role="menu" @click="newMenu = false">
                  <button class="menu-item" :disabled="!!lockedHere" :class="lockedHere ? 'opacity-40' : ''" @click="createFolder"><Icon name="folder-plus" :size="16" />Folder</button>
                  <button class="menu-item" :disabled="!!lockedHere" :class="lockedHere ? 'opacity-40' : ''" @click="createTextFile('txt')"><Icon name="file-plus" :size="16" />Text file</button>
                  <button class="menu-item" :disabled="!!lockedHere" :class="lockedHere ? 'opacity-40' : ''" @click="createTextFile('md')"><Icon name="note" :size="16" />Markdown note</button>
                  <div class="menu-sep"></div>
                  <button class="menu-item" @click="fileInput.click()"><Icon name="upload" :size="16" />Upload files</button>
                  <button class="menu-item" @click="folderInput.click()"><Icon name="folder-up" :size="16" />Upload a folder</button>
                </div>
              </Transition>
            </div>
            <input type="file" ref="fileInput" multiple class="hidden" @change="onPick">
            <input type="file" ref="folderInput" webkitdirectory multiple class="hidden" @change="onPickFolder">
            <button class="btn btn-primary" @click="fileInput.click()" :disabled="searching"><Icon name="upload" :size="16" />Upload</button>
          </div>
        </div>
      </div>

      <!-- Inside a locked library folder -->
      <div v-if="lockedHere && !searching" class="panel !shadow-none border-accent/40 bg-accent/[0.06] px-4 py-3 mb-4 flex items-center gap-3">
        <FolderGlyph :system-key="lockedHere.system_key" :size="30" />
        <p class="flex-1 text-[13.5px] leading-snug">
          <template v-if="lockedHere.role">
            <b>{{ lockedHere.role }}, used by {{ SECTION_OF[lockedHere.system_key] }}.</b>
            <span class="text-muted">They’re added automatically when you set artwork or a cover there. Deleting one here removes it from what it belongs to.</span>
          </template>
          <template v-else>
            <b>Managed by {{ SECTION_OF[lockedHere.system_key] }}.</b>
            <span class="text-muted">This folder can’t be renamed, moved or deleted, and only holds {{ ACCEPTS_LABEL[lockedHere.accepts] }}.</span>
          </template>
        </p>
        <a class="btn btn-sm shrink-0" :href="'#/' + ROUTE_OF[lockedHere.system_key]">Open {{ SECTION_OF[lockedHere.system_key] }}</a>
      </div>

      <!-- Content -->
      <div v-if="loading && !loaded" class="panel p-2 space-y-1">
        <div v-for="i in 6" :key="i" class="h-12 rounded-lg skeleton"></div>
      </div>

      <div v-else-if="!visibleFolders.length && !visibleFiles.length" class="panel py-16 px-6 text-center rise">
        <span class="w-14 h-14 rounded-2xl bg-accent/10 text-accent grid place-items-center mx-auto mb-4"><Icon :name="searching ? 'search' : 'upload'" :size="24" /></span>
        <template v-if="searching">
          <p class="title text-lg mb-1">Nothing matches “{{ query }}”</p>
          <p class="text-muted text-[13.5px]">Search looks at file and folder names in every folder.</p>
        </template>
        <template v-else>
          <p class="title text-lg mb-1">This folder is empty</p>
          <p class="text-muted text-[13.5px] mb-5">Drop files or whole folders anywhere on this page, or choose them from your device.</p>
          <div class="flex justify-center gap-2 flex-wrap">
            <button class="btn btn-primary" @click="fileInput.click()"><Icon name="upload" :size="16" />Upload files</button>
            <button class="btn" @click="folderInput.click()"><Icon name="folder-up" :size="16" />Upload a folder</button>
          </div>
        </template>
      </div>

      <!-- LIST -->
      <div v-else-if="layout === 'list'" class="panel overflow-hidden">
        <div class="hidden md:grid grid-cols-[32px_minmax(0,1fr)_110px_110px_76px] items-center gap-3 px-4 h-10 border-b border-line text-xs font-medium text-muted">
          <input type="checkbox" class="checkbox" :checked="allSelected" :indeterminate.prop="someSelected && !allSelected" @change="toggleAll" aria-label="Select all">
          <span>Name</span><span>Size</span><span>{{ searching ? 'Location' : 'Added' }}</span><span></span>
        </div>
        <ul role="list" class="stagger">
          <template v-for="(f, fi) in visibleFolders" :key="'d' + f.id">
          <li v-if="!searching && fi === 0 && f.system_key && !currentPath.length" class="px-4 py-2 text-xs text-muted bg-elevated/40 border-b border-line flex items-center gap-2"><Icon name="lock" :size="12" />Library folders, managed by Photos, Music, Videos and Books</li>
          <li v-if="!searching && fi > 0 && !f.system_key && visibleFolders[fi - 1].system_key" class="px-4 py-2 text-xs text-muted bg-elevated/40 border-b border-line">Your folders</li>
          <li class="group grid grid-cols-[32px_minmax(0,1fr)_auto] md:grid-cols-[32px_minmax(0,1fr)_110px_110px_76px] items-center gap-3 px-4 h-[58px] border-b border-line last:border-0 cursor-pointer row-hover"
              :class="[isSel('folder', f.id) ? 'bg-accent/[0.07]' : (f.system_key ? 'bg-accent/[0.035]' : ''), dropTarget === f.id ? 'outline outline-2 -outline-offset-2 outline-accent bg-accent/10' : '']"
              :draggable="!f.is_system" @dragstart="onDragStart($event, 'folder', f)" @dragend="dragging = null"
              @dragover.prevent.stop="onDragOverFolder($event, f.id)" @dragleave="dropTarget = null" @drop.stop.prevent="onDropOnFolder($event, f.id)"
              @click="onRowClick($event, 'folder', f)" @contextmenu.prevent="openMenu($event, 'folder', f)">
            <input type="checkbox" class="checkbox" :checked="isSel('folder', f.id)" @click.stop="toggleSel('folder', f.id, $event)" :aria-label="'Select ' + f.name">
            <div class="flex items-center gap-3 min-w-0">
              <FolderGlyph :system-key="f.system_key" />
              <div class="min-w-0">
                <p class="truncate font-medium text-[14px] flex items-center gap-2"><span class="truncate">{{ f.name }}</span>
                  <span v-if="f.system_key" class="chip chip-accent !h-5 !text-[11px] shrink-0" :title="(f.role ? f.role + ' for ' : 'Managed by ') + SECTION_OF[f.system_key] + '. Can’t be renamed, moved or deleted.'"><Icon name="lock" :size="11" :stroke="2.25" />{{ SECTION_OF[f.system_key] }}</span>
                </p>
                <p class="text-xs text-faint"><template v-if="f.role">{{ f.role }}, </template>{{ f.item_count === 1 ? '1 item' : (f.item_count || 0) + ' items' }}<span class="md:hidden"> <span class="text-line">/</span> {{ formatBytes(f.size_bytes) }}</span></p>
              </div>
            </div>
            <span class="hidden md:block text-muted text-[13px] tabular-nums">{{ formatBytes(f.size_bytes) }}</span>
            <span class="hidden md:block text-muted text-[13px] truncate">{{ searching ? 'Folder' : '' }}</span>
            <div class="flex justify-end">
              <button class="icon-btn md:opacity-0 group-hover:opacity-100 focus:opacity-100" @click.stop="openMenu($event, 'folder', f)" :aria-label="'Actions for ' + f.name"><Icon name="more" :size="18" /></button>
            </div>
          </li>
          </template>

          <li v-for="(file, i) in shownFiles" :key="file.id"
              class="group grid grid-cols-[32px_minmax(0,1fr)_auto] md:grid-cols-[32px_minmax(0,1fr)_110px_110px_76px] items-center gap-3 px-4 h-[58px] border-b border-line last:border-0 cursor-pointer row-hover"
              :class="isSel('file', file.id) ? 'bg-accent/[0.07]' : ''"
              draggable="true" @dragstart="onDragStart($event, 'file', file)" @dragend="dragging = null"
              @click="onRowClick($event, 'file', file, i)" @contextmenu.prevent="openMenu($event, 'file', file)">
            <input type="checkbox" class="checkbox" :checked="isSel('file', file.id)" @click.stop="toggleSel('file', file.id, $event)" :aria-label="'Select ' + file.filename">
            <div class="flex items-center gap-3 min-w-0">
              <span v-if="isImageKind(kindOf(file))" class="w-[34px] h-[34px] rounded-lg overflow-hidden shrink-0 bg-elevated">
                <Thumb :file-id="file.id" :w="240" />
              </span>
              <span v-else class="w-[34px] h-[34px] rounded-lg grid place-items-center shrink-0" :style="tileStyle(file)"><Icon :name="iconFor(kindOf(file))" :size="18" /></span>
              <div class="min-w-0">
                <p class="truncate text-[14px] flex items-center gap-1.5">
                  <span class="truncate">{{ file.filename }}</span>
                  <Icon v-if="!file.is_encrypted" name="globe" :size="13" class="text-accent shrink-0" title="Shared publicly" />
                </p>
                <p class="text-xs text-faint md:hidden">{{ formatBytes(file.size_bytes) }} <span class="text-line">/</span> {{ formatDate(file.created_at) }}</p>
                <p v-if="searching" class="text-xs text-faint hidden md:block truncate">{{ file.folder_name || 'Files' }}</p>
              </div>
            </div>
            <span class="hidden md:block text-muted text-[13px] tabular-nums">{{ formatBytes(file.size_bytes) }}</span>
            <span class="hidden md:block text-muted text-[13px] truncate">
              <button v-if="searching" class="hover:text-fg hover:underline truncate max-w-full" @click.stop="navigate(file.folder_id)">{{ file.folder_name || 'Files' }}</button>
              <template v-else>{{ formatDate(file.created_at) }}</template>
            </span>
            <div class="flex justify-end gap-0.5">
              <button class="icon-btn hidden md:inline-flex md:opacity-0 group-hover:opacity-100 focus:opacity-100" @click.stop="downloadFile(file)" title="Download"><Icon name="download" :size="17" /></button>
              <button class="icon-btn md:opacity-0 group-hover:opacity-100 focus:opacity-100" @click.stop="openMenu($event, 'file', file)" :aria-label="'Actions for ' + file.filename"><Icon name="more" :size="18" /></button>
            </div>
          </li>
        </ul>
      </div>

      <!-- GRID -->
      <!-- square tiles: a big tilted watermark of the type, a badge, and the name on a fade at the bottom -->
      <div v-else class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-9 gap-2.5 stagger">
        <div v-for="f in visibleFolders" :key="'d' + f.id"
             class="group tile lift" :class="[f.system_key ? 'tile-system' : 'tile-folder', isSel('folder', f.id) ? 'tile-sel' : '', dropTarget === f.id ? 'tile-drop' : '']"
             :title="f.name" :draggable="!f.is_system" @dragstart="onDragStart($event, 'folder', f)" @dragend="dragging = null"
             @dragover.prevent.stop="onDragOverFolder($event, f.id)" @dragleave="dropTarget = null" @drop.stop.prevent="onDropOnFolder($event, f.id)"
             @click="onRowClick($event, 'folder', f)" @contextmenu.prevent="openMenu($event, 'folder', f)">
          <Icon :name="f.system_key ? (SYS_ICON[f.system_key] || 'box') : 'folder'" size="100%" :stroke="1.25" class="tile-mark" />
          <span class="tile-badge" :class="f.system_key ? 'bg-accent text-accent-fg' : 'bg-accent/15 text-accent'"><Icon :name="f.system_key ? 'lock' : 'folder'" :size="11" :stroke="2.25" />{{ f.system_key ? SECTION_OF[f.system_key] : 'Folder' }}</span>
          <span class="tile-count">{{ f.item_count || 0 }}</span>
          <div class="tile-cap">
            <p class="truncate text-[13px] font-semibold leading-tight">{{ f.name }}</p>
            <p class="text-[11px] text-muted leading-tight mt-0.5">{{ f.item_count === 1 ? '1 item' : (f.item_count || 0) + ' items' }} · {{ formatBytes(f.size_bytes) }}</p>
          </div>
          <input type="checkbox" class="checkbox tile-check" :class="isSel('folder', f.id) ? '!opacity-100' : ''" :checked="isSel('folder', f.id)" @click.stop="toggleSel('folder', f.id, $event)" :aria-label="'Select ' + f.name">
          <button class="tile-more" @click.stop="openMenu($event, 'folder', f)" :aria-label="'Actions for ' + f.name"><Icon name="more" :size="16" /></button>
        </div>
        <div v-for="(file, i) in shownFiles" :key="file.id"
             class="group tile lift" :class="[isImageKind(kindOf(file)) ? 'tile-media' : '', isSel('file', file.id) ? 'tile-sel' : '']" :style="isImageKind(kindOf(file)) ? '' : tileVars(file)"
             :title="file.filename" draggable="true" @dragstart="onDragStart($event, 'file', file)" @dragend="dragging = null"
             @click="onRowClick($event, 'file', file, i)" @contextmenu.prevent="openMenu($event, 'file', file)">
          <div v-if="isImageKind(kindOf(file))" class="absolute inset-0 zoom-media"><Thumb :file-id="file.id" :w="480" /></div>
          <Icon v-else :name="iconFor(kindOf(file))" size="100%" :stroke="1.25" class="tile-mark" />
          <span v-if="!isImageKind(kindOf(file))" class="tile-badge tile-ext">{{ extLabel(file) }}</span>
          <span v-if="!file.is_encrypted" class="tile-shared" title="Shared publicly"><Icon name="globe" :size="12" /></span>
          <div class="tile-cap">
            <p class="truncate text-[13px] font-semibold leading-tight">{{ file.filename }}</p>
            <p class="text-[11px] leading-tight mt-0.5 tile-sub">{{ formatBytes(file.size_bytes) }} · {{ formatDate(file.created_at) }}</p>
          </div>
          <input type="checkbox" class="checkbox tile-check" :class="isSel('file', file.id) ? '!opacity-100' : ''" :checked="isSel('file', file.id)" @click.stop="toggleSel('file', file.id, $event)" :aria-label="'Select ' + file.filename">
          <button class="tile-more" @click.stop="openMenu($event, 'file', file)" :aria-label="'Actions for ' + file.filename"><Icon name="more" :size="16" /></button>
        </div>
      </div>

      <div v-if="moreFiles && (visibleFolders.length || visibleFiles.length)" ref="filesEnd" class="h-px" aria-hidden="true"></div>
      <p v-if="loaded && !searching && (folders.length || files.length)" class="text-faint text-xs mt-3 px-1">
        {{ folders.length }} folder{{ folders.length === 1 ? '' : 's' }}, {{ files.length }} file{{ files.length === 1 ? '' : 's' }}, {{ formatBytes(totalSize) }}
      </p>

      <!-- Selection bar -->
      <Transition name="pop">
        <div v-if="selCount" class="fixed z-[170] left-1/2 -translate-x-1/2 bottom-[76px] md:bottom-6 panel glass flex items-center gap-1 p-1.5 pl-4">
          <span class="text-[13.5px] font-medium mr-2 whitespace-nowrap">{{ selCount }} selected</span>
          <button class="btn btn-ghost btn-sm" @click="openMove(null)"><Icon name="folder-input" :size="15" /><span class="hidden sm:inline">Move</span></button>
          <button class="btn btn-ghost btn-sm" @click="downloadSelected" :title="selCount > 1 || selection.folders.length ? 'Download as one zip' : 'Download'"><Icon name="download" :size="15" /><span class="hidden sm:inline">{{ selCount > 1 || selection.folders.length ? 'Zip' : 'Download' }}</span></button>
          <button class="btn btn-ghost btn-sm !text-danger" @click="deleteSelected"><Icon name="trash" :size="15" /><span class="hidden sm:inline">Delete</span></button>
          <button class="icon-btn icon-btn-sm" @click="clearSelection" title="Clear selection (Esc)"><Icon name="x" :size="15" /></button>
        </div>
      </Transition>

      <!-- Drop overlay for files from the computer -->
      <Transition name="fade">
        <div v-if="externalDrag" class="fixed inset-0 z-[190] pointer-events-none p-4">
          <div class="w-full h-full rounded-2xl border-2 border-dashed border-accent bg-accent/[0.06] grid place-items-center">
            <div class="panel px-6 py-4 flex items-center gap-3">
              <Icon name="upload" :size="22" class="text-accent" />
              <span class="font-medium">Drop to upload to <b>{{ currentPath.length ? currentPath[currentPath.length - 1].name : 'Files' }}</b></span>
            </div>
          </div>
        </div>
      </Transition>

      <!-- Context menu -->
      <div v-if="menu" class="fixed inset-0 z-[230]" @click="menu = null" @contextmenu.prevent="menu = null">
        <div class="menu fixed" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop role="menu">
          <template v-if="menu.type === 'file'">
            <button class="menu-item" @click="act(i => openViewer(i))"><Icon name="eye" :size="16" />Open</button>
            <button v-if="isEditable(menu.item)" class="menu-item" @click="act(i => openViewer(i, true))"><Icon name="pencil" :size="16" />Edit</button>
            <button class="menu-item" @click="act(i => downloadFile(i))"><Icon name="download" :size="16" />Download</button>
            <div class="menu-sep"></div>
            <button class="menu-item" @click="act(i => renameFile(i))"><Icon name="pencil" :size="16" />Rename</button>
            <button class="menu-item" @click="act(i => openMove(i, 'file'))"><Icon name="folder-input" :size="16" />Move to…</button>
            <template v-if="menu.item.is_encrypted">
              <button class="menu-item" @click="act(i => share(i))"><Icon name="link" :size="16" />Create public link</button>
            </template>
            <template v-else>
              <button class="menu-item" @click="act(i => copyLink(i))"><Icon name="copy" :size="16" />Copy public link</button>
              <button class="menu-item" @click="act(i => unshare(i))"><Icon name="link-off" :size="16" />Stop sharing</button>
            </template>
            <div class="menu-sep"></div>
            <button class="menu-item danger" @click="act(i => deleteFile(i))"><Icon name="trash" :size="16" />Move to trash</button>
          </template>
          <template v-else>
            <button class="menu-item" @click="act(i => navigate(i.id))"><Icon name="folder" :size="16" />Open</button>
            <button class="menu-item" @click="act(i => downloadFolder(i))"><Icon name="download" :size="16" />Download as zip</button>
            <template v-if="!menu.item.is_system">
              <div class="menu-sep"></div>
              <button class="menu-item" @click="act(i => renameFolder(i))"><Icon name="pencil" :size="16" />Rename</button>
              <button class="menu-item" @click="act(i => openMove(i, 'folder'))"><Icon name="folder-input" :size="16" />Move to…</button>
              <div class="menu-sep"></div>
              <button class="menu-item danger" @click="act(i => deleteFolder(i))"><Icon name="trash" :size="16" />Move to trash</button>
            </template>
          </template>
        </div>
      </div>

      <!-- Move dialog -->
      <Transition name="fade">
        <div v-if="move.open" class="fixed inset-0 z-[240] bg-black/50 flex items-end sm:items-center justify-center p-4" @mousedown.self="move.open = false">
          <div class="panel w-full max-w-md flex flex-col max-h-[80vh]">
            <div class="p-5 pb-3">
              <h3 class="title text-lg">Move {{ move.label }}</h3>
              <p class="text-muted text-[13px] mt-0.5">Choose a destination folder.</p>
            </div>
            <ul class="px-2 overflow-y-auto flex-1 min-h-[160px]">
              <li v-for="opt in moveOptions" :key="opt.id || 'root'">
                <button class="w-full flex items-center gap-2.5 h-9 px-3 rounded-lg text-left text-[13.5px] disabled:opacity-40"
                        :class="move.target === opt.id ? 'bg-accent/15 text-accent' : 'hover:bg-elevated'"
                        :disabled="opt.disabled" @click="move.target = opt.id" @dblclick="move.target = opt.id; confirmMove()">
                  <span :style="{ width: (opt.depth * 18) + 'px' }" class="shrink-0"></span>
                  <Icon :name="opt.id ? (opt.system_key ? 'lock' : 'folder') : 'home'" :size="16" :class="move.target === opt.id ? '' : (opt.system_key ? 'text-accent' : 'text-muted')" />
                  <span class="truncate">{{ opt.name }}</span>
                  <span v-if="opt.system_key" class="text-[11px] text-faint shrink-0">{{ SECTION_OF[opt.system_key] }}</span>
                  <span v-if="opt.id === (folderId || null)" class="ml-auto text-faint text-xs">current</span>
                </button>
              </li>
            </ul>
            <div class="flex justify-end gap-2 p-4 border-t border-line">
              <button class="btn" @click="move.open = false">Cancel</button>
              <button class="btn btn-primary" @click="confirmMove" :disabled="move.target === undefined || move.busy">Move here</button>
            </div>
          </div>
        </div>
      </Transition>

      <FileViewer v-if="viewer" :files="viewer.files" :start-index="viewer.index" :start-editing="!!viewer.edit" @close="viewer = null" @changed="onFileChanged" />
    </div>
  `,
  setup(props, { emit }) {
    const folders = ref([]);
    const files = ref([]);
    const currentPath = ref([]);
    const loading = ref(false);
    const loaded = ref(false);
    const fileInput = ref(null);
    const folderInput = ref(null);
    const newMenu = ref(false);

    const query = ref('');
    const results = ref(null);
    const searching = computed(() => query.value.trim().length >= 2);

    // tiles are the default (the new storage key moves everyone onto them once; the toggle still remembers a choice)
    const layout = ref(storage.read('akulavLayout2') || 'grid');
    const sortKey = ref(storage.read('akulavSort') || 'name');
    watch(layout, v => storage.write('akulavLayout2', v));
    watch(sortKey, v => storage.write('akulavSort', v));

    const selection = reactive({ files: [], folders: [] });
    const menu = ref(null);
    const viewer = ref(null);
    const dragging = ref(null);
    const dropTarget = ref(null);
    const externalDrag = ref(false);
    let dragDepth = 0;

    const move = reactive({ open: false, items: [], target: undefined, label: '', allFolders: [], busy: false });

    // ---------- data ----------
    async function load() {
      loading.value = true;
      try {
        const data = await api(props.folderId ? `/api/directory/${encodeURIComponent(props.folderId)}` : '/api/directory');
        folders.value = data.folders;
        files.value = data.files;
        currentPath.value = data.currentPath || [];
        loaded.value = true;
      } catch (e) {
        if (e.status === 404 && props.folderId) { toast.error('That folder no longer exists.'); emit('navigate', null); }
        else toast.error(e.message);
      } finally { loading.value = false; }
    }

    let searchTimer = null;
    watch(query, (q) => {
      clearTimeout(searchTimer);
      clearSelection();
      if (q.trim().length < 2) { results.value = null; return; }
      searchTimer = setTimeout(async () => {
        try { results.value = await api(`/api/search?q=${encodeURIComponent(q.trim())}`); }
        catch (e) { toast.error(e.message); }
      }, 220);
    });

    const sorter = (getName) => (a, b) => {
      switch (sortKey.value) {
        case 'size': return (b.size_bytes || 0) - (a.size_bytes || 0);
        case 'date': return String(b.created_at || '').localeCompare(String(a.created_at || ''));
        case 'type': return kindOf(a).localeCompare(kindOf(b)) || compareText(getName(a), getName(b));
        default: return compareText(getName(a), getName(b));
      }
    };
    const visibleFolders = computed(() => {
      const list = searching.value ? (results.value?.folders || []) : folders.value;
      const rank = (f) => f.system_key ? SYS_ORDER.indexOf(f.system_key) : 99;
      const byName = (a, b) => rank(a) - rank(b) || compareText(a.name, b.name);
      return [...list].sort(sortKey.value === 'size' ? (a, b) => rank(a) - rank(b) || sorter(f => f.name)(a, b) : byName);
    });
    const visibleFiles = computed(() => [...(searching.value ? (results.value?.files || []) : files.value)].sort(sorter(f => f.filename)));
    const totalSize = computed(() => files.value.reduce((s, f) => s + (f.size_bytes || 0), 0) + folders.value.reduce((s, f) => s + (f.size_bytes || 0), 0));
    // a folder with thousands of files builds them a chunk at a time (see lib/lists.js)
    const { shown: shownFiles, more: moreFiles, end: filesEnd } = useRenderLimit(visibleFiles, { step: 200, resetOn: () => [props.folderId, searching.value && results.value, sortKey.value, layout.value] });

    // ---------- navigation ----------
    const navigate = (id) => { query.value = ''; emit('navigate', id || null); };
    const goUp = () => {
      const p = currentPath.value;
      navigate(p.length > 1 ? p[p.length - 2].id : null);
    };
    watch(() => props.folderId, () => { clearSelection(); load(); });

    // ---------- selection ----------
    // Sets for lookups: every row asks, and "select all" in a big folder would make that slow
    const selFiles = computed(() => new Set(selection.files));
    const selFolders = computed(() => new Set(selection.folders));
    const isSel = (type, id) => (type === 'file' ? selFiles : selFolders).value.has(id);
    let lastClicked = null;
    function toggleSel(type, id, ev) {
      const list = type === 'file' ? selection.files : selection.folders;
      // shift-click selects a range of files
      if (ev && ev.shiftKey && lastClicked && lastClicked.type === type && type === 'file') {
        const ids = visibleFiles.value.map(f => f.id);
        const [a, b] = [ids.indexOf(lastClicked.id), ids.indexOf(id)].sort((x, y) => x - y);
        const have = selFiles.value;
        list.push(...ids.slice(a, b + 1).filter(fid => !have.has(fid)));
      } else {
        const i = list.indexOf(id);
        if (i === -1) list.push(id); else list.splice(i, 1);
      }
      lastClicked = { type, id };
    }
    const selCount = computed(() => selection.files.length + selection.folders.length);
    const allSelected = computed(() => selCount.value > 0 && selCount.value === visibleFiles.value.length + visibleFolders.value.length);
    const someSelected = computed(() => selCount.value > 0);
    const toggleAll = () => {
      if (allSelected.value) clearSelection();
      else { selection.files = visibleFiles.value.map(f => f.id); selection.folders = visibleFolders.value.map(f => f.id); }
    };
    function clearSelection() { selection.files = []; selection.folders = []; }

    function onRowClick(ev, type, item, index) {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || selCount.value) { toggleSel(type, item.id, ev); return; }
      if (type === 'folder') navigate(item.id);
      else openViewer(item);
    }

    // ---------- viewer ----------
    function openViewer(file, edit = false) {
      const list = visibleFiles.value;
      viewer.value = { files: list, index: Math.max(0, list.findIndex(f => f.id === file.id)), edit };
    }
    const EDITABLE = ['text', 'json', 'code', 'markdown', 'csv', 'html'];
    const isEditable = (f) => EDITABLE.includes(kindOf(f)) && f.size_bytes <= 3 * 1024 * 1024;
    const onFileChanged = () => { reloadView(); refreshAccount(); };

    // ---------- context menu ----------
    function openMenu(ev, type, item) {
      const r = ev.currentTarget && ev.type === 'click' ? ev.currentTarget.getBoundingClientRect() : null;
      const w = 210, h = type === 'file' ? 336 : 230;
      let x = r ? r.right - w : ev.clientX, y = r ? r.bottom + 4 : ev.clientY;
      x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
      if (y + h > window.innerHeight - 8) y = Math.max(8, (r ? r.top - h - 4 : ev.clientY - h));
      menu.value = { x, y, type, item };
    }
    const act = (fn) => { const item = menu.value && menu.value.item; menu.value = null; if (item) fn(item); };

    // ---------- actions ----------
    async function createFolder() {
      const name = await promptDialog({ title: 'New folder', placeholder: 'Folder name', confirmText: 'Create' });
      if (!name) return;
      await attempt(async () => { await api('/api/folders', { method: 'POST', body: { name, parent_id: props.folderId || null } }); await load(); });
    }

    async function renameFolder(f) {
      const name = await promptDialog({ title: 'Rename folder', value: f.name, confirmText: 'Rename' });
      if (!name || name === f.name) return;
      await attempt(async () => { await api(`/api/folders/${f.id}/name`, { method: 'PATCH', body: { name } }); await reloadView(); });
    }

    async function renameFile(f) {
      const name = await promptDialog({ title: 'Rename file', value: f.filename, confirmText: 'Rename' });
      if (!name || name === f.filename) return;
      await attempt(async () => { await api(`/api/files/${f.id}/name`, { method: 'PATCH', body: { name } }); await reloadView(); });
    }

    // Deleting goes to the trash (with Undo), so no confirmation is needed
    const deleteFolder = (f) => moveToTrash({ folders: [f.id] }, `“${f.name}”`, reloadView);
    const deleteFile = (f) => moveToTrash({ files: [f.id] }, `“${f.filename}”`, reloadView);

    async function deleteSelected() {
      const files = [...selection.files], folders = [...selection.folders];
      if (folders.some(id => visibleFolders.value.find(f => f.id === id)?.is_system)) return toast.error('Locked library folders can’t be deleted.');
      clearSelection();
      await moveToTrash({ files, folders }, countLabel(files.length, folders.length), reloadView);
    }

    async function createTextFile(ext) {
      const name = await promptDialog({ title: ext === 'md' ? 'New note' : 'New text file', value: ext === 'md' ? 'Note.md' : 'Untitled.txt', confirmText: 'Create' });
      if (!name) return;
      const filename = /\.[^.]+$/.test(name) ? name : `${name}.${ext}`;
      const body = ext === 'md' ? `# ${filename.replace(/\.[^.]+$/, '')}\n\n` : '';
      await attempt(async () => {
        const id = await uploadFile(new File([body], filename, { type: ext === 'md' ? 'text/markdown' : 'text/plain' }), props.folderId || null);
        await load();
        const f = files.value.find(x => x.id === id);
        if (f) openViewer(f, true);
      });
    }

    const downloadFile = (f) => downloadUrl(fileUrl(f.id, { download: true }));
    const downloadFolder = (f) => downloadUrl(`/api/folders/${f.id}/download?token=${encodeURIComponent(session.token)}`);
    function downloadSelected() {
      if (selection.files.length === 1 && !selection.folders.length) return downloadFile({ id: selection.files[0] });
      // one zip for everything, folders included
      const here = currentPath.value.length ? currentPath.value[currentPath.value.length - 1].name : 'Files';
      downloadZip({ files: selection.files, folders: selection.folders, name: here });
    }

    async function share(f) {
      const ok = await confirmDialog({
        title: 'Create a public link?',
        message: 'Anyone with the link will be able to open this file. While shared, the file is stored unencrypted on the server so the link can work.',
        confirmText: 'Create link',
      });
      if (!ok) return;
      await attempt(async () => {
        const r = await api(`/api/files/${f.id}/share`, { method: 'PATCH', body: { is_shared: true } });
        await reloadView();
        if (r.public_hash && await copyText(sharedUrl(r.public_hash))) toast.success('Public link created and copied');
      });
    }
    async function unshare(f) {
      await attempt(async () => { await api(`/api/files/${f.id}/share`, { method: 'PATCH', body: { is_shared: false } }); await reloadView(); }, 'Link removed, file is private and encrypted again');
    }
    const copyLink = async (f) => { if (await copyText(sharedUrl(f.public_hash))) toast.success('Public link copied'); };

    const reloadView = async () => {
      if (searching.value) { try { results.value = await api(`/api/search?q=${encodeURIComponent(query.value.trim())}`); } catch (e) { /* ignore */ } }
      await load();
    };

    // ---------- move ----------
    async function openMove(item, type) {
      move.items = item ? [{ type, id: item.id }] : [...selection.files.map(id => ({ type: 'file', id })), ...selection.folders.map(id => ({ type: 'folder', id }))];
      move.label = item ? `“${item.filename || item.name}”` : `${move.items.length} item${move.items.length > 1 ? 's' : ''}`;
      move.target = undefined;
      move.open = true;
      try { move.allFolders = await api('/api/folders/all'); } catch (e) { toast.error(e.message); }
    }

    const moveOptions = computed(() => {
      const all = move.allFolders;
      const children = {};
      for (const f of all) (children[f.parent_id || 'root'] ||= []).push(f);
      const movingFolders = new Set(move.items.filter(i => i.type === 'folder').map(i => i.id));
      const fileById = new Map([...files.value, ...(results.value?.files || [])].map(x => [x.id, x]));
      const movingFileKinds = move.items.filter(i => i.type === 'file').map(i => kindOf(fileById.get(i.id) || {}));
      const out = [{ id: null, name: 'Files', depth: 0, disabled: false }];
      const walk = (parent, depth, blocked) => {
        for (const f of (children[parent] || []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
          const isBlocked = blocked || movingFolders.has(f.id);
          const lockedBad = f.system_key && (movingFolders.size > 0 || !movingFileKinds.every(k => fits(f.system_key, k)));
          out.push({ id: f.id, name: f.name, depth, disabled: isBlocked || lockedBad, system_key: f.system_key });
          walk(f.id, depth + 1, isBlocked);
        }
      };
      walk('root', 1, false);
      return out;
    });

    /** Move many items in one request; reports problems once */
    async function moveItems(items, target) {
      try {
        const r = await api('/api/items/move', { method: 'POST', body: {
          files: items.filter(i => i.type === 'file').map(i => i.id), folders: items.filter(i => i.type === 'folder').map(i => i.id), folder_id: target } });
        for (const e of r.errors || []) toast.error(e);
        return r.moved;
      } catch (e) { toast.error(e.message); return 0; }
    }

    async function confirmMove() {
      if (move.target === undefined) return;
      move.busy = true;
      const n = await moveItems(move.items, move.target);
      move.busy = false; move.open = false;
      clearSelection();
      await reloadView();
      if (n) toast.success(`Moved ${n} item${n === 1 ? '' : 's'}`);
    }

    // ---------- drag & drop ----------
    const isExternal = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

    function onDragStart(e, type, item) {
      // dragging a selected item drags the whole selection
      const items = isSel(type, item.id)
        ? [...selection.files.map(id => ({ type: 'file', id })), ...selection.folders.map(id => ({ type: 'folder', id }))]
        : [{ type, id: item.id }];
      dragging.value = items;
      e.dataTransfer.setData('application/x-akulav', JSON.stringify(items));
      e.dataTransfer.effectAllowed = 'move';
    }
    function onDragOverFolder(e, id) {
      if (isExternal(e)) { dropTarget.value = id; e.dataTransfer.dropEffect = 'copy'; return; }
      if (dragging.value && !dragging.value.some(i => i.type === 'folder' && i.id === id)) { dropTarget.value = id; e.dataTransfer.dropEffect = 'move'; }
      else e.dataTransfer.dropEffect = 'none';
    }
    async function onDropOnFolder(e, folderId) {
      dropTarget.value = null; externalDrag.value = false; dragDepth = 0;
      if (isExternal(e)) { await uploadEntries(await filesFromDrop(e.dataTransfer), folderId); return; }
      let items = [];
      try { items = JSON.parse(e.dataTransfer.getData('application/x-akulav') || '[]'); } catch (err) { return; }
      items = items.filter(i => !(i.type === 'folder' && i.id === folderId));
      if (!items.length) return;
      const n = await moveItems(items, folderId);
      dragging.value = null;
      clearSelection();
      await load();
      if (n) toast.success(`Moved ${n} item${n > 1 ? 's' : ''}`);
    }
    function onDragEnter(e) { if (isExternal(e)) { dragDepth++; externalDrag.value = true; } }
    function onDragLeave(e) { if (isExternal(e)) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) externalDrag.value = false; } }
    function onDragOverPage(e) { if (isExternal(e)) e.dataTransfer.dropEffect = 'copy'; }
    async function onDropPage(e) {
      externalDrag.value = false; dragDepth = 0;
      if (isExternal(e)) await uploadEntries(await filesFromDrop(e.dataTransfer), props.folderId || null);
    }

    // ---------- upload ----------
    let ownUploads = 0;
    /** Upload [{ file, path }] into folderId, recreating sub-folders from `path` */
    async function uploadEntries(entries, folderId) {
      let list = entries.filter(e => e.file);
      if (!list.length) return;
      const key = lockedKeyOf(folderId);
      if (key) {
        // library folders hold files only: flatten and keep what fits
        const ok = list.filter(e => fits(key, kindOf({ filename: e.file.name, mime_type: e.file.type }), e.file.name));
        if (ok.length < list.length) toast(`${list.length - ok.length} file(s) skipped: this library folder only holds ${ACCEPTS_LABEL[ACCEPTS[key]]}.`);
        list = ok.map(e => ({ ...e, path: '' }));
        if (!list.length) return;
      }
      const ids = { '': folderId };
      try {
        for (const dir of [...new Set(list.map(e => e.path).filter(Boolean))].sort()) {
          ids[dir] = (await api('/api/folders/path', { method: 'POST', body: { parent_id: folderId, path: dir } })).id;
        }
      } catch (e) { toast.error(e.message); return; }
      if (Object.keys(ids).length > 1) await load(); // show the new folders right away
      ownUploads++;
      const res = await uploadMany(list.map(e => ({ file: e.file, folderId: ids[e.path] })));
      ownUploads--;
      if (res.length) { await load(); refreshAccount(); }
      const failed = list.length - res.length;
      if (failed) toast.error(`${failed} file${failed > 1 ? 's' : ''} weren’t uploaded`);
      else toast.success(`Uploaded ${res.length} file${res.length > 1 ? 's' : ''}`);
    }
    async function onPick(e) {
      const list = Array.from(e.target.files || []);
      e.target.value = '';
      if (list.length) await uploadEntries(list.map(file => ({ file, path: '' })), props.folderId || null);
    }
    async function onPickFolder(e) {
      const list = filesFromPicker(e.target.files || []);
      e.target.value = '';
      if (list.length) await uploadEntries(list, props.folderId || null);
    }
    // a retry from the upload tray finished: show the file
    let tickTimer = null;
    watch(uploadTick, () => { if (!ownUploads) { clearTimeout(tickTimer); tickTimer = setTimeout(load, 400); } });

    // ---------- locked library folders ----------
    const BOOK_EXT = /\.(pdf|epub|mobi|azw3?|djvu|fb2|cbz|cbr|txt)$/i;
    const ACCEPTS = { gallery: 'image', music_art: 'image', video_covers: 'image', book_covers: 'image', music: 'audio', videos: 'video', books: 'book' };
    function fits(systemKey, kind, name = '') {
      const want = ACCEPTS[systemKey];
      if (!want) return true;
      if (want === 'image') return kind === 'image' || kind === 'svg';
      if (want === 'book') return ['pdf', 'epub'].includes(kind) || BOOK_EXT.test(name) || kind === 'text';
      return kind === want;
    }
    const lockedHere = computed(() => {
      const last = currentPath.value[currentPath.value.length - 1];
      return last && last.system_key ? last : null;
    });
    function lockedKeyOf(folderId) {
      if (!folderId) return null;
      if (lockedHere.value && lockedHere.value.id === folderId) return lockedHere.value.system_key;
      const f = folders.value.find(x => x.id === folderId);
      return f ? f.system_key || null : null;
    }

    const tileStyle = (file) => { const t = tintFor(kindOf(file)); return { background: t + '1f', color: t }; };
    const tileVars = (file) => ({ '--tint': tintFor(kindOf(file)) });
    const extLabel = (file) => { const e = (file.filename || '').split('.'); return e.length > 1 ? e.pop().slice(0, 5).toUpperCase() : 'FILE'; };

    const onKey = (e) => {
      if (viewer.value || move.open || document.querySelector('[role=dialog]')) return;
      if (e.key === 'Escape') { if (menu.value) menu.value = null; else if (newMenu.value) newMenu.value = false; else clearSelection(); return; }
      if (e.target.closest && e.target.closest('input:not([type=checkbox]), textarea, select, [contenteditable]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selection.files = visibleFiles.value.map(f => f.id); selection.folders = visibleFolders.value.filter(f => !f.is_system).map(f => f.id); }
      else if ((e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) && selCount.value) { e.preventDefault(); deleteSelected(); }
      else if (e.key === 'F2' && selCount.value === 1) {
        e.preventDefault();
        if (selection.files.length) { const f = visibleFiles.value.find(x => x.id === selection.files[0]); if (f) renameFile(f); }
        else { const f = visibleFolders.value.find(x => x.id === selection.folders[0]); if (f && !f.is_system) renameFolder(f); }
      }
    };
    const closeMenu = () => { menu.value = null; };
    onMounted(() => { load(); window.addEventListener('keydown', onKey); window.addEventListener('resize', closeMenu); window.addEventListener('scroll', closeMenu, true); });
    onUnmounted(() => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', closeMenu); window.removeEventListener('scroll', closeMenu, true); });

    return {
      folderInput, newMenu, onPickFolder, createTextFile, account,
      folders, files, currentPath, loading, loaded, fileInput, query, searching, layout, sortKey, visibleFolders, visibleFiles, shownFiles, moreFiles, filesEnd, totalSize,
      selection, isSel, toggleSel, selCount, allSelected, someSelected, toggleAll, clearSelection, onRowClick,
      menu, openMenu, act, viewer, openViewer, isEditable, onFileChanged, navigate, goUp,
      createFolder, renameFolder, renameFile, deleteFolder, deleteFile, deleteSelected, downloadFile, downloadFolder, downloadSelected,
      share, unshare, copyLink, move, openMove, moveOptions, confirmMove,
      dragging, dropTarget, externalDrag, onDragStart, onDragOverFolder, onDropOnFolder, onDragEnter, onDragLeave, onDragOverPage, onDropPage, onPick,
      lockedHere, thumbUrl, SECTION_OF, ROUTE_OF, ACCEPTS_LABEL,
      fileUrl, formatBytes, formatDate, kindOf, iconFor, isImageKind, tileStyle, tileVars, extLabel, SYS_ICON,
    };
  },
};
