// Lazy-loads third-party libraries (only when a feature needs them).
// Every file is pinned to one version and checked against its hash (Subresource
// Integrity): a tampered CDN copy is refused instead of running next to the login token.
// To change a version, update the URL and its sha384 together.
const LIBS = {
  hljs: [['https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/highlight.min.js', 'sha384-F/bZzf7p3Joyp5psL90p/p89AZJsndkSoGwRpXcZhleCWhd8SnRuoYo4d0yirjJp']],
  marked: [['https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js', 'sha384-/TQbtLCAerC3jgaim+N78RZSDYV7ryeoBCVqTuzRrFec2akfBkHS7ACQ3PQhvMVi']],
  DOMPurify: [['https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js', 'sha384-+VfUPEb0PdtChMwmBcBmykRMDd+v6D/oFmB3rZM/puCMDYcIvF968OimRh4KQY9a']],
  mammoth: [['https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js', 'sha384-/cXAMbzovUIKbBERjPmR3SnPTh8siWr5lsvFYj1Uq4XP0yaJUZJmsh0YXyGv5P0y']],
  // SheetJS from its own CDN: the npm 0.18.5 build has a prototype-pollution bug (CVE-2023-30533) a crafted spreadsheet can trigger
  XLSX: [['https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', 'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT']],
  JSZip: [['https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG']],
  ePub: [['https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js', 'sha384-ZqmkDa/1AGF4SKdSmXgEG+3G+Gsb6yNqUSq2Mqp0jDf1GWk+UY5eNbEd7hgwiywI']],
  pdfjsLib: [['https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js', 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e']],
};
const DEPS = { ePub: ['JSZip'] };
const loading = {};

function loadScript([src, integrity]) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.integrity = integrity; s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error('Could not load a viewer component. Check your internet connection.')); };
    document.head.appendChild(s);
  });
}

export function lib(name) {
  if (window[name]) return Promise.resolve(window[name]);
  if (!loading[name]) {
    loading[name] = (async () => {
      for (const dep of DEPS[name] || []) await lib(dep);
      for (const src of LIBS[name]) await loadScript(src);
      if (!window[name]) throw new Error(`${name} failed to load`);
      if (name === 'pdfjsLib') {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      }
      return window[name];
    })().catch((e) => { delete loading[name]; throw e; });
  }
  return loading[name];
}

export async function sanitize(html) {
  const DOMPurify = await lib('DOMPurify');
  if (!DOMPurify.__akulavHooked) {
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && node.getAttribute('href')) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
    });
    DOMPurify.__akulavHooked = true;
  }
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
