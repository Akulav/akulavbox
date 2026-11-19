import { useState } from 'react';
import { Plus, Pencil, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { Button, Field, Modal, PageHeader, ProgressBar, Segmented, Badge, IconButton, ConfirmDialog } from '../components/ui.jsx';
import { CATEGORY_COLORS, CATEGORY_ICONS, CategoryIcon } from '../lib/icons.jsx';
import { api } from '../lib/api.js';
import { useAuth, useData, useToast } from '../lib/context.jsx';
import { money, currencySymbol } from '../lib/format.js';

function CategoryEditor({ category, kind, onClose }) {
  const { user } = useAuth();
  const { bump } = useData();
  const toast = useToast();
  const [form, setForm] = useState({
    name: category?.name ?? '',
    icon: category?.icon ?? 'tag',
    color: category?.color ?? CATEGORY_COLORS[0],
    budget: category?.budget ? String(category.budget) : '',
    kind: category?.kind ?? kind,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { ...form, budget: Number(form.budget) || 0 };
      if (category) await api.patch(`/categories/${category.id}`, body);
      else await api.post('/categories', body);
      toast.success(category ? 'Category updated' : 'Category created');
      bump();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={category ? 'Edit category' : 'New category'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={save} className="space-y-5">
        <div className="flex items-center gap-3">
          <CategoryIcon icon={form.icon} color={form.color} size="lg" />
          <Field label="Name" className="flex-1">
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={40} required autoFocus />
          </Field>
        </div>
        <div>
          <span className="mb-2 block text-[13px] font-medium text-ink-2">Color</span>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => set('color', c)}
                className={`h-8 w-8 rounded-full transition ${form.color === c ? 'ring-2 ring-offset-2 ring-offset-surface' : 'hover:scale-110'}`}
                style={{ backgroundColor: c, '--tw-ring-color': c }}
                aria-label={`Color ${c}`}
                aria-pressed={form.color === c}
              />
            ))}
          </div>
        </div>
        <div>
          <span className="mb-2 block text-[13px] font-medium text-ink-2">Icon</span>
          <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-9">
            {Object.entries(CATEGORY_ICONS).map(([name, Icon]) => (
              <button
                type="button"
                key={name}
                onClick={() => set('icon', name)}
                className={`flex h-9 items-center justify-center rounded-lg border transition ${
                  form.icon === name ? 'border-transparent text-white' : 'border-line text-ink-2 hover:bg-surface-2'
                }`}
                style={form.icon === name ? { backgroundColor: form.color } : undefined}
                aria-label={name}
                aria-pressed={form.icon === name}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </div>
        {form.kind === 'expense' && (
          <Field label="Monthly budget" hint={`In ${user.baseCurrency}. Leave empty for no limit.`}>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">{currencySymbol(user.baseCurrency)}</span>
              <input className="input num pl-10" inputMode="decimal" value={form.budget} onChange={(e) => set('budget', e.target.value.replace(/[^\d.]/g, ''))} placeholder="0" />
            </div>
          </Field>
        )}
        {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

export default function Categories() {
  const { user } = useAuth();
  const { categories, bump } = useData();
  const toast = useToast();
  const [kind, setKind] = useState('expense');
  const [editing, setEditing] = useState(null); // null | 'new' | category
  const [deleting, setDeleting] = useState(null);
  const cur = user.baseCurrency;

  const list = categories.filter((c) => c.kind === kind);
  const active = list.filter((c) => !c.archived);
  const archived = list.filter((c) => c.archived);
  const totalBudget = active.reduce((a, c) => a + c.budget, 0);
  const totalSpent = active.reduce((a, c) => a + c.monthSpent, 0);

  const toggleArchive = async (c) => {
    await api.patch(`/categories/${c.id}`, { archived: !c.archived });
    toast.success(c.archived ? 'Category restored' : 'Category archived');
    bump();
  };

  const Item = ({ c }) => {
    const over = c.budget > 0 && c.monthSpent > c.budget;
    return (
      <div className={`card animate-in group p-4 ${c.archived ? 'opacity-60' : ''}`}>
        <div className="flex items-start gap-3">
          <CategoryIcon icon={c.icon} color={c.color} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-semibold">{c.name}</h3>
              {over && <Badge tone="danger">Over budget</Badge>}
            </div>
            <p className="text-xs text-ink-3">{c.txCount} transactions</p>
          </div>
          <div className="flex opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <IconButton icon={Pencil} label="Edit" onClick={() => setEditing(c)} />
            <IconButton icon={c.archived ? ArchiveRestore : Archive} label={c.archived ? 'Restore' : 'Archive'} onClick={() => toggleArchive(c)} />
            <IconButton icon={Trash2} label="Delete" className="hover:!text-danger" onClick={() => setDeleting(c)} />
          </div>
        </div>
        {kind === 'expense' && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="text-ink-3">This month</span>
              <span className="num">
                <span className="font-semibold text-ink">{money(c.monthSpent, cur)}</span>
                {c.budget > 0 && <span className="text-ink-3"> / {money(c.budget, cur, { maximumFractionDigits: 0 })}</span>}
              </span>
            </div>
            {c.budget > 0 ? (
              <ProgressBar value={c.monthSpent} max={c.budget} color={c.color} />
            ) : (
              <button onClick={() => setEditing(c)} className="text-xs font-medium text-brand hover:underline">
                Set a budget
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="Categories & budgets"
        subtitle="Organise your spending and set monthly limits."
        actions={
          <>
            <Segmented
              value={kind}
              onChange={setKind}
              options={[
                { value: 'expense', label: 'Expenses' },
                { value: 'income', label: 'Income' },
              ]}
            />
            <Button icon={Plus} onClick={() => setEditing('new')}>
              New category
            </Button>
          </>
        }
      />

      {kind === 'expense' && totalBudget > 0 && (
        <div className="card mb-5 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:gap-8">
          <div>
            <div className="text-xs text-ink-3">Total monthly budget</div>
            <div className="num font-display text-2xl font-extrabold">{money(totalBudget, cur, { maximumFractionDigits: 0 })}</div>
          </div>
          <div className="flex-1">
            <div className="mb-1.5 flex justify-between text-xs text-ink-3">
              <span>
                <span className="num font-semibold text-ink">{money(totalSpent, cur)}</span> spent this month
              </span>
              <span className="num">{money(Math.max(totalBudget - totalSpent, 0), cur)} left</span>
            </div>
            <ProgressBar value={totalSpent} max={totalBudget} color="var(--brand)" />
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {active.map((c) => (
          <Item key={c.id} c={c} />
        ))}
        <button
          onClick={() => setEditing('new')}
          className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line text-sm font-medium text-ink-3 transition hover:border-brand hover:text-brand"
        >
          <Plus size={20} />
          Add category
        </button>
      </div>

      {archived.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-sm font-semibold text-ink-3">Archived</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {archived.map((c) => (
              <Item key={c.id} c={c} />
            ))}
          </div>
        </>
      )}

      {editing && <CategoryEditor category={editing === 'new' ? null : editing} kind={kind} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        message={
          deleting?.txCount
            ? `Its ${deleting.txCount} transactions will be kept but become uncategorized. Consider archiving instead.`
            : 'This category has no transactions and will be removed.'
        }
        onConfirm={async () => {
          await api.del(`/categories/${deleting.id}`);
          toast.success('Category deleted');
          bump();
        }}
      />
    </div>
  );
}
