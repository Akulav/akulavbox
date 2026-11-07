import { ref, reactive, computed, onMounted } from 'vue';
import Icon from '../components/Icon.js';
import { Avatar } from '../components/Shell.js';
import { api, formatBytes, formatRelative, session } from '../lib/api.js';
import { toast, confirmDialog, promptDialog, attempt } from '../lib/ui.js';

const GB = 1024 ** 3;
const PART_LABEL = {
  files: ['Files', 'Everyone’s encrypted files', '#E8A33D'],
  thumbnails: ['Thumbnails', 'Photo previews cache', '#5fb3a1'],
  database: ['Database', 'Accounts, folders, albums, chat', '#6ea8e6'],
  chat_files: ['Chat files', 'Temporary, deleted after 10 minutes', '#c78bd8'],
  uploads_in_progress: ['Uploads in progress', 'Unfinished uploads, cleared after 24 h', '#d0806b'],
  backups: ['Backups', 'Database snapshots made before upgrades', '#8ea1a4'],
};

export default {
  components: { Icon, Avatar },
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
          <p v-if="sys" class="text-[11.5px] text-faint mt-4">Measured {{ formatRelative(sys.measured_at) }}. Trash keeps items {{ sys.trash_days }} days.</p>
        </div>
      </section>

      <!-- ===== New account ===== -->
      <section class="panel p-5 mb-5">
        <h2 class="font-semibold mb-4 flex items-center gap-2"><Icon name="user-plus" :size="17" class="text-accent" />Create an account</h2>
        <form class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_120px_130px_auto] gap-3 items-end" @submit.prevent="createUser">
          <div><label class="label" for="nu">Username</label><input id="nu" v-model="form.username" class="input" autocomplete="off" maxlength="32" required></div>
          <div><label class="label" for="np">Password</label><input id="np" v-model="form.password" type="password" class="input" autocomplete="new-password" minlength="4" required></div>
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
      const ok = await confirmDialog({ title: `Delete ${u.username}?`, message: `All of their files (${formatBytes(u.used_bytes)}), albums, playlists and messages are permanently deleted. This can’t be undone.`, confirmText: 'Delete account', danger: true });
      if (!ok) return;
      await attempt(async () => { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); await refresh(true); }, 'Account deleted');
    }

    onMounted(() => refresh(false));
    return { users, sys, sysBusy, busy, form, search, filtered, totalUsed, totalQuota, pctOf, otherBytes, pct, freePct, parts, stats, GB,
      refresh, createUser, editQuota, resetPassword, toggleRole, signOut, deleteUser, formatBytes, formatRelative, session };
  },
};
