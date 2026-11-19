import { useId } from 'react';

export function LogoMark({ size = 32, className = '' }) {
  // Unique gradient id per instance: a shared id breaks when the first instance is display:none.
  const gid = `florin-g-${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#15b386" />
          <stop offset="1" stopColor="#076b50" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gid})`} />
      <circle cx="49.5" cy="14.5" r="5.5" fill="#f3b93b" />
      <path d="M41 16.5c-2.6-2.4-8.6-2.6-10.4 3.4L24.4 46c-1.4 5.6-6.4 6.2-9 4" fill="none" stroke="#fff" strokeWidth="5.4" strokeLinecap="round" />
      <path d="M20 31.5h17" fill="none" stroke="#fff" strokeWidth="5.4" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ size = 32, showText = true, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      {showText && <span className="font-display text-[19px] font-extrabold tracking-tight text-ink">Florin</span>}
    </span>
  );
}
