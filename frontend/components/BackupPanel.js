import { reactive, ref, computed, onMounted, onBeforeUnmount } from 'vue';
import Icon from './Icon.js';
import { api, formatBytes, formatRelative, session, randomId, storage, sleep, waitOnline, restartServer } from '../lib/api.js';
import { toast, confirmDialog, attempt } from '../lib/ui.js';

// Admin → Backup and restore: download a backup, back up on a schedule, restore one.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` }));
const when = (iso) => iso ? new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

export default {
  components: { Icon },
  template: /*html*/`
    <div class="panel p-5 md:p-6 min-w-0">
      <div class="flex items-center gap-3 mb-3">
        <span class="w-10 h-10 rounded-xl bg-info/15 text-info grid place-items-center"><Icon name="database" :size="20" /></span>
        <div class="flex-1 min-w-0"><h2 class="font-semibold">Backup and restore</h2><p class="text-xs text-muted">Everything in one encrypted file: accounts, passwords, files, albums, playlists, chat</p></div>
      </div>
      <p v-if="bk.restored" class="rounded-xl bg-ok/10 text-[13px] px-3.5 py-2.5 mb-3"><Icon name="check" :size="14" class="inline text-ok mr-1" />Restored the backup from {{ formatRelative(bk.restored.created_at) }}. The data it replaced is in <span class="font-mono text-[12px] break-all">{{ bk.restored.previous }}</span>.</p>

      <!-- export -->
      <form class="space-y-2" @submit.prevent="exportBackup">
        <p class="text-[13px] font-medium">Export<span v-if="bk.estimate" class="text-muted font-normal"> · about {{ formatBytes(bk.estimate.bytes) }}</span></p>
        <div class="flex flex-col sm:flex-row gap-2">
          <input v-model="bk.pass" type="password" class="input flex-1" placeholder="Passphrase (8+ characters)" autocomplete="new-password" minlength="8" required aria-label="Backup passphrase">
          <button class="btn shrink-0" :disabled="bk.pass.length < 8"><Icon name="download" :size="15" />Download backup</button>
        </div>
        <p class="text-[11.5px] text-faint">Keep the passphrase safe: without it the backup can’t be opened. Stored files are already encrypted, so they’re copied as-is; the database is compressed. It restores on any AkulavBox server, even one with a different MASTER_KEY.</p>
      </form>

      <!-- schedule -->
      <div v-if="sc" class="border-t border-line mt-4 pt-4 space-y-3">
        <div class="flex items-center gap-2">
          <p class="text-[13px] font-medium flex-1">Scheduled backups</p>
          <span class="chip" :class="sc.enabled ? 'chip-ok' : ''">{{ sc.enabled ? 'On' : 'Off' }}</span>
        </div>
        <p v-if="sc.running" class="text-[13px] flex items-center gap-2"><Icon name="loader" :size="14" class="text-accent" />Backing up… {{ Math.round(schedulePct) }}%</p>
        <div v-if="sc.running" class="meter"><span :style="{ width: schedulePct + '%' }"></span></div>
        <ul class="text-[12.5px] space-y-1">
          <li v-if="sc.enabled && sc.next_at && !sc.running" class="flex gap-2"><Icon name="clock" :size="14" class="text-muted mt-0.5 shrink-0" /><span>Next: {{ when(sc.next_at) }} <span class="text-faint">({{ sc.timezone }})</span></span></li>
          <li v-if="sc.last && !sc.last.ok" class="flex gap-2 text-danger" role="alert"><Icon name="alert" :size="14" class="mt-0.5 shrink-0" /><span>The backup {{ formatRelative(sc.last.at) }} failed: {{ sc.last.error }}</span></li>
          <li v-if="sc.last_ok" class="flex gap-2"><Icon name="check" :size="14" class="text-ok mt-0.5 shrink-0" /><span class="min-w-0">Last backup {{ formatRelative(sc.last_ok.at) }}, {{ formatBytes(sc.last_ok.bytes) }}: <span class="font-mono text-[11.5px] break-all">{{ sc.last_ok.file }}</span></span></li>
          <li v-else-if="sc.enabled" class="text-muted">No scheduled backup has run yet.</li>
        </ul>
        <form class="space-y-2" @submit.prevent="saveSchedule">
          <label class="flex items-center gap-2 text-[13px]"><input type="checkbox" v-model="form.enabled" class="checkbox">Back up automatically</label>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div><label class="label" for="sc-every">Every</label><select id="sc-every" v-model="form.every" class="input"><option value="daily">Day</option><option value="weekly">Week</option></select></div>
            <div v-if="form.every === 'weekly'"><label class="label" for="sc-day">On</label><select id="sc-day" v-model.number="form.weekday" class="input"><option v-for="(d, i) in WEEKDAYS" :key="i" :value="i">{{ d }}</option></select></div>
            <div><label class="label" for="sc-hour">At</label><select id="sc-hour" v-model.number="form.hour" class="input"><option v-for="h in HOURS" :key="h.value" :value="h.value">{{ h.label }}</option></select></div>
            <div><label class="label" for="sc-keep">Keep</label><input id="sc-keep" v-model.number="form.keep" type="number" min="1" max="100" class="input" title="How many backups to keep; older ones are deleted"></div>
          </div>
          <div><label class="label" for="sc-dir">Folder on the server</label><input id="sc-dir" v-model="form.dir" class="input font-mono text-[12.5px]" :placeholder="sc.default_dir" autocomplete="off"></div>
          <div>
            <label class="label" for="sc-pass">Passphrase</label>
            <input id="sc-pass" v-model="form.passphrase" type="password" class="input" autocomplete="new-password" :disabled="sc.passphrase_from_env"
              :placeholder="sc.passphrase_from_env ? 'Set by BACKUP_PASSPHRASE in .env' : sc.has_passphrase ? 'Saved. Type to change it' : 'Needed to open the backups (8+ characters)'">
            <p v-if="sc.passphrase_unreadable" class="text-danger text-[12px] mt-1">The saved passphrase came from a server with another MASTER_KEY and can’t be read. Enter it again.</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-sm btn-primary" :disabled="sc.busy"><Icon name="check" :size="14" />Save schedule</button>
            <button type="button" class="btn btn-sm" :disabled="sc.running || !sc.has_passphrase" @click="runNow" :title="sc.has_passphrase ? 'Make a backup into the folder now' : 'Save a passphrase first'"><Icon name="play" :size="14" />Back up now</button>
          </div>
          <p class="text-[11.5px] text-faint">A folder on another drive (or a mounted network share) protects against a failing disk; the default is inside the storage folder. Missed times (the server was off) run once at the next start. They open like any backup, with this passphrase.</p>
        </form>
      </div>

      <!-- restore -->
      <div class="border-t border-line mt-4 pt-4 space-y-2">
        <p class="text-[13px] font-medium">Restore</p>
        <template v-if="bk.import.pending">
          <p class="text-[13px]">Ready to restore the backup from {{ formatRelative(bk.import.pending.created_at) }}: {{ bk.import.pending.users }} account{{ bk.import.pending.users === 1 ? '' : 's' }}, {{ (bk.import.pending.files || 0).toLocaleString() }} files. It replaces <b>everything</b> on this server when AkulavBox restarts. Anything changed before then is lost.</p>
          <div v-if="bk.import.pending.failed" class="rounded-xl bg-danger/10 text-[12.5px] px-3.5 py-2.5" role="alert">
            <p class="font-medium text-danger">The restart {{ formatRelative(bk.import.pending.failed.at) }} couldn’t apply it, so this server still runs on its old data.</p>
            <p class="mt-1 break-words">{{ bk.import.pending.failed.error }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-primary btn-sm" @click="restartServer"><Icon name="rotate" :size="14" />Restart now</button>
            <button class="btn btn-ghost btn-sm" @click="cancelImport">Cancel restore</button>
          </div>
          <p class="text-[11.5px] text-faint">“Restart now” stops the server. It starts again on its own under systemd, pm2, Docker or a similar service manager; otherwise start it again yourself.</p>
        </template>
        <template v-else-if="bk.import.running || bk.uploading">
          <p class="text-[13px] flex items-center gap-2"><Icon name="loader" :size="14" class="text-accent" />{{ bk.uploading ? 'Uploading' : bk.import.step }} {{ Math.round(importPct) }}%</p>
          <div class="meter"><span :style="{ width: importPct + '%' }"></span></div>
        </template>
        <p v-else-if="bk.import.staging" class="text-[13px] flex items-center gap-2"><Icon name="loader" :size="14" class="text-accent" />A backup is being unpacked from the command line. <button class="btn btn-ghost btn-sm" @click="pollImport">Refresh</button></p>
        <form v-else class="space-y-2" @submit.prevent="importBackup">
          <input type="file" accept=".akbx" class="input !h-auto py-1.5 text-[13px]" @change="e => bk.file = e.target.files[0] || null" aria-label="Backup file">
          <div class="flex flex-col sm:flex-row gap-2">
            <input v-model="bk.importPass" type="password" class="input flex-1" placeholder="The backup’s passphrase" autocomplete="off" required aria-label="Passphrase of the backup">
            <button class="btn shrink-0" :disabled="!bk.file || !bk.importPass"><Icon name="upload" :size="15" />Restore</button>
          </div>
          <p v-if="bk.import.error" class="text-danger text-[12.5px]">{{ bk.import.error }}</p>
          <p class="text-[11.5px] text-faint">Very large backups: copy the file to the server and run <span class="font-mono">node scripts/backup.js import &lt;file&gt;</span> instead.</p>
        </form>
      </div>
    </div>
  `,
  setup() {
    const bk = reactive({ pass: '', importPass: '', file: null, uploading: false, sent: 0, estimate: null, restored: null, import: { running: false, staging: null, pending: null, error: null, done: 0, total: 0, step: '' } });
    const sc = ref(null);
    const form = reactive({ enabled: false, every: 'daily', weekday: 0, hour: 3, keep: 7, dir: '', passphrase: '' });
    const importPct = computed(() => bk.uploading ? (bk.file ? (bk.sent / bk.file.size) * 100 : 0) : (bk.import.total ? (bk.import.done / bk.import.total) * 100 : 0));
    const schedulePct = computed(() => sc.value?.total ? Math.min(100, (sc.value.done / sc.value.total) * 100) : 0);

    const fillForm = (s) => Object.assign(form, { enabled: s.enabled, every: s.every, weekday: s.weekday, hour: s.hour, keep: s.keep, dir: s.dir || '', passphrase: '' });
    async function load() {
      let r;
      try { r = await api('/api/admin/backup'); } catch (e) { return; } // older server
      const { schedule, ...rest } = r;
      Object.assign(bk, rest);
      // the form keeps what the admin is typing; only a first load (or a save) fills it
      if (schedule && !sc.value) fillForm(schedule);
      sc.value = schedule ? { ...schedule, busy: sc.value?.busy } : null;
    }

    // ---------- export ----------
    function exportBackup() {
      // a real form post, so the browser streams the (possibly huge) file straight to disk
      const f = document.createElement('form');
      f.method = 'POST'; f.action = '/api/admin/backup/export'; f.style.display = 'none';
      for (const [k, v] of Object.entries({ token: session.token, passphrase: bk.pass })) { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i); }
      document.body.appendChild(f); f.submit(); f.remove();
      bk.pass = '';
      toast('Preparing the backup. The download starts in a moment.');
    }

    // ---------- schedule ----------
    let pollTimer = null;
    const pollSchedule = async () => { await load(); if (sc.value?.running) pollTimer = setTimeout(pollSchedule, 2000); else pollTimer = null; };
    async function saveSchedule() {
      sc.value.busy = true;
      const body = { enabled: form.enabled, every: form.every, weekday: form.weekday, hour: form.hour, keep: form.keep, dir: form.dir.trim() };
      if (form.passphrase) body.passphrase = form.passphrase;
      const s = await attempt(() => api('/api/admin/backup/schedule', { method: 'PUT', body }), form.enabled ? 'Scheduled backups are on' : 'Schedule saved');
      if (s) { sc.value = s; fillForm(s); }
      else sc.value.busy = false;
    }
    async function runNow() {
      if (!await attempt(() => api('/api/admin/backup/schedule/run', { method: 'POST' }))) return;
      await sleep(400);
      await pollSchedule();
      if (sc.value?.last?.ok) toast.success(`Backup saved (${formatBytes(sc.value.last.bytes)})`);
      else if (sc.value?.last?.error) toast.error(sc.value.last.error);
    }

    // ---------- restore ----------
    // The same file picked again (after a dropped connection, a reload or a failed check)
    // keeps its upload id, so only the missing part is sent
    const uploadKey = (f) => `akb-restore-upload:${f.name}:${f.size}:${f.lastModified}`;

    async function uploadBackup(file, id) {
      let chunk = 16 * 1024 * 1024, fails = 0;
      let off = 0;
      try { off = Math.min((await api(`/api/admin/backup/upload?id=${id}`)).size || 0, file.size); } catch (e) { /* older server: from the start */ }
      bk.sent = off;
      while (off < file.size) {
        let status = 0, data = {};
        try {
          const res = await fetch(`/api/admin/backup/upload?id=${id}&offset=${off}`, { method: 'PUT', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/octet-stream' }, body: file.slice(off, off + chunk) });
          status = res.status; data = await res.json().catch(() => ({}));
        } catch (e) { /* network: retried below */ }
        if (status === 200) { off = data.size; bk.sent = off; fails = 0; continue; }
        if (status === 409 && Number.isFinite(data.size)) { off = data.size; bk.sent = off; continue; } // the server has less than we thought
        // a proxy with a small request limit (nginx allows 1 MB unless told otherwise): smaller pieces
        if (status === 413 && chunk > 256 * 1024) { chunk = Math.max(256 * 1024, chunk / 4); continue; }
        if (status === 413) throw new Error('A proxy in front of AkulavBox refuses the upload (413). Raise its request size limit (nginx: client_max_body_size) or copy the file to the server and use node scripts/backup.js import.');
        if (status === 401) throw new Error('Your session expired. Sign in again; the upload carries on where it stopped.');
        if ((status >= 400 && status < 500) || status === 507) throw new Error(data.error || `Upload failed (${status})`);
        if (++fails > 8) throw new Error(data.error || (status ? `Upload failed (${status})` : 'Lost the connection to the server. Try again; the upload carries on where it stopped.'));
        await waitOnline();
        await sleep(Math.min(30000, 1000 * 2 ** fails));
      }
    }

    async function pollImport() {
      for (;;) {
        await load();
        if (!bk.import.running && !bk.import.staging) break;
        await sleep(1500);
      }
      if (bk.import.pending && !bk.import.pending.failed) toast.success('Backup checked. Restart to restore it.');
      else if (bk.import.error) toast.error(bk.import.error);
    }

    async function importBackup() {
      if (!await confirmDialog({ title: 'Restore this backup?', danger: true, confirmText: 'Upload and check',
        message: 'After it is uploaded and checked, AkulavBox replaces ALL accounts and files on this server with the backup’s at the next restart. The current data is moved to storage/backups/.' })) return;
      const file = bk.file, key = uploadKey(file);
      const id = storage.read(key) || randomId();
      storage.write(key, id);
      bk.uploading = true; bk.sent = 0; bk.import.error = null;
      try {
        await uploadBackup(file, id);
        bk.uploading = false;
        await api('/api/admin/backup/import', { method: 'POST', body: { id, passphrase: bk.importPass } });
        bk.importPass = '';
        await pollImport();
        // checked: the server dropped its copy, so a later restore of this file uploads again
        if (bk.import.pending) storage.write(key, null);
      } catch (e) { bk.uploading = false; bk.import.error = e.message; toast.error(e.message); }
    }
    async function cancelImport() { await attempt(async () => { await api('/api/admin/backup/import', { method: 'DELETE' }); await load(); }, 'Restore cancelled'); }

    onMounted(async () => { await load(); if (sc.value?.running) pollSchedule(); });
    onBeforeUnmount(() => clearTimeout(pollTimer));
    return { bk, sc, form, importPct, schedulePct, WEEKDAYS, HOURS, when, formatBytes, formatRelative,
      exportBackup, saveSchedule, runNow, importBackup, pollImport, cancelImport, restartServer };
  },
};
