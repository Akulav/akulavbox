import { reactive } from 'vue';
import { fileUrl, storage } from './api.js';
import { saveMeta } from './library.js';

// One audio element for the whole app, so music keeps playing while you browse other sections.
const audio = new Audio();
audio.preload = 'metadata';

const savedVolume = parseFloat(storage.read('akulavVolume'));

export const player = reactive({
  queue: [],          // array of song records
  order: [],          // play order (indices into queue); shuffled when shuffle is on
  pos: -1,            // position in `order`
  source: '',         // e.g. playlist name
  playing: false,
  loading: false,
  time: 0,
  duration: 0,
  volume: isNaN(savedVolume) ? 1 : savedVolume,
  muted: false,
  shuffle: storage.read('akulavShuffle') === '1',
  repeat: storage.read('akulavRepeat') || 'off', // 'off' | 'all' | 'one'
  get current() { return this.pos >= 0 ? this.queue[this.order[this.pos]] : null; },
});

audio.volume = player.volume;

export const songTitle = (s) => (s && s.title) || (s?.filename || '').replace(/\.[^/.]+$/, '');

function buildOrder(startIndex) {
  const idx = player.queue.map((_, i) => i);
  if (!player.shuffle) { player.order = idx; player.pos = startIndex; return; }
  const rest = idx.filter(i => i !== startIndex);
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  player.order = [startIndex, ...rest];
  player.pos = 0;
}

function load() {
  const song = player.current;
  if (!song) return;
  player.loading = true;
  player.time = 0; player.duration = 0;
  audio.src = fileUrl(song.id);
  audio.play().catch(() => { player.playing = false; });
  updateMediaSession();
}

export function playQueue(songs, index = 0, source = '') {
  if (!songs.length) return;
  player.queue = songs.slice();
  player.source = source;
  buildOrder(index);
  load();
}

export function toggle() {
  if (!player.current) return;
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}

export function next(auto = false) {
  if (!player.current) return;
  if (auto && player.repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
  if (player.pos < player.order.length - 1) { player.pos++; load(); }
  else if (player.repeat === 'all' || !auto) {
    if (player.shuffle) buildOrder(player.order[0]); // reshuffle for the next round
    player.pos = 0; load();
  } else { audio.pause(); audio.currentTime = 0; }
}

export function prev() {
  if (!player.current) return;
  if (audio.currentTime > 3 || player.pos === 0) { audio.currentTime = 0; return; }
  player.pos--; load();
}

export function seek(t) { if (isFinite(t)) audio.currentTime = t; }

export function setVolume(v) {
  player.volume = Math.max(0, Math.min(1, v));
  audio.volume = player.volume;
  player.muted = false; audio.muted = false;
  storage.write('akulavVolume', String(player.volume));
}

export function toggleMute() { player.muted = !player.muted; audio.muted = player.muted; }

export function toggleShuffle() {
  player.shuffle = !player.shuffle;
  storage.write('akulavShuffle', player.shuffle ? '1' : '0');
  if (player.current) { const cur = player.order[player.pos]; buildOrder(cur); }
}

export function cycleRepeat() {
  player.repeat = player.repeat === 'off' ? 'all' : player.repeat === 'all' ? 'one' : 'off';
  storage.write('akulavRepeat', player.repeat);
}

export function stop() {
  audio.pause(); audio.removeAttribute('src'); audio.load();
  player.queue = []; player.order = []; player.pos = -1; player.playing = false;
}

/** Remove a deleted song from the queue without interrupting playback of others */
export function forget(fileId) {
  if (player.current && player.current.id === fileId) { stop(); return; }
  const qi = player.queue.findIndex(s => s.id === fileId);
  if (qi === -1) return;
  const curQ = player.order[player.pos];
  player.queue.splice(qi, 1);
  player.order = player.order.filter(i => i !== qi).map(i => (i > qi ? i - 1 : i));
  player.pos = player.order.indexOf(curQ > qi ? curQ - 1 : curQ);
}

audio.addEventListener('play', () => { player.playing = true; });
audio.addEventListener('pause', () => { player.playing = false; });
audio.addEventListener('playing', () => { player.loading = false; });
audio.addEventListener('waiting', () => { player.loading = true; });
audio.addEventListener('timeupdate', () => { player.time = audio.currentTime; });
audio.addEventListener('loadedmetadata', () => {
  player.duration = audio.duration; player.loading = false;
  // remember the length so the library can sort by it
  const cur = player.current;
  if (cur && !cur.duration && isFinite(audio.duration) && audio.duration > 0) {
    cur.duration = audio.duration;
    saveMeta(cur.id, { duration: audio.duration }).catch(() => {});
  }
});
audio.addEventListener('ended', () => next(true));
audio.addEventListener('error', () => { player.loading = false; player.playing = false; });

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !player.current) return;
  const s = player.current;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: songTitle(s),
      artist: (s.participants || []).join(', '),
      album: s.series || player.source || 'AkulavBox',
      artwork: s.cover_file_id ? [{ src: location.origin + fileUrl(s.cover_file_id), sizes: '512x512' }] : [],
    });
  } catch (e) { /* ignore */ }
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  try {
    ms.setActionHandler('play', () => audio.play());
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('previoustrack', prev);
    ms.setActionHandler('nexttrack', () => next(false));
    ms.setActionHandler('seekto', (d) => seek(d.seekTime));
  } catch (e) { /* ignore */ }
}

export const formatTime = (sec) => {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};
