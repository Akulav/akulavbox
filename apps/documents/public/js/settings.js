// e-Management: Setări: contul, spațiul de stocare, copia de rezervă.
import { store, spaceLabel } from '/docs/js/state.js';
import { fmtSize } from '/docs/js/util.js';
import { BackupView } from '/docs/js/backup.js';

// ---------- setări ----------
export const SettingsView = {
  components: { BackupView },
  computed: {
    space: spaceLabel,
    me: () => store.me,
    pct() {
      const m = store.me;
      return m.quota_bytes ? Math.min(100, Math.round((m.used_bytes / m.quota_bytes) * 100)) : 0;
    },
  },
  methods: { fmtSize },
  template: /*html*/ `
    <div class="settings-page">
      <div class="page-head">
        <div>
          <h1>Setări</h1>
          <p class="muted page-sub">Contul dvs. și copia de rezervă a spațiului „{{ space }}”.</p>
        </div>
      </div>
      <div class="settings-grid">
        <div class="settings-col">
          <div class="card panel">
            <div class="panel-head"><h2>Cont</h2></div>
            <p>Sunteți autentificat ca <strong>{{ me.username }}</strong>. Același cont deschide toate aplicațiile de pe acest server.</p>
            <p class="muted small">Parola și deconectarea de pe alte dispozitive se schimbă în profilul contului.</p>
            <div class="panel-foot"><a class="btn" href="/box/#/profile">Deschide profilul</a></div>
          </div>
          <div v-if="me.quota_bytes" class="card panel">
            <div class="panel-head"><h2>Spațiu de stocare</h2></div>
            <p>{{ fmtSize(me.used_bytes) }} din {{ fmtSize(me.quota_bytes) }} folosiți ({{ pct }}%), în ambele spații.</p>
            <div class="quota-bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: pct + '%' }"></span></div>
            <p class="muted small">Pentru mai mult spațiu, adresați-vă administratorului.</p>
          </div>
        </div>
        <BackupView />
      </div>
    </div>`,
};
