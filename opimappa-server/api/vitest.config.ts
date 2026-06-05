import { defineConfig } from 'vitest/config';

// API backend (Hono): nessun CSS nei test. Senza questo, vitest avvia un dev
// server Vite che risale a /postcss.config.js (frontend CRA) e fallisce in CI
// perche' tailwindcss vive nei node_modules del frontend, non in opimappa-server/api.
// `css.postcss: {}` = config inline vuota → niente ricerca filesystem verso la root.
export default defineConfig({
  css: {
    postcss: {},
  },
  test: {
    css: false,
  },
});
