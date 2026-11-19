import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ComposedChart } from 'recharts';
import { ChevronLeft, ChevronRight, Wallet, Target, CalendarDays, TrendingUp, Plus, ArrowRight, Receipt, AlertTriangle } from 'lucide-react';
import { Card, Delta, EmptyState, ProgressBar, Skeleton, Button, Badge } from '../components/ui.jsx';
import { ChartTooltip, Legend } from '../components/charts.jsx';
import { CategoryIcon } from '../lib/icons.jsx';
import { useApi, useAuth, useChartTheme, useData } from '../lib/context.jsx';
import { changePct, dateLabel, money, moneyCompact, monthLabel, shiftMonth, thisMonth, pct } from '../lib/format.js';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function MonthPicker({ value, onChange }) {
  const isCurrent = value === thisMonth();
  return (
    <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
      <button onClick={() => onChange(shiftMonth(value, -1))} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Previous month">
        <ChevronLeft size={16} />
      </button>
      <span className="min-w-[110px] text-center text-sm font-semibold">{monthLabel(value, 'MMMM yyyy')}</span>
      <button
        onClick={() => onChange(shiftMonth(value, 1))}
        disabled={isCurrent}
        className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2 disabled:opacity-30"
        aria-label="Next month"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

function Stat({ icon: Icon, label, value, children, accent = 'var(--brand)' }) {
  return (
    <div className="card animate-in flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2 text-[13px] font-medium text-ink-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>
          <Icon size={15} strokeWidth={2.2} />
        </span>
        {label}
      </div>
      <div className="num font-display text-[26px] font-extrabold leading-none tracking-tight">{value}</div>
      <div className="min-h-[20px]">{children}</div>
    </div>
  );
}

export function TxRow({ t, currency, onClick }) {
  const income = t.kind === 'income';
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-surface-2">
      <CategoryIcon icon={t.category?.icon ?? 'tag'} color={t.category?.color ?? '#9ca3af'} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{t.payee || t.category?.name || 'Transaction'}</div>
        <div className="truncate text-xs text-ink-3">
          {t.category?.name ?? 'Uncategorized'} · {dateLabel(t.date, 'd MMM')}
          {t.note ? ` · ${t.note}` : ''}
        </div>
      </div>
      <div className="text-right">
        <div className={`num text-sm font-semibold ${income ? 'text-brand' : ''}`}>
          {income ? '+' : '−'}
          {money(t.amount, t.currency)}
        </div>
        {t.currency !== currency && <div className="num text-[11px] text-ink-3">≈ {money(t.amountBase, currency)}</div>}
      </div>
    </button>
  );
}

const MAX_SLICES = 7;

export default function Dashboard() {
  const { user } = useAuth();
  const { openTransaction } = useData();
  const ct = useChartTheme();
  const [month, setMonth] = useState(thisMonth());
  const { data, loading } = useApi(`/stats/overview?month=${month}`);
  const { data: trend } = useApi(`/stats/trend?months=12&month=${month}`);
  const cur = data?.currency ?? user.baseCurrency;

  const slices = useMemo(() => {
    const spent = (data?.byCategory ?? []).filter((c) => c.spent > 0);
    if (spent.length <= MAX_SLICES) return spent;
    const head = spent.slice(0, MAX_SLICES - 1);
    const rest = spent.slice(MAX_SLICES - 1);
    return [...head, { id: 'other', name: `Other (${rest.length})`, color: '#9aa3a0', spent: rest.reduce((a, c) => a + c.spent, 0) }];
  }, [data]);

  const budgets = (data?.byCategory ?? []).filter((c) => c.budget > 0).sort((a, b) => b.spent / b.budget - a.spent / a.budget);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  const t = data.totals;
  const budgetLeft = t.budget - t.spent;
  const net = t.income - t.spent;
  const empty = t.count === 0 && t.income === 0 && !data.recent.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-ink-3">{greeting()},</p>
          <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{user.name.split(' ')[0]} 👋</h1>
        </div>
        <div className="flex items-center gap-2">
          <MonthPicker value={month} onChange={setMonth} />
          <Button icon={Plus} onClick={() => openTransaction()} className="hidden sm:inline-flex">
            Add
          </Button>
        </div>
      </div>

      {empty ? (
        <Card>
          <EmptyState
            icon={Receipt}
            title="Your dashboard is waiting"
            message="Add your first expense and Florin will start drawing your spending picture."
            action={
              <Button icon={Plus} onClick={() => openTransaction()}>
                Add first transaction
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat icon={Wallet} label={`Spent in ${monthLabel(month, 'MMMM')}`} value={money(t.spent, cur)} accent={ct.spend}>
              <Delta value={changePct(t.spent, data.isCurrent ? t.prevSpentToDate : t.prevSpent)} suffix={data.isCurrent ? 'vs same point last month' : 'vs previous month'} />
            </Stat>
            <Stat icon={Target} label="Budget left" value={t.budget ? money(budgetLeft, cur) : '—'} accent={budgetLeft < 0 ? 'var(--danger)' : 'var(--brand)'}>
              {t.budget ? (
                <div className="space-y-1.5">
                  <ProgressBar value={t.spent} max={t.budget} color="var(--brand)" />
                  <div className="text-xs text-ink-3">
                    {pct((t.spent / t.budget) * 100)} of {money(t.budget, cur, { maximumFractionDigits: 0 })} used
                  </div>
                </div>
              ) : (
                <Link to="/categories" className="text-xs font-medium text-brand hover:underline">
                  Set monthly budgets →
                </Link>
              )}
            </Stat>
            <Stat icon={CalendarDays} label="Daily average" value={money(t.dailyAvg, cur)} accent="var(--gold)">
              <span className="text-xs text-ink-3">
                {data.isCurrent ? (
                  <>
                    On track for <span className="num font-semibold text-ink-2">{money(t.projected, cur, { maximumFractionDigits: 0 })}</span> this month
                  </>
                ) : (
                  `${t.count} expenses this month`
                )}
              </span>
            </Stat>
            <Stat icon={TrendingUp} label="Net this month" value={`${net >= 0 ? '+' : '−'}${money(Math.abs(net), cur)}`} accent={net >= 0 ? ct.income : 'var(--danger)'}>
              <span className="text-xs text-ink-3">
                <span className="num font-semibold text-ink-2">{money(t.income, cur)}</span> income
                {t.income > 0 && <> · saved {pct(Math.max(0, (net / t.income) * 100))}</>}
              </span>
            </Stat>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card
              className="xl:col-span-2"
              title="Spending pace"
              subtitle="Cumulative spending this month compared with last month"
              action={
                <Legend
                  items={[
                    { label: monthLabel(month, 'MMMM'), color: ct.spend },
                    { label: monthLabel(shiftMonth(month, -1), 'MMMM'), color: ct.prev, dashed: true },
                  ]}
                />
              }
            >
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ct.spend} stopOpacity={0.22} />
                        <stop offset="100%" stopColor={ct.spend} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke={ct.grid} />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: ct.axis, fontSize: 12 }} interval="preserveStartEnd" minTickGap={16} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: ct.axis, fontSize: 12 }} tickFormatter={(v) => moneyCompact(v, cur)} width={56} />
                    <Tooltip
                      cursor={{ stroke: ct.axis, strokeDasharray: '3 3' }}
                      content={<ChartTooltip currency={cur} labelFormatter={(d) => `Day ${d}`} />}
                    />
                    <Line
                      type="monotone"
                      dataKey="prevCumulative"
                      name={monthLabel(shiftMonth(month, -1), 'MMMM')}
                      stroke={ct.prev}
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: ct.surface }}
                    />
                    <Area
                      type="monotone"
                      dataKey="cumulative"
                      name={monthLabel(month, 'MMMM')}
                      stroke={ct.spend}
                      strokeWidth={2.25}
                      fill="url(#spendFill)"
                      dot={false}
                      activeDot={{ r: 5, strokeWidth: 2, stroke: ct.surface }}
                      connectNulls={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Where it went" subtitle={`${monthLabel(month, 'MMMM')} by category`}>
              {slices.length ? (
                <>
                  <div className="relative mx-auto h-[190px] w-[190px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={slices} dataKey="spent" nameKey="name" innerRadius={64} outerRadius={92} paddingAngle={1.5} cornerRadius={4} stroke={ct.surface} strokeWidth={2} startAngle={90} endAngle={-270}>
                          {slices.map((s) => (
                            <Cell key={s.id ?? 'none'} fill={s.color} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip currency={cur} />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Total</span>
                      <span className="num font-display text-lg font-extrabold">{money(t.spent, cur, { maximumFractionDigits: 0 })}</span>
                    </div>
                  </div>
                  <ul className="mt-4 space-y-2">
                    {slices.map((s) => (
                      <li key={s.id ?? 'none'} className="flex items-center gap-2 text-sm">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
                        <span className="min-w-0 flex-1 truncate text-ink-2">{s.name}</span>
                        <span className="num text-xs text-ink-3">{pct((s.spent / t.spent) * 100)}</span>
                        <span className="num w-20 text-right font-semibold">{money(s.spent, cur, { maximumFractionDigits: 0 })}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <EmptyState title="No expenses yet" message="Nothing spent this month." />
              )}
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card
              className="xl:col-span-2"
              title="Last 12 months"
              subtitle="Monthly spending and income"
              action={
                <Legend
                  items={[
                    { label: 'Spending', color: ct.spend },
                    { label: 'Income', color: ct.income },
                  ]}
                />
              }
            >
              <div className="h-[260px]">
                {trend && (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trend.months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
                      <CartesianGrid vertical={false} stroke={ct.grid} />
                      <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: ct.axis, fontSize: 12 }} tickFormatter={(m) => monthLabel(m, 'MMM')} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fill: ct.axis, fontSize: 12 }} tickFormatter={(v) => moneyCompact(v, cur)} width={56} />
                      <Tooltip cursor={{ fill: ct.grid, opacity: 0.5 }} content={<ChartTooltip currency={cur} labelFormatter={(m) => monthLabel(m, 'MMMM yyyy')} />} />
                      <Bar dataKey="spent" name="Spending" fill={ct.spend} radius={[4, 4, 0, 0]} maxBarSize={22} />
                      <Bar dataKey="income" name="Income" fill={ct.income} radius={[4, 4, 0, 0]} maxBarSize={22} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card
              title="Budgets"
              subtitle="Monthly limits by category"
              action={
                <Link to="/categories" className="text-xs font-semibold text-brand hover:underline">
                  Manage
                </Link>
              }
            >
              {budgets.length ? (
                <ul className="space-y-4">
                  {budgets.slice(0, 6).map((c) => {
                    const over = c.spent > c.budget;
                    return (
                      <li key={c.id}>
                        <div className="mb-1.5 flex items-center gap-2 text-sm">
                          <CategoryIcon icon={c.icon} color={c.color} size="sm" />
                          <span className="flex-1 truncate font-medium">{c.name}</span>
                          {over && (
                            <Badge tone="danger">
                              <AlertTriangle size={11} /> Over
                            </Badge>
                          )}
                          <span className="num text-xs text-ink-3">
                            <span className="font-semibold text-ink">{money(c.spent, cur, { maximumFractionDigits: 0 })}</span> / {money(c.budget, cur, { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                        <ProgressBar value={c.spent} max={c.budget} color={c.color} />
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState icon={Target} title="No budgets set" message="Give categories a monthly limit to track them here." />
              )}
            </Card>
          </div>

          <Card
            title="Recent transactions"
            action={
              <Link to="/transactions" className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                View all <ArrowRight size={13} />
              </Link>
            }
            bodyClass="px-3 pb-3 pt-2"
          >
            <div className="grid gap-x-4 md:grid-cols-2">
              {data.recent.map((tx) => (
                <TxRow key={tx.id} t={tx} currency={cur} onClick={() => openTransaction({ ...tx, categoryId: tx.category?.id ?? null })} />
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
