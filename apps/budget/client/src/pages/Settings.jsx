import { useState } from 'react';
import { Sun, Moon, Monitor, KeyRound } from 'lucide-react';
import { Button, Card, Field, PageHeader } from '../components/ui.jsx';
import { api, API } from '../lib/api.js';
import { useAuth, useData, useTheme, useToast } from '../lib/context.jsx';
import { dateLabel } from '../lib/format.js';

export default function Settings() {
  const { user, setUser } = useAuth();
  const { currencies, bump } = useData();
  const { pref, setPref } = useTheme();
  const toast = useToast();
  const [profile, setProfile] = useState({ name: user.name, baseCurrency: user.baseCurrency });
  const [busy, setBusy] = useState('');
  const [errors, setErrors] = useState({});

  const saveProfile = async (e) => {
    e.preventDefault();
    setBusy('profile');
    setErrors({});
    try {
      const { user: u } = await api.patch('/auth/me', profile);
      setUser(u);
      bump();
      toast.success('Profile saved');
    } catch (err) {
      setErrors({ profile: err.message });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle={`Using Florin since ${dateLabel(user.createdAt?.slice(0, 10), 'MMMM yyyy')}`} />
      <div className="space-y-5">
        <Card title="Profile" subtitle="The name Florin shows and your main currency.">
          <form onSubmit={saveProfile} className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} required maxLength={80} />
            </Field>
            <Field label="Main currency" hint="All totals and charts are shown in this currency.">
              <select className="input" value={profile.baseCurrency} onChange={(e) => setProfile({ ...profile, baseCurrency: e.target.value })}>
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </Field>
            {errors.profile && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger sm:col-span-2">{errors.profile}</p>}
            <div className="sm:col-span-2">
              <Button type="submit" loading={busy === 'profile'}>
                Save profile
              </Button>
            </div>
          </form>
        </Card>

        <Card title="Appearance">
          <div className="grid grid-cols-3 gap-3">
            {[
              ['light', 'Light', Sun],
              ['dark', 'Dark', Moon],
              ['system', 'System', Monitor],
            ].map(([v, label, Icon]) => (
              <button
                key={v}
                onClick={() => setPref(v)}
                aria-pressed={pref === v}
                className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium transition ${
                  pref === v ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line text-ink-2 hover:bg-surface-2'
                }`}
              >
                <Icon size={20} />
                {label}
              </button>
            ))}
          </div>
        </Card>

        <Card title="Sign-in" subtitle={`Signed in as ${user.username}. The same account opens every app on this server.`}>
          <p className="mb-4 text-sm text-ink-3">Change your password or sign out other devices in your account profile.</p>
          <Button variant="secondary" icon={KeyRound} onClick={() => (window.location.href = '/box/#/profile')}>
            Open my profile
          </Button>
        </Card>

        <Card title="Your data">
          <p className="mb-4 text-sm text-ink-3">Download every transaction as a CSV file you can open in Excel, Numbers or Google Sheets.</p>
          <Button variant="secondary" onClick={() => (window.location.href = `${API}/transactions/export.csv`)}>
            Export all transactions
          </Button>
        </Card>
      </div>
    </div>
  );
}
