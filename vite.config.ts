import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const APP_VERSION =
  process.env.VITE_APP_VERSION ??
  process.env.npm_package_version ??
  '7.0.0';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],

    define: {
      // ── Variables publiques uniquement — JAMAIS de secrets ──────────────
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(APP_VERSION),
      'import.meta.env.VITE_APP_NAME': JSON.stringify('IRO Strength Velocity'),
      // ── FIN DES VARIABLES CLIENT ─────────────────────────────────────────
      // Toute autre variable (GEMINI_API_KEY, PAPPERS_API_KEY, GITHUB_TOKEN)
      // doit rester dans process.env côté Node / server.ts UNIQUEMENT.
    },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },

    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      // Proxy API vers Express en développement
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
