import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  LayoutGrid,
  ArrowLeftRight,
  PieChart,
  Shapes,
  Settings,
  ShieldCheck,
  Plus,
  LogOut,
  Moon,
  Sun,
  Monitor,
  Menu,
  X,
} from 'lucide-react';
import { Logo } from './Logo.jsx';
import { useAuth, useData, useTheme } from '../lib/context.jsx';
import { initials } from '../lib/format.js';
import { Button } from './ui.jsx';
import TransactionModal from './TransactionModal.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/analytics', label: 'Analytics', icon: PieChart },
  { to: '/categories', label: 'Categories & budgets', icon: Shapes },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function NavItems({ onNavigate }) {
  const { user } = useAuth();
  const items = user?.role === 'admin' ? [...NAV, { to: '/admin', label: 'Admin', icon: ShieldCheck }] : NAV;
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              isActive ? 'bg-brand-soft text-brand-strong' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
            }`
          }
        >
          <Icon size={18} strokeWidth={2} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function ThemeSwitch() {
  const { pref, setPref } = useTheme();
  const opts = [
    { v: 'light', icon: Sun, label: 'Light' },
    { v: 'system', icon: Monitor, label: 'System' },
    { v: 'dark', icon: Moon, label: 'Dark' },
  ];
  return (
    <div className="flex rounded-xl border border-line bg-surface-2 p-0.5">
      {opts.map(({ v, icon: Icon, label }) => (
        <button
          key={v}
          onClick={() => setPref(v)}
          aria-label={`${label} theme`}
          title={`${label} theme`}
          className={`flex h-7 flex-1 items-center justify-center rounded-[10px] transition ${pref === v ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink'}`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  return (
    <div className="flex items-center gap-3 rounded-xl p-2">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-strong text-[13px] font-bold text-white">
        {initials(user?.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{user?.name}</div>
        <div className="truncate text-xs text-ink-3">{user?.username}</div>
      </div>
      <a href="/" className="rounded-lg p-2 text-ink-3 transition hover:bg-surface-2 hover:text-ink" aria-label="All apps" title="All apps">
        <LayoutGrid size={16} />
      </a>
      <button onClick={logout} className="rounded-lg p-2 text-ink-3 transition hover:bg-surface-2 hover:text-danger" aria-label="Sign out" title="Sign out">
        <LogOut size={16} />
      </button>
    </div>
  );
}

function Sidebar({ onNavigate }) {
  const { openTransaction } = useData();
  const { config } = useAuth();
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="px-2 pt-1">
        <Logo />
      </div>
      <Button
        icon={Plus}
        size="lg"
        className="w-full"
        onClick={() => {
          openTransaction();
          onNavigate?.();
        }}
      >
        Add transaction
      </Button>
      <NavItems onNavigate={onNavigate} />
      <div className="mt-auto flex flex-col gap-3">
        <ThemeSwitch />
        <div className="border-t border-line pt-3">
          <UserMenu />
        </div>
        <div className="px-2 text-[11px] text-ink-3">Florin v{config.version}</div>
      </div>
    </div>
  );
}

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { txModal, closeTransaction, openTransaction } = useData();
  const location = useLocation();
  const mainRef = useRef(null);

  useEffect(() => {
    mainRef.current?.scrollTo?.(0, 0);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Keyboard shortcut: "n" opens a new transaction.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      openTransaction();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openTransaction]);

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-surface lg:block">
        <Sidebar />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-surface/85 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setMobileOpen(true)} className="-ml-2 rounded-lg p-2 text-ink-2" aria-label="Open menu">
          <Menu size={20} />
        </button>
        <Logo size={28} />
        <button onClick={() => openTransaction()} className="-mr-2 rounded-lg p-2 text-brand" aria-label="Add transaction">
          <Plus size={22} />
        </button>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="animate-in absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-surface">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-4 rounded-lg p-2 text-ink-3" aria-label="Close menu">
              <X size={18} />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <main ref={mainRef} className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
        <Outlet />
      </main>

      {txModal && <TransactionModal transaction={txModal.transaction} defaults={txModal.defaults} onClose={closeTransaction} />}
    </div>
  );
}
