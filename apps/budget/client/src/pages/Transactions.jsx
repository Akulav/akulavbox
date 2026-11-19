import { useEffect, useMemo, useState } from 'react';
import { Search, Download, Plus, Receipt, X } from 'lucide-react';
import { endOfMonth, startOfMonth, startOfYear, subMonths, format } from 'date-fns';
import { Button, Card, EmptyState, PageHeader, Skeleton } from '../components/ui.jsx';
import { TxRow } from './Dashboard.jsx';
import { api, API, qs } from '../lib/api.js';
import { useAuth, useData } from '../lib/context.jsx';
import { dateLabel, money } from '../lib/format.js';

const f = (d) => format(d, 'yyyy-MM-dd');
const PRESETS = {
  month: () => [f(startOfMonth(new Date())), f(endOfMonth(new Date()))],
  last: () => [f(startOfMonth(subMonths(new Date(), 1))), f(endOfMonth(subMonths(new Date(), 1)))],
  '3m': () => [f(startOfMonth(subMonths(new Date(), 2))), f(new Date())],
  year: () => [f(startOfYear(new Date())), f(new Date())],
  all: () => ['', ''],
};
const PRESET_LABELS = { month: 'This month', last: 'Last month', '3m': 'Last 3 months', year: 'This year', all: 'All time', custom: 'Custom range' };
const PAGE = 60;

export default function Transactions() {
  const { user } = useAuth();
  const { categories, currencies, openTransaction, version } = useData();
  const [preset, setPreset] = useState('month');
  const [range, setRange] = useState(PRESETS.month);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [kind, setKind] = useState('');
  const [category, setCategory] = useState('');
  const [currency, setCurrency] = useState('');
  const [sort, setSort] = useState('date_desc');
  const [data, setData] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(id);
  }, [q]);

  const filters = useMemo(
    () => ({ from: range[0], to: range[1], q: debouncedQ, kind, category, currency, sort }),
    [range, debouncedQ, kind, category, currency, sort],
  );

  useEffect(() => {
    let alive = true;
    api.get(`/transactions${qs({ ...filters, limit: PAGE })}`).then((d) => alive && setData(d)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [filters, version]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const d = await api.get(`/transactions${qs({ ...filters, limit: PAGE, offset: data.items.length })}`);
      setData((prev) => ({ ...prev, items: [...prev.items, ...d.items] }));
    } finally {
      setLoadingMore(false);
    }
  };

  const onPreset = (p) => {
    setPreset(p);
    if (p !== 'custom') setRange(PRESETS[p]());
  };

  const groups = useMemo(() => {
    if (!data) return [];
    if (!sort.startsWith('date')) return [{ key: 'all', items: data.items }];
    const map = new Map();
    for (const t of data.items) {
      if (!map.has(t.date)) map.set(t.date, []);
      map.get(t.date).push(t);
    }
    return [...map.entries()].map(([date, items]) => ({
      key: date,
      date,
      items,
      net: items.reduce((a, t) => a + (t.kind === 'income' ? t.amountBase : -t.amountBase), 0),
    }));
  }, [data, sort]);

  const hasFilters = q || kind || category || currency;
  const cur = data?.currency ?? user.baseCurrency;

  return (
    <div>
      <PageHeader
        title="Transactions"
        subtitle="Every expense and income, searchable and filterable."
        actions={
          <>
            <Button variant="secondary" icon={Download} onClick={() => (window.location.href = `${API}/transactions/export.csv${qs(filters)}`)}>
              Export CSV
            </Button>
            <Button icon={Plus} onClick={() => openTransaction()}>
              Add transaction
            </Button>
          </>
        }
      />

      <div className="card mb-4 flex flex-col gap-3 p-3 lg:flex-row lg:flex-wrap lg:items-center">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input className="input pl-9" placeholder="Search payee, note or category…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <select className="input sm:!w-auto" value={preset} onChange={(e) => onPreset(e.target.value)} aria-label="Date range">
            {Object.entries(PRESET_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select className="input sm:!w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
            <option value="">All types</option>
            <option value="expense">Expenses</option>
            <option value="income">Income</option>
          </select>
          <select className="input sm:!w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {categories
              .filter((c) => !kind || c.kind === kind)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            <option value="none">Uncategorized</option>
          </select>
          <select className="input sm:!w-auto" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
            <option value="">All currencies</option>
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
          <select className="input sm:!w-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="date_desc">Newest first</option>
            <option value="date_asc">Oldest first</option>
            <option value="amount_desc">Largest first</option>
            <option value="amount_asc">Smallest first</option>
          </select>
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" className="input" value={range[0]} onChange={(e) => setRange([e.target.value, range[1]])} aria-label="From" />
            <span className="text-ink-3">–</span>
            <input type="date" className="input" value={range[1]} onChange={(e) => setRange([range[0], e.target.value])} aria-label="To" />
          </div>
        )}
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            onClick={() => {
              setQ('');
              setKind('');
              setCategory('');
              setCurrency('');
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {data && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          {[
            ['Transactions', data.total.toLocaleString(), ''],
            ['Spent', money(data.totals.spent, cur), ''],
            ['Income', money(data.totals.income, cur), 'text-brand'],
          ].map(([label, value, cls]) => (
            <div key={label} className="card px-4 py-3">
              <div className="text-xs text-ink-3">{label}</div>
              <div className={`num mt-0.5 truncate font-display text-lg font-extrabold ${cls}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      <Card bodyClass="p-2 sm:p-3">
        {!data ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={hasFilters ? 'No matching transactions' : 'No transactions in this period'}
            message={hasFilters ? 'Try a different search or clear the filters.' : 'Add one, or pick a wider date range.'}
            action={
              !hasFilters && (
                <Button icon={Plus} onClick={() => openTransaction()}>
                  Add transaction
                </Button>
              )
            }
          />
        ) : (
          <>
            {groups.map((g) => (
              <div key={g.key} className="mb-1">
                {g.date && (
                  <div className="flex items-center justify-between px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-3">
                    <span>{dateLabel(g.date, 'EEEE, d MMMM yyyy')}</span>
                    <span className="num normal-case tracking-normal">
                      {g.net >= 0 ? '+' : '−'}
                      {money(Math.abs(g.net), cur)}
                    </span>
                  </div>
                )}
                {g.items.map((t) => (
                  <TxRow key={t.id} t={t} currency={cur} onClick={() => openTransaction(t)} />
                ))}
              </div>
            ))}
            {data.items.length < data.total && (
              <div className="flex justify-center p-3">
                <Button variant="secondary" onClick={loadMore} loading={loadingMore}>
                  Load more ({data.total - data.items.length} remaining)
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
