// e-Management: Copia de rezervă a unui spațiu.
import { sp, spaceLabel, toast, ask, api, loadSpace } from '/docs/js/state.js';
import { fmtSize } from '/docs/js/util.js';

// ---------- copie de rezervă ----------
export const BackupView = {
  data: () => ({ busy: false, file: null }),
  computed: {
    space: spaceLabel,
    exportUrl: () => sp('/export'),
  },
  watch: {
    'space'() {
      this.file = null;
    },
  },
  methods: {
    fmtSize,
    async restore() {
      if (!this.file) return;
      const ok = await ask({
        title: 'Înlocuiți datele spațiului „' + this.space + '”?',
        message: 'Importul ÎNLOCUIEȘTE toate documentele, categoriile și fișierele din spațiul „' + this.space + '” cu cele din arhiva „' + this.file.name + '”. Celălalt spațiu nu este atins.',
        okLabel: 'Importă și înlocuiește',
        danger: true,
      });
      if (!ok) return;
      this.busy = true;
      try {
        const r = await api(sp('/import'), { method: 'POST', raw: this.file });
        window.akbBus?.post('storage');
        await loadSpace();
        this.file = null;
        await ask({
          title: 'Import finalizat',
          message: r.documents + ' documente, ' + r.files + ' fișiere.' + (r.missing ? '\n' + r.missing + ' fișiere lipseau deja la momentul exportului.' : ''),
          okLabel: 'Continuă',
          cancelLabel: '',
        });
      } catch (e) {
        toast(e.message, true);
      }
      this.busy = false;
    },
  },
  template: /*html*/ `
    <div class="settings-col">
      <section class="card panel">
        <div class="panel-head"><h2>Export</h2><span class="pill">{{ space }}</span></div>
        <p class="muted small">Un singur fișier comprimat cu tot ce conține spațiul „{{ space }}”: categorii, documente și fișiere. Fiecare element are sumă de control.</p>
        <div class="panel-foot">
          <a class="btn primary" :href="exportUrl" download>Descarcă exportul</a>
          <span class="muted small">Păstrați-l într-un loc sigur: conține toate documentele.</span>
        </div>
      </section>
      <section class="card panel danger-panel">
        <div class="panel-head"><h2>Import (restaurare)</h2><span class="pill red">Înlocuiește tot</span></div>
        <p class="muted small">Înlocuiește conținutul spațiului „{{ space }}” cu cel dintr-un export. Arhiva este verificată integral înainte; dacă este deteriorată sau incompletă, nu se schimbă nimic. Se pot importa și backupurile complete ale versiunii pentru instituții (doar documentele și categoriile).</p>
        <label class="filepick" :class="{ chosen: file }">
          <input type="file" accept=".anscbackup" :disabled="busy" @change="file = $event.target.files[0] || null" />
          <span>{{ file ? file.name + ' — ' + fmtSize(file.size) : 'Alegeți fișierul .anscbackup…' }}</span>
        </label>
        <div class="panel-foot">
          <button class="btn danger-solid" :disabled="!file || busy" @click="restore">{{ busy ? 'Se importă… nu închideți pagina' : 'Importă și înlocuiește' }}</button>
        </div>
      </section>
    </div>`,
};
