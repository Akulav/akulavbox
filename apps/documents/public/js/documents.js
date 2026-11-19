// e-Management: Documentele: lista, fișa unui document, formularul.
import { store, sp, spaceLabel, toast, ask, api, run, loadDocs } from '/docs/js/state.js';
import { MONTHS, today, fmtSize, tagIndex, chipStyle, docDay, docMon } from '/docs/js/util.js';
import { Modal } from '/docs/js/ui.js';

// ---------- documente ----------

export const DocForm = {
  components: { Modal },
  props: { doc: Object },
  emits: ['close', 'saved'],
  data() {
    const d = this.doc;
    return {
      busy: false,
      dragging: false,
      newFiles: [],
      form: {
        title: d ? d.title : '',
        number: d ? d.number : '',
        doc_date: d ? d.doc_date : today(),
        description: d ? d.description : '',
        tagIds: d ? [...d.tagIds] : [],
        removeFileIds: [],
      },
    };
  },
  computed: {
    store: () => store,
    keptFiles() {
      return this.doc ? this.doc.files.filter((f) => !this.form.removeFileIds.includes(f.id)) : [];
    },
  },
  methods: {
    fmtSize,
    toggle(list, id) {
      const i = list.indexOf(id);
      if (i < 0) list.push(id);
      else list.splice(i, 1);
    },
    dragLeave(e) {
      if (!e.currentTarget.contains(e.relatedTarget)) this.dragging = false;
    },
    tagStyle(c, t) {
      return this.form.tagIds.includes(t.id) ? { background: c.color, borderColor: c.color } : { borderColor: c.color, color: c.color };
    },
    // Fișierele se adună la fiecare alegere, deci se pot adăuga pe rând .docx, .pdf etc.
    addFiles(list) {
      for (const f of list) {
        if (this.newFiles.some((x) => x.name === f.name && x.size === f.size)) continue;
        if (this.newFiles.length >= 10) return toast('Cel mult 10 fișiere noi la o salvare.', true);
        if (f.size > 50 * 1024 * 1024) toast('„' + f.name + '” depășește 50 MB.', true);
        else this.newFiles.push(f);
      }
    },
    drop(e) {
      this.dragging = false;
      this.addFiles(e.dataTransfer.files);
    },
    async submit() {
      const fd = new FormData();
      fd.append('data', JSON.stringify(this.form));
      for (const f of this.newFiles) fd.append('files', f);
      this.busy = true;
      try {
        await api(this.doc ? sp('/documents/' + this.doc.id) : sp('/documents'), { method: this.doc ? 'PUT' : 'POST', form: fd });
        toast(this.doc ? 'Documentul a fost actualizat.' : 'Documentul a fost adăugat.');
        await loadDocs();
        this.$emit('saved');
      } catch (e) {
        toast(e.message, true);
      }
      this.busy = false;
    },
  },
  template: /*html*/ `
    <Modal xl :title="doc ? 'Modifică documentul' : 'Document nou'" :busy="busy" @close="$emit('close')" @submit="submit">
      <div class="form-cols">
        <div>
          <label class="field"><span>Denumirea documentului *</span><input v-model="form.title" maxlength="300" required autofocus /></label>
          <div class="row">
            <label class="field"><span>Data documentului *</span><input v-model="form.doc_date" type="date" required /></label>
            <label class="field"><span>Număr</span><input v-model="form.number" maxlength="60" placeholder="ex. 15-P" /></label>
          </div>
          <label class="field"><span>Descriere</span><textarea v-model="form.description" rows="4" maxlength="5000"></textarea></label>

          <div class="section-title">Fișiere</div>
          <div class="drop" :class="{ over: dragging }" @dragover.prevent="dragging = true" @dragleave="dragLeave" @drop.prevent="drop">
            <input ref="files" type="file" multiple hidden @change="addFiles($event.target.files); $event.target.value = ''" />
            Trageți fișierele aici sau
            <button type="button" class="btn sm" @click="$refs.files.click()">Alegeți fișiere</button>
            <div class="muted small">Mai multe fișiere pe același document (.pdf, .docx, .xlsx…), max. 50 MB fiecare</div>
          </div>
          <ul v-if="keptFiles.length || newFiles.length" class="filelist">
            <li v-for="f in keptFiles" :key="'k' + f.id">
              <span class="fname">{{ f.name }}</span><span class="muted small">{{ fmtSize(f.size) }}</span>
              <button type="button" class="btn link danger" @click="form.removeFileIds.push(f.id)">Elimină</button>
            </li>
            <li v-for="(f, i) in newFiles" :key="'n' + i">
              <span class="fname">{{ f.name }}</span><span class="badge new">nou</span><span class="muted small">{{ fmtSize(f.size) }}</span>
              <button type="button" class="btn link danger" @click="newFiles.splice(i, 1)">Elimină</button>
            </li>
          </ul>
        </div>

        <div>
          <div class="section-title">Etichete</div>
          <div v-if="!store.categories.length" class="muted small">Nu există încă nicio categorie. Le puteți crea în pagina „Categorii”.</div>
          <div v-for="c in store.categories" :key="c.id" class="pick-group">
            <div>{{ c.name }}</div>
            <div class="pick">
              <button v-for="t in c.tags" :key="t.id" type="button" :class="{ on: form.tagIds.includes(t.id) }" :style="tagStyle(c, t)" @click="toggle(form.tagIds, t.id)">{{ t.name }}</button>
              <span v-if="!c.tags.length" class="muted small">fără etichete</span>
            </div>
          </div>
        </div>
      </div>
    </Modal>`,
};

export const EXT_KIND = { pdf: 'pdf', doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', xls: 'xls', xlsx: 'xls', csv: 'xls', png: 'img', jpg: 'img', jpeg: 'img', p7s: 'sig', asice: 'sig', sig: 'sig' };
export const FileLink = {
  props: { file: Object },
  computed: {
    ext() {
      const m = /\.([a-z0-9]{1,5})$/i.exec(this.file.name);
      return m ? m[1].toLowerCase() : 'fișier';
    },
    kind() {
      return EXT_KIND[this.ext] || 'other';
    },
  },
  methods: { fmtSize, sp },
  template: /*html*/ `
    <a class="file" :href="sp('/files/' + file.id)" target="_blank" rel="noopener" :title="file.signed_by_name ? 'Versiune semnată de ' + file.signed_by_name : null">
      <span class="ext" :class="kind">{{ ext }}</span><span class="fname">{{ file.name }}</span><span class="muted small">{{ fmtSize(file.size) }}</span>
    </a>`,
};

// Datele din baza de date sunt în UTC ('AAAA-LL-ZZ OO:MM:SS'); le afișăm în ora locală.

export const DocCard = {
  components: { FileLink },
  props: { doc: Object },
  emits: ['edit'],
  computed: {
    tags: () => tagIndex(),
  },
  methods: {
    chipStyle,
    docDay,
    docMon,
    async remove() {
      const ok = await ask({
        title: 'Ștergeți documentul?',
        message: '„' + this.doc.title + '” va fi șters definitiv, împreună cu toate fișierele atașate. Acțiunea nu poate fi anulată.',
        okLabel: 'Șterge definitiv',
        danger: true,
      });
      if (!ok) return;
      await run(async () => {
        await api(sp('/documents/' + this.doc.id), { method: 'DELETE' });
        await loadDocs();
      }, 'Documentul a fost șters.');
    },
  },
  template: /*html*/ `
    <article class="card doc">
      <div class="doc-date"><b>{{ docDay(doc) }}</b><span>{{ docMon(doc) }}</span></div>
      <div class="doc-body">
        <div class="doc-title">{{ doc.title }}<span v-if="doc.number" class="doc-nr">nr. {{ doc.number }}</span></div>
        <p v-if="doc.description" class="doc-desc">{{ doc.description }}</p>
        <div v-if="doc.files.length" class="files">
          <FileLink v-for="f in doc.files" :key="f.id" :file="f" />
        </div>
        <div v-if="doc.tagIds.length" class="doc-meta">
          <template v-for="id in doc.tagIds" :key="id">
            <span v-if="tags.get(id)" class="chip" :style="chipStyle(tags.get(id).color)">{{ tags.get(id).name }}</span>
          </template>
        </div>
      </div>
      <div class="doc-actions">
        <button class="btn link" @click="$emit('edit', doc)">Modifică</button>
        <button class="btn link danger" @click="remove">Șterge</button>
      </div>
    </article>`,
};

export const DocsView = {
  components: { DocForm, DocCard },
  data: () => ({ sel: { type: 'all', id: null }, year: '', q: '', editing: undefined }),
  computed: {
    store: () => store,
    docs: () => store.docs,
    tags: () => tagIndex(),
    space: spaceLabel,
    years() {
      return [...new Set(this.docs.map((d) => d.doc_date.slice(0, 4)))];
    },
    counts() {
      const tag = {};
      const cat = {};
      for (const d of this.docs) {
        const cats = new Set();
        for (const id of d.tagIds) {
          tag[id] = (tag[id] || 0) + 1;
          const t = this.tags.get(id);
          if (t) cats.add(t.category_id);
        }
        for (const c of cats) cat[c] = (cat[c] || 0) + 1;
      }
      return { tag, cat };
    },
    filtered() {
      const q = this.q.trim().toLowerCase();
      return this.docs.filter((d) => {
        if (this.year && !d.doc_date.startsWith(this.year)) return false;
        if (this.sel.type === 'tag' && !d.tagIds.includes(this.sel.id)) return false;
        if (this.sel.type === 'cat' && !d.tagIds.some((id) => (this.tags.get(id) || {}).category_id === this.sel.id)) return false;
        if (!q) return true;
        const hay = [d.title, d.number, d.description, ...d.files.map((f) => f.name), ...d.tagIds.map((id) => (this.tags.get(id) || {}).name)];
        return hay.join(' ').toLowerCase().includes(q);
      });
    },
    // Lista vine deja ordonată după data documentului (cele mai recente primele); aici doar o grupăm pe luni.
    groups() {
      const out = [];
      for (const d of this.filtered) {
        const key = d.doc_date.slice(0, 7);
        if (!out.length || out[out.length - 1].key !== key) {
          out.push({ key, label: MONTHS[Number(key.slice(5)) - 1] + ' ' + key.slice(0, 4), docs: [] });
        }
        out[out.length - 1].docs.push(d);
      }
      return out;
    },
  },
  watch: {
    // filtrele țin de categoriile unui spațiu; la schimbarea spațiului pornim de la zero
    'store.space'() {
      this.sel = { type: 'all', id: null };
      this.year = '';
      this.editing = undefined;
    },
  },
  methods: {
    isSel(type, id) {
      return this.sel.type === type && this.sel.id === id;
    },
  },
  template: /*html*/ `
    <div class="page-head">
      <div>
        <h1>Documente</h1>
        <p class="muted page-sub">Spațiul {{ space.toLowerCase() }}</p>
      </div>
      <button class="btn primary" @click="editing = null">+ Adaugă document</button>
    </div>
    <div class="docs">
      <aside class="card side">
        <button class="side-item" :class="{ on: sel.type === 'all' }" @click="sel = { type: 'all', id: null }">
          <span>Toate documentele</span><span class="count">{{ docs.length }}</span>
        </button>
        <template v-for="c in store.categories" :key="c.id">
          <button class="side-item side-cat" :class="{ on: isSel('cat', c.id) }" @click="sel = { type: 'cat', id: c.id }">
            <span><i class="dot" :style="{ background: c.color }"></i>{{ c.name }}</span><span class="count">{{ counts.cat[c.id] || 0 }}</span>
          </button>
          <button v-for="t in c.tags" :key="t.id" class="side-item side-tag" :class="{ on: isSel('tag', t.id) }" @click="sel = { type: 'tag', id: t.id }">
            <span>{{ t.name }}</span><span class="count">{{ counts.tag[t.id] || 0 }}</span>
          </button>
        </template>
      </aside>

      <section>
        <div class="toolbar">
          <input v-model="q" type="search" placeholder="Caută după denumire, număr, descriere, fișier…" />
          <select v-model="year" aria-label="Anul">
            <option value="">Toți anii</option>
            <option v-for="y in years" :key="y">{{ y }}</option>
          </select>
        </div>

        <div v-if="store.docsLoaded && !groups.length" class="card empty">
          {{ docs.length ? 'Niciun document nu corespunde filtrelor.' : 'Încă nu există documente în acest spațiu.' }}
        </div>
        <template v-for="g in groups" :key="g.key">
          <div class="month">{{ g.label }}</div>
          <DocCard v-for="d in g.docs" :key="d.id" :doc="d" @edit="editing = $event" />
        </template>
      </section>
    </div>
    <DocForm v-if="editing !== undefined" :key="store.space" :doc="editing" @close="editing = undefined" @saved="editing = undefined" />`,
};
