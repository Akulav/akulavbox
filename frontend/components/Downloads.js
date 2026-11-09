import { ref, computed, onMounted, onUnmounted } from 'vue';
import Icon from './Icon.js';
import { api, session, formatBytes } from '../lib/api.js';
import { toast } from '../lib/ui.js';

const ACTIVE = ['queued', 'probing', 'downloading', 'encode_wait', 'converting', 'processing'];
const STATUS_LABEL = { queued: 'Waiting', probing: 'Reading link…', downloading: 'Downloading', encode_wait: 'Downloaded, waiting to shrink', converting: 'Shrinking to AV1', processing: 'Saving…', done: 'Added', error: 'Failed', cancelled: 'Cancelled', expanded: 'Playlist' };
let statusCache = null;

/**
 * "Paste a link" bar for Videos (kind="video"), XXX (kind="xxx") and Music (kind="audio").
 * Emits `finished` whenever a download lands in the library, and `open` with a file id.
 */
export default {
  components: { Icon },
  props: { kind: { type: String, default: 'video' } },
  emits: ['finished', 'open'],
  template: /*html*/`
    <section v-if="st && st.enabled" class="panel p-3 sm:p-4 mb-5 rise">
      <form class="flex flex-col sm:flex-row gap-2" @submit.prevent="submit">
        <div class="relative flex-1 min-w-0">
          <Icon name="link" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input ref="inputEl" v-model="url" class="input pl-9 h-10" :disabled="!st.available" inputmode="url" autocomplete="off" spellcheck="false"
                 :placeholder="kind === 'audio' ? 'Paste a YouTube, SoundCloud or Bandcamp link (playlists work too)' : 'Paste a YouTube, Vimeo or other video link (playlists and channels work too)'"
                 aria-label="Link to download">
        </div>
        <button type="submit" class="btn btn-primary h-10 shrink-0" :disabled="!st.available || !url.trim() || busy">
          <Icon :name="busy ? 'loader' : 'download'" :size="16" />{{ kind === 'audio' ? 'Download music' : 'Download video' }}
        </button>
      </form>
      <p v-if="!st.available && st.installing" class="text-[12.5px] text-muted mt-2.5 flex items-center gap-2">
        <Icon name="loader" :size="14" class="shrink-0 text-accent" />Setting up the downloader, a one-time step: {{ st.step || 'starting…' }}
      </p>
      <p v-else-if="!st.available" class="text-[12.5px] text-muted mt-2.5 flex items-start gap-2">
        <Icon name="alert" :size="14" class="mt-0.5 shrink-0 text-danger" />
        <span>The downloader couldn’t be set up<template v-if="st.error">: {{ st.error }}</template>.
          <template v-if="session.role === 'admin'"> Try again from the Admin page.</template><template v-else> Ask the admin to check the Admin page.</template></span>
      </p>
      <p v-else-if="!jobs.length" class="text-[12px] text-faint mt-2">Saved to your {{ kind === 'audio' ? 'Music' : kind === 'xxx' ? 'XXX section' : 'Videos' }} with title, cover and creator, and listed under the {{ kind === 'audio' ? 'artist in Artists' : 'creator in Creators' }}.<template v-if="kind !== 'audio' && st.av1"> Videos are kept in AV1 to save space.</template> Tip: paste a link anywhere on this page.</p>

      <p v-if="summary" class="mt-3 text-[12.5px] text-muted flex items-center gap-2"><Icon name="loader" :size="13" class="text-accent" />{{ summary }}</p>
      <ul v-if="jobs.length" class="mt-3 divide-y divide-line border-t border-line">
        <li v-for="j in shown" :key="j.id" class="py-2.5 flex items-center gap-3">
          <span class="w-8 h-8 rounded-lg grid place-items-center shrink-0"
                :class="j.status === 'done' ? 'bg-ok/15 text-ok' : j.status === 'error' ? 'bg-danger/15 text-danger' : j.status === 'expanded' ? 'bg-info/15 text-info' : 'bg-accent/15 text-accent'">
            <Icon :name="j.status === 'done' ? 'check' : j.status === 'error' ? 'alert' : j.status === 'cancelled' ? 'x' : j.status === 'expanded' ? 'list-music' : 'loader'" :size="15" />
          </span>
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2">
              <p class="truncate text-[13.5px] font-medium flex-1" :title="j.title || j.url">{{ j.title || hostOf(j.url) }}</p>
              <span class="text-[11.5px] text-muted shrink-0 tabular-nums">{{ label(j) }}</span>
            </div>
            <p v-if="j.status === 'error'" class="text-[12px] text-danger" :class="needsCookies(j) ? 'line-clamp-2' : 'truncate'" :title="j.error">{{ j.error }}
              <a v-if="needsCookies(j)" href="#/profile/cookies" class="ml-1 font-medium text-accent hover:underline whitespace-nowrap">Add cookies</a></p>
            <p v-else class="text-[12px] text-faint truncate">{{ j.creator ? 'by ' + j.creator : hostOf(j.url) }}<template v-if="isConversion(j) && j.creator"> · {{ hostOf(j.url) }}</template><template v-if="j.error && (j.status === 'done' || active(j))"> · <span :class="active(j) ? 'text-accent' : ''">{{ j.error }}</span></template></p>
            <div v-if="active(j)" class="meter mt-1.5" style="height:3px"><span :style="{ width: Math.round((j.progress || 0) * 100) + '%' }"></span></div>
          </div>
          <button v-if="j.status === 'done' && j.file_id" class="btn btn-ghost btn-sm" @click="$emit('open', j.file_id)">{{ kind === 'audio' ? 'Play' : 'Open' }}</button>
          <button v-if="j.status === 'error' || j.status === 'cancelled'" class="icon-btn icon-btn-sm" @click="retry(j)" title="Try again"><Icon name="rotate" :size="14" /></button>
          <button class="icon-btn icon-btn-sm" @click="remove(j)" :title="active(j) ? 'Cancel' : 'Remove from list'"><Icon name="x" :size="14" /></button>
        </li>
      </ul>
      <div v-if="jobs.length" class="flex items-center gap-2 pt-2">
        <button v-if="jobs.length > 5" class="btn btn-ghost btn-sm" @click="expanded = !expanded">{{ expanded ? 'Show less' : 'Show all ' + jobs.length }}</button>
        <span class="flex-1"></span>
        <button v-if="jobs.some(j => !active(j))" class="btn btn-ghost btn-sm" @click="clear">Clear finished</button>
      </div>
    </section>`,
  setup(props, { emit }) {
    const st = ref(statusCache);
    const url = ref('');
    const busy = ref(false);
    const jobs = ref([]);
    const expanded = ref(false);
    const inputEl = ref(null);
    let timer = null, alive = true;
    const doneSeen = new Set();

    const active = (j) => ACTIVE.includes(j.status);
    // running and waiting jobs first, so a long queue doesn't hide what's happening now
    const RANK = { downloading: 0, probing: 0, converting: 1, processing: 1, encode_wait: 2, queued: 3 };
    const ordered = computed(() => [...jobs.value].sort((a, b) => (RANK[a.status] ?? 4) - (RANK[b.status] ?? 4)));
    const shown = computed(() => (expanded.value ? ordered.value : ordered.value.slice(0, 5)));
    // place in line among my waiting jobs (oldest first: that's the order they run in)
    const queuePos = computed(() => {
      const q = jobs.value.filter(j => j.status === 'queued').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      return new Map(q.map((j, i) => [j.id, i + 1]));
    });
    const summary = computed(() => {
      const n = (s) => jobs.value.filter(j => s.includes(j.status)).length;
      const parts = [];
      const working = n(['probing', 'downloading']), shrinking = n(['encode_wait', 'converting']), waiting = n(['queued']);
      if (working) parts.push(`${working} downloading`);
      if (shrinking) parts.push(`${shrinking} shrinking to AV1`);
      if (waiting) parts.push(`${waiting} waiting`);
      return parts.length && (waiting || working + shrinking > 1) ? parts.join(' · ') + '. They keep going if you close this page.' : '';
    });
    const isConversion = (j) => j.url.startsWith('akulavbox:');
    const hostOf = (u) => { if (u.startsWith('akulavbox:trim/')) return 'trim of your video'; if (u.startsWith('akulavbox:')) return 'from your video'; try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
    const needsCookies = (j) => /Profile → Link downloads/.test(j.error || '');
    const label = (j) => {
      if (j.status === 'downloading') {
        const pct = Math.round((j.progress || 0) * 100);
        return `${pct}%${j.speed ? ' · ' + formatBytes(j.speed) + '/s' : ''}`;
      }
      if (j.status === 'converting') return `${j.url.startsWith('akulavbox:trim/') ? 'Trimming' : isConversion(j) ? 'Saving the sound' : 'Shrinking to AV1'} ${Math.round((j.progress || 0) * 100)}%`;
      if (j.status === 'done' && j.url.startsWith('akulavbox:trim/')) return 'Trimmed';
      if (j.status === 'queued' && queuePos.value.get(j.id)) return `Waiting · #${queuePos.value.get(j.id)} in line`;
      return STATUS_LABEL[j.status] || j.status;
    };

    async function refresh() {
      try {
        const list = await api(`/api/downloads?kind=${props.kind}`);
        let finished = false;
        for (const j of list) {
          if (j.status === 'done' && !doneSeen.has(j.id)) { if (jobs.value.some(x => x.id === j.id && active(x))) finished = true; doneSeen.add(j.id); }
        }
        jobs.value = list;
        if (finished) emit('finished');
      } catch (e) { /* keep showing what we had */ }
      schedule();
    }
    function schedule() {
      clearTimeout(timer);
      if (alive && jobs.value.some(active)) timer = setTimeout(refresh, 1200);
    }

    async function submit() {
      const text = url.value.trim();
      if (!text) return;
      busy.value = true;
      try {
        const r = await api('/api/downloads', { method: 'POST', body: { url: text, kind: props.kind } });
        url.value = '';
        toast.success(r.ids.length > 1 ? `${r.ids.length} downloads started` : 'Download started');
        await refresh();
      } catch (e) { toast.error(e.message); }
      finally { busy.value = false; }
    }
    async function retry(j) {
      try { await api(`/api/downloads/${j.id}`, { method: 'DELETE' }); await api('/api/downloads', { method: 'POST', body: { url: j.url, kind: props.kind } }); await refresh(); }
      catch (e) { toast.error(e.message); }
    }
    async function remove(j) {
      try { await api(`/api/downloads/${j.id}`, { method: 'DELETE' }); await refresh(); } catch (e) { toast.error(e.message); }
    }
    async function clear() {
      try { await api('/api/downloads/clear', { method: 'POST' }); await refresh(); } catch (e) { toast.error(e.message); }
    }

    // Pasting a link anywhere on the page (outside text fields) puts it in the box
    const onPaste = (e) => {
      if (!st.value?.available || (e.target.closest && e.target.closest('input, textarea, [contenteditable]'))) return;
      const text = (e.clipboardData?.getData('text') || '').trim();
      if (!/^https?:\/\/\S+$/i.test(text.split(/\s+/)[0] || '')) return;
      e.preventDefault();
      url.value = text;
      inputEl.value?.focus();
      toast('Link pasted. Press Enter to download.');
    };

    // while the server installs yt-dlp / ffmpeg, check back until it's ready
    let statusTimer = null;
    async function loadStatus() {
      try { st.value = statusCache = await api('/api/downloads/status'); } catch (e) { return; }
      if (!st.value.available && st.value.installing && alive) statusTimer = setTimeout(loadStatus, 3000);
      else if (st.value.available) statusCache = st.value;
    }

    onMounted(async () => {
      window.addEventListener('paste', onPaste);
      if (statusCache && statusCache.available) st.value = statusCache; else await loadStatus();
      for (const j of (jobs.value = await api(`/api/downloads?kind=${props.kind}`).catch(() => []))) if (j.status === 'done') doneSeen.add(j.id);
      schedule();
    });
    onUnmounted(() => { alive = false; clearTimeout(timer); clearTimeout(statusTimer); window.removeEventListener('paste', onPaste); });

    return { st, url, busy, jobs, shown, expanded, summary, inputEl, session, active, hostOf, label, needsCookies, isConversion, submit, retry, remove, clear };
  },
};
