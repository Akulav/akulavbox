import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import Icon from '../components/Icon.js';
import { api, fileUrl, formatBytes, refreshAccount } from '../lib/api.js';
import { toast, confirmDialog, promptDialog, attempt } from '../lib/ui.js';
import { uploadMany, uploadFile } from '../lib/upload.js';
import { player, playQueue, playList, toggle, songTitle, forget, positionOf, previewRange } from '../lib/player.js';
import TrimPanel from '../components/Trim.js';
import { MetaEditor, LibraryFilters, Stars } from '../components/Library.js';
import Downloads from '../components/Downloads.js';
import { useLibraryFilter, systemFolder, formatDuration, thumbUrl, groupByPerson } from '../lib/library.js';
import { useRenderLimit, useSelection } from '../lib/lists.js';
import { moveToTrash } from '../lib/trash.js';

export default {
  components: { Icon, MetaEditor, LibraryFilters, Stars, Downloads, TrimPanel },
  template: /*html*/`
    <div>
      <!-- Header -->
      <div class="flex flex-col gap-4 mb-6">
        <div>
          <nav v-if="view !== 'home'" class="flex items-center gap-1 text-[13px] text-muted mb-1.5"><button class="hover:text-fg" @click="goHome">Music</button></nav>
          <div class="flex items-center gap-3">
            <button v-if="view !== 'home'" class="icon-btn -ml-2" @click="goHome" title="Back"><Icon name="arrow-left" :size="19" /></button>
            <h1 class="title text-[28px] md:text-[32px] leading-tight truncate">{{ view === 'home' ? 'Music' : view === 'all' ? 'All songs' : playlist?.title }}</h1>
          </div>
          <p v-if="view !== 'home' && songs.length" class="text-muted text-[13.5px] mt-1">{{ songs.length }} song{{ songs.length === 1 ? '' : 's' }}<template v-if="listDuration">, {{ listDuration }}</template><template v-if="canReorder"> · drag songs to reorder</template></p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div v-if="view === 'home'" class="relative flex-1 min-w-[180px] max-w-sm">
            <Icon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
            <input v-model="search" type="search" :placeholder="homeTab === 'artists' ? 'Search artists' : 'Search playlists'" class="input pl-9">
          </div>
          <div class="flex flex-wrap gap-2 ml-auto">
            <button v-if="view !== 'home' && songs.length" class="btn" :class="selecting ? '!border-accent text-accent' : ''" @click="toggleSelecting"><Icon name="check" :size="16" />{{ selecting ? 'Done' : 'Select' }}</button>
            <button v-if="view !== 'home' && filteredSongs.length" class="btn" @click="playAll(true)"><Icon name="shuffle" :size="16" /><span class="hidden sm:inline">Shuffle</span></button>
            <button v-if="view !== 'home' && filteredSongs.length" class="btn" @click="playAll(false)"><Icon name="play" :size="14" />Play</button>
            <button v-if="view === 'home' && allSongs.length" class="btn" @click="shuffleEverything"><Icon name="shuffle" :size="16" />Shuffle all</button>
            <button v-if="view === 'home'" class="btn" @click="createPlaylist"><Icon name="plus" :size="16" />New playlist</button>
            <button v-if="view === 'playlist'" class="btn btn-primary" @click="openAddSongs"><Icon name="plus" :size="16" />Add songs</button>
            <input ref="musicInput" type="file" multiple accept="audio/*,.flac,.m4a,.opus" class="hidden" @change="onPickMusic">
            <button v-if="view !== 'playlist'" class="btn btn-primary" @click="musicInput.click()"><Icon name="upload" :size="16" />Upload music</button>
          </div>
        </div>
      </div>

      <input ref="coverInput" type="file" accept="image/*" class="hidden" @change="onPickCover">
      <div v-if="view === 'home'" class="seg self-start mb-5" role="tablist" aria-label="Show">
        <button :class="{ on: homeTab === 'artists' }" @click="homeTab = 'artists'" role="tab"><Icon name="users" :size="14" />Artists<span v-if="artists.length" class="text-faint tabular-nums">{{ artists.length }}</span></button>
        <button :class="{ on: homeTab === 'playlists' }" @click="homeTab = 'playlists'" role="tab"><Icon name="list-music" :size="14" />Playlists<span v-if="playlists.length" class="text-faint tabular-nums">{{ playlists.length }}</span></button>
      </div>
      <Downloads v-if="view !== 'playlist' || dlKey > 0" :key="dlKey" kind="audio" @finished="onDownloaded" @open="playById" />
      <LibraryFilters v-if="view !== 'home' && songs.length" :f="f" kind="music" :sorts="view === 'playlist' ? [['order', 'Playlist order'], ...SORTS] : SORTS" placeholder="Search titles, artists, tags" class="-mt-2 mb-5" />

      <!-- HOME: artists -->
      <template v-if="view === 'home' && homeTab === 'artists'">
        <div v-if="!artists.length" class="panel py-14 px-6 text-center">
          <span class="w-14 h-14 rounded-2xl bg-accent/10 text-accent grid place-items-center mx-auto mb-4"><Icon name="users" :size="24" /></span>
          <p class="title text-lg mb-1">No artists yet</p>
          <p class="text-muted text-[13.5px] max-w-md mx-auto">Artists come from your songs’ details. Downloads and songs saved from videos fill them in for you.</p>
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 stagger">
          <button v-for="a in shownArtists" :key="a.name" class="group tile lift text-left" :class="a.cover ? 'tile-media tile-cap-on' : ''" :style="a.cover ? '' : { '--tint': a.tint }" :title="a.name" @click="openArtist(a.name)">
            <div v-if="a.cover" class="absolute inset-0 zoom-media"><img :src="thumbUrl(a.cover, 480)" loading="lazy" alt="" class="w-full h-full object-cover"></div>
            <template v-else>
              <Icon name="user" size="100%" :stroke="1.25" class="tile-mark" />
              <span class="tile-count">{{ a.name.charAt(0).toUpperCase() }}</span>
            </template>
            <span class="absolute z-[3] bottom-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <span class="w-8 h-8 rounded-full bg-black/55 backdrop-blur text-white grid place-items-center" role="button" :aria-label="'Shuffle ' + a.name" @click.stop="playArtist(a.name, true)"><Icon name="shuffle" :size="14" /></span>
              <span class="w-8 h-8 rounded-full bg-accent text-accent-fg grid place-items-center" role="button" :aria-label="'Play ' + a.name" @click.stop="playArtist(a.name, false)"><Icon name="play" :size="13" class="translate-x-[1px]" /></span>
            </span>
            <div class="tile-cap">
              <p class="truncate text-[13.5px] font-semibold leading-tight">{{ a.name }}</p>
              <p class="text-[11px] leading-tight mt-0.5 tile-sub">{{ a.count }} song{{ a.count === 1 ? '' : 's' }}<template v-if="a.duration"> · {{ formatDuration(a.duration) }}</template></p>
            </div>
          </button>
        </div>
        <div v-if="moreArtists" ref="artistsEnd" class="h-px" aria-hidden="true"></div>
      </template>

      <!-- HOME: playlists -->
      <template v-else-if="view === 'home'">
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-x-4 gap-y-6 stagger">
          <button class="group text-left" @click="openAll">
            <div class="aspect-square rounded-xl text-accent-fg grid place-items-center relative overflow-hidden lift" style="background: linear-gradient(135deg, rgb(var(--accent-hi)), rgb(var(--accent)) 55%, #b9621a)">
              <Icon name="list-music" :size="44" :stroke="1.5" class="transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6" />
              <span class="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,.35),transparent_55%)]"></span>
            </div>
            <p class="mt-2.5 font-medium text-[14px]">All songs</p>
            <p class="text-xs text-muted">{{ allSongs.length }} song{{ allSongs.length === 1 ? '' : 's' }}</p>
          </button>
          <div v-for="p in filteredPlaylists" :key="p.id" class="group cursor-pointer" @click="openPlaylist(p)">
            <div class="relative aspect-square rounded-xl overflow-hidden bg-elevated lift zoom-media">
              <img v-if="p.cover_file_id" :src="thumbUrl(p.cover_file_id, 480)" loading="lazy" alt="" class="w-full h-full object-cover">
              <div v-else class="w-full h-full grid place-items-center text-faint"><Icon name="disc" :size="44" :stroke="1.25" /></div>
              <div class="absolute bottom-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 translate-y-1 group-hover:translate-y-0 transition">
                <button class="w-10 h-10 rounded-full bg-black/55 backdrop-blur text-white grid place-items-center shadow-lg hover:bg-black/70"
                        @click.stop="playPlaylist(p, true)" :title="'Shuffle ' + p.title" :aria-label="'Shuffle ' + p.title"><Icon name="shuffle" :size="16" /></button>
                <button class="w-10 h-10 rounded-full bg-accent text-accent-fg grid place-items-center shadow-lg"
                        @click.stop="playPlaylist(p)" :title="'Play ' + p.title" :aria-label="'Play ' + p.title"><Icon name="play" :size="16" class="translate-x-[1px]" /></button>
              </div>
              <button class="absolute top-2 right-2 w-8 h-8 rounded-full grid place-items-center bg-black/45 backdrop-blur text-white opacity-0 group-hover:opacity-100 focus:opacity-100"
                      @click.stop="openMenu($event, { type: 'playlist', item: p })"><Icon name="more" :size="17" /></button>
              <span v-if="p.is_favorite" class="absolute top-2 left-2 w-8 h-8 rounded-full grid place-items-center bg-black/45 text-accent"><Icon name="star-fill" :size="15" /></span>
            </div>
            <p class="mt-2.5 font-medium text-[14px] truncate">{{ p.title }}</p>
            <p class="text-xs text-muted">{{ p.song_count }} song{{ p.song_count === 1 ? '' : 's' }}<template v-if="p.total_duration"> · {{ formatDuration(p.total_duration) }}</template></p>
          </div>
        </div>
        <p v-if="!playlists.length && !loading" class="text-muted text-[13.5px] mt-6">Playlists you create appear here. Upload music first, then group songs into playlists.</p>
      </template>

      <!-- SONG LIST -->
      <template v-else>
        <div v-if="loading" class="panel p-2 space-y-1"><div v-for="i in 8" :key="i" class="h-12 rounded-lg skeleton"></div></div>
        <div v-else-if="!filteredSongs.length" class="panel py-16 px-6 text-center">
          <span class="w-14 h-14 rounded-2xl bg-elevated grid place-items-center mx-auto mb-4 text-muted"><Icon name="music" :size="24" /></span>
          <p class="title text-lg mb-1">{{ f.active.value ? 'No songs match these filters' : view === 'all' ? 'Your library is empty' : 'This playlist is empty' }}</p>
          <p v-if="!f.active.value" class="text-muted text-[13.5px] mb-5">{{ view === 'all' ? 'Upload MP3, FLAC, M4A, OGG or WAV files.' : 'Add songs from your library.' }}</p>
          <button v-if="f.active.value" class="btn" @click="f.reset()">Clear filters</button>
          <button v-else class="btn btn-primary" @click="view === 'all' ? musicInput.click() : openAddSongs()"><Icon :name="view === 'all' ? 'upload' : 'plus'" :size="16" />{{ view === 'all' ? 'Upload music' : 'Add songs' }}</button>
        </div>
        <ol v-else class="panel overflow-hidden stagger">
          <li v-for="(s, i) in shownSongs" :key="s.id"
              class="group grid grid-cols-[32px_minmax(0,1fr)_auto] md:grid-cols-[32px_minmax(0,1fr)_150px_auto] items-center gap-3 px-3 md:px-4 h-[60px] border-b border-line last:border-0 row-hover cursor-pointer"
              :class="[isCurrent(s) || isSel(s.id) ? 'bg-accent/[0.07]' : '', dragOverIndex === i ? 'shadow-[inset_0_2px_0_rgb(var(--accent))]' : '', dragIndex === i ? 'opacity-40' : '']"
              :draggable="canReorder" @dragstart="onSongDragStart($event, i)" @dragover.prevent="canReorder && (dragOverIndex = i)" @dragleave="dragOverIndex = null"
              @drop.prevent="onSongDrop(i)" @dragend="dragIndex = dragOverIndex = null"
              @dblclick="!selecting && play(i)" @click="selecting ? toggleSel(s.id, $event, i) : onRowClick(i)">
            <input v-if="selecting" type="checkbox" class="checkbox mx-2" :checked="isSel(s.id)" @click.stop="toggleSel(s.id, $event, i)" :aria-label="'Select ' + songTitle(s)">
            <button v-else class="w-8 h-8 grid place-items-center rounded-full text-muted" @click.stop="isCurrent(s) ? toggle() : play(i)" :aria-label="'Play ' + songTitle(s)">
              <template v-if="isCurrent(s)">
                <Icon :name="player.playing ? 'pause' : 'play'" :size="14" class="text-accent" />
              </template>
              <template v-else>
                <span class="text-[13px] tabular-nums group-hover:hidden">{{ i + 1 }}</span>
                <Icon name="play" :size="13" class="hidden group-hover:block text-fg" />
              </template>
            </button>
            <div class="flex items-center gap-3 min-w-0">
              <img v-if="s.cover_file_id" :src="thumbUrl(s.cover_file_id, 240)" loading="lazy" alt="" class="w-10 h-10 rounded-md object-cover shrink-0">
              <span v-else class="w-10 h-10 rounded-md bg-elevated grid place-items-center text-faint shrink-0"><Icon name="music" :size="17" /></span>
              <div class="min-w-0">
                <p class="truncate text-[14px]" :class="isCurrent(s) ? 'text-accent font-medium' : ''">{{ songTitle(s) }}</p>
                <p v-if="s.participants.length || s.series || s.tags.length" class="truncate text-[12.5px] text-muted">
                  {{ s.participants.join(', ') }}<span v-if="s.participants.length && s.series" class="text-faint"> / </span>{{ s.series }}
                  <span v-for="t in s.tags.slice(0, 3)" :key="t" class="text-faint ml-1.5">#{{ t }}</span>
                </p>
              </div>
            </div>
            <span class="hidden md:flex items-center justify-end gap-2 text-muted text-[13px] tabular-nums"><Stars v-if="s.rating" :model-value="s.rating" :size="11" readonly />{{ s.duration ? formatDuration(s.duration) : formatBytes(s.size_bytes) }}</span>
            <button class="icon-btn md:opacity-0 group-hover:opacity-100 focus:opacity-100" @click.stop="openMenu($event, { type: 'song', item: s })" :aria-label="'Actions for ' + songTitle(s)"><Icon name="more" :size="18" /></button>
          </li>
        </ol>
        <div v-if="moreSongs && !loading && filteredSongs.length" ref="songsEnd" class="h-px" aria-hidden="true"></div>
      </template>

      <!-- Menus -->
      <div v-if="menu" class="fixed inset-0 z-[230]" @click="menu = null">
        <div class="menu fixed max-h-[70vh] overflow-y-auto" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
          <template v-if="menu.type === 'playlist'">
            <button class="menu-item" @click="run(p => playPlaylist(p))"><Icon name="play" :size="14" />Play</button>
            <button class="menu-item" @click="run(p => playPlaylist(p, true))"><Icon name="shuffle" :size="16" />Shuffle</button>
            <button class="menu-item" @click="run(toggleFavorite)"><Icon :name="menu.item.is_favorite ? 'star-fill' : 'star'" :size="16" />{{ menu.item.is_favorite ? 'Remove from favorites' : 'Add to favorites' }}</button>
            <button class="menu-item" @click="run(p => pickCover('playlist', p))"><Icon name="image" :size="16" />Change cover</button>
            <button class="menu-item" @click="run(renamePlaylist)"><Icon name="pencil" :size="16" />Rename</button>
            <div class="menu-sep"></div>
            <button class="menu-item danger" @click="run(deletePlaylist)"><Icon name="trash" :size="16" />Delete playlist</button>
          </template>
          <template v-else-if="menu.type === 'song'">
            <button class="menu-item" @click="run(s => editors = [s])"><Icon name="pencil" :size="16" />Edit details</button>
            <button class="menu-item" @click="run(s => pickCover('song', s))"><Icon name="image" :size="16" />Set artwork</button>
            <button v-if="canTrim" class="menu-item" @click="run(s => trimSong = s)"><Icon name="zoom-out" :size="16" />Trim</button>
            <button class="menu-item" @click="menu = { ...menu, type: 'add' }"><Icon name="list-music" :size="16" />Add to playlist<Icon name="chevron-right" :size="15" class="ml-auto text-faint" /></button>
            <div class="menu-sep"></div>
            <button v-if="view === 'playlist'" class="menu-item" @click="run(removeFromPlaylist)"><Icon name="x" :size="16" />Remove from playlist</button>
            <button v-else class="menu-item danger" @click="run(deleteSong)"><Icon name="trash" :size="16" />Move to trash</button>
          </template>
          <template v-else-if="menu.type === 'add-many'">
            <p class="px-2.5 py-1.5 text-xs text-muted">Add {{ selected.length }} song{{ selected.length === 1 ? '' : 's' }} to</p>
            <button v-for="p in playlists.filter(x => x.id !== playlist?.id)" :key="p.id" class="menu-item" @click="addManyTo(p)"><Icon name="disc" :size="16" /><span class="truncate">{{ p.title }}</span></button>
            <div v-if="playlists.length" class="menu-sep"></div>
            <button class="menu-item" @click="addManyToNew"><Icon name="plus" :size="16" />New playlist…</button>
          </template>
          <template v-else-if="menu.type === 'add'">
            <p class="px-2.5 py-1.5 text-xs text-muted">Add to playlist</p>
            <button v-for="p in playlists" :key="p.id" class="menu-item" @click="run(s => addToPlaylist(s, p))"><Icon name="disc" :size="16" /><span class="truncate">{{ p.title }}</span></button>
            <div v-if="playlists.length" class="menu-sep"></div>
            <button class="menu-item" @click="run(s => addToNewPlaylist(s))"><Icon name="plus" :size="16" />New playlist…</button>
          </template>
        </div>
      </div>

      <!-- Add songs dialog -->
      <Transition name="fade">
        <div v-if="adder.open" class="fixed inset-0 z-[240] bg-black/50 flex items-end sm:items-center justify-center p-4" @mousedown.self="adder.open = false">
          <div class="panel w-full max-w-lg flex flex-col max-h-[80vh]">
            <div class="p-5 pb-3">
              <h3 class="title text-lg">Add songs to {{ playlist?.title }}</h3>
              <div class="relative mt-3">
                <Icon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                <input v-model="adder.search" type="search" placeholder="Search your library" class="input pl-9">
              </div>
            </div>
            <ul class="flex-1 overflow-y-auto px-2 min-h-[160px]">
              <li v-for="s in shownAddable" :key="s.id">
                <label class="flex items-center gap-3 px-3 h-12 rounded-lg hover:bg-elevated cursor-pointer">
                  <input type="checkbox" class="checkbox" :value="s.id" v-model="adder.selected">
                  <img v-if="s.cover_file_id" :src="thumbUrl(s.cover_file_id, 240)" alt="" class="w-8 h-8 rounded object-cover">
                  <span v-else class="w-8 h-8 rounded bg-elevated grid place-items-center text-faint"><Icon name="music" :size="15" /></span>
                  <span class="truncate text-[13.5px]">{{ songTitle(s) }}</span>
                </label>
              </li>
              <li v-if="moreAddable" ref="addableEnd" class="h-px" aria-hidden="true"></li>
              <li v-if="!addable.length" class="text-muted text-[13px] text-center py-8">{{ allSongs.length ? 'Every matching song is already in this playlist.' : 'Upload music to your library first.' }}</li>
            </ul>
            <div class="flex items-center gap-2 p-4 border-t border-line">
              <button v-if="addable.length" class="btn btn-ghost btn-sm" @click="adder.selected = adder.selected.length === addable.length ? [] : addable.map(s => s.id)">{{ adder.selected.length === addable.length ? 'Select none' : 'Select all' }}</button>
              <span class="flex-1"></span>
              <button class="btn" @click="adder.open = false">Cancel</button>
              <button class="btn btn-primary" :disabled="!adder.selected.length" @click="confirmAdd">Add {{ adder.selected.length || '' }} song{{ adder.selected.length === 1 ? '' : 's' }}</button>
            </div>
          </div>
        </div>
      </Transition>

      <Transition name="pop">
        <div v-if="selected.length" class="fixed z-[170] left-1/2 -translate-x-1/2 bottom-[150px] md:bottom-[104px] panel glass flex items-center gap-1 p-1.5 pl-4 max-w-[calc(100vw-1rem)] overflow-x-auto no-scrollbar">
          <span class="text-[13.5px] font-medium mr-2 whitespace-nowrap">{{ selected.length }} selected</span>
          <button class="btn btn-ghost btn-sm" @click="selected = selected.length === filteredSongs.length ? [] : filteredSongs.map(s => s.id)">{{ selected.length === filteredSongs.length ? 'None' : 'All' }}</button>
          <button class="btn btn-ghost btn-sm" @click="playSelected" title="Play the selection"><Icon name="play" :size="14" /><span class="hidden sm:inline">Play</span></button>
          <button class="btn btn-ghost btn-sm" @click="editors = songs.filter(s => isSel(s.id))"><Icon name="pencil" :size="15" /><span class="hidden sm:inline">Edit details</span></button>
          <button class="btn btn-ghost btn-sm" @click="openAddMany"><Icon name="list-music" :size="15" /><span class="whitespace-nowrap">Add to playlist</span></button>
          <button v-if="view === 'playlist'" class="btn btn-ghost btn-sm" @click="removeSelectedFromPlaylist"><Icon name="x" :size="15" /><span class="whitespace-nowrap">Remove</span></button>
          <button class="btn btn-ghost btn-sm !text-danger" @click="deleteSelected" title="Move to trash"><Icon name="trash" :size="15" /><span class="hidden sm:inline">Delete</span></button>
          <button class="icon-btn icon-btn-sm shrink-0" @click="selected = []; selecting = false" title="Clear"><Icon name="x" :size="15" /></button>
        </div>
      </Transition>

      <!-- Trim a song -->
      <Transition name="fade">
        <div v-if="trimSong" class="fixed inset-0 z-[240] bg-black/50 flex items-end sm:items-center justify-center p-4" @mousedown.self="trimSong = null">
          <div class="panel w-full max-w-sm p-4">
            <div class="flex items-center gap-3 mb-3 min-w-0">
              <img v-if="trimSong.cover_file_id" :src="thumbUrl(trimSong.cover_file_id, 240)" alt="" class="w-10 h-10 rounded-md object-cover shrink-0">
              <div class="min-w-0"><p class="font-medium truncate">{{ songTitle(trimSong) }}</p><p class="text-xs text-muted truncate">{{ trimSong.participants.join(', ') || 'Unknown artist' }}<template v-if="trimSong.duration"> · {{ formatDuration(trimSong.duration) }}</template></p></div>
            </div>
            <TrimPanel :item="{ id: trimSong.id, duration: trimSong.duration }" kind="audio" :get-time="() => positionOf(trimSong.id)"
                       :preview="(s, e) => previewRange(trimSong, s, e)" @close="trimSong = null" @started="onTrimStarted" />
          </div>
        </div>
      </Transition>

      <MetaEditor v-if="editors" kind="music" :items="editors" :all-items="allSongs" @close="editors = null" @saved="onMetaSaved" />
    </div>
  `,
  setup() {
    const view = ref('home');
    const playlists = ref([]);
    const allSongs = ref([]);
    const songs = ref([]);
    const playlist = ref(null);
    const musicFolderId = ref(null);
    const loading = ref(false);
    const search = ref('');
    const musicInput = ref(null);
    const coverInput = ref(null);
    const coverTarget = ref(null);
    const menu = ref(null);
    const adder = reactive({ open: false, search: '', selected: [] });

    const q = computed(() => search.value.trim().toLowerCase());
    const filteredPlaylists = computed(() => playlists.value.filter(p => p.title.toLowerCase().includes(q.value)));
    const SORTS = [['title', 'Title'], ['people', 'Artist'], ['series', 'Album'], ['added', 'Recently added'], ['date', 'Year'], ['rating', 'Rating'], ['longest', 'Longest']];
    const f = useLibraryFilter(songs, 'music', 'title');
    const filteredSongs = f.filtered;
    const editors = ref(null);
    const selecting = ref(false);
    const sel = useSelection();
    const { selected, isSel } = sel;
    // shift-click selects everything between the last click and this one
    let lastSel = null;
    const toggleSel = (id, e, index) => {
      if (e && e.shiftKey && lastSel !== null && index !== undefined) {
        const [a, b] = [Math.min(lastSel, index), Math.max(lastSel, index)];
        sel.add(filteredSongs.value.slice(a, b + 1).map(s => s.id));
      } else sel.toggle(id);
      if (index !== undefined) lastSel = index;
    };
    const toggleSelecting = () => { selecting.value = !selecting.value; lastSel = null; if (!selecting.value) selected.value = []; };
    const endSelection = () => { selected.value = []; selecting.value = false; lastSel = null; };
    const selectedSongs = () => filteredSongs.value.filter(s => isSel(s.id));
    // long lists build a chunk of rows at a time (see lib/lists.js)
    const { shown: shownSongs, more: moreSongs, end: songsEnd } = useRenderLimit(filteredSongs, {
      step: 150, resetOn: () => [f.search.value, f.person.value, f.tag.value, f.series.value, f.sort.value, view.value, playlist.value?.id],
    });
    const playSelected = () => { playQueue(selectedSongs(), 0, `${selected.value.length} selected`); };
    async function deleteSelected() {
      const ids = [...selected.value];
      ids.forEach(forget);
      endSelection();
      await moveToTrash({ files: ids }, `${ids.length} song${ids.length === 1 ? '' : 's'}`, async () => { await fetchAll(); if (view.value === 'playlist') await fetchPlaylistSongs(); });
      if (view.value === 'playlist') { const gone = new Set(ids); songs.value = songs.value.filter(s => !gone.has(s.id)); }
    }
    async function removeSelectedFromPlaylist() {
      const ids = [...selected.value];
      const pid = playlist.value.id;
      endSelection();
      await attempt(async () => {
        await api(`/api/music/playlists/${pid}/songs/remove`, { method: 'POST', body: { file_ids: ids } });
        { const gone = new Set(ids); songs.value = songs.value.filter(s => !gone.has(s.id)); }
        fetchPlaylists();
      }, `Removed ${ids.length} song${ids.length === 1 ? '' : 's'} from ${playlist.value.title}`);
    }
    async function addManyToNew() {
      menu.value = null;
      const id = await createPlaylist();
      const p = playlists.value.find(x => x.id === id);
      if (p) await addManyTo(p);
    }
    async function onMetaSaved() {
      if (editors.value && editors.value.length > 1) { selected.value = []; selecting.value = false; }
      if (view.value === 'playlist') await fetchPlaylistSongs(); else await fetchAll();
      // keep the player's queue in sync with new titles/artists
      for (const q of player.queue) { const s = allSongs.value.find(x => x.id === q.id); if (s) Object.assign(q, s); }
    }
    function openAddMany() { menu.value = { type: 'add-many', x: Math.max(8, window.innerWidth / 2 - 105), y: Math.max(8, window.innerHeight - 420) }; }
    async function addManyTo(p) {
      menu.value = null;
      const n = selected.value.length;
      await attempt(async () => {
        await api(`/api/music/playlists/${p.id}/songs/bulk`, { method: 'POST', body: { file_ids: selected.value } });
        await fetchPlaylists();
      }, `Added ${n} song${n === 1 ? '' : 's'} to ${p.title}`);
      endSelection();
    }
    const addable = computed(() => {
      const inList = new Set(songs.value.map(s => s.id));
      const aq = adder.search.trim().toLowerCase();
      return allSongs.value.filter(s => !inList.has(s.id) && s.filename.toLowerCase().includes(aq));
    });
    const { shown: shownAddable, more: moreAddable, end: addableEnd } = useRenderLimit(addable, { step: 150, resetOn: () => [adder.open, adder.search] });

    const fetchPlaylists = async () => { playlists.value = await api('/api/music/playlists'); };
    const fetchAll = async () => {
      const d = await api('/api/music/songs');
      allSongs.value = d.songs; musicFolderId.value = d.folderId;
      if (view.value === 'all') songs.value = d.songs;
    };
    const fetchPlaylistSongs = async () => { songs.value = await api(`/api/music/playlists/${playlist.value.id}/songs`); };
    const guarded = async (fn) => { loading.value = true; try { await fn(); } catch (e) { toast.error(e.message); } finally { loading.value = false; } };

    const goHome = () => { selected.value = []; selecting.value = false; if (f.sort.value === 'order') f.sort.value = 'title'; view.value = 'home'; playlist.value = null; search.value = ''; guarded(async () => { await Promise.all([fetchPlaylists(), fetchAll()]); }); };
    const openAll = () => { if (f.sort.value === 'order') f.sort.value = 'title'; f.reset(); view.value = 'all'; playlist.value = null; search.value = ''; songs.value = allSongs.value; guarded(fetchAll); };
    const openPlaylist = (p) => { f.reset(); f.sort.value = 'order'; selected.value = []; selecting.value = false; playlist.value = p; view.value = 'playlist'; search.value = ''; songs.value = []; guarded(fetchPlaylistSongs); };

    const onDownloaded = () => { fetchAll().catch(() => {}); fetchPlaylists().catch(() => {}); refreshAccount(); };
    async function playById(id) {
      if (!allSongs.value.some(s => s.id === id)) await fetchAll().catch(() => {});
      const i = allSongs.value.findIndex(s => s.id === id);
      if (i !== -1) playQueue(allSongs.value, i, 'Downloads');
    }

    // ---------- artists (like Creators in Videos) ----------
    const homeTab = ref('artists'); // Music opens on Artists; playlists are the user's own
    // one tile per artist, with the artwork of their newest song that has some
    const artists = computed(() => groupByPerson(allSongs.value, s => s.cover_file_id)
      .map(a => ({ name: a.value, count: a.count, duration: a.duration, cover: a.newest ? a.newest.cover_file_id : null, tint: a.tint })));
    const filteredArtists = computed(() => artists.value.filter(a => a.name.toLowerCase().includes(q.value)));
    const { shown: shownArtists, more: moreArtists, end: artistsEnd } = useRenderLimit(filteredArtists, { step: 120, resetOn: () => [q.value, homeTab.value] });
    const songsBy = (name) => allSongs.value.filter(s => (s.participants || []).some(p => p.toLowerCase() === name.toLowerCase()));
    function openArtist(name) { openAll(); f.person.value = name; }
    const playArtist = (name, shuffled) => playList(songsBy(name), shuffled, name);

    // ---------- trim ----------
    const canTrim = ref(false);
    api('/api/downloads/status').then(s => { canTrim.value = !!s.convert; }).catch(() => {});
    const trimSong = ref(null);
    const dlKey = ref(0); // remount the downloads list so it shows (and follows) the trim
    function onTrimStarted() {
      if (player.current && player.current.id === trimSong.value.id) toggle(); // the file is about to change under the player
      trimSong.value = null;
      dlKey.value++;
    }

    const sourceName = () => view.value === 'playlist' ? playlist.value.title : 'All songs';
    const play = (i) => playQueue(filteredSongs.value, i, sourceName());
    const playAll = (shuffled) => playList(filteredSongs.value, shuffled, sourceName());
    const shuffleEverything = () => playList(allSongs.value, true, 'All songs');
    async function playPlaylist(p, shuffled = false) {
      const list = await attempt(() => api(`/api/music/playlists/${p.id}/songs`));
      if (list && list.length) playList(list, shuffled, p.title);
      else if (list) toast('This playlist is empty');
    }
    const isCurrent = (s) => player.current && player.current.id === s.id;
    // single click plays on touch devices where double-click doesn't exist
    const onRowClick = (i) => { if (window.matchMedia('(hover: none)').matches) play(i); };

    // ---------- playlists ----------
    async function createPlaylist() {
      const title = await promptDialog({ title: 'New playlist', placeholder: 'Playlist name', confirmText: 'Create' });
      if (!title) return null;
      const r = await attempt(() => api('/api/music/playlists', { method: 'POST', body: { title } }));
      await fetchPlaylists();
      return r && r.id;
    }
    async function renamePlaylist(p) {
      const title = await promptDialog({ title: 'Rename playlist', value: p.title, confirmText: 'Rename' });
      if (!title || title === p.title) return;
      await attempt(async () => { await api(`/api/music/playlists/${p.id}/title`, { method: 'PATCH', body: { title } }); await fetchPlaylists(); });
    }
    async function deletePlaylist(p) {
      if (!await confirmDialog({ title: `Delete “${p.title}”?`, message: 'The songs stay in your library.', confirmText: 'Delete', danger: true })) return;
      await attempt(async () => { await api(`/api/music/playlists/${p.id}`, { method: 'DELETE' }); await fetchPlaylists(); }, 'Playlist deleted');
    }
    async function toggleFavorite(p) {
      await attempt(async () => { await api(`/api/music/playlists/${p.id}/favorite`, { method: 'PATCH' }); await fetchPlaylists(); });
    }

    // ---------- songs ----------
    async function addToPlaylist(s, p) {
      await attempt(async () => { await api(`/api/music/playlists/${p.id}/songs`, { method: 'POST', body: { file_id: s.id } }); await fetchPlaylists(); }, `Added to ${p.title}`);
    }
    async function addToNewPlaylist(s) {
      const id = await createPlaylist();
      const p = playlists.value.find(x => x.id === id);
      if (p) await addToPlaylist(s, p);
    }
    async function removeFromPlaylist(s) {
      await attempt(async () => { await api(`/api/music/playlists/${playlist.value.id}/songs/${s.id}`, { method: 'DELETE' }); songs.value = songs.value.filter(x => x.id !== s.id); });
    }
    async function deleteSong(s) {
      forget(s.id);
      await moveToTrash({ files: [s.id] }, `“${songTitle(s)}”`, fetchAll);
    }

    // ---------- playlist order (drag & drop) ----------
    const canReorder = computed(() => view.value === 'playlist' && f.sort.value === 'order' && !f.active.value && !selecting.value);
    const dragIndex = ref(null);
    const dragOverIndex = ref(null);
    function onSongDragStart(e, i) {
      if (!canReorder.value) return;
      dragIndex.value = i;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
    }
    async function onSongDrop(to) {
      const from = dragIndex.value;
      dragIndex.value = dragOverIndex.value = null;
      if (!canReorder.value || from === null || from === to) return;
      const list = [...songs.value];
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      songs.value = list;
      try { await api(`/api/music/playlists/${playlist.value.id}/order`, { method: 'PUT', body: { file_ids: list.map(s => s.id) } }); }
      catch (e) { toast.error(e.message); fetchPlaylistSongs(); }
    }
    const listDuration = computed(() => { const t = songs.value.reduce((a, s) => a + (s.duration || 0), 0); return t ? formatDuration(t) : ''; });

    function openAddSongs() { Object.assign(adder, { open: true, search: '', selected: [] }); if (!allSongs.value.length) fetchAll(); }
    async function confirmAdd() {
      await attempt(async () => {
        await api(`/api/music/playlists/${playlist.value.id}/songs/bulk`, { method: 'POST', body: { file_ids: adder.selected } });
        adder.open = false;
        await fetchPlaylistSongs();
      }, `Added ${adder.selected.length} song${adder.selected.length === 1 ? '' : 's'}`);
    }

    // ---------- uploads ----------
    async function onPickMusic(e) {
      const list = Array.from(e.target.files || []);
      e.target.value = '';
      if (!list.length) return;
      if (!musicFolderId.value) await fetchAll();
      const res = await uploadMany(list, musicFolderId.value);
      await fetchAll(); refreshAccount();
      if (res.length < list.length) toast.error(`${list.length - res.length} file(s) failed to upload`);
      else toast.success(`Uploaded ${res.length} song${res.length === 1 ? '' : 's'}`);
    }

    const artFolder = () => systemFolder('music_art');
    function pickCover(type, item) { coverTarget.value = { type, item }; coverInput.value.click(); }
    async function onPickCover(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      const target = coverTarget.value;
      if (!file || !target) return;
      await attempt(async () => {
        const fileId = await uploadFile(file, await artFolder());
        if (target.type === 'playlist') {
          await api(`/api/music/playlists/${target.item.id}/cover`, { method: 'PATCH', body: { cover_file_id: fileId } });
          await fetchPlaylists();
        } else {
          await api(`/api/music/songs/${target.item.id}/cover`, { method: 'POST', body: { cover_file_id: fileId } });
          target.item.cover_file_id = fileId;
          const inQueue = player.queue.find(s => s.id === target.item.id);
          if (inQueue) inQueue.cover_file_id = fileId;
        }
        if (view.value === 'playlist') await fetchPlaylistSongs(); else await fetchAll();
        refreshAccount();
      }, 'Artwork updated');
    }

    function openMenu(e, { type, item }) {
      const r = e.currentTarget.getBoundingClientRect();
      menu.value = { type, item, x: Math.max(8, Math.min(r.right - 210, window.innerWidth - 218)), y: Math.min(r.bottom + 4, window.innerHeight - 260) };
    }
    const run = (fn) => { const it = menu.value.item; menu.value = null; fn(it); };

    const onKey = (e) => { if (e.key === 'Escape') { menu.value = null; adder.open = false; } };
    onMounted(() => { goHome(); window.addEventListener('keydown', onKey); });
    onUnmounted(() => window.removeEventListener('keydown', onKey));

    return {
      view, playlists, allSongs, songs, playlist, loading, search, musicInput, coverInput, menu, adder,
      f, SORTS, editors, selecting, selected, isSel, toggleSel, toggleSelecting, onMetaSaved, addManyTo, addManyToNew, openAddMany, formatDuration,
      playSelected, deleteSelected, removeSelectedFromPlaylist, shuffleEverything,
      homeTab, artists, filteredArtists, openArtist, shownArtists, moreArtists, artistsEnd, shownSongs, moreSongs, songsEnd, shownAddable, moreAddable, addableEnd, playArtist, canTrim, trimSong, dlKey, onTrimStarted, positionOf, previewRange,
      filteredPlaylists, filteredSongs, addable, goHome, openAll, openPlaylist, play, playAll, playPlaylist, isCurrent, onRowClick,
      createPlaylist, renamePlaylist, deletePlaylist, toggleFavorite, addToPlaylist, addToNewPlaylist, removeFromPlaylist, deleteSong,
      openAddSongs, confirmAdd, onPickMusic, pickCover, onPickCover, openMenu, run, onDownloaded, playById,
      player, toggle, songTitle, fileUrl, thumbUrl, formatBytes, canReorder, dragIndex, dragOverIndex, onSongDragStart, onSongDrop, listDuration,
    };
  },
};
