// Categories (expense and income) with monthly budgets: create, edit, archive and delete.
import { api } from '../api.js';
import { store, bump, toast } from '../store.js';
import { money, money0, currencySymbol } from '../format.js';
import { CATEGORY_COLORS, CATEGORY_ICON_NAMES, CategoryIcon } from '../icons.js';

const CategoryEditor = {
  components: { CategoryIcon },
  props: { category: Object, kind: String },
  emits: ['close'],
  data() {
    const c = this.category;
    return {
      store,
      CATEGORY_COLORS,
      CATEGORY_ICON_NAMES,
      form: { name: c?.name ?? '', icon: c?.icon ?? 'tag', color: c?.color ?? CATEGORY_COLORS[0], budget: c?.budget ? String(c.budget) : '', kind: c?.kind ?? this.kind },
      busy: false,
      error: '',
    };
  },
  computed: {
    symbol: () => currencySymbol(store.user.baseCurrency),
  },
  methods: {
    onBudget(e) {
      this.form.budget = e.target.value.replace(/[^\d.]/g, '');
      e.target.value = this.form.budget;
    },
    async save() {
      this.busy = true;
      this.error = '';
      try {
        const body = { ...this.form, budget: Number(this.form.budget) || 0 };
        if (this.category) await api.patch(`/categories/${this.category.id}`, body);
        else await api.post('/categories', body);
        toast.success(this.category ? 'Category updated' : 'Category created');
        bump();
        this.$emit('close');
      } catch (err) {
        this.error = err.message;
      } finally {
        this.busy = false;
      }
    },
  },
  template: /*html*/ `
    <Modal :title="category ? 'Edit category' : 'New category'" @close="$emit('close')">
      <form @submit.prevent="save" class="space-y-5">
        <div class="flex items-center gap-3">
          <CategoryIcon :icon="form.icon" :color="form.color" size="lg" />
          <Field label="Name" class="flex-1"><input class="input" v-model="form.name" maxlength="40" required /></Field>
        </div>
        <div>
          <span class="mb-2 block text-[13px] font-medium text-ink-2">Color</span>
          <div class="flex flex-wrap gap-2">
            <button v-for="c in CATEGORY_COLORS" :key="c" type="button" @click="form.color = c" :aria-label="'Color ' + c" :aria-pressed="form.color === c"
              :class="['h-8 w-8 rounded-full transition', form.color === c ? 'ring-2 ring-offset-2 ring-offset-surface' : 'hover:scale-110']"
              :style="{ backgroundColor: c, '--tw-ring-color': c }"></button>
          </div>
        </div>
        <div>
          <span class="mb-2 block text-[13px] font-medium text-ink-2">Icon</span>
          <div class="grid grid-cols-7 gap-1.5 sm:grid-cols-9">
            <button v-for="name in CATEGORY_ICON_NAMES" :key="name" type="button" @click="form.icon = name" :aria-label="name" :aria-pressed="form.icon === name"
              :class="['flex h-9 items-center justify-center rounded-lg border transition', form.icon === name ? 'border-transparent text-white' : 'border-line text-ink-2 hover:bg-surface-2']"
              :style="form.icon === name ? { backgroundColor: form.color } : null">
              <Icon :name="name" />
            </button>
          </div>
        </div>
        <Field v-if="form.kind === 'expense'" label="Monthly budget" :hint="'In ' + store.user.baseCurrency + '. Leave empty for no limit.'">
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">{{ symbol }}</span>
            <input class="input num has-prefix" inputmode="decimal" :value="form.budget" @input="onBudget" placeholder="0" />
          </div>
        </Field>
        <p v-if="error" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{{ error }}</p>
        <button type="submit" class="hidden"></button>
      </form>
      <template #footer>
        <Btn variant="secondary" @click="$emit('close')">Cancel</Btn>
        <Btn @click="save" :loading="busy">Save</Btn>
      </template>
    </Modal>`,
};

/** The overall monthly limit; empty = the sum of the category budgets */
const TotalBudgetEditor = {
  props: { categoryBudgets: Number },
  emits: ['close'],
  data: () => ({ value: store.user.monthlyBudget > 0 ? String(store.user.monthlyBudget) : '', busy: false, error: '' }),
  computed: {
    symbol: () => currencySymbol(store.user.baseCurrency),
    hint() {
      return `In ${store.user.baseCurrency}. Leave empty to use the sum of your category budgets (${money0(this.categoryBudgets, store.user.baseCurrency)}).`;
    },
  },
  methods: {
    onInput(e) {
      this.value = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.');
      e.target.value = this.value;
    },
    async save() {
      this.busy = true;
      this.error = '';
      try {
        store.user = (await api.patch('/auth/me', { monthlyBudget: this.value === '' ? 0 : Number(this.value) })).user;
        toast.success(this.value ? 'Monthly budget saved' : 'Using the sum of your category budgets');
        bump();
        this.$emit('close');
      } catch (err) {
        this.error = err.message;
      } finally {
        this.busy = false;
      }
    },
  },
  template: /*html*/ `
    <Modal title="Total monthly budget" size="sm" @close="$emit('close')">
      <form @submit.prevent="save" class="space-y-4">
        <Field label="Monthly budget" :hint="hint">
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">{{ symbol }}</span>
            <input class="input num has-prefix" inputmode="decimal" :value="value" @input="onInput" placeholder="No overall limit" />
          </div>
        </Field>
        <p v-if="error" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{{ error }}</p>
        <button type="submit" class="hidden"></button>
      </form>
      <template #footer>
        <Btn variant="secondary" @click="$emit('close')">Cancel</Btn>
        <Btn @click="save" :loading="busy">Save</Btn>
      </template>
    </Modal>`,
};

const CategoryCard = {
  components: { CategoryIcon },
  props: { c: { type: Object, required: true }, kind: String, currency: String },
  emits: ['edit', 'archive', 'delete'],
  computed: {
    over() {
      return this.c.budget > 0 && this.c.monthSpent > this.c.budget;
    },
  },
  methods: { money, money0 },
  template: /*html*/ `
    <div :class="['card animate-in group p-4', c.archived ? 'opacity-60' : '']">
      <div class="flex items-start gap-3">
        <CategoryIcon :icon="c.icon" :color="c.color" size="lg" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h3 class="truncate font-semibold">{{ c.name }}</h3>
            <Badge v-if="over" tone="danger">Over budget</Badge>
          </div>
          <p class="text-xs text-ink-3">{{ c.txCount }} transactions</p>
        </div>
        <div class="flex opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <IconButton icon="pencil" label="Edit" @click="$emit('edit')" />
          <IconButton :icon="c.archived ? 'archive-restore' : 'archive'" :label="c.archived ? 'Restore' : 'Archive'" @click="$emit('archive')" />
          <IconButton icon="trash-2" label="Delete" class="hover:!text-danger" @click="$emit('delete')" />
        </div>
      </div>
      <div v-if="kind === 'expense'" class="mt-4">
        <div class="mb-1.5 flex items-baseline justify-between text-xs">
          <span class="text-ink-3">This month</span>
          <span class="num">
            <span class="font-semibold text-ink">{{ money(c.monthSpent, currency) }}</span>
            <span v-if="c.budget > 0" class="text-ink-3"> / {{ money0(c.budget, currency) }}</span>
          </span>
        </div>
        <ProgressBar v-if="c.budget > 0" :value="c.monthSpent" :max="c.budget" :color="c.color" />
        <button v-else type="button" @click="$emit('edit')" class="text-xs font-medium text-brand hover:underline">Set a budget</button>
      </div>
    </div>`,
};

export default {
  components: { CategoryEditor, CategoryCard, TotalBudgetEditor },
  data: () => ({
    store,
    kind: 'expense',
    editing: null, // null | 'new' | category
    editingTotal: false,
    deleting: null,
    kinds: [
      { value: 'expense', label: 'Expenses' },
      { value: 'income', label: 'Income' },
    ],
  }),
  computed: {
    cur: () => store.user.baseCurrency,
    list() {
      return store.categories.filter((c) => c.kind === this.kind);
    },
    active() {
      return this.list.filter((c) => !c.archived);
    },
    archived() {
      return this.list.filter((c) => c.archived);
    },
    categoryBudgets() {
      return this.active.reduce((a, c) => a + c.budget, 0);
    },
    /** The overall budget when one is set, else the sum of the categories' */
    totalBudget() {
      return store.user.monthlyBudget > 0 ? store.user.monthlyBudget : this.categoryBudgets;
    },
    budgetNote() {
      if (!(store.user.monthlyBudget > 0)) return this.categoryBudgets ? 'The sum of your category budgets' : 'Set one here, or give categories a budget';
      const diff = this.totalBudget - this.categoryBudgets;
      if (!this.categoryBudgets) return 'Your overall limit';
      return diff >= 0 ? `Categories add up to ${money0(this.categoryBudgets, this.cur)}` : `Categories add up to ${money0(this.categoryBudgets, this.cur)}, more than this`;
    },
    totalSpent() {
      return this.active.reduce((a, c) => a + c.monthSpent, 0);
    },
    deleteMessage() {
      const d = this.deleting;
      return d?.txCount ? `Its ${d.txCount} transactions will be kept but become uncategorized. Consider archiving instead.` : 'This category has no transactions and will be removed.';
    },
  },
  methods: {
    money,
    money0,
    async toggleArchive(c) {
      try {
        await api.patch(`/categories/${c.id}`, { archived: !c.archived });
        toast.success(c.archived ? 'Category restored' : 'Category archived');
        bump();
      } catch (err) {
        toast.error(err.message);
      }
    },
    async remove() {
      try {
        await api.del(`/categories/${this.deleting.id}`);
        toast.success('Category deleted');
        bump();
      } catch (err) {
        toast.error(err.message);
        throw err;
      }
    },
  },
  template: /*html*/ `
    <div>
      <PageHeader title="Categories & budgets" subtitle="Organise your spending and set monthly limits.">
        <Segmented v-model="kind" :options="kinds" />
        <Btn icon="plus" @click="editing = 'new'">New category</Btn>
      </PageHeader>

      <div v-if="kind === 'expense'" class="card mb-5 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-8">
        <div class="flex items-start gap-2">
          <div>
            <div class="text-xs text-ink-3">Total monthly budget</div>
            <div class="num font-display text-2xl font-extrabold">{{ totalBudget ? money0(totalBudget, cur) : '—' }}</div>
            <div class="text-xs text-ink-3">{{ budgetNote }}</div>
          </div>
          <IconButton icon="pencil" label="Edit total monthly budget" @click="editingTotal = true" />
        </div>
        <div v-if="totalBudget > 0" class="flex-1">
          <div class="mb-1.5 flex justify-between text-xs text-ink-3">
            <span><span class="num font-semibold text-ink">{{ money(totalSpent, cur) }}</span> spent this month</span>
            <span class="num">{{ money(Math.max(totalBudget - totalSpent, 0), cur) }} left</span>
          </div>
          <ProgressBar :value="totalSpent" :max="totalBudget" color="var(--brand)" />
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <CategoryCard v-for="c in active" :key="c.id" :c="c" :kind="kind" :currency="cur" @edit="editing = c" @archive="toggleArchive(c)" @delete="deleting = c" />
        <button type="button" @click="editing = 'new'"
          class="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line text-sm font-medium text-ink-3 transition hover:border-brand hover:text-brand">
          <Icon name="plus" :size="20" />
          Add category
        </button>
      </div>

      <template v-if="archived.length">
        <h2 class="mb-3 mt-8 text-sm font-semibold text-ink-3">Archived</h2>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <CategoryCard v-for="c in archived" :key="c.id" :c="c" :kind="kind" :currency="cur" @edit="editing = c" @archive="toggleArchive(c)" @delete="deleting = c" />
        </div>
      </template>

      <TotalBudgetEditor v-if="editingTotal" :category-budgets="categoryBudgets" @close="editingTotal = false" />
      <CategoryEditor v-if="editing":category="editing === 'new' ? null : editing" :kind="kind" @close="editing = null" />
      <ConfirmDialog v-if="deleting" :title="'Delete “' + deleting.name + '”?'" :message="deleteMessage" :confirm="remove" @close="deleting = null" />
    </div>`,
};
