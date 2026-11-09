import { reactive, toRefs, onMounted } from 'vue';
import Icon from './Icon.js';
import { api, formatRelative } from '../lib/api.js';
import { toast } from '../lib/ui.js';

// Admin → Activity: sign-ins, account changes, shares, backups and server actions.
const ACTIONS = {
  'auth.login': ['Signed in', 'log-in'],
  'auth.login_failed': ['Sign-in failed', 'alert', 'danger'],
  'auth.locked': ['Sign-ins blocked', 'lock', 'danger'],
  'account.password_changed': ['Changed their password', 'key'],
  'account.password_change_failed': ['Password change refused', 'alert', 'danger'],
  'admin.user_created': ['Created account', 'user-plus'],
  'admin.user_deleted': ['Deleted account', 'trash', 'danger'],
  'admin.user_password_reset': ['Reset password of', 'key'],
  'admin.user_quota': ['Changed storage limit of', 'hard-drive'],
  'admin.user_role': ['Changed role of', 'shield'],
  'admin.user_signed_out': ['Signed out everywhere:', 'logout'],
  'share.created': ['Shared a public link to', 'link'],
  'share.removed': ['Stopped sharing', 'link-off'],
  'backup.exported': ['Downloaded a backup', 'download'],
  'backup.scheduled': ['Scheduled backup saved', 'database'],
  'backup.scheduled_failed': ['Scheduled backup failed', 'alert', 'danger'],
  'backup.schedule_changed': ['Changed the backup schedule', 'clock'],
  'backup.import_staged': ['Checked a backup to restore', 'upload'],
  'backup.import_failed': ['Backup import failed', 'alert', 'danger'],
  'backup.import_cancelled': ['Cancelled a restore', 'x'],
  'backup.restored': ['Restored a backup', 'database'],
  'backup.restore_failed': ['Restore couldn’t be applied', 'alert', 'danger'],
  'admin.storage_cleaned': ['Cleaned up storage', 'sparkles'],
  'admin.update_installed': ['Installed an update', 'download'],
  'admin.update_failed': ['Update failed', 'alert', 'danger'],
  'admin.update_rolled_back': ['Rolled back the update', 'undo'],
  'admin.server_restart': ['Restarted the server', 'rotate'],
};
const KINDS = [['', 'Everything'], ['signin', 'Sign-ins'], ['failed', 'Failures'], ['account', 'Accounts'], ['share', 'Sharing'], ['backup', 'Backups'], ['server', 'Server']];

export default {
  components: { Icon },
  props: { users: { type: Array, default: () => [] } },
  template: /*html*/`
    <section class="panel overflow-hidden mt-5">
      <div class="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-line">
        <h2 class="font-semibold flex-1 flex items-center gap-2 min-w-[120px]"><Icon name="activity" :size="17" class="text-accent" />Activity</h2>
        <select v-model="f.kind" class="input h-9 w-auto" aria-label="What to show" @change="load()"><option v-for="[v, l] in KINDS" :key="v" :value="v">{{ l }}</option></select>
        <select v-model="f.user" class="input h-9 w-auto max-w-[160px]" aria-label="Account" @change="load()"><option value="">All accounts</option><option v-for="u in users" :key="u.id" :value="u.id">{{ u.username }}</option></select>
        <div class="relative w-full sm:w-auto sm:max-w-[200px]">
          <Icon name="search" :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input v-model="f.q" type="search" class="input h-9 pl-9" placeholder="Name, file or IP" aria-label="Search activity" @input="debounced">
        </div>
        <button class="icon-btn" :disabled="busy" @click="load()" title="Refresh" aria-label="Refresh activity"><Icon :name="busy ? 'loader' : 'rotate'" :size="16" /></button>
      </div>
      <ul class="divide-y divide-line">
        <li v-for="a in items" :key="a.id" class="px-5 py-2.5 flex items-start gap-3 text-[13px]">
          <Icon :name="meta(a)[1]" :size="15" class="mt-0.5 shrink-0" :class="meta(a)[2] === 'danger' ? 'text-danger' : 'text-muted'" />
          <div class="flex-1 min-w-0">
            <p class="break-words"><b class="font-medium">{{ a.username || 'AkulavBox' }}</b> <span :class="meta(a)[2] === 'danger' ? 'text-danger' : ''">{{ meta(a)[0] }}</span>{{ a.target ? ' ' : '' }}<span v-if="a.target" class="font-medium">{{ a.target }}</span></p>
            <p v-if="a.detail" class="text-[12px] text-muted break-words line-clamp-2" :title="a.detail">{{ a.detail }}</p>
          </div>
          <div class="text-right shrink-0 text-[12px] text-muted">
            <p :title="new Date(a.at).toLocaleString()">{{ formatRelative(a.at) }}</p>
            <p v-if="a.ip" class="font-mono text-[11px] text-faint">{{ a.ip }}</p>
          </div>
        </li>
        <li v-if="!items.length && !busy" class="px-5 py-8 text-center text-muted text-[13.5px]">Nothing recorded{{ f.kind || f.user || f.q ? ' that matches' : ' yet' }}.</li>
      </ul>
      <div class="px-5 py-3 border-t border-line flex items-center gap-3 text-[12px] text-faint">
        <span class="flex-1">Kept for {{ keepDays }} days.</span>
        <button v-if="next" class="btn btn-sm" :disabled="busy" @click="load(true)"><Icon :name="busy ? 'loader' : 'chevron-down'" :size="14" />Show older</button>
      </div>
    </section>
  `,
  setup() {
    const state = reactive({ items: [], next: null, busy: false, keepDays: 180, f: { kind: '', user: '', q: '' } });
    const meta = (a) => ACTIONS[a.action] || [a.action, 'info'];

    async function load(more = false) {
      state.busy = true;
      const p = new URLSearchParams({ limit: '60' });
      for (const [k, v] of Object.entries(state.f)) if (v) p.set(k, v);
      if (more && state.next) p.set('before', String(state.next));
      try {
        const r = await api(`/api/admin/activity?${p}`);
        state.items = more ? [...state.items, ...r.items] : r.items;
        state.next = r.next; state.keepDays = r.keep_days || state.keepDays;
      } catch (e) { toast.error(e.message); }
      finally { state.busy = false; }
    }
    let t = null;
    const debounced = () => { clearTimeout(t); t = setTimeout(() => load(), 300); };

    onMounted(() => load());
    return { ...toRefs(state), meta, load, debounced, formatRelative, KINDS };
  },
};
