import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Support the Vite names used by this SPA and the NEXT_PUBLIC names from
  // Supabase's Next.js starter instructions without exposing server secrets.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  server: {
    port: 5173,
  },
});
