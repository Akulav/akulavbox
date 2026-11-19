import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal, Button, Field, Segmented } from './ui.jsx';
import { CategoryIcon } from '../lib/icons.jsx';
import { api } from '../lib/api.js';
import { useAuth, useData, useToast } from '../lib/context.jsx';
import { money, todayISO } from '../lib/format.js';

const LAST_CURRENCY_KEY = 'florin-last-currency';

export default function TransactionModal({ transaction, defaults = {}, onClose }) {
  const { user } = useAuth();
  const { categories, currencies, bump } = useData();
  const toast = useToast();
  const editing = !!transaction;

  const [form, setForm] = useState(() => ({
    kind: transaction?.kind ?? defaults.kind ?? 'expense',
    amount: transaction ? String(transaction.amount) : '',
    currency:
      transaction?.currency ??
      (() => {
        try {
          return localStorage.getItem(LAST_CURRENCY_KEY);
        } catch {
          return null;
        }
      })() ??
      user.baseCurrency,
    categoryId: transaction?.categoryId ?? defaults.categoryId ?? null,
    date: transaction?.date ?? todayISO(),
    payee: transaction?.payee ?? '',
    note: transaction?.note ?? '',
  }));
  const [payees, setPayees] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get('/transactions/payees').then((d) => setPayees(d.payees)).catch(() => {});
  }, []);

  const visibleCats = categories.filter((c) => c.kind === form.kind && (!c.archived || c.id === form.categoryId));
  const rates = useMemo(() => Object.fromEntries(currencies.map((c) => [c.code, c.rate])), [currencies]);
  const amountNum = Number(String(form.amount).replace(',', '.'));
  const converted =
    form.currency !== user.baseCurrency && amountNum > 0 && rates[form.currency] && rates[user.baseCurrency]
      ? (amountNum / rates[form.currency]) * rates[user.baseCurrency]
      : null;

  const onPayee = (v) => {
    set('payee', v);
    const match = payees.find((p) => p.name.toLowerCase() === v.toLowerCase());
    if (match?.categoryId && !form.categoryId && categories.some((c) => c.id === match.categoryId && c.kind === form.kind)) {
      set('categoryId', match.categoryId);
    }
  };

  const submit = async (e) => {
    e?.preventDefault();
    setError('');
    if (!(amountNum > 0)) return setError('Enter an amount greater than zero.');
    setBusy(true);
    try {
      const body = { ...form, amount: amountNum };
      if (editing) await api.patch(`/transactions/${transaction.id}`, body);
      else await api.post('/transactions', body);
      try {
        localStorage.setItem(LAST_CURRENCY_KEY, form.currency);
      } catch {}
      toast.success(editing ? 'Transaction updated' : `${form.kind === 'expense' ? 'Expense' : 'Income'} added`);
      bump();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this transaction? This cannot be undone.')) return;
    setBusy(true);
    try {
      await api.del(`/transactions/${transaction.id}`);
      toast.success('Transaction deleted');
      bump();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Edit transaction' : 'New transaction'}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {editing ? (
            <Button variant="danger-ghost" icon={Trash2} onClick={remove} disabled={busy}>
              Delete
            </Button>
          ) : (
            <span className="hidden text-xs text-ink-3 sm:block">
              Tip: press <kbd className="rounded border border-line px-1">N</kbd> anywhere to add
            </span>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} loading={busy}>
              {editing ? 'Save changes' : 'Add'}
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <Segmented
          className="w-full [&>button]:flex-1"
          value={form.kind}
          onChange={(v) => setForm((f) => ({ ...f, kind: v, categoryId: null }))}
          options={[
            { value: 'expense', label: 'Expense' },
            { value: 'income', label: 'Income' },
          ]}
        />

        <div>
          <div className="flex items-stretch gap-2">
            <input
              inputMode="decimal"
              autoFocus
              placeholder="0.00"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value.replace(/[^\d.,]/g, ''))}
              className="input num !h-14 flex-1 !text-2xl font-semibold"
              aria-label="Amount"
            />
            <select value={form.currency} onChange={(e) => set('currency', e.target.value)} className="input !h-14 !w-28 font-semibold" aria-label="Currency">
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </div>
          {converted !== null && (
            <p className="num mt-1.5 text-xs text-ink-3">
              ≈ {money(converted, user.baseCurrency)} in your base currency
            </p>
          )}
        </div>

        <div>
          <span className="mb-2 block text-[13px] font-medium text-ink-2">Category</span>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {visibleCats.map((c) => {
              const active = form.categoryId === c.id;
              return (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => set('categoryId', active ? null : c.id)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border px-1 py-2.5 text-center text-[12px] font-medium transition ${
                    active ? 'border-transparent ring-2' : 'border-line hover:bg-surface-2'
                  }`}
                  style={active ? { '--tw-ring-color': c.color, backgroundColor: `${c.color}14` } : undefined}
                  aria-pressed={active}
                >
                  <CategoryIcon icon={c.icon} color={c.color} size="sm" />
                  <span className="line-clamp-1 w-full px-0.5 text-ink">{c.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date">
            <input type="date" className="input" value={form.date} onChange={(e) => set('date', e.target.value)} required />
          </Field>
          <Field label={form.kind === 'expense' ? 'Payee' : 'Source'}>
            <input className="input" list="payee-list" value={form.payee} onChange={(e) => onPayee(e.target.value)} placeholder="e.g. Lidl" maxLength={120} />
            <datalist id="payee-list">
              {payees.map((p) => (
                <option key={p.name} value={p.name} />
              ))}
            </datalist>
          </Field>
        </div>
        <Field label="Note">
          <textarea className="input" rows={2} value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Optional" maxLength={500} />
        </Field>
        {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
