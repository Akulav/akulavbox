import { ref, reactive, computed, watch, onMounted, onUnmounted, markRaw, nextTick } from 'vue';
import Icon from './Icon.js';
import { fileUrl, sharedUrl, formatBytes, formatDate, copyText, downloadUrl, storage } from '../lib/api.js';
import { kindOf, kindLabel, iconFor, tintFor, languageFor, isTextual, extOf } from '../lib/filetypes.js';
import { toast, confirmDialog } from '../lib/ui.js';
import { api } from '../lib/api.js';
import { lib, sanitize } from '../lib/cdn.js';
import { thumbUrl, displayTitle, formatDuration } from '../lib/library.js';
import EpubReader from './EpubReader.js';

const TEXT_LIMIT = 3 * 1024 * 1024;      // show at most the first 3 MB of a text file
const HIGHLIGHT_LIMIT = 400 * 1024;      // syntax highlighting gets slow above this
const BINARY_LIMIT = 80 * 1024 * 1024;   // docx / xlsx / zip parsing in the browser
const ROW_LIMIT = 2000;

function parseDelimited(text, delimiter) {
  if (!delimiter) {
    const first = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
    const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
    for (const ch of first) if (ch in counts) counts[ch]++;
    delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
  const rows = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
      if (rows.length > ROW_LIMIT) break;
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const looksBinary = (bytes) => {
  let odd = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0) return true;
    if (b < 7 || (b > 14 && b < 32 && b !== 27)) odd++;
  }
  return bytes.length > 0 && odd / bytes.length > 0.1;
};

export default {
  name: 'FileViewer',
  components: { Icon, EpubReader },
  props: {
    files: { type: Array, required: true },
    startIndex: { type: Number, default: 0 },
    startEditing: { type: Boolean, default: false },
    infoOpen: { type: Boolean, default: undefined },
    autoplayNext: { type: Boolean, default: false }, // collections: go on to the next video when one ends
  },
  emits: ['close', 'changed'],
  template: /*html*/`
    <Teleport to="body">
      <div ref="rootEl" class="fixed inset-0 z-[220] bg-bg flex flex-col" role="dialog" aria-modal="true" :aria-label="file ? file.filename : 'Preview'">

        <!-- Top bar -->
        <header class="h-14 shrink-0 flex items-center gap-2 px-2 sm:px-3 border-b border-line bg-surface">
          <button class="icon-btn" @click="requestClose" title="Close (Esc)"><Icon name="x" :size="19" /></button>
          <span class="w-8 h-8 rounded-lg grid place-items-center shrink-0 ml-1" :style="{ background: tint + '22', color: tint }"><Icon :name="iconFor(kind)" :size="17" /></span>
          <div class="min-w-0 flex-1 ml-1">
            <p class="font-medium truncate text-[14px] leading-tight">{{ file.filename }}</p>
            <p class="text-xs text-muted truncate">{{ kindLabel(kind) }} <span class="text-faint">/</span> {{ formatBytes(file.size_bytes) }}<span v-if="files.length > 1" class="hidden sm:inline"> <span class="text-faint">/</span> {{ index + 1 }} of {{ files.length }}</span></p>
          </div>

          <!-- Editing tools -->
          <div v-if="editing" class="flex items-center gap-1">
            <span v-if="kind === 'json'" class="hidden sm:inline-flex chip mr-1" :class="jsonError ? '!text-danger' : 'chip-ok'" :title="jsonError || ''">{{ jsonError ? 'Invalid JSON' : 'Valid JSON' }}</span>
            <button v-if="kind === 'json'" class="btn btn-ghost btn-sm" @click="formatJson" :disabled="!!jsonError" title="Pretty-print with 2-space indents"><Icon name="code" :size="15" /><span class="hidden sm:inline">Format</span></button>
            <button class="icon-btn hidden sm:inline-flex" :class="{ active: wrap }" @click="wrap = !wrap" title="Wrap lines"><Icon name="wrap-text" :size="18" /></button>
            <button class="btn btn-sm" @click="cancelEdit">Cancel</button>
            <button class="btn btn-primary btn-sm" @click="save" :disabled="!dirty || saving" title="Save (Ctrl+S)">
              <Icon :name="saving ? 'loader' : 'check'" :size="15" />{{ saving ? 'Saving…' : 'Save' }}
            </button>
          </div>

          <!-- Contextual tools -->
          <div v-else class="flex items-center gap-1">
            <template v-if="isImageView">
              <button class="icon-btn hidden sm:inline-flex" @click="zoomBy(-0.25)" title="Zoom out (−)"><Icon name="zoom-out" :size="18" /></button>
              <button class="btn btn-ghost btn-sm hidden sm:inline-flex tabular-nums w-14" @click="resetZoom" title="Fit to screen">{{ Math.round(zoom.scale * 100) }}%</button>
              <button class="icon-btn hidden sm:inline-flex" @click="zoomBy(0.25)" title="Zoom in (+)"><Icon name="zoom-in" :size="18" /></button>
              <button class="icon-btn" @click="zoom.rotate = (zoom.rotate + 90) % 360" title="Rotate"><Icon name="rotate" :size="17" /></button>
              <button v-if="imageCount > 1" class="icon-btn" :class="{ active: slideshow }" @click="toggleSlideshow" :title="slideshow ? 'Pause slideshow (Space)' : 'Slideshow (Space)'"><Icon :name="slideshow ? 'pause' : 'play'" :size="15" /></button>
            </template>
            <button class="icon-btn hidden sm:inline-flex" @click="toggleFullscreen" title="Full screen (F)"><Icon name="maximize" :size="17" /></button>
            <div v-if="modes.length > 1" class="seg mr-1">
              <button v-for="m in modes" :key="m.id" :class="{ on: mode === m.id }" @click="mode = m.id">{{ m.label }}</button>
            </div>
            <button v-if="showsCode" class="icon-btn hidden sm:inline-flex" :class="{ active: wrap }" @click="wrap = !wrap" title="Wrap lines"><Icon name="wrap-text" :size="18" /></button>
            <button v-if="canEdit" class="btn btn-sm mr-1" @click="startEdit" title="Edit this file"><Icon name="pencil" :size="15" /><span class="hidden sm:inline">Edit</span></button>
            <button v-if="state.text != null" class="icon-btn" @click="copyContents" title="Copy contents"><Icon name="copy" :size="17" /></button>
            <a class="icon-btn hidden sm:inline-flex" :href="url" target="_blank" rel="noopener" title="Open in new tab"><Icon name="external" :size="17" /></a>
            <button class="icon-btn" :class="{ active: showInfo }" @click="showInfo = !showInfo" title="Details (I)"><Icon name="info" :size="18" /></button>
            <button class="btn btn-sm ml-1" @click="download"><Icon name="download" :size="15" /><span class="hidden sm:inline">Download</span></button>
          </div>
        </header>

        <div class="flex-1 flex min-h-0">
          <!-- Stage -->
          <div class="flex-1 relative min-w-0 overflow-hidden" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">

            <!-- Editor -->
            <div v-if="editing" class="absolute inset-0 flex flex-col">
              <textarea ref="editorEl" v-model="draft" spellcheck="false" autocapitalize="off" autocomplete="off" :wrap="wrap ? 'soft' : 'off'"
                        class="code-view flex-1 w-full resize-none bg-bg text-fg p-4 outline-none border-0" :class="wrap ? '' : 'whitespace-pre overflow-auto'"
                        @keydown="onEditorKey" aria-label="File contents"></textarea>
              <div class="shrink-0 h-8 flex items-center gap-4 px-4 border-t border-line bg-surface text-xs text-muted">
                <span :class="dirty ? 'text-accent' : ''">{{ dirty ? 'Unsaved changes' : 'No changes' }}</span>
                <span class="tabular-nums">{{ draftLines.toLocaleString() }} lines, {{ formatBytes(draftBytes) }}</span>
                <span v-if="jsonError" class="text-danger truncate">{{ jsonError }}</span>
                <span v-if="!file.is_encrypted" class="ml-auto hidden sm:flex items-center gap-1.5"><Icon name="globe" :size="13" class="text-accent" />Shared link stays the same after saving</span>
              </div>
            </div>

            <!-- Loading / error -->
            <div v-else-if="state.status === 'loading'" class="absolute inset-0 grid place-items-center text-muted">
              <div class="flex flex-col items-center gap-3"><Icon name="loader" :size="26" /><span class="text-[13px]">{{ state.message || 'Opening…' }}</span></div>
            </div>
            <div v-else-if="state.status === 'error' || state.status === 'none'" class="absolute inset-0 grid place-items-center p-6">
              <div class="text-center max-w-sm">
                <span class="w-16 h-16 rounded-2xl mx-auto grid place-items-center mb-4" :style="{ background: tint + '22', color: tint }"><Icon :name="iconFor(kind)" :size="30" /></span>
                <p class="title text-lg mb-1">{{ state.status === 'error' ? 'This file couldn’t be previewed' : 'No preview for this file type' }}</p>
                <p class="text-muted text-[13.5px] mb-5">{{ state.message || 'Download it to open it with an app on your device.' }}</p>
                <div class="flex justify-center gap-2 flex-wrap">
                  <button class="btn btn-primary" @click="download"><Icon name="download" :size="16" />Download</button>
                  <button v-if="state.canForceText" class="btn" @click="load(true)"><Icon name="file-text" :size="16" />Open as text</button>
                </div>
              </div>
            </div>

            <!-- IMAGE -->
            <div v-else-if="isImageView" class="absolute inset-0 select-none" :class="zoom.scale > 1 ? (drag.active ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'"
                 @wheel.prevent="onWheel" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp" @dblclick="toggleZoom"
                 style="background-image: radial-gradient(rgb(var(--line)) 1px, transparent 1px); background-size: 22px 22px;">
              <img v-if="!state.imgLoaded && !isShared" :src="thumbUrl(file.id, 480) + '&cached=1'" alt="" aria-hidden="true" draggable="false"
                   class="absolute inset-0 m-auto max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] object-contain blur-[1px]"
                   :style="{ transform: 'rotate(' + zoom.rotate + 'deg)' }" @error="$event.target.style.display = 'none'">
              <img ref="imgEl" :src="url" :alt="file.filename" draggable="false" @load="onImgLoad" @error="fail('The image could not be decoded by your browser.')"
                   class="absolute inset-0 m-auto max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] object-contain will-change-transform"
                   :class="[drag.active ? '' : 'transition-transform duration-150', state.imgLoaded ? '' : 'opacity-0']"
                   :style="{ transform: 'translate(' + zoom.x + 'px,' + zoom.y + 'px) scale(' + zoom.scale + ') rotate(' + zoom.rotate + 'deg)' }">
              <div v-if="!state.imgLoaded" class="absolute bottom-4 left-1/2 -translate-x-1/2 chip pointer-events-none"><Icon name="loader" :size="13" />Loading full image</div>
            </div>

            <!-- VIDEO -->
            <div v-else-if="kind === 'video'" class="absolute inset-0 bg-black grid place-items-center">
              <!-- fills the stage and letterboxes: a grid cell has no definite height, so max-h-full let tall (phone) videos overflow it -->
              <video ref="videoEl" :key="file.id" :src="url" controls autoplay playsinline class="absolute inset-0 w-full h-full object-contain"
                     @loadedmetadata="onVideoMeta" @timeupdate="onVideoTime" @ended="onMediaEnded" @error="fail('Your browser can’t play this video format. Download it to watch with a media player.')"></video>
              <span v-if="autoplayNext && index < files.length - 1" class="absolute top-3 left-1/2 -translate-x-1/2 chip !bg-black/60 !text-white backdrop-blur pointer-events-none">Up next: {{ displayTitle(files[index + 1]) }}</span>
            </div>

            <!-- AUDIO -->
            <div v-else-if="kind === 'audio'" class="absolute inset-0 grid place-items-center p-6">
              <div class="w-full max-w-md text-center">
                <span class="w-40 h-40 rounded-3xl mx-auto mb-6 grid place-items-center" :style="{ background: tint + '1f', color: tint }"><Icon name="music" :size="64" :stroke="1.25" /></span>
                <p class="title text-xl mb-1 break-words">{{ displayTitle(file) }}</p>
                <p v-if="file.participants && file.participants.length" class="text-muted mb-5">{{ file.participants.join(', ') }}</p>
                <div v-else class="mb-5"></div>
                <audio :key="file.id" :src="url" controls autoplay class="w-full" @error="fail('Your browser can’t play this audio format.')"></audio>
              </div>
            </div>

            <!-- EPUB -->
            <EpubReader v-else-if="kind === 'epub'" ref="epubRef" :key="file.id" :src="url" :file-id="isShared ? null : file.id" :progress="file.progress" @progress="p => (file.progress = p)" />

            <!-- PDF -->
            <iframe v-else-if="kind === 'pdf'" :key="file.id" :src="url" class="absolute inset-0 w-full h-full bg-white" title="PDF preview"></iframe>

            <!-- HTML rendered (sandboxed: no scripts, no access to this site) -->
            <iframe v-else-if="mode === 'preview' && kind === 'html'" sandbox="" :srcdoc="state.text" class="absolute inset-0 w-full h-full bg-white" title="HTML preview"></iframe>

            <!-- Markdown rendered / Word document -->
            <div v-else-if="state.html != null && (mode === 'rendered' || kind === 'docx')" class="absolute inset-0 overflow-auto">
              <div v-if="kind === 'docx'" class="py-8 px-3 sm:px-8"><div class="paper"><div class="doc" v-html="state.html"></div></div></div>
              <div v-else class="py-10 px-5 sm:px-10"><article class="doc" v-html="state.html"></article></div>
            </div>

            <!-- Tables: CSV & spreadsheets -->
            <div v-else-if="state.table && mode !== 'source'" class="absolute inset-0 flex flex-col">
              <div v-if="state.sheets && state.sheets.length > 1" class="shrink-0 flex gap-1 px-3 py-2 border-b border-line overflow-x-auto no-scrollbar">
                <button v-for="(s, i) in state.sheets" :key="s" class="btn btn-sm" :class="i === state.sheetIndex ? 'btn-primary' : 'btn-ghost'" @click="showSheet(i)">{{ s }}</button>
              </div>
              <div class="flex-1 overflow-auto">
                <table class="data-table">
                  <thead v-if="state.table.length"><tr><th class="rownum"></th><th v-for="(h, i) in state.table[0]" :key="i" :title="h">{{ h }}</th></tr></thead>
                  <tbody>
                    <tr v-for="(r, ri) in state.table.slice(1)" :key="ri">
                      <td class="rownum">{{ ri + 2 }}</td>
                      <td v-for="(c, ci) in tableWidth" :key="ci" :title="r[ci]">{{ r[ci] }}</td>
                    </tr>
                  </tbody>
                </table>
                <p v-if="state.tableTruncated" class="text-muted text-xs px-4 py-3">Showing the first {{ ROW_LIMIT.toLocaleString() }} rows. Download the file to see everything.</p>
              </div>
            </div>

            <!-- Zip contents -->
            <div v-else-if="state.entries" class="absolute inset-0 overflow-auto">
              <div class="max-w-3xl mx-auto p-4 sm:p-8">
                <p class="text-muted text-[13px] mb-3">{{ state.entries.filter(e => !e.dir).length }} files inside. Select a text file or image to look inside it.</p>
                <ul class="panel divide-y divide-line overflow-hidden">
                  <li v-for="e in state.entries" :key="e.name">
                    <button class="w-full flex items-center gap-3 px-4 py-2 text-left row-hover disabled:cursor-default" :disabled="e.dir" @click="openEntry(e)">
                      <span :style="{ paddingLeft: (e.depth * 16) + 'px' }" class="flex items-center gap-2.5 min-w-0 flex-1">
                        <Icon :name="e.dir ? 'folder' : iconFor(e.kind)" :size="16" :class="e.dir ? 'text-accent' : 'text-muted'" />
                        <span class="truncate text-[13.5px]">{{ e.base }}</span>
                      </span>
                      <span v-if="!e.dir" class="text-faint text-xs tabular-nums">{{ formatBytes(e.size) }}</span>
                    </button>
                  </li>
                </ul>
              </div>
              <!-- entry preview -->
              <div v-if="entry" class="fixed inset-0 z-10 bg-black/60 grid place-items-center p-4" @click.self="closeEntry">
                <div class="panel w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
                  <div class="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-line">
                    <span class="truncate flex-1 font-medium text-[13.5px]">{{ entry.name }}</span>
                    <button class="icon-btn icon-btn-sm" @click="closeEntry"><Icon name="x" :size="16" /></button>
                  </div>
                  <div class="flex-1 overflow-auto">
                    <img v-if="entry.blobUrl" :src="entry.blobUrl" class="max-w-full mx-auto p-4">
                    <pre v-else class="code-view p-4 whitespace-pre-wrap break-words">{{ entry.text }}</pre>
                  </div>
                </div>
              </div>
            </div>

            <!-- Text / code -->
            <div v-else-if="state.text != null" class="absolute inset-0 overflow-auto">
              <div class="flex" :class="wrap ? '' : 'min-w-fit'">
                <pre v-if="!wrap" aria-hidden="true" class="code-view sticky left-0 select-none text-right text-faint pl-4 pr-3 py-4 bg-bg border-r border-line">{{ gutter }}</pre>
                <pre class="code-view flex-1 px-4 py-4" :class="wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'"><code v-if="state.highlighted" v-html="state.highlighted"></code><code v-else>{{ state.text }}</code></pre>
              </div>
              <p v-if="state.truncated" class="sticky bottom-0 text-xs text-muted bg-surface border-t border-line px-4 py-2">Showing the first {{ formatBytes(TEXT_LIMIT) }} of {{ formatBytes(file.size_bytes) }}. Download the file to see the rest.</p>
            </div>

            <!-- Prev / next -->
            <template v-if="files.length > 1">
              <button v-if="index > 0" class="hidden sm:grid absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-surface/90 border border-line place-items-center text-muted hover:text-fg shadow-lg z-10" @click="go(-1)" title="Previous (←)"><Icon name="chevron-left" :size="20" /></button>
              <button v-if="index < files.length - 1" class="hidden sm:grid absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-surface/90 border border-line place-items-center text-muted hover:text-fg shadow-lg z-10" @click="go(1)" title="Next (→)"><Icon name="chevron-right" :size="20" /></button>
            </template>
          </div>

          <!-- Details panel -->
          <aside v-if="showInfo" class="absolute md:static inset-x-0 bottom-0 top-14 md:top-auto z-30 md:z-auto md:w-[320px] shrink-0 border-l border-line bg-surface overflow-y-auto">
            <slot name="details" :file="file" :index="index"></slot>
            <div class="p-5 space-y-5">
              <div>
                <p class="label">Name</p>
                <p class="break-words text-[13.5px]">{{ file.filename }}</p>
              </div>
              <dl class="grid grid-cols-[90px_1fr] gap-y-3 text-[13px]">
                <dt class="text-muted">Type</dt><dd>{{ kindLabel(kind) }}<span v-if="ext" class="text-faint"> (.{{ ext }})</span></dd>
                <dt class="text-muted">Size</dt><dd class="tabular-nums">{{ formatBytes(file.size_bytes) }}</dd>
                <dt class="text-muted">Uploaded</dt><dd>{{ formatDate(file.created_at) }}</dd>
                <dt v-if="dims" class="text-muted">Dimensions</dt><dd v-if="dims" class="tabular-nums">{{ dims }}</dd>
                <dt v-if="state.text != null" class="text-muted">Lines</dt><dd v-if="state.text != null" class="tabular-nums">{{ lineCount.toLocaleString() }}</dd>
                <dt class="text-muted">MIME</dt><dd class="break-all text-muted">{{ file.mime_type || 'unknown' }}</dd>
              </dl>
              <div class="pt-4 border-t border-line">
                <p class="label">Access</p>
                <p v-if="file.is_encrypted" class="flex items-center gap-2 text-[13px]"><Icon name="lock" :size="15" class="text-ok" />Private, encrypted at rest</p>
                <template v-else>
                  <p class="flex items-center gap-2 text-[13px] mb-3"><Icon name="globe" :size="15" class="text-accent" />Anyone with the link can open it</p>
                  <button class="btn btn-sm w-full" @click="copyLink"><Icon name="link" :size="14" />Copy public link</button>
                </template>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </Teleport>
  `,
  setup(props, { emit }) {
    const index = ref(Math.min(Math.max(0, props.startIndex), props.files.length - 1));
    const file = computed(() => props.files[index.value] || {});
    const kind = computed(() => state.forcedKind || kindOf(file.value));
    const ext = computed(() => extOf(file.value.filename || ''));
    const tint = computed(() => tintFor(kind.value));
    const url = computed(() => (!file.value.is_encrypted && file.value.public_hash) ? `/shared/${file.value.public_hash}` : fileUrl(file.value.id));
    const showInfo = ref(props.infoOpen !== undefined ? (props.infoOpen && window.innerWidth >= 768) : window.innerWidth >= 1280);
    const isShared = computed(() => !file.value.is_encrypted && !!file.value.public_hash);
    const epubRef = ref(null);
    const wrap = ref(false);
    const mode = ref('source');
    const entry = ref(null);
    const dims = ref('');

    const state = reactive({});
    const resetState = () => {
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, { status: 'loading', message: '', text: null, raw: null, highlighted: null, html: null, table: null, sheets: null, sheetIndex: 0,
        workbook: null, entries: null, truncated: false, tableTruncated: false, imgLoaded: false, canForceText: false, forcedKind: null });
    };
    resetState();

    const isImageView = computed(() => (kind.value === 'image' || kind.value === 'svg') && state.status === 'ready');
    const modes = computed(() => {
      if (state.status !== 'ready') return [];
      if (kind.value === 'markdown') return [{ id: 'rendered', label: 'Preview' }, { id: 'source', label: 'Source' }];
      if (kind.value === 'html') return [{ id: 'source', label: 'Source' }, { id: 'preview', label: 'Preview' }];
      if (kind.value === 'csv' && state.table) return [{ id: 'table', label: 'Table' }, { id: 'source', label: 'Raw' }];
      return [];
    });
    const showsCode = computed(() => state.text != null && (mode.value === 'source' || !modes.value.length) && !(state.table && mode.value !== 'source'));
    const lineCount = computed(() => state.text == null ? 0 : (state.text.match(/\n/g) || []).length + 1);
    const gutter = computed(() => Array.from({ length: lineCount.value }, (_, i) => i + 1).join('\n'));
    const tableWidth = computed(() => state.table ? Math.max(...state.table.slice(0, 200).map(r => r.length), 0) : 0);

    const fail = (message) => { state.status = 'error'; state.message = message; };

    let token = 0; // guards against a slow load finishing after the user moved on

    async function fetchRange(limit) {
      const res = await fetch(url.value, { headers: { Range: `bytes=0-${limit - 1}` } });
      if (!res.ok) throw new Error(res.status === 404 ? 'The file is missing on the server.' : `Server responded ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    }
    async function fetchAll() {
      const res = await fetch(url.value);
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      return await res.arrayBuffer();
    }

    async function loadText(my) {
      const bytes = await fetchRange(TEXT_LIMIT);
      if (my !== token) return;
      state.truncated = file.value.size_bytes > TEXT_LIMIT;
      let text = new TextDecoder('utf-8').decode(bytes);
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      state.raw = text; // exact contents, used by the editor (the preview may be pretty-printed)
      const k = kind.value;

      if (k === 'json' && !state.truncated) {
        try { text = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* show as-is */ }
      }
      state.text = text;

      if (k === 'markdown') {
        const marked = await lib('marked');
        if (my !== token) return;
        state.html = await sanitize(marked.parse(text, { gfm: true, breaks: false }));
        mode.value = 'rendered';
      } else if (k === 'csv') {
        const rows = parseDelimited(text, ext.value === 'tsv' ? '\t' : null);
        state.tableTruncated = rows.length > ROW_LIMIT || state.truncated;
        state.table = rows.slice(0, ROW_LIMIT + 1);
        mode.value = 'table';
      } else {
        mode.value = 'source';
      }
      state.status = 'ready';

      // Syntax highlighting happens after first paint
      const lang = languageFor(file.value.filename) || (k === 'json' ? 'json' : k === 'html' ? 'xml' : null);
      if (lang && text.length <= HIGHLIGHT_LIMIT) {
        try {
          const hljs = await lib('hljs');
          if (my !== token) return;
          if (hljs.getLanguage(lang)) state.highlighted = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
        } catch (e) { /* plain text is fine */ }
      }
    }

    async function load(forceText = false) {
      const my = ++token;
      resetState();
      entry.value = null; dims.value = '';
      resetZoom();
      const k = kindOf(file.value);
      if (forceText) state.forcedKind = 'text';
      try {
        if (forceText || isTextual(k)) {
          await loadText(my);
        } else if (['image', 'svg', 'video', 'audio', 'pdf', 'epub'].includes(k)) {
          state.status = 'ready';
        } else if (k === 'docx') {
          if (file.value.size_bytes > BINARY_LIMIT) return fail('This document is too large to preview in the browser.');
          state.message = 'Rendering document…';
          const [buf, mammoth] = await Promise.all([fetchAll(), lib('mammoth')]);
          if (my !== token) return;
          const result = await mammoth.convertToHtml({ arrayBuffer: buf });
          state.html = await sanitize(result.value || '<p><em>This document is empty.</em></p>');
          state.status = 'ready';
        } else if (k === 'sheet') {
          if (file.value.size_bytes > BINARY_LIMIT) return fail('This spreadsheet is too large to preview in the browser.');
          state.message = 'Reading spreadsheet…';
          const [buf, XLSX] = await Promise.all([fetchAll(), lib('XLSX')]);
          if (my !== token) return;
          state.workbook = markRaw(XLSX.read(buf, { type: 'array', cellDates: true, sheetRows: ROW_LIMIT + 1 }));
          state.sheets = state.workbook.SheetNames;
          showSheet(0);
          mode.value = 'table';
          state.status = 'ready';
        } else if (k === 'zip') {
          if (file.value.size_bytes > BINARY_LIMIT * 2) return fail('This archive is too large to look inside from the browser.');
          state.message = 'Reading archive…';
          const [buf, JSZip] = await Promise.all([fetchAll(), lib('JSZip')]);
          if (my !== token) return;
          const zip = await JSZip.loadAsync(buf);
          state.zip = markRaw(zip);
          const entries = [];
          const seenDirs = new Set();
          zip.forEach((path, obj) => {
            const parts = path.replace(/\/$/, '').split('/');
            // make sure parent folders exist as rows even if the zip doesn't list them
            for (let i = 1; i < parts.length; i++) {
              const dir = parts.slice(0, i).join('/') + '/';
              if (!seenDirs.has(dir)) { seenDirs.add(dir); entries.push({ name: dir, base: parts[i - 1], dir: true, depth: i - 1, size: 0 }); }
            }
            if (obj.dir) { if (!seenDirs.has(path)) { seenDirs.add(path); entries.push({ name: path, base: parts[parts.length - 1], dir: true, depth: parts.length - 1, size: 0 }); } return; }
            entries.push({ name: path, base: parts[parts.length - 1], dir: false, depth: parts.length - 1,
              size: obj._data?.uncompressedSize || 0, kind: kindOf({ filename: path }) });
          });
          entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
          state.entries = entries;
          state.status = 'ready';
        } else if (k === 'archive') {
          state.status = 'none';
          state.message = 'Archives like this can’t be opened in the browser. Download it and extract it with an app such as 7-Zip.';
        } else {
          // Unknown type: peek at the first bytes and treat it as text if it looks like text
          const head = await fetchRange(8192);
          if (my !== token) return;
          if (head.length && !looksBinary(head)) { state.forcedKind = 'text'; await loadText(my); }
          else { state.status = 'none'; state.canForceText = true; }
        }
      } catch (e) {
        if (my === token) fail(e.message);
      }
    }

    function showSheet(i) {
      const XLSX = window.XLSX;
      state.sheetIndex = i;
      const ws = state.workbook.Sheets[state.sheets[i]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '', raw: false });
      state.tableTruncated = rows.length > ROW_LIMIT;
      state.table = rows.slice(0, ROW_LIMIT + 1);
      if (!state.table.length) state.table = [['(empty sheet)']];
    }

    async function openEntry(e) {
      if (e.dir) return;
      const obj = state.zip.file(e.name);
      if (!obj) return;
      if (e.kind === 'image') {
        const blob = await obj.async('blob');
        entry.value = { name: e.name, blobUrl: URL.createObjectURL(blob) };
      } else if (isTextual(e.kind) || e.kind === 'other') {
        if (e.size > TEXT_LIMIT) return toast('That file is too large to preview from inside the archive.');
        const bytes = await obj.async('uint8array');
        if (looksBinary(bytes.subarray(0, 4096))) return toast('That file isn’t text, so it can’t be previewed here.');
        entry.value = { name: e.name, text: new TextDecoder().decode(bytes) };
      } else {
        toast('Preview inside archives works for text files and images.');
      }
    }
    function closeEntry() { if (entry.value?.blobUrl) URL.revokeObjectURL(entry.value.blobUrl); entry.value = null; }

    // ---------- image zoom & pan ----------
    const zoom = reactive({ scale: 1, x: 0, y: 0, rotate: 0 });
    const drag = reactive({ active: false, sx: 0, sy: 0, ox: 0, oy: 0, moved: false });
    function resetZoom() { Object.assign(zoom, { scale: 1, x: 0, y: 0, rotate: 0 }); }
    function zoomBy(d) {
      zoom.scale = Math.min(8, Math.max(0.25, +(zoom.scale + d * zoom.scale).toFixed(3)));
      if (zoom.scale <= 1) { zoom.x = 0; zoom.y = 0; }
    }
    const onWheel = (e) => zoomBy(e.deltaY < 0 ? 0.15 : -0.15);
    const toggleZoom = () => { if (zoom.scale > 1) resetZoom(); else zoom.scale = 2.5; };
    const onPointerDown = (e) => {
      if (zoom.scale <= 1 || e.button !== 0) return;
      Object.assign(drag, { active: true, sx: e.clientX, sy: e.clientY, ox: zoom.x, oy: zoom.y });
      e.currentTarget.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e) => { if (drag.active) { zoom.x = drag.ox + e.clientX - drag.sx; zoom.y = drag.oy + e.clientY - drag.sy; } };
    const onPointerUp = () => { drag.active = false; };

    // swipe between files on touch screens
    let touch = null;
    const onTouchStart = (e) => { if (e.touches.length === 1 && zoom.scale <= 1) touch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; else touch = null; };
    const onTouchEnd = (e) => {
      if (!touch || !isImageView.value) return;
      const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
      else if (dy > 100 && dy > Math.abs(dx) * 1.5) requestClose();   // swipe down closes
      touch = null;
    };

    // capture image dimensions for the details panel
    const imgEl = ref(null);
    const onImgLoad = () => {
      state.imgLoaded = true;
      // warm up the next and previous photos so arrowing through an album is instant
      for (const d of [1, -1]) {
        const nf = props.files[index.value + d];
        if (nf && ['image', 'svg'].includes(kindOf(nf))) { const im = new Image(); im.decoding = 'async'; im.src = fileUrl(nf.id); }
      }
      const img = imgEl.value;
      if (img && img.naturalWidth) dims.value = `${img.naturalWidth} × ${img.naturalHeight}`;
    };

    // ---------- editing ----------
    const EDIT_LIMIT = TEXT_LIMIT;
    const editing = ref(false);
    const draft = ref('');
    const saving = ref(false);
    const editorEl = ref(null);
    const EDITABLE_KINDS = ['text', 'json', 'code', 'markdown', 'csv', 'html'];
    const canEdit = computed(() => state.status === 'ready' && state.raw != null && !state.truncated
      && EDITABLE_KINDS.includes(kind.value) && file.value.size_bytes <= EDIT_LIMIT);
    const dirty = computed(() => editing.value && draft.value !== state.raw);
    const draftBytes = computed(() => new TextEncoder().encode(draft.value).length);
    const draftLines = computed(() => (draft.value.match(/\n/g) || []).length + 1);
    const jsonError = computed(() => {
      if (!editing.value || kind.value !== 'json' || !draft.value.trim()) return '';
      try { JSON.parse(draft.value); return ''; } catch (e) { return e.message; }
    });

    async function startEdit() {
      if (!canEdit.value) return;
      draft.value = state.raw;
      editing.value = true;
      await nextTick();
      if (editorEl.value) { editorEl.value.focus(); editorEl.value.setSelectionRange(0, 0); editorEl.value.scrollTop = 0; }
    }
    async function confirmDiscard() {
      if (!dirty.value) return true;
      return confirmDialog({ title: 'Discard your changes?', message: 'Your edits to this file haven’t been saved.', confirmText: 'Discard', danger: true });
    }
    async function cancelEdit() { if (await confirmDiscard()) editing.value = false; }
    function formatJson() {
      try { draft.value = JSON.stringify(JSON.parse(draft.value), null, 2) + (draft.value.endsWith('\n') ? '\n' : ''); }
      catch (e) { /* button is disabled while invalid */ }
    }
    async function save() {
      if (!dirty.value || saving.value) return;
      if (jsonError.value && !await confirmDialog({ title: 'Save invalid JSON?', message: `The file won’t parse as JSON: ${jsonError.value}`, confirmText: 'Save anyway' })) return;
      saving.value = true;
      try {
        const f = file.value;
        const r = await api(`/api/files/${f.id}/content`, { method: 'PUT', body: { content: draft.value, base_size: f.size_bytes } });
        f.size_bytes = r.size_bytes;
        editing.value = false;
        toast.success(f.is_encrypted ? 'Saved' : 'Saved. The public link now shows the new version.');
        emit('changed', f);
        await load();
      } catch (e) {
        toast.error(e.message);
      } finally { saving.value = false; }
    }
    function onEditorKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
      if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); return; }
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // Tab indents instead of leaving the editor (use Esc, then Tab, to move focus)
        e.preventDefault();
        const el = e.target, { selectionStart: a, selectionEnd: b } = el;
        const insert = ext.value === 'go' || ext.value === 'makefile' ? '\t' : '  ';
        el.setRangeText(insert, a, b, 'end');
        draft.value = el.value;
      }
    }
    const onBeforeUnload = (e) => { if (dirty.value) { e.preventDefault(); e.returnValue = ''; } };
    async function requestClose() { if (await confirmDiscard()) { editing.value = false; emit('close'); } }

    // ---------- slideshow & full screen ----------
    const rootEl = ref(null);
    const slideshow = ref(false);
    let slideTimer = null;
    const imageCount = computed(() => props.files.filter(f => ['image', 'svg'].includes(kindOf(f))).length);
    function toggleSlideshow() {
      slideshow.value = !slideshow.value;
      clearInterval(slideTimer);
      if (!slideshow.value) return;
      slideTimer = setInterval(() => {
        // next image, wrapping around; skips non-images
        for (let step = 1; step <= props.files.length; step++) {
          const n = (index.value + step) % props.files.length;
          if (['image', 'svg'].includes(kindOf(props.files[n]))) { index.value = n; return; }
        }
      }, 4000);
    }
    function toggleFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (rootEl.value && rootEl.value.requestFullscreen) rootEl.value.requestFullscreen().catch(() => {});
    }

    async function go(d) {
      const n = index.value + d;
      if (n < 0 || n >= props.files.length) return;
      if (editing.value) { if (!await confirmDiscard()) return; editing.value = false; }
      index.value = n;
    }

    // ---------- videos pick up where you stopped (remembered in this browser) ----------
    const RESUME_KEY = 'akulavResume', RESUME_MIN = 120, RESUME_MAX_ITEMS = 300;
    const videoEl = ref(null);
    const readResume = () => { try { return JSON.parse(storage.read(RESUME_KEY) || '{}') || {}; } catch (e) { return {}; } };
    const writeResume = (fn) => {
      const m = readResume();
      fn(m);
      const ids = Object.keys(m);
      for (const id of ids.slice(0, Math.max(0, ids.length - RESUME_MAX_ITEMS))) delete m[id];
      storage.write(RESUME_KEY, Object.keys(m).length ? JSON.stringify(m) : null);
    };
    let lastSaved = 0;
    function onVideoMeta(e) {
      const v = e.target, at = readResume()[file.value.id];
      // only longer videos, and not when you were near the start or the end
      if (!(v.duration > RESUME_MIN) || !(at > 15) || at > v.duration - 20) return;
      v.currentTime = at;
      const id = file.value.id;
      toast(`Resumed at ${formatDuration(at)}`, 'info', 5000, { label: 'Start over', run: () => { if (videoEl.value && file.value.id === id) videoEl.value.currentTime = 0; } });
    }
    function onVideoTime(e) {
      const v = e.target;
      if (!(v.duration > RESUME_MIN) || Date.now() - lastSaved < 4000) return;
      lastSaved = Date.now();
      const id = file.value.id, t = Math.floor(v.currentTime);
      writeResume((m) => { delete m[id]; if (t > 15 && t < v.duration - 20) m[id] = t; });
    }
    const onMediaEnded = () => {
      if (kind.value === 'video') writeResume((m) => { delete m[file.value.id]; });
      if (props.autoplayNext && index.value < props.files.length - 1) go(1);
    };
    const download = () => downloadUrl(fileUrl(file.value.id, { download: true }));
    const copyLink = async () => { if (await copyText(sharedUrl(file.value.public_hash))) toast.success('Public link copied'); };
    const copyContents = async () => { if (await copyText(state.text || '')) toast.success('Copied to clipboard'); };

    const onKey = (e) => {
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
      if (editing.value) return; // the editor handles its own keys
      if (e.key === 'Escape') { if (entry.value) closeEntry(); else requestClose(); }
      else if (kind.value === 'epub' && epubRef.value && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.key === 'ArrowRight' ? epubRef.value.next() : epubRef.value.prev(); }
      else if (e.key === 'ArrowRight' && !e.altKey) go(1);
      else if (e.key === 'ArrowLeft' && !e.altKey) go(-1);
      else if ((e.key === '+' || e.key === '=') && isImageView.value) zoomBy(0.25);
      else if (e.key === '-' && isImageView.value) zoomBy(-0.25);
      else if (e.key === '0' && isImageView.value) resetZoom();
      else if (e.key.toLowerCase() === 'i') showInfo.value = !showInfo.value;
      else if (e.key.toLowerCase() === 'f') toggleFullscreen();
      else if (e.key === ' ' && isImageView.value && imageCount.value > 1) { e.preventDefault(); toggleSlideshow(); }
      // Space plays and pauses even when the video itself doesn't have focus (when it does, the browser handles it)
      else if (e.key === ' ' && kind.value === 'video' && videoEl.value && e.target !== videoEl.value) {
        e.preventDefault();
        if (videoEl.value.paused) videoEl.value.play().catch(() => {}); else videoEl.value.pause();
      }
    };

    watch(index, () => load());
    // open straight into the editor when asked (e.g. "Edit" from the file menu)
    if (props.startEditing) {
      const stop = watch(() => state.status, (st) => {
        if (st === 'ready' || st === 'error' || st === 'none') { stop(); if (canEdit.value) startEdit(); }
      });
    }
    onMounted(() => {
      window.addEventListener('beforeunload', onBeforeUnload);
      window.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
      load();
    });
    onUnmounted(() => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
      clearInterval(slideTimer);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      document.body.style.overflow = '';
      closeEntry();
      token++;
    });

    return {
      editing, draft, saving, editorEl, canEdit, dirty, draftBytes, draftLines, jsonError, startEdit, cancelEdit, formatJson, save, onEditorKey, requestClose,
      isShared, epubRef, thumbUrl, displayTitle, rootEl, slideshow, imageCount, toggleSlideshow, toggleFullscreen,
      index, file, kind, ext, tint, url, state, mode, modes, wrap, showInfo, showsCode, isImageView, lineCount, gutter, tableWidth,
      zoom, drag, zoomBy, resetZoom, toggleZoom, onWheel, onPointerDown, onPointerMove, onPointerUp, onTouchStart, onTouchEnd,
      go, load, fail, download, onMediaEnded, videoEl, onVideoMeta, onVideoTime, imgEl, onImgLoad, copyLink, copyContents, showSheet, openEntry, closeEntry, entry, dims,
      iconFor, kindLabel, formatBytes, formatDate, TEXT_LIMIT, ROW_LIMIT,
    };
  },
};
