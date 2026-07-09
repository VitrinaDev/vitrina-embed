import { defineConfig } from 'tsup';

// Two outputs from ONE `tsup` invocation (array of configs):
//   1. ESM library  -> dist/index.js + dist/index.d.ts  (package.json exports ".")
//   2. IIFE loader  -> dist/loader.global.js             (package.json exports "./loader")
//
// Only the FIRST config sets `clean: true` — the second must NOT re-clean or it
// wipes the library output written just before it.
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2020',
    dts: true,
    treeshake: true,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
  },
  {
    entry: { loader: 'src/loader.ts' },
    format: ['iife'],
    platform: 'browser',
    target: 'es2019',
    dts: false,
    minify: true,
    sourcemap: true,
    clean: false,
    // Self-executing IIFE (loader.ts auto-inits from window.vitrinaChat); the
    // global name is inert but named for clarity.
    globalName: 'VitrinaChatLoader',
    outDir: 'dist',
    outExtension() {
      return { js: '.global.js' };
    },
  },
]);
