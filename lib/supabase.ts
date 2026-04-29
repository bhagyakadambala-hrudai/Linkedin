import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://fjghdbrqwbnzebeawvfg.supabase.co';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'sb_publishable_cecJvTPntPgw9VfmwN5eCg_8sOx4Pq0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * After email confirm / magic link, Supabase redirects here. Must use the *actual* deployed
 * origin (not localhost), or links from production will fail with otp_expired / access_denied.
 * List this URL pattern in Supabase → Authentication → URL configuration → Redirect URLs
 * (e.g. https://your-app.vercel.app/** or https://*.vercel.app/**).
 */
export function getHashRouterAuthUrl(hashSuffix: string): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${window.location.pathname}${hashSuffix}`;
}

/** After signup email confirmation (HashRouter: #/auth). */
export function getEmailConfirmRedirectTo(): string {
  return getHashRouterAuthUrl('#/auth');
}

/** After password reset email (HashRouter). */
export function getPasswordResetRedirectTo(): string {
  return getHashRouterAuthUrl('#/auth?reset=true');
}

/** Production redirect for Supabase OAuth (e.g. LinkedIn via Supabase). HashRouter: include #/ path. */
export const SUPABASE_OAUTH_REDIRECT_TO =
  'https://linkedin-theta-seven.vercel.app/#/app/dashboard';

/**
 * Use when enabling LinkedIn (or other) OAuth through Supabase Auth.
 * Ensure the redirect URL is added in Supabase Dashboard → Authentication → URL configuration.
 */
export async function signInWithLinkedInOAuth() {
  return supabase.auth.signInWithOAuth({
    provider: 'linkedin',
    options: {
      redirectTo: SUPABASE_OAUTH_REDIRECT_TO,
    },
  });
}
