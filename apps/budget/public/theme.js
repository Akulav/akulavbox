// Applies the saved theme before the page renders, so it never flashes the wrong one.
try {
  var pref = localStorage.getItem('florin-theme') || 'system';
  var dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
} catch (e) {
  /* storage unavailable */
}
