import { ref, computed, onMounted, onUnmounted } from 'vue';
import Icon from '../components/Icon.js';
import { Thumb } from '../components/Library.js';
import { api, formatBytes, formatRelative, parseDbDate, refreshAccount } from '../lib/api.js';
import { toast, confirmDialog, attempt } from '../lib/ui.js';
import { kindOf, iconFor, tintFor, isImageKind } from '../lib/filetypes.js';
import { countLabel } from '../lib/trash.js';

export default {
  components: { Icon, Thumb },
  template: /*html*/`
    <div>
      <div class="flex flex-wrap items-end gap-3 mb-6">
        <div class="flex-1 min-w-0">
          <h1 class="title text-[28px] md:text-[32px] leading-tight flex items-center gap-3">Trash</h1>
          <p class="text-muted text-[13.5px]">
            <template v-if="loaded">{{ items.length ? items.length + ' item' + (items.length === 1 ? '' : 's') + ', ' + formatBytes(data.total_bytes) : 'Empty' }}. Items are deleted for good after {{ data.days }} days.</template>
            <template v-else>&nbsp;</template>
          </p>
        </div>
        <div class="flex gap-2">
          <button v-if="items.length" class="btn" @click="toggleAll"><Icon name="check" :size="16" />{{ allSelected ? 'Select none' : 'Select all' }}</button>
          <button v-if="items.length" class="btn btn-danger" @click="emptyTrash"><Icon name="trash" :size="16" />Empty trash</button>
        </div>
      </div>

      <div v-if="!loaded" class="panel p-2 space-y-1"><div v-for="i in 5" :key="i" class="h-14 rounded-lg skeleton"></div></div>

      <div v-else-if="!items.length" class="panel py-20 px-6 text-center rise">
        <span class="w-16 h-16 rounded-2xl bg-ok/10 text-ok grid place-items-center mx-auto mb-4"><Icon name="check" :size="28" /></span>
        <p class="title text-xl mb-1">The trash is empty</p>
        <p class="text-muted text-[13.5px] max-w-sm mx-auto">Deleted files and folders wait here for {{ data.days }} days, so you can bring them back if you change your mind.</p>
      </div>

      <ul v-else class="panel overflow-hidden stagger" role="list">
        <li v-for="it in items" :key="it.type + it.id"
            class="group grid grid-cols-[28px_minmax(0,1fr)_auto] md:grid-cols-[28px_minmax(0,1fr)_120px_150px_auto] items-center gap-3 px-4 h-[62px] border-b border-line last:border-0 row-hover cursor-pointer"
            :class="isSel(it) ? 'bg-accent/[0.07]' : ''" @click="toggle(it)">
          <input type="checkbox" class="checkbox" :checked="isSel(it)" @click.stop="toggle(it)" :aria-label="'Select ' + it.name">
          <div class="flex items-center gap-3 min-w-0">
            <span v-if="it.type === 'file' && isImageKind(kindOf(it.raw))" class="w-[36px] h-[36px] rounded-lg overflow-hidden shrink-0 bg-elevated opacity-80"><Thumb :file-id="it.id" :w="240" /></span>
            <span v-else class="w-[36px] h-[36px] rounded-lg grid place-items-center shrink-0" :style="tile(it)"><Icon :name="it.type === 'folder' ? 'folder' : iconFor(kindOf(it.raw))" :size="18" /></span>
            <div class="min-w-0">
              <p class="truncate text-[14px] font-medium">{{ it.name }}</p>
              <p class="text-xs text-faint truncate">
                <template v-if="it.type === 'folder'">Folder, {{ it.raw.file_count }} file{{ it.raw.file_count === 1 ? '' : 's' }} · </template>
                <template v-else>From {{ it.raw.folder_name || 'Files' }} · </template>
                <span :class="daysLeft(it) <= 3 ? 'text-danger' : ''">{{ daysLeft(it) <= 0 ? 'deleted soon' : daysLeft(it) + ' day' + (daysLeft(it) === 1 ? '' : 's') + ' left' }}</span>
              </p>
            </div>
          </div>
          <span class="hidden md:block text-muted text-[13px] tabular-nums">{{ formatBytes(it.size) }}</span>
          <span class="hidden md:block text-muted text-[13px]" :title="it.trashed_at">Deleted {{ formatRelative(it.trashed_at) }}</span>
          <div class="flex justify-end gap-1">
            <button class="btn btn-sm" @click.stop="restore([it])" title="Restore"><Icon name="undo" :size="15" /><span class="hidden sm:inline">Restore</span></button>
            <button class="icon-btn hover:!text-danger" @click.stop="destroy([it])" title="Delete forever"><Icon name="x" :size="17" /></button>
          </div>
        </li>
      </ul>

      <Transition name="pop">
        <div v-if="selected.length" class="fixed z-[170] left-1/2 -translate-x-1/2 bottom-[76px] md:bottom-6 panel glass flex items-center gap-1 p-1.5 pl-4">
          <span class="text-[13.5px] font-medium mr-2 whitespace-nowrap">{{ selected.length }} selected</span>
          <button class="btn btn-ghost btn-sm" @click="restore(selectedItems)"><Icon name="undo" :size="15" />Restore</button>
          <button class="btn btn-ghost btn-sm !text-danger" @click="destroy(selectedItems)"><Icon name="trash" :size="15" />Delete forever</button>
          <button class="icon-btn icon-btn-sm" @click="selected = []" title="Clear selection (Esc)"><Icon name="x" :size="15" /></button>
        </div>
      </Transition>
    </div>
  `,
  setup() {
    const data = ref({ files: [], folders: [], total_bytes: 0, days: 30 });
    const loaded = ref(false);
    const selected = ref([]);

    const items = computed(() => [
      ...data.value.folders.map(f => ({ type: 'folder', id: f.id, name: f.name, size: f.size_bytes, trashed_at: f.trashed_at, raw: f })),
      ...data.value.files.map(f => ({ type: 'file', id: f.id, name: f.filename, size: f.size_bytes, trashed_at: f.trashed_at, raw: f })),
    ].sort((a, b) => String(b.trashed_at).localeCompare(String(a.trashed_at))));
    const keyOf = (it) => `${it.type}:${it.id}`;
    const isSel = (it) => selected.value.includes(keyOf(it));
    const toggle = (it) => { const k = keyOf(it), i = selected.value.indexOf(k); if (i === -1) selected.value.push(k); else selected.value.splice(i, 1); };
    const selectedItems = computed(() => items.value.filter(isSel));
    const allSelected = computed(() => items.value.length > 0 && selected.value.length === items.value.length);
    const toggleAll = () => { selected.value = allSelected.value ? [] : items.value.map(keyOf); };

    const daysLeft = (it) => {
      const d = parseDbDate(it.trashed_at);
      return d ? Math.ceil((d.getTime() + data.value.days * 86400000 - Date.now()) / 86400000) : data.value.days;
    };
    const tile = (it) => { const t = it.type === 'folder' ? '#e8a33d' : tintFor(kindOf(it.raw)); return { background: t + '1f', color: t }; };
    const split = (list) => ({ files: list.filter(i => i.type === 'file').map(i => i.id), folders: list.filter(i => i.type === 'folder').map(i => i.id) });

    async function load() {
      try { data.value = await api('/api/trash'); loaded.value = true; }
      catch (e) { toast.error(e.message); }
      selected.value = selected.value.filter(k => items.value.some(it => keyOf(it) === k));
    }

    async function restore(list) {
      const body = split(list);
      const r = await attempt(() => api('/api/trash/restore', { method: 'POST', body }));
      if (!r) return;
      toast.success(`Restored ${countLabel(body.files.length, body.folders.length, 'file')}`);
      selected.value = [];
      await load(); refreshAccount();
    }
    async function destroy(list) {
      const body = split(list);
      const label = countLabel(body.files.length, body.folders.length, 'file');
      if (!await confirmDialog({ title: `Delete ${label} forever?`, message: 'They are removed from the server right away. This can’t be undone.', confirmText: 'Delete forever', danger: true })) return;
      const r = await attempt(() => api('/api/trash/delete', { method: 'POST', body }));
      if (!r) return;
      toast.success(`Deleted ${label} for good`);
      selected.value = [];
      await load(); refreshAccount();
    }
    async function emptyTrash() {
      if (!await confirmDialog({ title: 'Empty the trash?', message: `Everything in the trash (${formatBytes(data.value.total_bytes)}) is deleted for good. This can’t be undone.`, confirmText: 'Empty trash', danger: true })) return;
      await attempt(async () => { await api('/api/trash', { method: 'DELETE' }); selected.value = []; await load(); refreshAccount(); }, 'Trash emptied');
    }

    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('[role=dialog]')) selected.value = []; };
    onMounted(() => { load(); window.addEventListener('keydown', onKey); });
    onUnmounted(() => window.removeEventListener('keydown', onKey));

    return { data, loaded, items, selected, selectedItems, allSelected, isSel, toggle, toggleAll, daysLeft, tile, restore, destroy, emptyTrash,
      formatBytes, formatRelative, kindOf, iconFor, isImageKind, countLabel };
  },
};
