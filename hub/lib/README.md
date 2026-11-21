# Viewer libraries

Third-party browser libraries Trove loads only when a feature needs them (`apps/trove/public/lib/cdn.js`). They are served by this server at `/hub/lib/~<revision>/…` (`src/modules/hub.js`), so nothing is fetched from a CDN. Each file is byte-for-byte the published build, checked against the Subresource Integrity hash it had on the CDN before it was copied here, and `cdn.js` still checks that hash in the browser.

| File | Library | Version | License |
| --- | --- | --- | --- |
| `highlight.min.js` | [highlight.js](https://highlightjs.org) (`@highlightjs/cdn-assets`) | 11.9.0 | BSD-3-Clause |
| `marked.min.js` | [marked](https://marked.js.org) | 12.0.2 | MIT |
| `purify.min.js` | [DOMPurify](https://github.com/cure53/DOMPurify) | 3.1.6 | Apache-2.0 or MPL-2.0 |
| `mammoth.browser.min.js` | [mammoth](https://github.com/mwilliamson/mammoth.js) | 1.8.0 | BSD-2-Clause |
| `xlsx.full.min.js` | [SheetJS](https://sheetjs.com) (from cdn.sheetjs.com: the npm 0.18.5 build has CVE-2023-30533) | 0.20.3 | Apache-2.0 |
| `jszip.min.js` | [JSZip](https://stuk.github.io/jszip/) | 3.10.1 | MIT or GPL-3.0 |
| `epub.min.js` | [epub.js](https://github.com/futurepress/epub.js) | 0.3.93 | BSD-2-Clause |
| `pdf.min.js`, `pdf.worker.min.js` | [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | 3.11.174 | Apache-2.0 |
| `cropper.min.js`, `cropper.min.css` | [Cropper.js](https://github.com/fengyuanchen/cropperjs) | 1.6.1 | MIT |

The full license texts are in `licenses/`. To change a version, replace the file, update its sha384 in `cdn.js` and this table.
