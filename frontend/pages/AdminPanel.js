import { ref, reactive, computed, onMounted } from 'vue';
import Icon from '../components/Icon.js';
import { Avatar } from '../components/Shell.js';
import { api, formatBytes, session } from '../lib/api.js';
import { toast, confirmDialog, promptDialog, attempt } from '../lib/ui.js';

const GB = 1024 ** 3;

export default {
  components: { Icon, Avatar },
  template: /*html*/`
    <div class="max-w-5xl">
      <h1 class="title text-[28px] md:text-[32px] leading-tight">Users</h1>
      <p class="text-muted text-[13.5px] mb-6">{{ users.length }} account{{ users.length === 1 ? '' : 's' }}, {{ formatBytes(totalUsed) }} stored of {{ formatBytes(totalQuota) }} allocated</p>

      <section class="panel p-5 mb-5">
        <h2 class="font-semibold mb-4">Create an account</h2>
        <form class="grid grid-cols-1 sm:grid-cols-[1fr_1fr_130px_auto] gap-3 items-end" @submit.prevent="createUser">
          <div><label class="label" for="nu">Username</label><input id="nu" v-model="form.username" class="input" autocomplete="off" required></div>
          <div><label class="label" for="np">Password</label><input id="np" v-model="form.password" type="password" class="input" autocomplete="new-password" required></div>
          <div><label class="label" for="nq">Storage (GB)</label><input id="nq" v-model.number="form.quotaGb" type="number" min="0.1" step="0.1" class="input" required></div>
          <button type="submit" class="btn btn-primary h-[38px]" :disabled="busy"><Icon name="user-plus" :size="16" />Create</button>
        </form>
      </section>

      <section class="panel overflow-hidden">
        <div class="hidden md:grid grid-cols-[minmax(0,1fr)_240px_120px] gap-4 px-5 h-10 items-center border-b border-line text-xs font-medium text-muted">
          <span>Account</span><span>Storage</span><span></span>
        </div>
        <div v-for="u in users" :key="u.id" class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_240px_120px] gap-3 md:gap-4 px-5 py-4 border-b border-line last:border-0 items-center">
          <div class="flex items-center gap-3 min-w-0">
            <Avatar :name="u.username" :src="u.profile_image" :size="38" />
            <div class="min-w-0">
              <p class="font-medium truncate flex items-center gap-2">{{ u.username }}<span v-if="u.role === 'admin'" class="chip chip-accent">Admin</span><span v-if="u.id === session.id" class="chip">You</span></p>
              <p class="text-xs text-muted">{{ u.file_count || 0 }} files</p>
            </div>
          </div>
          <div>
            <div class="flex justify-between text-xs mb-1.5"><span>{{ formatBytes(u.used_bytes) }}</span><span class="text-muted">{{ formatBytes(u.quota_bytes) }}</span></div>
            <div class="meter" :class="{ warn: pctOf(u) >= 90 }"><span :style="{ width: pctOf(u) + '%' }"></span></div>
          </div>
          <div class="flex md:justify-end gap-1">
            <button class="icon-btn" @click="editQuota(u)" title="Change storage limit"><Icon name="hard-drive" :size="17" /></button>
            <button class="icon-btn" @click="resetPassword(u)" title="Set a new password"><Icon name="key" :size="17" /></button>
            <button class="icon-btn hover:!text-danger" :disabled="u.id === session.id" :class="u.id === session.id ? 'opacity-30' : ''" @click="deleteUser(u)" title="Delete account"><Icon name="trash" :size="17" /></button>
          </div>
        </div>
      </section>
    </div>
  `,
  setup() {
    const users = ref([]);
    const busy = ref(false);
    const form = reactive({ username: '', password: '', quotaGb: 5 });

    const totalUsed = computed(() => users.value.reduce((s, u) => s + (u.used_bytes || 0), 0));
    const totalQuota = computed(() => users.value.reduce((s, u) => s + (u.quota_bytes || 0), 0));
    const pctOf = (u) => u.quota_bytes ? Math.min(100, (u.used_bytes / u.quota_bytes) * 100) : 0;

    const fetchUsers = async () => { await attempt(async () => { users.value = await api('/api/admin/users'); }); };

    async function createUser() {
      busy.value = true;
      await attempt(async () => {
        await api('/api/admin/users', { method: 'POST', body: { username: form.username.trim(), password: form.password, quota: Math.floor(form.quotaGb * GB) } });
        Object.assign(form, { username: '', password: '', quotaGb: 5 });
        await fetchUsers();
      }, 'Account created');
      busy.value = false;
    }

    async function editQuota(u) {
      const v = await promptDialog({ title: `Storage limit for ${u.username}`, message: `Currently using ${formatBytes(u.used_bytes)}. Enter the new limit in GB.`, value: String(+(u.quota_bytes / GB).toFixed(2)), inputType: 'number', confirmText: 'Save' });
      if (v == null) return;
      const gb = parseFloat(v);
      if (!(gb > 0)) return toast.error('Enter a number of gigabytes greater than 0.');
      await attempt(async () => { await api(`/api/admin/users/${u.id}/quota`, { method: 'PATCH', body: { quota: Math.floor(gb * GB) } }); await fetchUsers(); }, 'Storage limit updated');
    }

    async function resetPassword(u) {
      const pw = await promptDialog({ title: `New password for ${u.username}`, message: 'They’ll need to use this password next time they sign in.', inputType: 'password', confirmText: 'Set password' });
      if (!pw) return;
      await attempt(() => api(`/api/admin/users/${u.id}/password`, { method: 'PATCH', body: { newPassword: pw } }), 'Password changed');
    }

    async function deleteUser(u) {
      const ok = await confirmDialog({ title: `Delete ${u.username}?`, message: `All of their files (${formatBytes(u.used_bytes)}), albums, playlists and messages are permanently deleted.`, confirmText: 'Delete account', danger: true });
      if (!ok) return;
      await attempt(async () => { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); await fetchUsers(); }, 'Account deleted');
    }

    onMounted(fetchUsers);
    return { users, busy, form, totalUsed, totalQuota, pctOf, createUser, editQuota, resetPassword, deleteUser, formatBytes, session };
  },
};
