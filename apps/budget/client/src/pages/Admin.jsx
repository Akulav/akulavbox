import { useEffect, useState } from 'react';
import { Users, RefreshCw, Database, Receipt, ExternalLink } from 'lucide-react';
import { Button, Card, PageHeader, Segmented } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth, useData, useToast } from '../lib/context.jsx';
import { dateLabel } from '../lib/format.js';

// Accounts, roles and access to Florin are managed for every app at once in the server's
// Admin console (/admin). This page keeps what is Florin's own: exchange rates and defaults.
function OverviewTab() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    api.get('/admin/stats').then(setStats);
  }, []);
  return (
    <div className="space-y-5">
      {stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            [Users, 'People using Florin', `${stats.users}`, 'accounts that opened it'],
            [Receipt, 'Transactions', stats.transactions.toLocaleString(), `${stats.categories} categories`],
            [Database, 'Database', `${(stats.dbSize / 1024 / 1024).toFixed(2)} MB`, 'SQLite'],
          ].map(([Icon, label, value, sub]) => (
            <div key={label} className="card p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-ink-3">
                <Icon size={14} /> {label}
              </div>
              <div className="num mt-2 font-display text-[22px] font-extrabold leading-none">{value}</div>
              <div className="mt-1.5 text-xs text-ink-3">{sub}</div>
            </div>
          ))}
        </div>
      )}
      <Card title="Accounts" subtitle="Who can use Florin, roles and passwords are managed for every app in the Admin console.">
        <Button variant="secondary" icon={ExternalLink} onClick={() => (window.location.href = '/admin')}>
          Open the Admin console
        </Button>
      </Card>
    </div>
  );
}

function RatesTab() {
  const { currencies, reloadCurrencies } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState({});

  const refresh = async () => {
    setBusy(true);
    try {
      const r = await api.post('/admin/rates/refresh');
      await reloadCurrencies();
      toast.success(`Updated ${r.updated} rates from ${r.source}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveRate = async (code) => {
    try {
      await api.put(`/admin/rates/${code}`, { rate: Number(edits[code]) });
      await reloadCurrencies();
      setEdits(({ [code]: _, ...rest }) => rest);
      toast.success(`${code} rate saved`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Card
      title="Exchange rates"
      subtitle="Units of each currency per 1 EUR. New transactions are converted at the rate in effect when they're saved."
      action={
        <Button size="sm" variant="secondary" icon={RefreshCw} loading={busy} onClick={refresh}>
          Fetch latest
        </Button>
      }
      bodyClass="p-0 pt-4"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-y border-line bg-surface-2/60 text-left text-xs font-semibold uppercase tracking-wide text-ink-3">
              <th className="px-5 py-2.5">Currency</th>
              <th className="px-3 py-2.5">Rate per EUR</th>
              <th className="px-3 py-2.5">Source</th>
              <th className="px-5 py-2.5">Updated</th>
            </tr>
          </thead>
          <tbody>
            {currencies.map((c) => (
              <tr key={c.code} className="border-b border-line last:border-0">
                <td className="px-5 py-2.5">
                  <span className="font-semibold">{c.code}</span> <span className="text-ink-3">{c.name}</span>
                </td>
                <td className="px-3 py-2">
                  {c.code === 'EUR' ? (
                    <span className="num text-ink-3">1 (reference)</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        className="input num !h-8 !w-32"
                        inputMode="decimal"
                        value={edits[c.code] ?? String(c.rate)}
                        onChange={(e) => setEdits({ ...edits, [c.code]: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && edits[c.code] !== undefined && saveRate(c.code)}
                        aria-label={`${c.code} rate`}
                      />
                      {edits[c.code] !== undefined && edits[c.code] !== String(c.rate) && (
                        <Button size="sm" onClick={() => saveRate(c.code)}>
                          Save
                        </Button>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 text-ink-3">{c.source}</td>
                <td className="px-5 py-2.5 text-ink-3">{dateLabel(c.updatedAt?.slice(0, 10))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AppSettingsTab() {
  const { refreshConfig } = useAuth();
  const { currencies } = useData();
  const toast = useToast();
  const [s, setS] = useState(null);
  useEffect(() => {
    api.get('/admin/settings').then(setS);
  }, []);
  const update = async (patch) => {
    const next = await api.patch('/admin/settings', patch);
    setS(next);
    refreshConfig();
    toast.success('Settings saved');
  };
  if (!s) return null;
  return (
    <Card title="Application settings">
      <div className="divide-y divide-line">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold">Default currency</div>
            <div className="text-xs text-ink-3">Pre-selected for new accounts.</div>
          </div>
          <select className="input sm:!w-60" value={s.defaultCurrency} onChange={(e) => update({ defaultCurrency: e.target.value })}>
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Card>
  );
}

export default function Admin() {
  const [tab, setTab] = useState('overview');
  return (
    <div>
      <PageHeader
        title="Administration"
        subtitle="Exchange rates and Florin settings."
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'overview', label: 'Overview' },
              { value: 'rates', label: 'Exchange rates' },
              { value: 'settings', label: 'Settings' },
            ]}
          />
        }
      />
      {tab === 'overview' && <OverviewTab />}
      {tab === 'rates' && <RatesTab />}
      {tab === 'settings' && <AppSettingsTab />}
    </div>
  );
}
