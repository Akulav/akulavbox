// The account's name and main currency, the theme, and the CSV export.
import { api, API } from '../api.js';
import { store, bump, toast } from '../store.js';
import { dateLabel } from '../format.js';

export default {
  data: () => ({
    store,
    profile: { name: store.user.name, baseCurrency: store.user.baseCurrency },
    busy: false,
    error: '',
    themes: [
      ['light', 'Light', 'sun'],
      ['dark', 'Dark', 'moon'],
      ['system', 'System', 'monitor'],
    ],
  }),
  computed: {
    since: () => `Using Florin since ${dateLabel(store.user.createdAt?.slice(0, 10), 'MMMM yyyy')}`,
    signedIn: () => `Signed in as ${store.user.username}. The same account opens every app on this server.`,
  },
  methods: {
    async saveProfile() {
      this.busy = true;
      this.error = '';
      try {
        store.user = (await api.patch('/auth/me', this.profile)).user;
        bump();
        toast.success('Profile saved');
      } catch (err) {
        this.error = err.message;
      } finally {
        this.busy = false;
      }
    },
    openProfile: () => (window.location.href = '/box/#/profile'),
    exportAll: () => (window.location.href = `${API}/transactions/export.csv`),
  },
  template: /*html*/ `
    <div class="max-w-3xl">
      <PageHeader title="Settings" :subtitle="since" />
      <div class="space-y-5">
        <Card title="Profile" subtitle="The name Florin shows and your main currency.">
          <form @submit.prevent="saveProfile" class="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><input class="input" v-model="profile.name" required maxlength="80" /></Field>
            <Field label="Main currency" hint="All totals and charts are shown in this currency.">
              <select class="input" v-model="profile.baseCurrency">
                <option v-for="c in store.currencies" :key="c.code" :value="c.code">{{ c.code }} — {{ c.name }}</option>
              </select>
            </Field>
            <p v-if="error" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger sm:col-span-2">{{ error }}</p>
            <div class="sm:col-span-2"><Btn type="submit" :loading="busy">Save profile</Btn></div>
          </form>
        </Card>

        <Card title="Appearance">
          <div class="grid grid-cols-3 gap-3">
            <button v-for="[v, label, icon] in themes" :key="v" type="button" @click="store.themePref = v" :aria-pressed="store.themePref === v"
              :class="['flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium transition', store.themePref === v ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line text-ink-2 hover:bg-surface-2']">
              <Icon :name="icon" :size="20" />
              {{ label }}
            </button>
          </div>
        </Card>

        <Card title="Sign-in" :subtitle="signedIn">
          <p class="mb-4 text-sm text-ink-3">Change your password or sign out other devices in your account profile.</p>
          <Btn variant="secondary" icon="key-round" @click="openProfile">Open my profile</Btn>
        </Card>

        <Card title="Your data">
          <p class="mb-4 text-sm text-ink-3">Download every transaction as a CSV file you can open in Excel, Numbers or Google Sheets.</p>
          <Btn variant="secondary" @click="exportAll">Export all transactions</Btn>
        </Card>
      </div>
    </div>`,
};
