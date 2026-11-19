import { money } from '../lib/format.js';

/** Shared tooltip: text in ink tokens, color only on the swatch. */
export function ChartTooltip({ active, payload, label, currency, labelFormatter, hideZero = false }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value !== null && p.value !== undefined && (!hideZero || p.value !== 0));
  if (!rows.length) return null;
  return (
    <div className="min-w-[150px] rounded-xl border border-line bg-surface px-3 py-2.5 text-xs shadow-xl shadow-black/10">
      {label !== undefined && <div className="mb-1.5 font-semibold text-ink">{labelFormatter ? labelFormatter(label) : label}</div>}
      <div className="space-y-1">
        {rows.map((p) => (
          <div key={p.dataKey ?? p.name} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: p.color ?? p.payload?.fill }} />
              {p.name}
            </span>
            <span className="num font-semibold text-ink">{money(p.value, currency)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={i.dashed ? { border: `1.5px dashed ${i.color}`, background: 'transparent' } : { backgroundColor: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}
