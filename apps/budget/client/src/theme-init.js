// Applies the saved theme before React mounts to avoid a flash of the wrong theme.
try {
  const pref = localStorage.getItem('florin-theme') || 'system';
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
} catch {
  /* storage unavailable */
}
