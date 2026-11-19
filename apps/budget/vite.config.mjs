// Builds Florin's page into apps/budget/dist, served by AkulavBox at /budget/.
// Run from the repository root: npm run build:budget. The output is committed, so servers
// never need these build tools (they are devDependencies).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const meta = JSON.parse(readFileSync(new URL('./meta.json', import.meta.url), 'utf8'));
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('./client'),
  base: '/budget/',
  publicDir: 'public',
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(meta.version) },
  build: {
    outDir: here('./dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: { charts: ['recharts'], vendor: ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
});
