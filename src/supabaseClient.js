import { createClient } from "@supabase/supabase-js";

/* Sync is optional. If the client cannot be created the app still runs exactly
 * as it did before: fully local, no account, no network.
 *
 * The publishable key is SAFE to ship in a client bundle. It only identifies
 * the project; access is enforced by row level security on every table. The
 * secret / service_role key must NEVER appear in this file or anywhere else in
 * the client.
 */
const FALLBACK_URL = "https://lbaxooyifuhsghbbygov.supabase.co";
const FALLBACK_KEY = "sb_publishable_-5wOhnkOswX8xuA0L_k0eQ_HSuX_OGX";

// Build-time overrides win, so the same source can point at another project.
export const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || FALLBACK_URL;
export const SUPABASE_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || FALLBACK_KEY;

export const syncConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const supabase = syncConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
