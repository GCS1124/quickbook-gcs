import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * This project is a Vite SPA, so the browser client is the correct SSR-aware
 * integration point. It keeps auth in cookies and refreshes sessions without
 * pretending that a Next.js server or middleware exists in this runtime.
 */
const runtimeEnv = import.meta.env as ImportMetaEnv & {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};
const supabaseUrl = String(runtimeEnv.VITE_SUPABASE_URL || runtimeEnv.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const supabasePublishableKey = String(runtimeEnv.VITE_SUPABASE_PUBLISHABLE_KEY || runtimeEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '').trim();

export const hasSupabaseConfig = Boolean(supabaseUrl && supabasePublishableKey);
export const supabaseProjectRef = supabaseUrl.match(/^https?:\/\/([^.]+)\.supabase\.co/i)?.[1] || null;

let client: SupabaseClient | null = null;
let initializationError = '';

if (hasSupabaseConfig) {
  try {
    client = createBrowserClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  } catch (error) {
    initializationError = error instanceof Error ? error.message : 'The Supabase browser client could not be initialized.';
  }
}

export const supabase = client;
export const supabaseInitializationError = initializationError;
