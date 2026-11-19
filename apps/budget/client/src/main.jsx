import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, Link } from 'react-router-dom';
import './index.css';
import { AuthProvider, DataProvider, ThemeProvider, ToastProvider, useAuth } from './lib/context.jsx';
import { BASE } from './lib/api.js';
import Layout from './components/Layout.jsx';
import { LogoMark } from './components/Logo.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Transactions from './pages/Transactions.jsx';
import Analytics from './pages/Analytics.jsx';
import Categories from './pages/Categories.jsx';
import Settings from './pages/Settings.jsx';
import Admin from './pages/Admin.jsx';

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <LogoMark size={44} className="animate-pulse" />
    </div>
  );
}

// Signed-out visitors are sent to the server's sign-in page (lib/context.jsx); this covers the
// moment before that, and accounts that don't have Florin turned on.
function Protected({ children, admin = false }) {
  const { user, error } = useAuth();
  if (user === undefined) return <Splash />;
  if (!user)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <LogoMark size={44} />
        <p className="max-w-sm text-ink-3">{error || 'Opening the sign-in page…'}</p>
        <a href="/" className="text-sm font-semibold text-brand hover:underline">
          All apps
        </a>
      </div>
    );
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function NotFound() {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <div className="font-display text-6xl font-extrabold text-brand">404</div>
      <p className="mt-2 text-ink-3">This page wandered off.</p>
      <Link to="/" className="mt-6 text-sm font-semibold text-brand hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="categories" element={<Categories />} />
        <Route path="settings" element={<Settings />} />
        <Route path="admin" element={<Protected admin><Admin /></Protected>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename={BASE}>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <DataProvider>
              <App />
            </DataProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
