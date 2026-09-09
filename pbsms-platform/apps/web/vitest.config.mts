import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * jsdom does not implement IndexedDB at all -- fake-indexeddb (loaded via
 * setupFiles below) provides a real, spec-following implementation so
 * offline-db.ts's actual IndexedDB calls run against real semantics
 * (transactions, keyPaths, onupgradeneeded) rather than being mocked away.
 *
 * pool: 'threads' rather than the default forked-process pool -- process
 * forking was unreliable in this sandbox (workers repeatedly timed out
 * starting up); worker_threads avoids the extra process-spawn entirely.
 * .mts extension (not .ts): apps/web's package.json has no "type": "module"
 * (Next.js's own tooling expects CommonJS there), and Vitest's native
 * config loader warns when an ESM-syntax .ts config is loaded as CommonJS.
 */
export default defineConfig({
  plugins: [react()],
  // tsconfig.json's own "@/*" -> "./src/*" path mapping (used throughout
  // src/, e.g. SyncLedger.tsx's "@/lib/offline-sync") -- Vite/Vitest does
  // not read tsconfig "paths" on its own, only Next.js's webpack/turbopack
  // build does, so every component test that imports something under
  // src/ via '@/' needs this mirrored here. First needed by
  // SyncLedger.test.tsx, the first test file to render a component with
  // '@/' imports rather than a leaf lib module.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: false,
    pool: 'threads',
  },
});
