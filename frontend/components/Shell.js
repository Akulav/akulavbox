import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import Icon from './Icon.js';
import { toasts, dismissToast, dialog, closeDialog } from '../lib/ui.js';
import { uploads, clearFinishedUploads, cancelUpload, cancelAllUploads, retryUpload } from '../lib/upload.js';
import { formatBytes } from '../lib/api.js';
import { thumbUrl } from '../lib/library.js';
import { player, songTitle, toggle, next, prev, seek, setVolume, toggleMute, toggleShuffle, cycleRepeat, stop, formatTime } from '../lib/player.js';
import { call, acceptCall, declineCall, endCall, toggleMuteCall, enableSound } from '../lib/realtime.js';

export const Avatar = {
  props: { name: String, src: String, size: { type: Number, default: 36 }, online: { type: Boolean, default: undefined } },
  template: /*html*/`
    <span class="relative inline-flex shrink-0" :style="{ width: size + 'px', height: size + 'px' }">
      <img v-if="src" :src="src" alt="" class="w-full h-full rounded-full object-cover">
      <span v-else class="w-full h-full rounded-full grid place-items-center font-semibold text-accent-fg"
            :style="{ background: hue, fontSize: (size * 0.4) + 'px' }">{{ (name || '?').charAt(0).toUpperCase() }}</span>
      <span v-if="online !== undefined" class="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-surface"
            :class="online ? 'bg-ok' : 'bg-faint'" :style="{ width: size * 0.32 + 'px', height: size * 0.32 + 'px' }"></span>
    </span>`,
  computed: {
    hue() {
      let h = 0; for (const c of (this.name || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
      return `hsl(${h} 45% 62%)`;
    },
  },
};

export const UiHost = {
  components: { Icon },
  template: /*html*/`
    <!-- Toasts -->
    <div class="fixed z-[300] bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0 flex flex-col gap-2 items-center sm:items-end pointer-events-none w-[calc(100%-2rem)] sm:w-auto">
      <TransitionGroup name="toast">
        <div v-for="t in toasts" :key="t.id" role="status"
             class="relative overflow-hidden pointer-events-auto flex items-center gap-3 max-w-sm w-full sm:w-auto sm:min-w-[260px] pl-3 pr-2 py-2.5 rounded-xl border shadow-2xl text-[13.5px] glass border-line">
          <span class="w-7 h-7 rounded-lg grid place-items-center shrink-0"
                :class="t.type === 'error' ? 'bg-danger/15 text-danger' : t.type === 'success' ? 'bg-ok/15 text-ok' : 'bg-accent/15 text-accent'">
            <Icon :name="t.type === 'error' ? 'alert' : t.type === 'success' ? 'check' : 'info'" :size="15" :stroke="2.2" />
          </span>
          <span class="flex-1 leading-snug">{{ t.message }}</span>
          <button v-if="t.action" class="btn btn-sm !h-7 font-semibold text-accent" @click="runAction(t)">{{ t.action.label }}</button>
          <button class="icon-btn icon-btn-sm" @click="dismissToast(t.id)" aria-label="Dismiss"><Icon name="x" :size="14" /></button>
          <span v-if="t.timeout" class="toast-timer absolute left-0 bottom-0 h-[2px] w-full"
                :class="t.type === 'error' ? 'bg-danger/60' : t.type === 'success' ? 'bg-ok/60' : 'bg-accent/60'" :style="{ animationDuration: t.timeout + 'ms' }"></span>
        </div>
      </TransitionGroup>
    </div>

    <!-- Dialog -->
    <Transition name="fade">
      <div v-if="dialog.open" class="fixed inset-0 z-[280] bg-black/50 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-4" @mousedown.self="cancel">
        <Transition name="pop" appear>
          <form class="panel w-full max-w-md p-5" @submit.prevent="ok" role="dialog" aria-modal="true">
            <h3 class="title text-lg mb-1">{{ dialog.title }}</h3>
            <p v-if="dialog.message" class="text-muted text-[13.5px] leading-relaxed whitespace-pre-line">{{ dialog.message }}</p>
            <input v-if="dialog.kind === 'prompt'" ref="inputEl" v-model="dialog.value" :type="dialog.inputType" :placeholder="dialog.placeholder" class="input mt-4">
            <div class="flex justify-end gap-2 mt-5">
              <button type="button" class="btn" @click="cancel">{{ dialog.cancelText }}</button>
              <button type="submit" class="btn" :class="dialog.danger ? 'btn-danger' : 'btn-primary'"
                      :disabled="dialog.kind === 'prompt' && !String(dialog.value || '').trim()">{{ dialog.confirmText }}</button>
            </div>
          </form>
        </Transition>
      </div>
    </Transition>`,
  setup() {
    const inputEl = ref(null);
    const ok = () => closeDialog(dialog.kind === 'prompt' ? String(dialog.value || '').trim() : true);
    const cancel = () => closeDialog(dialog.kind === 'prompt' ? null : false);
    watch(() => dialog.open, async (o) => {
      if (o && dialog.kind === 'prompt') {
        await nextTick();
        if (inputEl.value) {
          inputEl.value.focus();
          // Select the name without its extension, like a desktop file manager
          const v = inputEl.value.value, dot = v.lastIndexOf('.');
          inputEl.value.setSelectionRange(0, dot > 0 ? dot : v.length);
        }
      }
    });
    const onKey = (e) => { if (dialog.open && e.key === 'Escape') cancel(); };
    onMounted(() => window.addEventListener('keydown', onKey));
    onUnmounted(() => window.removeEventListener('keydown', onKey));
    const runAction = (t) => { dismissToast(t.id); t.action.run(); };
    return { toasts, dismissToast, dialog, ok, cancel, inputEl, runAction };
  },
};

export const UploadTray = {
  components: { Icon },
  template: /*html*/`
    <Transition name="pop">
    <div v-if="uploads.length" class="fixed z-[200] right-4 panel glass w-[min(380px,calc(100vw-2rem))] overflow-hidden"
         :class="playerVisible ? 'bottom-[136px] md:bottom-[96px]' : 'bottom-20 md:bottom-4'">
      <div class="relative flex items-center justify-between pl-4 pr-2 h-12 border-b border-line">
        <span class="font-medium text-[13.5px] flex items-center gap-2 min-w-0">
          <Icon :name="active ? 'loader' : failed ? 'alert' : 'check'" :size="15" :class="active ? 'text-accent' : failed ? 'text-danger' : 'text-ok'" />
          <span class="truncate">{{ headline }}<span v-if="eta" class="text-muted font-normal">, {{ eta }}</span></span>
        </span>
        <div class="flex items-center shrink-0">
          <button v-if="active" class="btn btn-ghost btn-sm !h-7" @click="cancelAllUploads" title="Cancel all uploads">Cancel all</button>
          <button class="icon-btn icon-btn-sm" @click="collapsed = !collapsed" :aria-label="collapsed ? 'Expand' : 'Collapse'">
            <Icon name="chevron-down" :size="16" :class="collapsed ? 'rotate-180' : ''" class="transition-transform" />
          </button>
          <button v-if="!active" class="icon-btn icon-btn-sm" @click="clearFinishedUploads" aria-label="Close"><Icon name="x" :size="15" /></button>
        </div>
        <div v-if="active" class="absolute left-0 right-0 bottom-0 h-[2px] bg-line/50"><div class="h-full bg-accent transition-[width] duration-300" :style="{ width: overall + '%' }"></div></div>
      </div>
      <ul v-show="!collapsed" class="max-h-72 overflow-y-auto divide-y divide-line">
        <li v-for="u in uploads" :key="u.id" class="group px-4 py-2.5">
          <div class="flex items-center gap-2 text-[13px]">
            <Icon :name="u.status === 'done' ? 'check' : u.status === 'error' ? 'alert' : u.status === 'cancelled' ? 'x' : 'upload'" :size="15"
                  :class="u.status === 'done' ? 'text-ok' : u.status === 'error' ? 'text-danger' : 'text-muted'" />
            <span class="truncate flex-1" :class="u.status === 'cancelled' ? 'text-faint line-through' : ''" :title="u.name">{{ u.name }}</span>
            <span class="text-faint text-xs tabular-nums">{{ u.status === 'error' ? 'Failed' : u.status === 'cancelled' ? 'Cancelled' : u.status === 'queued' ? 'Waiting' : Math.round(u.progress * 100) + '%' }}</span>
            <button v-if="u.status === 'uploading' || u.status === 'queued'" class="icon-btn icon-btn-sm !w-6 !h-6" @click="cancelUpload(u)" :aria-label="'Cancel ' + u.name" title="Cancel"><Icon name="x" :size="13" /></button>
            <button v-else-if="u.status === 'error' || u.status === 'cancelled'" class="icon-btn icon-btn-sm !w-6 !h-6" @click="retryUpload(u)" :aria-label="'Retry ' + u.name" title="Try again"><Icon name="rotate" :size="13" /></button>
          </div>
          <p v-if="u.error" class="text-danger text-xs mt-1 pl-6">{{ u.error }}</p>
          <div v-else-if="u.status !== 'cancelled'" class="meter mt-2 ml-6" :class="{ ok: u.status === 'done' }" style="height:3px"><span :style="{ width: (u.progress * 100) + '%' }"></span></div>
        </li>
      </ul>
    </div>
    </Transition>`,
  setup() {
    const collapsed = ref(false);
    const active = computed(() => uploads.some(u => u.status === 'uploading' || u.status === 'queued'));
    const failed = computed(() => uploads.filter(u => u.status === 'error').length);
    const overall = computed(() => {
      const live = uploads.filter(u => u.status !== 'cancelled' && u.status !== 'error');
      const total = live.reduce((s, u) => s + (u.size || 1), 0);
      return total ? Math.round(live.reduce((s, u) => s + (u.size || 1) * u.progress, 0) / total * 100) : 0;
    });
    const headline = computed(() => {
      const left = uploads.filter(u => u.status === 'uploading' || u.status === 'queued').length;
      if (left) return `Uploading ${left} file${left > 1 ? 's' : ''}`;
      if (failed.value) return `${failed.value} upload${failed.value > 1 ? 's' : ''} failed`;
      return 'Uploads complete';
    });
    const playerVisible = computed(() => !!player.current);
    // speed of the file being sent right now, used for the time-left estimate
    const now = ref(Date.now());
    const tick = setInterval(() => { now.value = Date.now(); }, 1000);
    onUnmounted(() => clearInterval(tick));
    const eta = computed(() => {
      // combined speed of everything uploading right now (several files go in parallel)
      const running = uploads.filter(u => u.status === 'uploading' && u.startedAt);
      if (!running.length) return '';
      const speed = running.reduce((s, u) => { const secs = (now.value - u.startedAt) / 1000; return s + (secs > 1.5 ? (u.size * u.progress) / secs : 0); }, 0);
      if (!speed) return '';
      const left = uploads.filter(u => u.status === 'uploading' || u.status === 'queued').reduce((a, u) => a + u.size * (1 - u.progress), 0) / speed;
      const mbps = speed / (1024 * 1024);
      const t = left < 60 ? `${Math.max(1, Math.round(left))} s left` : left < 3600 ? `${Math.round(left / 60)} min left` : `${(left / 3600).toFixed(1)} h left`;
      return `${mbps >= 1 ? mbps.toFixed(1) + ' MB/s' : Math.round(speed / 1024) + ' KB/s'}, ${t}`;
    });
    return { uploads, collapsed, active, failed, overall, headline, eta, clearFinishedUploads, cancelUpload, cancelAllUploads, retryUpload, formatBytes, playerVisible };
  },
};

export const PlayerBar = {
  components: { Icon },
  template: /*html*/`
    <Transition name="pop">
    <div v-if="player.current" class="fixed z-[150] left-0 right-0 bottom-[60px] md:bottom-0 md:left-[248px] border-t border-line glass">
      <!-- thin progress line on mobile -->
      <div class="md:hidden h-[2px] bg-line"><div class="h-full bg-accent" :style="{ width: pct + '%' }"></div></div>
      <div class="h-[64px] md:h-[80px] px-3 md:px-6 grid grid-cols-[1fr_auto] md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] items-center gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <img v-if="cover" :src="cover" alt="" class="w-11 h-11 md:w-12 md:h-12 rounded-lg object-cover shrink-0">
          <div v-else class="w-11 h-11 md:w-12 md:h-12 rounded-lg bg-elevated grid place-items-center text-muted shrink-0"><Icon name="music" /></div>
          <div class="min-w-0">
            <p class="font-medium truncate text-[13.5px]">{{ title }}</p>
            <p class="text-muted text-xs truncate">{{ player.source || 'Library' }}</p>
          </div>
        </div>

        <div class="flex flex-col items-center gap-1">
          <div class="flex items-center gap-1 md:gap-2">
            <button class="icon-btn hidden md:inline-flex" :class="{ 'text-accent': player.shuffle }" @click="toggleShuffle" :aria-pressed="player.shuffle" title="Shuffle"><Icon name="shuffle" :size="17" /></button>
            <button class="icon-btn" @click="prev" title="Previous"><Icon name="skip-back" :size="18" /></button>
            <button class="w-10 h-10 rounded-full bg-fg text-bg grid place-items-center hover:scale-105 transition-transform" @click="toggle" :title="player.playing ? 'Pause' : 'Play'">
              <Icon v-if="player.loading && !player.playing" name="loader" :size="18" />
              <Icon v-else :name="player.playing ? 'pause' : 'play'" :size="17" :class="player.playing ? '' : 'translate-x-[1px]'" />
            </button>
            <button class="icon-btn" @click="next()" title="Next"><Icon name="skip-forward" :size="18" /></button>
            <button class="icon-btn hidden md:inline-flex" :class="{ 'text-accent': player.repeat !== 'off' }" @click="cycleRepeat" :title="'Repeat: ' + player.repeat">
              <Icon :name="player.repeat === 'one' ? 'repeat-1' : 'repeat'" :size="17" />
            </button>
          </div>
          <div class="hidden md:flex items-center gap-3 w-full text-[11px] text-muted tabular-nums">
            <span class="w-9 text-right">{{ formatTime(player.time) }}</span>
            <input type="range" class="slider flex-1" min="0" :max="player.duration || 0" step="0.1" :value="player.time"
                   :style="{ '--p': pct + '%' }" @input="seek(+$event.target.value)" aria-label="Seek">
            <span class="w-9">{{ formatTime(player.duration) }}</span>
          </div>
        </div>

        <div class="hidden md:flex items-center justify-end gap-2">
          <button class="icon-btn" @click="toggleMute" :title="player.muted ? 'Unmute' : 'Mute'"><Icon :name="player.muted || player.volume === 0 ? 'volume-x' : 'volume'" :size="17" /></button>
          <input type="range" class="slider w-24" min="0" max="1" step="0.01" :value="player.muted ? 0 : player.volume"
                 :style="{ '--p': (player.muted ? 0 : player.volume * 100) + '%' }" @input="setVolume(+$event.target.value)" aria-label="Volume">
          <button class="icon-btn" @click="stop" title="Close player"><Icon name="x" :size="16" /></button>
        </div>
      </div>
    </div>
    </Transition>`,
  setup() {
    const pct = computed(() => (player.duration ? (player.time / player.duration) * 100 : 0));
    const cover = computed(() => player.current?.cover_file_id ? thumbUrl(player.current.cover_file_id, 240) : null);
    const title = computed(() => songTitle(player.current));
    return { player, pct, cover, title, toggle, next, prev, seek, setVolume, toggleMute, toggleShuffle, cycleRepeat, stop, formatTime };
  },
};

export const CallOverlay = {
  components: { Icon, Avatar },
  template: /*html*/`
    <Transition name="pop">
      <div v-if="call.state !== 'idle'" class="fixed z-[260] top-4 right-4 left-4 sm:left-auto sm:w-80 panel p-4">
        <div class="flex items-center gap-3">
          <Avatar :name="call.peerName" :size="44" />
          <div class="flex-1 min-w-0">
            <p class="font-semibold truncate">{{ call.peerName }}</p>
            <p class="text-muted text-[13px]">{{ status }}</p>
          </div>
        </div>
        <button v-if="call.needsSound" class="btn btn-primary w-full mt-3" @click="enableSound"><Icon name="volume" :size="16" />Turn on sound</button>
        <div class="flex gap-2 mt-4">
          <template v-if="call.state === 'ringing'">
            <button class="btn flex-1" @click="declineCall"><Icon name="phone-off" :size="16" />Decline</button>
            <button class="btn flex-1 !bg-ok !text-white !border-transparent" @click="acceptCall"><Icon name="phone" :size="16" />Answer</button>
          </template>
          <template v-else>
            <button class="btn flex-1" @click="toggleMuteCall" :disabled="call.state !== 'active'">
              <Icon :name="call.muted ? 'mic-off' : 'mic'" :size="16" />{{ call.muted ? 'Unmute' : 'Mute' }}
            </button>
            <button class="btn btn-danger flex-1" @click="endCall"><Icon name="phone-off" :size="16" />Hang up</button>
          </template>
        </div>
      </div>
    </Transition>`,
  setup() {
    const now = ref(Date.now());
    let t = setInterval(() => { now.value = Date.now(); }, 1000);
    onUnmounted(() => clearInterval(t));
    const status = computed(() => {
      if (call.state === 'ringing') return 'Incoming voice call';
      if (call.state === 'calling') return 'Calling…';
      if (call.state === 'connecting') return 'Connecting…';
      const s = Math.floor((now.value - (call.startedAt || now.value)) / 1000);
      return `On call ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}${call.relayed ? ' (via relay)' : ''}`;
    });
    return { call, status, acceptCall, declineCall, endCall, toggleMuteCall, enableSound };
  },
};
