// The theme every app shares (localStorage akulavTheme: light, dark or system), applied before the
// page paints: <script src="/hub/theme.js"></script> in the <head>. Sets <html data-theme> and, for
// Tailwind's dark: variant, the "dark" class.
(function () {
  var t = null;
  try { t = localStorage.getItem('akulavTheme'); } catch (e) { /* storage unavailable */ }
  if (!t || t === 'system') t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  document.documentElement.classList.toggle('dark', t === 'dark');
})();
