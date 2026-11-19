// e-Management: Categorii și etichete.
import { store, sp, spaceLabel, ask, api, run, loadCategories } from '/docs/js/state.js';
import { Modal } from '/docs/js/ui.js';

// ---------- categorii și etichete ----------
export const CategoriesView = {
  components: { Modal },
  data: () => ({ catForm: null, newTag: {}, busy: false }),
  computed: { store: () => store, space: spaceLabel },
  methods: {
    act(fn, msg) {
      return run(async () => {
        await fn();
        await loadCategories();
      }, msg);
    },
    async saveCat() {
      const f = this.catForm;
      this.busy = true;
      const ok = await this.act(() => api(f.id ? sp('/categories/' + f.id) : sp('/categories'), { method: f.id ? 'PUT' : 'POST', body: f }), 'Categoria a fost salvată.');
      this.busy = false;
      if (ok) this.catForm = null;
    },
    async removeCat(c) {
      const ok = await ask({
        title: 'Ștergeți categoria?',
        message: '„' + c.name + '” va fi ștearsă împreună cu toate etichetele ei. Documentele rămân, dar pierd aceste etichete.',
        okLabel: 'Șterge categoria',
        danger: true,
      });
      if (ok) this.act(() => api(sp('/categories/' + c.id), { method: 'DELETE' }), 'Categoria a fost ștearsă.');
    },
    async addTag(c) {
      const name = (this.newTag[c.id] || '').trim();
      if (!name) return;
      if (await this.act(() => api(sp('/tags'), { method: 'POST', body: { category_id: c.id, name } }))) this.newTag[c.id] = '';
    },
    async renameTag(t) {
      const name = await ask({ title: 'Redenumește eticheta', input: true, label: 'Denumirea etichetei', value: t.name, maxlength: 80, okLabel: 'Salvează' });
      if (name && name !== t.name) this.act(() => api(sp('/tags/' + t.id), { method: 'PUT', body: { name } }), 'Eticheta a fost redenumită.');
    },
    async removeTag(t) {
      const ok = await ask({
        title: 'Ștergeți eticheta?',
        message: '„' + t.name + '” va fi ștearsă. Documentele rămân, dar pierd această etichetă.',
        okLabel: 'Șterge eticheta',
        danger: true,
      });
      if (ok) this.act(() => api(sp('/tags/' + t.id), { method: 'DELETE' }), 'Eticheta a fost ștearsă.');
    },
  },
  template: /*html*/ `
    <div class="page-head">
      <div>
        <h1>Categorii și etichete</h1>
        <p class="muted page-sub">Spațiul {{ space.toLowerCase() }}. Categoriile grupează etichetele (ex. „Finanțe” → „Facturi”). La adăugarea unui document se aleg una sau mai multe etichete.</p>
      </div>
      <button class="btn primary" @click="catForm = { id: null, name: '', color: '#1d4e89', sort: 0 }">+ Adaugă categorie</button>
    </div>
    <div class="cats">
      <div v-for="c in store.categories" :key="c.id" class="card cat" :style="{ borderTopColor: c.color }">
        <div class="cat-head">
          <h2>{{ c.name }}</h2>
          <button class="btn link" @click="catForm = { id: c.id, name: c.name, color: c.color, sort: c.sort }">Modifică</button>
          <button class="btn link danger" @click="removeCat(c)">Șterge</button>
        </div>
        <div v-for="t in c.tags" :key="t.id" class="tagrow">
          <span>{{ t.name }}</span>
          <span><button class="btn link" @click="renameTag(t)">Redenumește</button><button class="btn link danger" @click="removeTag(t)">Șterge</button></span>
        </div>
        <div v-if="!c.tags.length" class="muted small">Nicio etichetă încă.</div>
        <form class="addrow" @submit.prevent="addTag(c)">
          <input v-model="newTag[c.id]" maxlength="80" placeholder="Etichetă nouă…" />
          <button class="btn">Adaugă</button>
        </form>
      </div>
    </div>
    <div v-if="!store.categories.length" class="card empty">Nicio categorie. Adăugați prima categorie pentru a putea eticheta documentele.</div>

    <Modal v-if="catForm" :title="catForm.id ? 'Modifică categoria' : 'Categorie nouă'" :busy="busy" @close="catForm = null" @submit="saveCat">
      <label class="field"><span>Denumirea *</span><input v-model="catForm.name" maxlength="80" required autofocus placeholder="ex. Finanțe" /></label>
      <div class="row">
        <label class="field"><span>Culoarea</span><input v-model="catForm.color" type="color" /></label>
        <label class="field"><span>Ordinea de afișare</span><input v-model.number="catForm.sort" type="number" /></label>
      </div>
    </Modal>`,
};
