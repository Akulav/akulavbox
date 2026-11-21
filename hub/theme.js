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

// The backdrop every page shares, behind its content: a slow aurora in the app's colour, a faint dot
// grid that fades out down the page, and on a mouse a soft glow that follows the pointer. Cheap on
// purpose: three fixed layers moved with transforms (the compositor's work, no repaints), one pointer
// listener throttled to a frame. Motion stops under html[data-motion="off"] and prefers-reduced-motion.
// Ironveil's game fills the screen and gets none; Trove draws its own aurora, so it gets the rest.
(function () {
  var path = location.pathname;
  if (path.indexOf('/ironveil') === 0) return;
  var ACCENT = { '/box': '232 163 61', '/docs': '59 130 246', '/budget': '27 175 122', '/tasks': '139 92 246' };
  var accent = '232 163 61';
  for (var p in ACCENT) if (path.indexOf(p) === 0) accent = ACCENT[p];
  var ownAurora = path.indexOf('/box') === 0;

  var css =
    '.akb-backdrop{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;--a:' + accent + ';--t:95 179 161;--o:1}' +
    ':root[data-theme="light"] .akb-backdrop{--o:.65}' +
    '.akb-backdrop>i{position:absolute;display:block;will-change:transform}' +
    '.akb-backdrop .au1{width:70vmax;height:70vmax;left:-22vmax;top:-34vmax;border-radius:50%;opacity:calc(.16*var(--o));' +
      'background:radial-gradient(closest-side,rgb(var(--a)),rgb(var(--a)/0));animation:akb-drift1 38s ease-in-out infinite alternate}' +
    '.akb-backdrop .au2{width:60vmax;height:60vmax;right:-24vmax;bottom:-30vmax;border-radius:50%;opacity:calc(.12*var(--o));' +
      'background:radial-gradient(closest-side,rgb(var(--t)),rgb(var(--t)/0));animation:akb-drift2 46s ease-in-out infinite alternate}' +
    '.akb-backdrop .grid{inset:0;opacity:calc(.5*var(--o));' +
      'background-image:radial-gradient(rgb(var(--fg-dot,255 255 255)/.09) 1px,transparent 1.4px);background-size:24px 24px;' +
      '-webkit-mask-image:radial-gradient(120% 70% at 50% 0%,#000 10%,transparent 70%);mask-image:radial-gradient(120% 70% at 50% 0%,#000 10%,transparent 70%)}' +
    ':root[data-theme="light"] .akb-backdrop .grid{--fg-dot:20 31 34}' +
    '.akb-backdrop .spot{width:560px;height:560px;left:-280px;top:-280px;border-radius:50%;opacity:0;transition:opacity .6s ease;' +
      'background:radial-gradient(closest-side,rgb(var(--a)/.10),rgb(var(--a)/0));transform:translate3d(var(--mx,50vw),var(--my,30vh),0)}' +
    '.akb-backdrop.lit .spot{opacity:calc(1*var(--o))}' +
    '@keyframes akb-drift1{to{transform:translate3d(14vmax,10vmax,0) scale(1.15)}}' +
    '@keyframes akb-drift2{to{transform:translate3d(-12vmax,-8vmax,0) scale(1.1)}}' +
    '@media (prefers-reduced-motion:reduce){.akb-backdrop>i{animation:none!important}.akb-backdrop .spot{display:none}}' +
    'html[data-motion="off"] .akb-backdrop>i{animation:none!important}html[data-motion="off"] .akb-backdrop .spot{display:none}' +
    '@media print{.akb-backdrop{display:none}}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function mount() {
    if (document.querySelector('.akb-backdrop')) return;
    var bd = document.createElement('div');
    bd.className = 'akb-backdrop';
    bd.setAttribute('aria-hidden', 'true');
    bd.innerHTML = (ownAurora ? '' : '<i class="au1"></i><i class="au2"></i>') + '<i class="grid"></i><i class="spot"></i>';
    document.body.insertBefore(bd, document.body.firstChild);
    // the glow follows a mouse (not a finger), one update per frame at most
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    var x = 0, y = 0, queued = false;
    var paint = function () { queued = false; bd.style.setProperty('--mx', x + 'px'); bd.style.setProperty('--my', y + 'px'); };
    window.addEventListener('pointermove', function (e) {
      x = e.clientX; y = e.clientY;
      if (!bd.classList.contains('lit')) bd.classList.add('lit');
      if (!queued) { queued = true; requestAnimationFrame(paint); }
    }, { passive: true });
    document.addEventListener('pointerleave', function () { bd.classList.remove('lit'); });
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
