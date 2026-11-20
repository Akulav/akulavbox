// Tailwind's classes compiled on the server, once per revision, into one ordinary stylesheet.
//
// The pages used to compile them in the browser (Tailwind's browser build, or Trove's CDN script): a
// render-blocking script, a MutationObserver re-scanning the page on every change, and a page that came
// up unstyled whenever the script was slow, failed or lost the race with the first render. Here the same
// compiler (the @tailwindcss/browser bundle, run in a sandbox with a stub DOM: no new dependency and no
// build step) reads the page's `<style type="text/tailwindcss">` and every class-like word of the app's
// sources, like Tailwind's own scanner, and the page links the result as a versioned, immutable file.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BUNDLE = require.resolve('@tailwindcss/browser');
let script = null;

// Words that may be classes: everything between quotes, spaces and template punctuation. Tailwind
// ignores what is not a class, so taking too much only costs a little time, once.
const SPLIT = /[\s"'`\\<>{}=;,]+/;
const CLASSY = /^[a-z!@\-[*][\w\-:/.[\]()#%!&>@*+,'=]*$/i;
function candidates(files) {
  const out = new Set();
  for (const f of files) {
    let text = '';
    try { text = fs.readFileSync(f, 'utf-8'); } catch (e) { continue; }
    for (const w of text.split(SPLIT)) if (w.length > 1 && w.length < 120 && CLASSY.test(w)) out.add(w);
    // arbitrary values keep their commas (grid-cols-[repeat(auto-fill,minmax(9rem,1fr))])
    for (const m of text.matchAll(/[\w:!-]+-\[[^\s"'`\]]+\](?:\/[\w.]+)?/g)) out.add(m[0]);
  }
  return [...out];
}

/** Every .js and .html file under these folders */
function sources(dirs, skip) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (skip && skip.test(p)) continue;
      if (e.isDirectory()) walk(p);
      else if (/\.(?:js|html)$/.test(e.name)) out.push(p);
    }
  };
  for (const d of dirs) walk(d);
  return out;
}

/**
 * Compile `css` (the page's Tailwind stylesheet: @theme, @custom-variant, …) for the classes found in
 * the files under `dirs`. Resolves to the stylesheet's text.
 */
function compile(css, dirs, { skip = null } = {}) {
  const classes = candidates(sources(dirs, skip));
  if (!script) script = new vm.Script(fs.readFileSync(BUNDLE, 'utf-8'), { filename: BUNDLE });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tailwind did not finish compiling.')), 20000);
    const done = (text) => { clearTimeout(timer); resolve(text); };
    // the generated <style>: its text is set once the utilities are built
    const out = { set textContent(v) { done(v); }, get textContent() { return ''; } };
    const el = (tag) => (tag === 'style' ? out : {});
    const doc = {
      documentElement: {},
      head: { append() {} },
      createElement: el,
      querySelectorAll: (sel) => (sel.startsWith('style')
        ? [{ textContent: css }]
        : [{ classList: classes }]),
    };
    const noop = () => {};
    const sandbox = {
      document: doc,
      Node: { ELEMENT_NODE: 1 },
      MutationObserver: class { observe() {} },
      performance: { mark: noop, measure: noop },
      console: { ...console, warn: noop },
      setTimeout, clearTimeout, queueMicrotask, URL, TextEncoder, TextDecoder,
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    try {
      script.runInNewContext(sandbox);
    } catch (e) { clearTimeout(timer); reject(e); }
    // a compile error ends up in performance.mark('(error)'): report it instead of waiting
    sandbox.performance.mark = (name, opts) => { if (name === '(error)') { clearTimeout(timer); reject(opts?.detail?.error || new Error('Tailwind failed.')); } };
  });
}

module.exports = { compile, candidates };
