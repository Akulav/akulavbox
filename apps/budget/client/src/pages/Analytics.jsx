import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import { format, startOfMonth, startOfYear, subMonths, eachDayOfInterval, parseISO, getDay } from 'date-fns';
import { Wallet, CalendarDays, PiggyBank, Receipt, BarChart3 } from 'lucide-react';
import { Card, EmptyState, PageHeader, Segmented, Skeleton } from '../components/ui.jsx';
import { ChartTooltip, Legend } from '../components/charts.jsx';
import { CategoryIcon } from '../lib/icons.jsx';
import { useApi, useAuth, useChartTheme, useData, useTheme } from '../lib/context.jsx';
import { dateLabel, money, moneyCompact, monthLabel, pct } from '../lib/format.js';
import { qs } from '../lib/api.js';

const f = (d) => format(d, 'yyyy-MM-dd');
const RANGES = {
  '3m': () => [f(startOfMonth(subMonths(new Date(), 2))), f(new Date())],
  '6m': () => [f(startOfMonth(subMonths(new Date(), 5))), f(new Date())],
  '12m': () => [f(startOfMonth(subMonths(new Date(), 11))), f(new Date())],
  ytd: () => [f(startOfYear(new Date())), f(new Date())],
};
const MAX_STACK = 7;

function Kpi({ icon: Icon, label, value, sub }) {
  return (
    <div className="card animate-in p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-ink-3">
        <Icon size={14} /> {label}
      </div>
      <div className="num mt-2 font-display text-[22px] font-extrabold leading-none">{value}</div>
      {sub && <div className="mt-1.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

// Sequential single-hue ramp (light → dark), with the zero bucket receding to the surface.
const HEAT_LIGHT = ['var(--surface-2)', '#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
const HEAT_DARK = ['var(--surface-2)', '#14304f', '#184f95', '#2a78d6', '#5598e7', '#9ec5f4'];

function Heatmap({ from, to, daily, currency }) {
  const { dark } = useTheme();
  const ramp = dark ? HEAT_DARK : HEAT_LIGHT;
  const { weeks, max } = useMemo(() => {
    const map = Object.fromEntries(daily.map((d) => [d.date, d.spent]));
    const days = eachDayOfInterval({ start: parseISO(from), end: parseISO(to) });
    const values = days.map((d) => map[f(d)] ?? 0).filter((v) => v > 0).sort((a, b) => a - b);
    // Cap the scale at the 95th percentile so one rent payment doesn't wash everything out.
    const cap = values.length ? values[Math.floor(values.length * 0.95)] : 1;
    const weeks = [];
    let week = Array(7).fill(null);
    for (const d of days) {
      const wd = (getDay(d) + 6) % 7; // Monday first
      week[wd] = { date: f(d), value: map[f(d)] ?? 0 };
      if (wd === 6) {
        weeks.push(week);
        week = Array(7).fill(null);
      }
    }
    if (week.some(Boolean)) weeks.push(week);
    return { weeks, max: cap };
  }, [from, to, daily]);

  const bucket = (v) => (v <= 0 ? 0 : Math.min(5, Math.ceil((v / max) * 5)));
  return (
    <div>
      <div className="scrollbar-thin overflow-x-auto pb-2">
        <div className="flex gap-[3px]">
          <div className="mr-1 flex flex-col gap-[3px] pt-0 text-[10px] text-ink-3">
            {['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((l, i) => (
              <div key={i} className="flex h-4 items-center">
                {l}
              </div>
            ))}
          </div>
          {weeks.map((w, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {w.map((d, j) =>
                d ? (
                  <div
                    key={j}
                    className="h-4 w-4 rounded-[3px] transition hover:ring-2 hover:ring-ink-3"
                    style={{ backgroundColor: ramp[bucket(d.value)] }}
                    title={`${dateLabel(d.date, 'EEE d MMM yyyy')}: ${money(d.value, currency)}`}
                  />
                ) : (
                  <div key={j} className="h-4 w-4" />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-ink-3">
        Less
        {ramp.map((c) => (
          <span key={c} className="h-[11px] w-[11px] rounded-[3px]" style={{ backgroundColor: c }} />
        ))}
        More
      </div>
    </div>
  );
}

export default function Analytics() {
  const { user } = useAuth();
  const { openTransaction } = useData();
  const ct = useChartTheme();
  const [rangeKey, setRangeKey] = useState('6m');
  const [from, to] = useMemo(() => RANGES[rangeKey](), [rangeKey]);
  const { data, loading } = useApi(`/stats/analytics${qs({ from, to })}`);
  const cur = data?.currency ?? user.baseCurrency;

  // Fold everything beyond the top categories into "Other" for the stacked chart.
  const stack = useMemo(() => {
    if (!data) return { keys: [], rows: [] };
    const head = data.categories.slice(0, MAX_STACK - 1);
    const tail = data.categories.slice(MAX_STACK - 1);
    const useOther = tail.length > 1;
    const keys = useOther ? [...head, { key: 'other', name: `Other (${tail.length})`, color: '#9aa3a0' }] : data.categories;
    const rows = data.monthly.map((m) => {
      const row = { month: m.month };
      for (const k of head) row[k.key] = m[k.key] ?? 0;
      if (useOther) row.other = tail.reduce((a, k) => a + (m[k.key] ?? 0), 0);
      else for (const k of tail) row[k.key] = m[k.key] ?? 0;
      return row;
    });
    return { keys, rows };
  }, [data]);

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Patterns and trends in your spending."
        actions={
          <Segmented
            value={rangeKey}
            onChange={setRangeKey}
            options={[
              { value: '3m', label: '3M' },
              { value: '6m', label: '6M' },
              { value: '12m', label: '12M' },
              { value: 'ytd', label: 'YTD' },
            ]}
          />
        }
      />

      {loading && !data ? (
        <div className="grid gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-80" />
        </div>
      ) : !data || data.totals.count === 0 ? (
        <Card>
          <EmptyState icon={BarChart3} title="Not enough data yet" message="Add some expenses and come back to see your patterns." />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi icon={Wallet} label="Total spent" value={money(data.totals.spent, cur, { maximumFractionDigits: 0 })} sub={`${data.totals.count} expenses`} />
            <Kpi icon={CalendarDays} label="Per day" value={money(data.totals.perDay, cur)} sub={`${dateLabel(from, 'd MMM')} – ${dateLabel(to, 'd MMM yyyy')}`} />
            <Kpi
              icon={PiggyBank}
              label="Savings rate"
              value={data.totals.savingsRate === null ? '—' : pct(data.totals.savingsRate, 1)}
              sub={`Net ${data.totals.net >= 0 ? '+' : '−'}${money(Math.abs(data.totals.net), cur, { maximumFractionDigits: 0 })}`}
            />
            <Kpi icon={Receipt} label="Average expense" value={money(data.totals.average, cur)} />
          </div>

          <Card title="Monthly spending by category" subtitle="Stacked by category" action={<Legend items={stack.keys.map((k) => ({ label: k.name, color: k.color }))} />}>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stack.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke={ct.grid} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: ct.axis, fontSize: 12 }} tickFormatter={(m) => monthLabel(m, 'MMM yy')} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: ct.axis, fontSize: 12 }} tickFormatter={(v) => moneyCompact(v, cur)} width={56} />
                  <Tooltip cursor={{ fill: ct.grid, opacity: 0.5 }} content={<ChartTooltip currency={cur} hideZero labelFormatter={(m) => monthLabel(m, 'MMMM yyyy')} />} />
                  {stack.keys.map((k, i) => (
                    <Bar
                      key={k.key}
                      dataKey={k.key}
                      name={k.name}
                      stackId="a"
                      fill={k.color}
                      stroke={ct.surface}
                      strokeWidth={1.5}
                      maxBarSize={48}
                      radius={i === stack.keys.length - 1 ? [4, 4, 0, 0] : 0}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Category ranking" subtitle="Share of total spending">
              <ul className="space-y-3">
                {data.categories.map((c) => {
                  const share = (c.spent / data.totals.spent) * 100;
                  return (
                    <li key={c.key} className="flex items-center gap-3">
                      <CategoryIcon icon={c.icon} color={c.color} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                          <span className="truncate font-medium">{c.name}</span>
                          <span className="num shrink-0 font-semibold">{money(c.spent, cur, { maximumFractionDigits: 0 })}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                            <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: c.color }} />
                          </div>
                          <span className="num w-10 text-right text-xs text-ink-3">{pct(share)}</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card title="Spending by weekday" subtitle="Average spent on each day of the week">
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.weekday} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={ct.grid} />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: ct.axis, fontSize: 12 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: ct.axis, fontSize: 12 }} tickFormatter={(v) => moneyCompact(v, cur)} width={56} />
                    <Tooltip cursor={{ fill: ct.grid, opacity: 0.5 }} content={<ChartTooltip currency={cur} />} />
                    <Bar dataKey="average" name="Average" radius={[4, 4, 0, 0]} maxBarSize={36}>
                      {data.weekday.map((d) => {
                        const peak = Math.max(...data.weekday.map((x) => x.average));
                        return <Cell key={d.day} fill={d.average === peak ? ct.spend : ct.muted} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-ink-3">
                Your biggest spending day is{' '}
                <span className="font-semibold text-ink-2">{[...data.weekday].sort((a, b) => b.average - a.average)[0].day}</span>.
              </p>
            </Card>
          </div>

          <Card title="Daily spending" subtitle="Each square is a day — stronger colour means more spent">
            <Heatmap from={from} to={to} daily={data.daily} currency={cur} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Top payees">
              {data.topPayees.length ? (
                <ol className="space-y-2.5">
                  {data.topPayees.map((p, i) => (
                    <li key={p.name} className="flex items-center gap-3 text-sm">
                      <span className="num flex h-6 w-6 items-center justify-center rounded-md bg-surface-2 text-xs font-semibold text-ink-3">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                      <span className="text-xs text-ink-3">{p.count}×</span>
                      <span className="num w-20 text-right font-semibold">{money(p.spent, cur, { maximumFractionDigits: 0 })}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-ink-3">Add payees to your expenses to see them here.</p>
              )}
            </Card>

            <Card title="By currency" subtitle={`Converted to ${cur}`}>
              <ul className="space-y-3">
                {data.byCurrency.map((c) => (
                  <li key={c.code} className="flex items-center gap-3 text-sm">
                    <span className="flex h-9 w-12 items-center justify-center rounded-lg bg-surface-2 text-xs font-bold">{c.code}</span>
                    <div className="min-w-0 flex-1">
                      <div className="num font-semibold">{money(c.original, c.code)}</div>
                      <div className="text-xs text-ink-3">{c.count} transactions</div>
                    </div>
                    <div className="text-right">
                      <div className="num font-semibold">{money(c.spent, cur, { maximumFractionDigits: 0 })}</div>
                      <div className="num text-xs text-ink-3">{pct((c.spent / data.totals.spent) * 100)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="Largest expenses">
              <ul className="space-y-1">
                {data.largest.map((t) => (
                  <li key={t.id}>
                    <button onClick={() => openTransaction({ ...t, kind: 'expense', categoryId: t.category?.id ?? null })} className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left text-sm hover:bg-surface-2">
                      <CategoryIcon icon={t.category?.icon ?? 'tag'} color={t.category?.color ?? '#9ca3af'} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{t.payee || t.category?.name || 'Expense'}</div>
                        <div className="text-xs text-ink-3">{dateLabel(t.date)}</div>
                      </div>
                      <span className="num font-semibold">{money(t.amountBase, cur, { maximumFractionDigits: 0 })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
