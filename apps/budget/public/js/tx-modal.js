// Adding or editing one transaction.
import { api } from './api.js';
import { store, bump, toast, closeTransaction } from './store.js';
import { money, todayISO } from './format.js';
import { CategoryIcon } from './icons.js';

const LAST_CURRENCY_KEY = 'florin-last-currency';
const lastCurrency = () => {
  try {
    return localStorage.getItem(LAST_CURRENCY_KEY);
  } catch {
    return null;
  }
};

export const TransactionModal = {
  components: { CategoryIcon },
  props: { transaction: Object, defaults: { type: Object, default: () => ({}) } },
  data() {
    const t = this.transaction;
    return {
      store,
      form: {
        kind: t?.kind ?? this.defaults.kind ?? 'expense',
        amount: t ? String(t.amount) : '',
        currency: t?.currency ?? lastCurrency() ?? store.user.baseCurrency,
        categoryId: t?.categoryId ?? this.defaults.categoryId ?? null,
        date: t?.date ?? todayISO(),
        payee: t?.payee ?? '',
        note: t?.note ?? '',
      },
      payees: [],
      busy: false,
      error: '',
      kinds: [
        { value: 'expense', label: 'Expense' },
        { value: 'income', label: 'Income' },
      ],
    };
  },
  computed: {
    editing() {
      return !!this.transaction;
    },
    base: () => store.user.baseCurrency,
    visibleCats() {
      return store.categories.filter((c) => c.kind === this.form.kind && (!c.archived || c.id === this.form.categoryId));
    },
    amountNum() {
      return Number(String(this.form.amount).replace(',', '.'));
    },
    /** The amount in the main currency, when it's another one */
    converted() {
      const rates = Object.fromEntries(store.currencies.map((c) => [c.code, c.rate]));
      const { currency } = this.form;
      if (currency === this.base || !(this.amountNum > 0) || !rates[currency] || !rates[this.base]) return null;
      return money((this.amountNum / rates[currency]) * rates[this.base], this.base);
    },
  },
  watch: {
    'form.kind'() {
      this.form.categoryId = null;
    },
  },
  created() {
    api.get('/transactions/payees').then((d) => (this.payees = d.payees)).catch(() => {});
  },
  methods: {
    close: closeTransaction,
    onAmount(e) {
      this.form.amount = e.target.value.replace(/[^\d.,]/g, '');
      e.target.value = this.form.amount;
    },
    /** A known payee picks its usual category */
    onPayee() {
      const v = this.form.payee.toLowerCase();
      const match = this.payees.find((p) => p.name.toLowerCase() === v);
      if (match?.categoryId && !this.form.categoryId && store.categories.some((c) => c.id === match.categoryId && c.kind === this.form.kind)) {
        this.form.categoryId = match.categoryId;
      }
    },
    async submit() {
      this.error = '';
      if (!(this.amountNum > 0)) return (this.error = 'Enter an amount greater than zero.');
      this.busy = true;
      try {
        const body = { ...this.form, amount: this.amountNum };
        if (this.editing) await api.patch(`/transactions/${this.transaction.id}`, body);
        else await api.post('/transactions', body);
        try {
          localStorage.setItem(LAST_CURRENCY_KEY, this.form.currency);
        } catch {
          /* storage unavailable */
        }
        toast.success(this.editing ? 'Transaction updated' : `${this.form.kind === 'expense' ? 'Expense' : 'Income'} added`);
        bump();
        this.close();
      } catch (err) {
        this.error = err.message;
      } finally {
        this.busy = false;
      }
    },
    async remove() {
      if (!confirm('Delete this transaction? This cannot be undone.')) return;
      this.busy = true;
      try {
        await api.del(`/transactions/${this.transaction.id}`);
        toast.success('Transaction deleted');
        bump();
        this.close();
      } catch (err) {
        this.error = err.message;
        this.busy = false;
      }
    },
  },
  template: /*html*/ `
    <Modal :title="editing ? 'Edit transaction' : 'New transaction'" @close="close">
      <form @submit.prevent="submit" class="space-y-5">
        <Segmented class="!flex w-full [&>button]:flex-1" v-model="form.kind" :options="kinds" />

        <div>
          <div class="flex items-stretch gap-2">
            <input inputmode="decimal" placeholder="0.00" :value="form.amount" @input="onAmount" class="input num !h-14 flex-1 !text-2xl font-semibold" aria-label="Amount" />
            <select v-model="form.currency" class="input !h-14 !w-28 font-semibold" aria-label="Currency">
              <option v-for="c in store.currencies" :key="c.code" :value="c.code">{{ c.code }}</option>
            </select>
          </div>
          <p v-if="converted" class="num mt-1.5 text-xs text-ink-3">≈ {{ converted }} in your base currency</p>
        </div>

        <div>
          <span class="mb-2 block text-[13px] font-medium text-ink-2">Category</span>
          <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
            <button v-for="c in visibleCats" :key="c.id" type="button" @click="form.categoryId = form.categoryId === c.id ? null : c.id" :aria-pressed="form.categoryId === c.id"
              :class="['flex flex-col items-center gap-1.5 rounded-xl border px-1 py-2.5 text-center text-[12px] font-medium transition', form.categoryId === c.id ? 'border-transparent ring-2' : 'border-line hover:bg-surface-2']"
              :style="form.categoryId === c.id ? { '--tw-ring-color': c.color, backgroundColor: c.color + '14' } : null">
              <CategoryIcon :icon="c.icon" :color="c.color" size="sm" />
              <span class="line-clamp-1 w-full px-0.5 text-ink">{{ c.name }}</span>
            </button>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <Field label="Date"><input type="date" class="input" v-model="form.date" required /></Field>
          <Field :label="form.kind === 'expense' ? 'Payee' : 'Source'">
            <input class="input" list="payee-list" v-model="form.payee" @input="onPayee" placeholder="e.g. Lidl" maxlength="120" />
            <datalist id="payee-list"><option v-for="p in payees" :key="p.name" :value="p.name" /></datalist>
          </Field>
        </div>
        <Field label="Note"><textarea class="input" rows="2" v-model="form.note" placeholder="Optional" maxlength="500"></textarea></Field>
        <p v-if="error" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{{ error }}</p>
        <button type="submit" class="hidden"></button>
      </form>
      <template #footer>
        <div class="flex w-full items-center justify-between gap-2">
          <Btn v-if="editing" variant="danger-ghost" icon="trash-2" @click="remove" :disabled="busy">Delete</Btn>
          <span v-else class="hidden text-xs text-ink-3 sm:block">Tip: press <kbd class="rounded border border-line px-1">N</kbd> anywhere to add</span>
          <div class="flex gap-2">
            <Btn variant="secondary" @click="close">Cancel</Btn>
            <Btn @click="submit" :loading="busy">{{ editing ? 'Save changes' : 'Add' }}</Btn>
          </div>
        </div>
      </template>
    </Modal>`,
};
