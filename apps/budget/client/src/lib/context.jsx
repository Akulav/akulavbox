import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { api, toLogin } from './api.js';

/* ───────────── Auth (the server's shared sign-in) ───────────── */
const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [error, setError] = useState(null); // e.g. Florin is turned off for this account
  const [config, setConfig] = useState({ version: __APP_VERSION__ });

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.get('/auth/me');
      setUser(user);
    } catch (e) {
      if (e.status === 401) toLogin();
      else setError(e.message);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    api.get('/config').then(setConfig).catch(() => {});
    const onUnauthorized = () => toLogin();
    window.addEventListener('florin:unauthorized', onUnauthorized);
    return () => window.removeEventListener('florin:unauthorized', onUnauthorized);
  }, [refresh]);

  const value = useMemo(
    () => ({
      user,
      error,
      config,
      setUser,
      refreshConfig: () => api.get('/config').then(setConfig),
      // signing out is shared by every app: forget AkulavBox's stored token too
      logout: async () => {
        await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
        try {
          for (const k of ['akulavToken', 'akulavRole', 'akulavWeak']) localStorage.removeItem(k);
        } catch {}
        window.location.assign('/login?out=1');
      },
    }),
    [user, error, config],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

/* ───────────── Theme ───────────── */
const ThemeCtx = createContext(null);

const readPref = () => {
  try {
    return localStorage.getItem('florin-theme') || 'system';
  } catch {
    return 'system';
  }
};

export function ThemeProvider({ children }) {
  const [pref, setPref] = useState(readPref);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const fn = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  const dark = pref === 'dark' || (pref === 'system' && systemDark);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('florin-theme', pref);
    } catch {}
  }, [dark, pref]);

  const value = useMemo(() => ({ pref, setPref, dark }), [pref, dark]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

/** Concrete colors for chart chrome (Recharts needs real values, not CSS vars). */
export function useChartTheme() {
  const { dark } = useTheme();
  return dark
    ? { grid: '#232c28', axis: '#808b85', text: '#eef2ef', muted: '#3a4540', surface: '#131917', spend: '#3987e5', income: '#199e70', prev: '#5b6761' }
    : { grid: '#eceeea', axis: '#7f8882', text: '#121614', muted: '#d5dad5', surface: '#ffffff', spend: '#2a78d6', income: '#1baf7a', prev: '#b3bab5' };
}

/* ───────────── Toasts ───────────── */
const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (message, type = 'success') => {
      const id = Math.random().toString(36).slice(2);
      setToasts((t) => [...t, { id, message, type }]);
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );
  const value = useMemo(
    () => ({ success: (m) => push(m, 'success'), error: (m) => push(m, 'error') }),
    [push],
  );
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-pop pointer-events-auto flex max-w-sm items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-lg shadow-black/5"
          >
            {t.type === 'error' ? (
              <AlertCircle size={18} className="shrink-0 text-danger" />
            ) : (
              <CheckCircle2 size={18} className="shrink-0 text-brand" />
            )}
            <span className="text-ink">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="ml-1 text-ink-3 hover:text-ink" aria-label="Dismiss">
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/* ───────────── Data refresh + shared reference data ───────────── */
const DataCtx = createContext(null);

export function DataProvider({ children }) {
  const { user } = useAuth();
  const [version, setVersion] = useState(0);
  const [categories, setCategories] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [txModal, setTxModal] = useState(null); // null | { transaction?: object }

  const loadCategories = useCallback(() => api.get('/categories').then((d) => setCategories(d.categories)), []);
  useEffect(() => {
    if (!user) return;
    loadCategories().catch(() => {});
  }, [user, version, loadCategories]);
  useEffect(() => {
    api.get('/currencies').then((d) => setCurrencies(d.currencies)).catch(() => {});
  }, [user]);

  const value = useMemo(
    () => ({
      version,
      bump: () => setVersion((v) => v + 1),
      categories,
      currencies,
      reloadCurrencies: () => api.get('/currencies').then((d) => setCurrencies(d.currencies)),
      txModal,
      openTransaction: (transaction = null, defaults = {}) => setTxModal({ transaction, defaults }),
      closeTransaction: () => setTxModal(null),
    }),
    [version, categories, currencies, txModal],
  );
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export const useData = () => useContext(DataCtx);

/** Fetch helper that re-runs when deps or the global data version change. */
export function useApi(url, deps = []) {
  const { version } = useData() ?? { version: 0 };
  const [state, setState] = useState({ data: null, loading: true, error: null });
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    api
      .get(url)
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState((s) => ({ ...s, loading: false, error })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, version, ...deps]);
  return state;
}
