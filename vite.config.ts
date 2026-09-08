import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createShopifySyncPlugin } from './server/shopify-sync.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), createShopifySyncPlugin(env)],
    // Support the Vite names used by this SPA and the NEXT_PUBLIC names from
    // Supabase's Next.js starter instructions without exposing server secrets.
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    server: {
      port: 5173,
    },
  };
});
