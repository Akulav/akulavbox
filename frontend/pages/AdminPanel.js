import { ref, reactive, computed, onMounted } from 'vue';
import Icon from '../components/Icon.js';
import { Avatar } from '../components/Shell.js';
import BackupPanel from '../components/BackupPanel.js';
import ActivityLog from '../components/ActivityLog.js';
import { api, formatBytes, formatRelative, session, restartServer } from '../lib/api.js';
import { toast, confirmDialog, promptDialog, attempt } from '../lib/ui.js';

const GB = 1024 ** 3;
const PART_LABEL = {
  files: ['Files', 'Everyone’s encrypted files', '#E8A33D'],
  thumbnails: ['Thumbnails', 'Photo previews cache', '#5fb3a1'],
  database: ['Database', 'Accounts, folders, albums, playlists', '#6ea8e6'],
  uploads_in_progress: ['Uploads in progress', 'Unfinished uploads, cleared after 24 h', '#d0806b'],
  backups: ['Backups', 'Scheduled backups, snapshots before upgrades, data replaced by a restore', '#8ea1a4'],
};

export default {
  components: { Icon, Avatar, BackupPanel, ActivityLog },
  template: /*html*/`
    <div class="max-w-6xl mx-auto">
      <div class="flex flex-wrap items-end gap-3 mb-6">
        <div class="flex-1 min-w-0">
          <h1 class="title text-[28px] md:text-[32px] leading-tight">Admin</h1>
          <p class="text-muted text-[13.5px]">{{ users.length }} account{{ users.length === 1 ? '' : 's' }}, {{ formatBytes(totalUsed) }} stored of {{ formatBytes(totalQuota) }} allocated</p>
        </div>
        <button class="btn" @click="refresh(true)" :disabled="sysBusy"><Icon :name="sysBusy ? 'loader' : 'rotate'" :size="15" />Refresh</button>
      </div>

      <!-- ===== Server ===== -->
      <section class="grid lg:grid-cols-[1.35fr_1fr] gap-5 mb-5 stagger">
        <div class="panel p-5 md:p-6 min-w-0">
          <div class="flex items-center gap-3 mb-5">
            <span class="w-10 h-10 rounded-xl bg-accent/15 text-accent grid place-items-center"><Icon name="hard-drive" :size="20" /></span>
            <div class="flex-1 min-w-0">
              <h2 class="font-semibold">Server disk</h2>
              <p class="text-xs text-muted truncate" :title="sys?.storage_dir">{{ sys ? sys.storage_dir : 'Measuring…' }}</p>
            </div>
            <span v-if="sys && sys.disk" class="chip" :class="freePct < 10 ? '!bg-danger/15 !text-danger' : freePct < 20 ? 'chip-accent' : 'chip-ok'">{{ freePct }}% free</span>
          </div>

          <template v-if="sys && sys.disk">
            <div class="flex items-end justify-between mb-2">
              <div>
                <p class="title text-[34px] leading-none tabular-nums">{{ formatBytes(sys.disk.free) }}</p>
                <p class="text-muted text-[13px] mt-1.5">free of {{ formatBytes(sys.disk.total) }}</p>
              </div>
              <div class="text-right text-[12.5px] text-muted leading-relaxed">
                <p><span class="inline-block w-2 h-2 rounded-full bg-accent mr-1.5"></span>AkulavBox {{ formatBytes(sys.app_bytes) }}</p>
                <p><span class="inline-block w-2 h-2 rounded-full bg-faint mr-1.5"></span>Other {{ formatBytes(otherBytes) }}</p>
              </div>
            </div>
            <!-- stacked bar: AkulavBox | other data | free -->
            <div class="h-3 rounded-full bg-elevated overflow-hidden flex" role="img" :aria-label="'Disk: ' + formatBytes(sys.disk.free) + ' free'">
              <span class="h-full bg-gradient-to-r from-accent to-[rgb(var(--accent-hi))] transition-[width] duration-700" :style="{ width: pct(sys.app_bytes) + '%' }"></span>
              <span class="h-full bg-faint/60 transition-[width] duration-700" :style="{ width: pct(otherBytes) + '%' }"></span>
            </div>
            <p v-if="freePct < 10" class="text-danger text-[13px] mt-3 flex items-center gap-2"><Icon name="alert" :size="15" />The disk is almost full. Uploads stop when less than {{ formatBytes(sys.reserve_bytes) }} is left.</p>
            <p v-if="sys.overcommitted > 0" class="text-[13px] mt-3 flex items-start gap-2 text-accent"><Icon name="info" :size="15" class="mt-0.5" />
              <span>Storage limits promise {{ formatBytes(sys.overcommitted) }} more than the disk has free. That’s fine until people actually fill their space.</span></p>

            <ul class="mt-6 space-y-3">
              <li v-for="row in parts" :key="row.key" class="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-3">
                <span class="w-2.5 h-2.5 rounded-full" :style="{ background: row.color }"></span>
                <div class="min-w-0">
                  <div class="flex justify-between text-[13px]"><span class="font-medium">{{ row.label }}</span><span class="tabular-nums text-muted">{{ formatBytes(row.bytes) }}</span></div>
                  <div class="h-1.5 rounded-full bg-elevated mt-1.5 overflow-hidden"><span class="block h-full rounded-full transition-[width] duration-700" :style="{ width: Math.max(row.bytes ? 1.5 : 0, row.share) + '%', background: row.color }"></span></div>
                  <p class="text-[11.5px] text-faint mt-1">{{ row.hint }}<template v-if="row.files"> · {{ row.files.toLocaleString() }} file{{ row.files === 1 ? '' : 's' }}</template></p>
                </div>
              </li>
            </ul>
          </template>
          <div v-else-if="sys && !sys.disk" class="text-muted text-[13.5px]">This system doesn’t report free disk space.</div>
          <div v-else class="space-y-3"><div class="h-9 w-40 rounded skeleton"></div><div class="h-3 rounded-full skeleton"></div><div v-for="i in 4" :key="i" class="h-8 rounded skeleton"></div></div>
        </div>

        <div class="panel p-5 md:p-6 min-w-0">
          <div class="flex items-center gap-3 mb-5">
            <span class="w-10 h-10 rounded-xl bg-info/15 text-info grid place-items-center"><Icon name="server" :size="20" /></span>
            <div><h2 class="font-semibold">Server</h2><p class="text-xs text-muted">AkulavBox by Akulav</p></div>
          </div>
          <dl v-if="sys" class="grid grid-cols-2 gap-3">
            <div v-for="s in stats" :key="s.label" class="rounded-xl bg-elevated/60 px-3.5 py-3">
              <dt class="text-[11.5px] text-muted flex items-center gap-1.5"><Icon :name="s.icon" :size="13" />{{ s.label }}</dt>
              <dd class="font-semibold text-[15px] mt-1 tabular-nums truncate" :title="s.value">{{ s.value }}</dd>
            </div>
          </dl>
          <div v-else class="grid grid-cols-2 gap-3"><div v-for="i in 8" :key="i" class="h-16 rounded-xl skeleton"></div></div>
          <div v-if="sys && sys.downloader && sys.downloader.enabled" class="mt-4 rounded-xl border border-line p-3.5">
            <div class="flex items-center gap-2 mb-2">
              <Icon name="download" :size="15" class="text-accent" /><p class="font-medium text-[13.5px] flex-1">Link downloader</p>
              <span class="chip" :class="sys.downloader.available ? 'chip-ok' : sys.downloader.installing ? 'chip-accent' : '!bg-danger/15 !text-danger'">{{ sys.downloader.available ? 'Ready' : sys.downloader.installing ? 'Installing' : 'Not available' }}</span>
            </div>
            <p class="text-[12px] text-muted leading-relaxed">
              yt-dlp {{ sys.downloader.ytdlp || '—' }} · ffmpeg {{ sys.downloader.ffmpeg || '—' }}<template v-if="sys.downloader.av1"> · AV1 conversion on</template>
            </p>
            <p v-if="sys.downloader.installing" class="text-[12px] text-accent mt-1 flex items-center gap-1.5"><Icon name="loader" :size="12" />{{ sys.downloader.step }}</p>
            <p v-else-if="sys.downloader.error" class="text-[12px] text-danger mt-1">{{ sys.downloader.error }}</p>
            <div class="flex gap-2 mt-3">
              <button class="btn btn-sm" :disabled="sys.downloader.installing" @click="toolAction('update')"><Icon name="rotate" :size="13" />Update yt-dlp</button>
              <button class="btn btn-sm" :disabled="sys.downloader.installing" @click="toolAction('install')"><Icon name="download" :size="13" />Reinstall tools</button>
            </div>
          </div>
          <p v-if="sys" class="text-[11.5px] text-faint mt-4">Measured {{ formatRelative(sys.measured_at) }}. Trash keeps items {{ sys.trash_days }} days.</p>
        </div>
      </section>

      <!-- ===== Updates from GitHub ===== -->
      <section id="updates" v-if="upd && upd.enabled" class="panel p-5 md:p-6 mb-5 min-w-0" :class="upd.available && !upd.ready ? '!border-info/50' : ''">
        <div class="flex flex-wrap items-center gap-3">
          <span class="w-10 h-10 rounded-xl bg-info/15 text-info grid place-items-center"><Icon name="download" :size="20" /></span>
          <div class="flex-1 min-w-0">
            <h2 class="font-semibold flex items-center gap-2 flex-wrap">Updates
              <span v-if="upd.ready" class="chip chip-ok">{{ upd.ready.rollback ? 'Rolled back' : 'Installed' }}, restart to finish</span>
              <span v-else-if="upd.available" class="chip !bg-info/15 !text-info">v{{ upd.latest.version }} available</span>
              <span v-else-if="upd.latest" class="chip chip-ok">Up to date</span></h2>
            <p class="text-xs text-muted truncate">v{{ upd.current }} installed · from <a :href="'https://github.com/' + upd.repo" target="_blank" rel="noopener" class="hover:text-fg underline-offset-2 hover:underline">{{ upd.repo }}</a> ({{ upd.branch }}) · {{ upd.mode === 'git' ? 'git checkout' : 'downloaded copy' }}<template v-if="upd.checked_at"> · checked {{ formatRelative(upd.checked_at) }}</template></p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-sm" :disabled="upd.checking || upd.applying" @click="checkUpdates"><Icon :name="upd.checking ? 'loader' : 'rotate'" :size="14" />Check now</button>
            <button v-if="upd.available && !upd.ready" class="btn btn-primary btn-sm" :disabled="upd.applying || (upd.latest && !upd.latest.node_ok)" @click="applyUpdate"><Icon :name="upd.applying ? 'loader' : 'download'" :size="14" />{{ upd.applying ? 'Updating…' : 'Update to v' + upd.latest.version }}</button>
            <button v-if="upd.ready" class="btn btn-primary btn-sm" @click="restartServer"><Icon name="rotate" :size="14" />Restart now</button>
            <button v-if="upd.rollback && !upd.applying" class="btn btn-ghost btn-sm" @click="rollbackUpdate" :title="'Go back to v' + upd.rollback.version"><Icon name="undo" :size="14" />Roll back to v{{ upd.rollback.version }}</button>
          </div>
        </div>
        <p v-if="upd.applying" class="text-[13px] text-info mt-3 flex items-center gap-2"><Icon name="loader" :size="14" />{{ upd.step || 'Working…' }}</p>
        <p v-if="upd.error" class="text-[13px] text-danger mt-3">{{ upd.error }}</p>
        <p v-if="upd.latest && !upd.latest.node_ok && upd.available" class="text-[13px] text-danger mt-3">v{{ upd.latest.version }} needs Node.js {{ upd.latest.node }}. Update Node.js on the server first.</p>
        <p v-if="upd.ready" class="text-[12.5px] text-muted mt-3">The new code is on disk. It runs after a restart: “Restart now” stops the server, and systemd, pm2, Docker or a similar service manager starts it again (otherwise start it yourself). Database changes, if any, run automatically on start, after a backup snapshot.</p>
        <div v-if="upd.available && upd.latest.notes && !upd.ready" class="mt-4 rounded-xl border border-line max-h-72 overflow-y-auto px-4 py-3 text-[13px] leading-relaxed release-notes" v-html="notesHtml"></div>
      </section>

      <!-- ===== Maintenance ===== -->
      <section class="grid lg:grid-cols-2 gap-5 mb-5">
        <div class="panel p-5 md:p-6 min-w-0">
          <div class="flex items-center gap-3 mb-3">
            <span class="w-10 h-10 rounded-xl bg-ok/15 text-ok grid place-items-center"><Icon name="activity" :size="20" /></span>
            <div class="flex-1 min-w-0"><h2 class="font-semibold">Storage check</h2><p class="text-xs text-muted">Compares the files on disk with the database</p></div>
            <button class="btn btn-sm" :disabled="check.busy" @click="runCheck"><Icon :name="check.busy ? 'loader' : 'search'" :size="14" />{{ check.report ? 'Check again' : 'Check now' }}</button>
          </div>
          <p v-if="!check.report" class="text-[13px] text-muted">If “Files” above is much bigger than what accounts use, some files on disk may belong to nothing: left over from crashes, older versions or deleted accounts. A check finds them; nothing changes until you clean up.</p>
          <template v-else>
            <dl class="grid grid-cols-2 gap-3 text-[13px]">
              <div class="rounded-xl bg-elevated/60 px-3.5 py-3"><dt class="text-[11.5px] text-muted">On disk</dt><dd class="font-semibold tabular-nums">{{ formatBytes(check.report.disk_bytes) }}<span class="text-muted font-normal"> · {{ check.report.disk_files.toLocaleString() }} files</span></dd></div>
              <div class="rounded-xl bg-elevated/60 px-3.5 py-3"><dt class="text-[11.5px] text-muted">In the database</dt><dd class="font-semibold tabular-nums">{{ formatBytes(check.report.db_bytes) }}<span class="text-muted font-normal"> · {{ check.report.db_files.toLocaleString() }} files</span></dd></div>
            </dl>
            <ul class="mt-4 space-y-2 text-[13px]">
              <li class="flex items-start gap-2"><Icon :name="check.report.orphans.length ? 'alert' : 'check'" :size="15" :class="check.report.orphans.length ? 'text-accent mt-0.5' : 'text-ok mt-0.5'" />
                <span v-if="check.report.orphans.length"><b>{{ check.report.orphans.length.toLocaleString() }}</b> file{{ check.report.orphans.length === 1 ? '' : 's' }} ({{ formatBytes(check.report.orphan_bytes) }}) {{ check.report.orphans.length === 1 ? 'belongs' : 'belong' }} to nothing.
                  <template v-if="check.report.recoverable"> {{ check.report.recoverable }} can still be opened and will be put back in a “Recovered files” folder; the rest are encrypted without a key record and will be deleted.</template>
                  <template v-else> They’re encrypted without a key record, so they can’t be opened and will be deleted.</template>
                  <button class="text-accent hover:underline ml-1" @click="check.details = !check.details">{{ check.details ? 'Hide' : 'Details' }}</button></span>
                <span v-else>Every file on disk belongs to an account.</span></li>
              <li class="flex items-start gap-2"><Icon :name="check.report.missing.length ? 'alert' : 'check'" :size="15" :class="check.report.missing.length ? 'text-accent mt-0.5' : 'text-ok mt-0.5'" />
                <span v-if="check.report.missing.length"><b>{{ check.report.missing.length }}</b> file{{ check.report.missing.length === 1 ? ' is' : 's are' }} listed but missing on disk ({{ check.report.missing.slice(0, 3).map(m => m.filename).join(', ') }}<template v-if="check.report.missing.length > 3">…</template>). They’ll be repaired if possible, otherwise removed from the lists.</span>
                <span v-else>Every listed file is on disk.</span></li>
              <li class="flex items-start gap-2"><Icon :name="check.report.usage.length ? 'alert' : 'check'" :size="15" :class="check.report.usage.length ? 'text-accent mt-0.5' : 'text-ok mt-0.5'" />
                <span v-if="check.report.usage.length">Storage used is off for {{ check.report.usage.map(u => u.username + ' (' + formatBytes(u.recorded) + ' → ' + formatBytes(u.actual) + ')').join(', ') }}.</span>
                <span v-else>Storage used is right for every account.</span></li>
            </ul>
            <ul v-if="check.details && check.report.orphans.length" class="mt-3 max-h-48 overflow-y-auto rounded-lg border border-line divide-y divide-line text-[12px]">
              <li v-for="o in check.report.orphans.slice(0, 200)" :key="(o.owner || '') + o.name" class="px-3 py-1.5 flex gap-3"><span class="truncate flex-1 font-mono" :title="o.name">{{ o.username || o.owner || '—' }}/{{ o.name }}</span><span class="text-muted shrink-0">{{ o.reason }}</span><span class="tabular-nums shrink-0">{{ formatBytes(o.bytes) }}</span></li>
            </ul>
            <div v-if="checkIssues" class="flex items-center gap-2 mt-4">
              <button class="btn btn-primary btn-sm" :disabled="check.busy" @click="cleanUp"><Icon name="sparkles" :size="14" />Clean up<template v-if="check.report.orphan_bytes"> and free {{ formatBytes(check.report.orphan_bytes) }}</template></button>
            </div>
          </template>
        </div>

        <BackupPanel />
      </section>

      <!-- ===== New account ===== -->
      <section class="panel p-5 mb-5">
        <h2 class="font-semibold mb-4 flex items-center gap-2"><Icon name="user-plus" :size="17" class="text-accent" />Create an account</h2>
        <form class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_120px_130px_auto] gap-3 items-end" @submit.prevent="createUser">
          <div><label class="label" for="nu">Username</label><input id="nu" v-model="form.username" class="input" autocomplete="off" maxlength="32" required></div>
          <div><label class="label" for="np">Password</label><input id="np" v-model="form.password" type="password" class="input" autocomplete="new-password" minlength="8" required></div>
          <div><label class="label" for="nq">Storage (GB)</label><input id="nq" v-model.number="form.quotaGb" type="number" min="0.1" step="0.1" class="input" required></div>
          <div><label class="label" for="nr">Role</label><select id="nr" v-model="form.role" class="input"><option value="user">User</option><option value="admin">Admin</option></select></div>
          <button type="submit" class="btn btn-primary h-[38px]" :disabled="busy"><Icon :name="busy ? 'loader' : 'user-plus'" :size="16" />Create</button>
        </form>
        <p v-if="sys && sys.disk && form.quotaGb * GB > sys.disk.free" class="text-accent text-xs mt-2">That’s more than the {{ formatBytes(sys.disk.free) }} free on the disk.</p>
      </section>

      <!-- ===== Users ===== -->
      <section class="panel overflow-hidden">
        <div class="flex items-center gap-3 px-5 py-3 border-b border-line">
          <h2 class="font-semibold flex-1">Accounts</h2>
          <div class="relative w-full max-w-[220px]">
            <Icon name="search" :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
            <input v-model="search" type="search" class="input h-9 pl-9" placeholder="Find an account" aria-label="Find an account">
          </div>
        </div>
        <div class="hidden md:grid grid-cols-[minmax(0,1fr)_240px_168px] gap-4 px-5 h-10 items-center border-b border-line text-xs font-medium text-muted">
          <span>Account</span><span>Storage</span><span></span>
        </div>
        <div class="stagger">
          <div v-for="u in filtered" :key="u.id" class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px_168px] gap-3 md:gap-4 px-5 py-4 border-b border-line last:border-0 items-center row-hover">
            <div class="flex items-center gap-3 min-w-0">
              <Avatar :name="u.username" :src="u.profile_image" :size="40" />
              <div class="min-w-0">
                <p class="font-medium truncate flex items-center gap-2">{{ u.username }}<span v-if="u.role === 'admin'" class="chip chip-accent">Admin</span><span v-if="u.id === session.id" class="chip">You</span></p>
                <p class="text-xs text-muted truncate">{{ (u.file_count || 0).toLocaleString() }} files<template v-if="u.trash_bytes"> · {{ formatBytes(u.trash_bytes) }} in trash</template> · {{ u.last_login_at ? 'signed in ' + formatRelative(u.last_login_at) : 'never signed in since v2' }}</p>
              </div>
            </div>
            <div>
              <div class="flex justify-between text-xs mb-1.5"><span class="tabular-nums" :class="u.used_bytes > u.quota_bytes ? 'text-danger font-medium' : ''">{{ formatBytes(u.used_bytes) }}</span><span class="text-muted">{{ formatBytes(u.quota_bytes) }}</span></div>
              <div class="meter" :class="{ warn: pctOf(u) >= 90 }"><span :style="{ width: pctOf(u) + '%' }"></span></div>
            </div>
            <div class="flex md:justify-end gap-1">
              <button class="icon-btn" @click="editQuota(u)" title="Change storage limit"><Icon name="hard-drive" :size="17" /></button>
              <button class="icon-btn" @click="resetPassword(u)" title="Set a new password"><Icon name="key" :size="17" /></button>
              <button class="icon-btn" :disabled="u.id === session.id" :class="u.id === session.id ? 'opacity-30' : ''" @click="toggleRole(u)" :title="u.role === 'admin' ? 'Remove admin rights' : 'Make admin'"><Icon name="shield" :size="17" :class="u.role === 'admin' ? 'text-accent' : ''" /></button>
              <button class="icon-btn" @click="signOut(u)" title="Sign out on every device"><Icon name="logout" :size="17" /></button>
              <button class="icon-btn hover:!text-danger" :disabled="u.id === session.id" :class="u.id === session.id ? 'opacity-30' : ''" @click="deleteUser(u)" title="Delete account"><Icon name="trash" :size="17" /></button>
            </div>
          </div>
          <p v-if="!filtered.length" class="px-5 py-8 text-center text-muted text-[13.5px]">No account matches “{{ search }}”.</p>
        </div>
      </section>

      <!-- ===== Activity ===== -->
      <ActivityLog :users="users" />
    </div>
  `,
  setup() {
    const users = ref([]);
    const sys = ref(null);
    const sysBusy = ref(false);
    const busy = ref(false);
    const search = ref('');
    const form = reactive({ username: '', password: '', quotaGb: 5, role: 'user' });

    const totalUsed = computed(() => users.value.reduce((s, u) => s + (u.used_bytes || 0), 0));
    const totalQuota = computed(() => users.value.reduce((s, u) => s + (u.quota_bytes || 0), 0));
    const pctOf = (u) => u.quota_bytes ? Math.min(100, (u.used_bytes / u.quota_bytes) * 100) : 0;
    const filtered = computed(() => { const q = search.value.trim().toLowerCase(); return q ? users.value.filter(u => u.username.toLowerCase().includes(q)) : users.value; });

    const otherBytes = computed(() => sys.value?.disk ? Math.max(0, sys.value.disk.used - sys.value.app_bytes) : 0);
    const pct = (b) => sys.value?.disk?.total ? Math.min(100, (b / sys.value.disk.total) * 100) : 0;
    const freePct = computed(() => sys.value?.disk?.total ? Math.round((sys.value.disk.free / sys.value.disk.total) * 100) : 0);
    const parts = computed(() => {
      if (!sys.value) return [];
      const total = sys.value.app_bytes || 1;
      return Object.entries(sys.value.parts).map(([key, p]) => ({ key, label: PART_LABEL[key]?.[0] || key, hint: PART_LABEL[key]?.[1] || '', color: PART_LABEL[key]?.[2] || '#8ea1a4',
        bytes: p.bytes, files: key === 'database' ? 0 : p.files, share: (p.bytes / total) * 100 })).sort((a, b) => b.bytes - a.bytes);
    });
    const uptime = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
    const stats = computed(() => sys.value ? [
      { label: 'Version', value: `v${sys.value.version}`, icon: 'sparkles' },
      { label: 'Uptime', value: uptime(sys.value.uptime_s), icon: 'clock' },
      { label: 'Files', value: sys.value.totals.files.toLocaleString(), icon: 'file' },
      { label: 'Accounts', value: String(sys.value.totals.users), icon: 'users' },
      { label: 'In trash', value: formatBytes(sys.value.totals.trash_bytes), icon: 'trash' },
      { label: 'Memory', value: formatBytes(sys.value.memory_rss), icon: 'activity' },
      { label: 'Node.js', value: sys.value.node, icon: 'code' },
      { label: 'Thumbnails', value: sys.value.thumbnails, icon: 'image' },
      { label: 'Database schema', value: `#${sys.value.schema}`, icon: 'database' },
      { label: 'System', value: sys.value.platform, icon: 'server' },
    ] : []);

    const fetchUsers = async () => { await attempt(async () => { users.value = await api('/api/admin/users'); }); };
    const fetchSystem = async (fresh) => {
      sysBusy.value = true;
      try { sys.value = await api(`/api/admin/system${fresh ? '?fresh=1' : ''}`); } catch (e) { toast.error(e.message); }
      finally { sysBusy.value = false; }
    };
    const refresh = (fresh) => Promise.all([fetchUsers(), fetchSystem(fresh)]);

    // installs run in the background on the server: re-check until they finish
    async function toolAction(action) {
      if (!await attempt(() => api('/api/downloads/tools', { method: 'POST', body: { action } }), action === 'update' ? 'Updating yt-dlp…' : 'Reinstalling the download tools…')) return;
      const poll = async () => { await fetchSystem(true); if (sys.value?.downloader?.installing) setTimeout(poll, 3000); };
      setTimeout(poll, 1500);
    }

    async function createUser() {
      busy.value = true;
      await attempt(async () => {
        await api('/api/admin/users', { method: 'POST', body: { username: form.username.trim(), password: form.password, quota: Math.floor(form.quotaGb * GB), role: form.role } });
        Object.assign(form, { username: '', password: '', quotaGb: 5, role: 'user' });
        await fetchUsers();
      }, 'Account created');
      busy.value = false;
    }

    async function editQuota(u) {
      const v = await promptDialog({ title: `Storage limit for ${u.username}`, message: `Currently using ${formatBytes(u.used_bytes)}. Enter the new limit in GB.`, value: String(+(u.quota_bytes / GB).toFixed(2)), inputType: 'number', confirmText: 'Save' });
      if (v == null) return;
      const gb = parseFloat(v);
      if (!(gb > 0)) return toast.error('Enter a number of gigabytes greater than 0.');
      if (gb * GB < u.used_bytes && !await confirmDialog({ title: 'Set a limit below current use?', message: `${u.username} already stores ${formatBytes(u.used_bytes)}. Nothing is deleted, but they won’t be able to upload until they free up space.`, confirmText: 'Set limit' })) return;
      await attempt(async () => { await api(`/api/admin/users/${u.id}/quota`, { method: 'PATCH', body: { quota: Math.floor(gb * GB) } }); await fetchUsers(); }, 'Storage limit updated');
    }

    async function resetPassword(u) {
      const pw = await promptDialog({ title: `New password for ${u.username}`, message: 'They’re signed out everywhere and need this password next time they sign in.', inputType: 'password', confirmText: 'Set password' });
      if (!pw) return;
      await attempt(() => api(`/api/admin/users/${u.id}/password`, { method: 'PATCH', body: { newPassword: pw } }), 'Password changed');
    }

    async function toggleRole(u) {
      const role = u.role === 'admin' ? 'user' : 'admin';
      if (!await confirmDialog({ title: role === 'admin' ? `Make ${u.username} an admin?` : `Remove admin rights from ${u.username}?`,
        message: role === 'admin' ? 'Admins can create and delete accounts, reset passwords and see server details.' : 'They keep their files, but lose access to this page.',
        confirmText: role === 'admin' ? 'Make admin' : 'Remove rights' })) return;
      await attempt(async () => { await api(`/api/admin/users/${u.id}/role`, { method: 'PATCH', body: { role } }); await fetchUsers(); }, 'Role updated');
    }

    async function signOut(u) {
      if (!await confirmDialog({ title: `Sign ${u.username} out everywhere?`, message: u.id === session.id ? 'This includes this browser.' : 'Every browser and device they use will ask them to sign in again.', confirmText: 'Sign out' })) return;
      await attempt(() => api(`/api/admin/users/${u.id}/signout`, { method: 'POST' }), 'Signed out on every device');
    }

    async function deleteUser(u) {
      const ok = await confirmDialog({ title: `Delete ${u.username}?`, message: `All of their files (${formatBytes(u.used_bytes)}), albums, playlists and collections are permanently deleted. This can’t be undone.`, confirmText: 'Delete account', danger: true });
      if (!ok) return;
      await attempt(async () => { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); await refresh(true); }, 'Account deleted');
    }

    // ---------- storage check ----------
    const check = reactive({ report: null, busy: false, details: false });
    const checkIssues = computed(() => check.report && (check.report.orphans.length || check.report.missing.length || check.report.usage.length));
    async function runCheck() {
      check.busy = true;
      try { check.report = await api('/api/admin/storage-check'); } catch (e) { toast.error(e.message); }
      finally { check.busy = false; }
    }
    async function cleanUp() {
      const r = check.report;
      if (!await confirmDialog({ title: 'Clean up storage?', danger: true, confirmText: 'Clean up',
        message: [r.orphans.length - r.recoverable > 0 && `${r.orphans.length - r.recoverable} unreadable file(s) are deleted for good.`, r.recoverable && `${r.recoverable} readable file(s) go to “Recovered files”.`,
          r.missing.length && `${r.missing.length} missing file(s) are repaired or removed from lists.`, r.usage.length && 'Storage used is recalculated.'].filter(Boolean).join(' ') })) return;
      check.busy = true;
      const done = await attempt(() => api('/api/admin/storage-check/clean', { method: 'POST', body: {} }));
      check.busy = false;
      if (!done) return;
      toast.success([done.freed_bytes && `Freed ${formatBytes(done.freed_bytes)}`, done.recovered && `recovered ${done.recovered}`, (done.repaired + done.removed_rows) && `fixed ${done.repaired + done.removed_rows} listing(s)`, done.usage_fixed && `corrected ${done.usage_fixed} account(s)`].filter(Boolean).join(', ') || 'Nothing needed fixing');
      await Promise.all([runCheck(), refresh(true)]);
    }

    // ---------- updates from GitHub ----------
    const upd = ref(null);
    const loadUpdates = async (check = false) => { try { upd.value = await api(`/api/admin/updates${check ? '?check=1' : ''}`); } catch (e) { /* older server */ } };
    const checkUpdates = async () => { if (upd.value) upd.value.checking = true; await loadUpdates(true); if (upd.value?.error) toast.error(upd.value.error); else if (!upd.value?.available) toast.success('AkulavBox is up to date'); };
    const pollUpdate = async () => { await loadUpdates(); if (upd.value?.applying) setTimeout(pollUpdate, 1500); else if (upd.value?.ready) toast.success('Update installed. Restart to finish.'); };
    async function applyUpdate() {
      const v = upd.value.latest.version;
      if (!await confirmDialog({ title: `Update to v${v}?`, confirmText: 'Update',
        message: `AkulavBox downloads v${v} from GitHub and installs it next to the running version${upd.value.mode === 'archive' ? ' (the current code is backed up first)' : ''}. Your data and .env aren’t touched. It takes effect after a restart, and you can roll back.` })) return;
      if (await attempt(() => api('/api/admin/updates/apply', { method: 'POST' }))) { upd.value.applying = true; setTimeout(pollUpdate, 800); }
    }
    async function rollbackUpdate() {
      const v = upd.value.rollback.version;
      if (!await confirmDialog({ title: `Go back to v${v}?`, confirmText: 'Roll back', danger: true, message: `The code from before the last update is put back. It runs after a restart. A database already upgraded by the newer version stays upgraded.` })) return;
      const r = await attempt(() => api('/api/admin/updates/rollback', { method: 'POST' }), `v${v} restored. Restart to finish.`);
      if (r) await loadUpdates();
    }
    // the changelog is our own Markdown: headings, bullets, **bold** and `code`
    const esc = (s) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const notesHtml = computed(() => (upd.value?.latest?.notes || '').split('\n').map(l => {
      if (l.startsWith('## ')) return `<h3>${inline(l.slice(3))}</h3>`;
      if (l.startsWith('### ')) return `<h4>${inline(l.slice(4))}</h4>`;
      if (l.startsWith('- ')) return `<p class="li">${inline(l.slice(2))}</p>`;
      return l.trim() ? `<p>${inline(l)}</p>` : '';
    }).join(''));

    onMounted(async () => {
      refresh(false);
      await loadUpdates();
      if (upd.value?.applying) pollUpdate();
      if (location.hash.includes('updates')) document.getElementById('updates')?.scrollIntoView({ behavior: 'smooth' });
    });
    return { users, sys, sysBusy, busy, form, search, filtered, totalUsed, totalQuota, pctOf, otherBytes, pct, freePct, parts, stats, GB,
      refresh, toolAction, createUser, editQuota, resetPassword, toggleRole, signOut, deleteUser, formatBytes, formatRelative, session,
      check, checkIssues, runCheck, cleanUp, upd, checkUpdates, applyUpdate, rollbackUpdate, notesHtml, restartServer };
  },
};
