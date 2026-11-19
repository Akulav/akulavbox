// e-Management: Componente de bază: ferestre, dialoguri, marca aplicației.
import { store } from '/docs/js/state.js';

// ---------- componente de bază ----------
// Ferestrele deschise, în ordine; Escape o închide doar pe cea de deasupra.
export const modalStack = [];
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) {
    e.preventDefault();
    modalStack[modalStack.length - 1].cancel();
  }
});

export const Modal = {
  props: {
    title: String,
    wide: Boolean,
    xl: Boolean,
    busy: Boolean,
    danger: Boolean,
    okLabel: { type: String, default: 'Salvează' },
    busyLabel: { type: String, default: 'Se salvează…' },
    cancelLabel: { type: String, default: 'Anulează' },
  },
  emits: ['close', 'submit'],
  methods: {
    // în timpul salvării fereastra rămâne deschisă, ca utilizatorul să vadă rezultatul
    cancel() {
      if (!this.busy) this.$emit('close');
    },
  },
  mounted() {
    modalStack.push(this);
    this.lastFocus = document.activeElement;
    const el =
      this.$el.querySelector('[autofocus]') ||
      this.$el.querySelector('.modal-body input:not([type=hidden]):not([type=checkbox]):not([type=radio]), .modal-body select, .modal-body textarea') ||
      this.$el.querySelector('.modal-foot .btn:last-child');
    if (el) el.focus();
  },
  unmounted() {
    const i = modalStack.indexOf(this);
    if (i >= 0) modalStack.splice(i, 1);
    if (this.lastFocus && document.contains(this.lastFocus)) this.lastFocus.focus();
  },
  template: /*html*/ `
    <div class="overlay" @mousedown.self="cancel">
      <form class="modal" :class="{ wide, xl }" role="dialog" aria-modal="true" :aria-label="title" @submit.prevent="busy || $emit('submit')">
        <div class="modal-head"><h2>{{ title }}</h2><button type="button" class="x" @click="cancel" aria-label="Închide">×</button></div>
        <div class="modal-body"><slot /></div>
        <div class="modal-foot">
          <button v-if="cancelLabel" type="button" class="btn" :disabled="busy" @click="cancel">{{ cancelLabel }}</button>
          <button class="btn" :class="danger ? 'danger-solid' : 'primary'" :disabled="busy">{{ busy ? busyLabel : okLabel }}</button>
        </div>
      </form>
    </div>`,
};

export const DialogHost = {
  components: { Modal },
  computed: { d: () => store.dialog },
  methods: {
    close(result) {
      const d = store.dialog;
      store.dialog = null;
      if (d) d.resolve(result);
    },
    ok() {
      if (!this.d.input) return this.close(true);
      const v = this.d.value.trim();
      if (v) this.close(v);
    },
  },
  template: /*html*/ `
    <Modal v-if="d" :title="d.title" :ok-label="d.okLabel" :cancel-label="d.cancelLabel === undefined ? 'Anulează' : d.cancelLabel" :danger="d.danger" @close="close(d.input ? null : false)" @submit="ok">
      <p v-if="d.message" class="dialog-msg">{{ d.message }}</p>
      <label v-if="d.input" class="field"><span>{{ d.label }}</span><input v-model="d.value" :maxlength="d.maxlength || 200" required autofocus /></label>
    </Modal>`,
};

export const Brand = {
  template: /*html*/ `<a class="brand" href="/" title="Toate aplicațiile"><img class="brand-logo" src="/docs/favicon.svg" alt="" width="30" height="30" /><span>e-Management</span></a>`,
};

// Fără sesiune (sau fără acces la aplicație): trimitere la pagina comună de intrare, ori un mesaj.
export const NoAccess = {
  components: { Brand },
  computed: { error: () => store.error },
  template: /*html*/ `
    <div class="login-wrap">
      <div class="login">
        <Brand />
        <h1>e-Management</h1>
        <p class="muted small login-sub">{{ error || 'Se deschide pagina de autentificare…' }}</p>
        <a class="btn primary block" href="/">Toate aplicațiile</a>
      </div>
    </div>`,
};
