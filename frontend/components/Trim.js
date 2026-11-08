import { reactive, computed } from 'vue';
import Icon from './Icon.js';
import { api } from '../lib/api.js';
import { toast, attempt } from '../lib/ui.js';

const fmtTime = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const ss = sec.toFixed(1).replace(/\.0$/, '');
  const pad = (x) => (Number(x) < 10 ? '0' + x : x);
  return h ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
};
// "90", "1:30", "1:02:03.5" → seconds
const parseTime = (v) => {
  const parts = String(v ?? '').trim().split(':').map(Number);
  if (!parts.length || parts.some(n => !isFinite(n) || n < 0)) return NaN;
  return parts.reduce((a, n) => a * 60 + n, 0);
};

/**
 * Trim controls for a video or a song: start/end (typed or from playback),
 * preview, fast or exact cut, replace or save as new. The work runs on the server
 * (POST /api/downloads/trim). The parent supplies how to read the playback time
 * and how to preview a range, since videos and songs play in different places.
 */
export default {
  components: { Icon },
  props: {
    item: { type: Object, required: true },          // { id, duration?, title? }
    kind: { type: String, default: 'video' },         // 'video' | 'audio'
    getTime: { type: Function, default: () => null }, // current playback position of this item, or null
    preview: { type: Function, default: null },       // (start, end) => void
  },
  emits: ['close', 'started'],
  template: /*html*/`
    <div class="rounded-xl border border-line p-3.5 space-y-3">
      <div class="flex items-center gap-2"><p class="font-medium text-[13.5px] flex-1">Trim</p><button class="icon-btn icon-btn-sm" @click="$emit('close')" title="Close"><Icon name="x" :size="14" /></button></div>
      <div class="grid grid-cols-2 gap-2">
        <div v-for="side in ['start', 'end']" :key="side">
          <label class="label !mb-1" :for="'trim-' + side">{{ side === 'start' ? 'Start' : 'End' }}</label>
          <input :id="'trim-' + side" v-model="t[side]" class="input h-9 tabular-nums" :placeholder="side === 'start' ? '0:00' : '1:23'" inputmode="decimal">
          <button class="text-[11.5px] text-accent hover:underline mt-1 disabled:text-faint disabled:no-underline" :disabled="getTime() === null" @click="t[side] = fmtTime(getTime())"
                  :title="getTime() === null ? 'Play it first' : ''">Use current time</button>
        </div>
      </div>
      <p class="text-[12px]" :class="error ? 'text-danger' : 'text-muted'">{{ error || 'Keeps ' + fmtTime(range.end - range.start) + (range.total ? ' of ' + fmtTime(range.total) : '') + '.' }}</p>
      <button v-if="preview" class="btn btn-sm w-full" :disabled="!!error" @click="preview(range.start, range.end)"><Icon name="play" :size="13" />Preview the cut</button>
      <label class="flex items-start gap-2 text-[12.5px] cursor-pointer"><input type="checkbox" class="checkbox mt-0.5" v-model="t.exact">
        <span>Exact cut <span class="text-muted">{{ kind === 'audio'
          ? '(re-encodes to AAC: exact to the millisecond). Otherwise the cut is instant and lossless, within a fraction of a second.'
          : '(re-encodes: slower, frame-accurate). Otherwise the cut is instant and lossless but may start up to a few seconds early.' }}</span></span></label>
      <div class="seg w-full" role="radiogroup" aria-label="Save as">
        <button class="flex-1" :class="{ on: !t.copy }" @click="t.copy = false" role="radio" :aria-checked="!t.copy">Replace</button>
        <button class="flex-1" :class="{ on: t.copy }" @click="t.copy = true" role="radio" :aria-checked="t.copy">Save as new</button>
      </div>
      <p class="text-[11.5px] text-muted">{{ t.copy
        ? 'A new ' + noun + ' with the same details' + (kind === 'audio' ? ', artwork and playlists.' : ' and collections.')
        : 'The ' + noun + ' keeps its details, ' + (kind === 'audio' ? 'artwork and playlists' : 'cover and collections') + '. The cut-off parts are gone for good.' }}</p>
      <button class="btn btn-primary btn-sm w-full" :disabled="!!error || t.busy" @click="start"><Icon :name="t.busy ? 'loader' : 'check'" :size="14" />{{ t.copy ? 'Save trimmed copy' : 'Trim ' + noun }}</button>
    </div>`,
  setup(props, { emit }) {
    const noun = props.kind === 'audio' ? 'song' : 'video';
    const t = reactive({ start: '0:00', end: fmtTime(props.item.duration || 0), exact: false, copy: false, busy: false });
    const range = computed(() => ({ start: parseTime(t.start), end: parseTime(t.end), total: props.item.duration || 0 }));
    const error = computed(() => {
      const { start, end, total } = range.value;
      if (!isFinite(start) || !isFinite(end)) return 'Write times like 1:30 or 90.';
      if (end <= start + 0.2) return 'The end must come after the start.';
      if (total && start >= total) return `The start is past the end of the ${noun}.`;
      if (total && start <= 0.05 && end >= total - 0.05) return 'Move the start or the end to cut something.';
      return '';
    });
    async function start() {
      const { start: s, end, total } = range.value;
      t.busy = true;
      const r = await attempt(() => api('/api/downloads/trim', { method: 'POST', body: { file_id: props.item.id, start: s, end: total ? Math.min(end, total) : end, exact: t.exact, copy: t.copy } }));
      t.busy = false;
      if (!r) return;
      toast.success(t.copy ? `Trimming into a new ${noun}. It appears when it’s done.` : `Trimming. The ${noun} updates when it’s done; you can close this.`);
      emit('started', r.id);
    }
    return { t, noun, range, error, start, fmtTime };
  },
};
