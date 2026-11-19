// e-Management: Jurnalul de activitate.
import { toast, ask, api, run } from '/docs/js/state.js';
import { fmtDateTime, yesterday } from '/docs/js/util.js';

// ---------- jurnal de activitate ----------
export const AuditView = {
  data: () => ({ rows: [], total: 0, oldest: null, retention: 90, q: '', until: yesterday(), busy: false, loaded: false }),
  computed: {
    shown() {
      const q = this.q.trim().toLowerCase();
      return q ? this.rows.filter((r) => (r.action + ' ' + r.details + ' ' + r.ip).toLowerCase().includes(q)) : this.rows;
    },
    maxDate: yesterday,
  },
  methods: {
    fmtDateTime,
    async load() {
      await run(async () => {
        const r = await api('/docs/api/audit');
        Object.assign(this, { rows: r.rows, total: r.total, oldest: r.oldest, retention: r.retentionDays });
      });
      this.loaded = true;
    },
    async prune() {
      if (!this.until) return;
      const shown = this.until.split('-').reverse().join('.');
      const ok = await ask({
        title: 'Curățați jurnalul?',
        message: 'Toate înregistrările până la ' + shown + ' inclusiv vor fi șterse definitiv. Ștergerea va rămâne consemnată în jurnal.',
        okLabel: 'Șterge înregistrările',
        danger: true,
      });
      if (!ok) return;
      this.busy = true;
      let r;
      if (await run(async () => (r = await api('/docs/api/audit/prune', { method: 'POST', body: { until: this.until } })))) {
        toast(r.deleted ? r.deleted + ' înregistrări au fost șterse.' : 'Nu existau înregistrări până la această dată.');
        await this.load();
      }
      this.busy = false;
    },
  },
  mounted() {
    this.load();
  },
  template: /*html*/ `
    <div class="page-head">
      <div>
        <h1>Jurnal de activitate</h1>
        <p class="muted page-sub">
          Autentificări, descărcări și modificări, din ambele spații. {{ total }} înregistrări<template v-if="oldest">, începând cu {{ fmtDateTime(oldest) }}</template><template v-if="total > rows.length"> (sunt afișate ultimele {{ rows.length }})</template>.
          Înregistrările mai vechi de {{ retention }} de zile se șterg automat.
        </p>
      </div>
      <div class="head-actions">
        <input v-model="q" type="search" placeholder="Filtrează după acțiune, document…" class="search-sm" aria-label="Filtrează jurnalul" />
        <form class="prune" @submit.prevent="prune">
          <label class="prune-label" for="prune-until">Șterge până la</label>
          <input id="prune-until" v-model="until" type="date" :max="maxDate" required />
          <button class="btn danger" :disabled="busy || !until">{{ busy ? 'Se șterge…' : 'Curăță' }}</button>
        </form>
      </div>
    </div>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Data</th><th>Acțiune</th><th>Detalii</th><th>Adresă IP</th></tr></thead>
        <tbody>
          <tr v-for="r in shown" :key="r.id">
            <td class="nowrap">{{ fmtDateTime(r.at) }}</td>
            <td>{{ r.action }}</td>
            <td>{{ r.details }}</td>
            <td class="muted small">{{ r.ip }}</td>
          </tr>
          <tr v-if="loaded && !shown.length"><td colspan="4" class="empty-row">{{ rows.length ? 'Nicio înregistrare nu corespunde filtrului.' : 'Jurnalul este gol.' }}</td></tr>
        </tbody>
      </table>
    </div>`,
};
