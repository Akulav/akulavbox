import { useEffect, useRef, useState } from 'react';
import { Loader2, X, ArrowUpRight, ArrowDownRight } from 'lucide-react';

export function Button({ variant = 'primary', size = 'md', loading, icon: Icon, children, className = '', ...props }) {
  const base =
    'inline-flex items-center justify-center gap-2 font-medium transition-all disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap';
  const sizes = { sm: 'h-8 px-3 text-[13px] rounded-lg', md: 'h-10 px-4 text-sm rounded-xl', lg: 'h-11 px-5 text-[15px] rounded-xl' };
  const variants = {
    primary: 'bg-brand text-white hover:bg-brand-strong shadow-sm shadow-brand/20 active:scale-[0.98] dark:text-[#04140f]',
    secondary: 'bg-surface border border-line text-ink hover:bg-surface-2 active:scale-[0.98]',
    ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
    danger: 'bg-danger text-white hover:opacity-90 active:scale-[0.98]',
    'danger-ghost': 'text-danger hover:bg-danger/10',
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} disabled={loading || props.disabled} {...props}>
      {loading ? <Loader2 size={16} className="animate-spin" /> : Icon ? <Icon size={16} strokeWidth={2.2} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, className = '', size = 16, ...props }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 transition hover:bg-surface-2 hover:text-ink ${className}`}
      {...props}
    >
      <Icon size={size} />
    </button>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>}
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function Card({ title, subtitle, action, children, className = '', bodyClass = 'p-5' }) {
  return (
    <section className={`card animate-in ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            {title && <h2 className="font-display text-[15px] font-bold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.activeElement;
    setTimeout(() => {
      if (ref.current?.contains(document.activeElement)) return;
      (ref.current?.querySelector('input,select,textarea') ?? ref.current?.querySelector('button'))?.focus();
    }, 30);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        className={`animate-pop relative flex max-h-[92vh] w-full ${widths[size]} flex-col rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl`}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-base font-bold">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="scrollbar-thin overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Delete', onConfirm, onClose, danger = true }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-2">{message}</p>
    </Modal>
  );
}

export function Badge({ children, tone = 'neutral', className = '' }) {
  const tones = {
    neutral: 'bg-surface-2 text-ink-2',
    brand: 'bg-brand-soft text-brand-strong',
    danger: 'bg-danger/10 text-danger',
    warning: 'bg-warning/12 text-warning',
    gold: 'bg-gold/15 text-[#9a6a00] dark:text-gold',
  };
  return <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tones[tone]} ${className}`}>{children}</span>;
}

/** Up/down change pill. `inverse` = higher is worse (spending). */
export function Delta({ value, inverse = true, suffix = 'vs last month' }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="text-xs text-ink-3">No prior data</span>;
  const up = value > 0;
  const good = inverse ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold ${good ? 'bg-brand-soft text-brand-strong' : 'bg-danger/10 text-danger'}`}>
        <Icon size={12} strokeWidth={2.5} />
        {Math.abs(value).toFixed(0)}%
      </span>
      <span className="text-ink-3">{suffix}</span>
    </span>
  );
}

export function EmptyState({ icon: Icon, title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {Icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
          <Icon size={22} />
        </div>
      )}
      <h3 className="font-display text-[15px] font-bold">{title}</h3>
      {message && <p className="mt-1 max-w-sm text-sm text-ink-3">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-lg bg-surface-2 ${className}`} />;
}

export function Segmented({ options, value, onChange, className = '' }) {
  return (
    <div className={`inline-flex rounded-xl border border-line bg-surface-2 p-0.5 ${className}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-[10px] px-3 py-1.5 text-[13px] font-medium transition ${
            value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${checked ? 'bg-brand' : 'bg-line'}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

export function ProgressBar({ value, max, color }) {
  const ratio = max > 0 ? value / max : 0;
  const over = ratio > 1;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(ratio, 1) * 100}%`, backgroundColor: over ? 'var(--danger)' : color }}
      />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
