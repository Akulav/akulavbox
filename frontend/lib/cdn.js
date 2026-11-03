// Lazy-loads third-party libraries (only when a feature needs them).
const LIBS = {
  hljs: ['https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/highlight.min.js'],
  marked: ['https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js'],
  DOMPurify: ['https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js'],
  mammoth: ['https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js'],
  XLSX: ['https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'],
  JSZip: ['https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'],
  ePub: ['https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js'],
  pdfjsLib: ['https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'],
};
const DEPS = { ePub: ['JSZip'] };
const loading = {};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load a viewer component. Check your internet connection.'));
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
