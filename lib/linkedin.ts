// Stable production domain for Vercel. Never use preview URLs or window.location.origin for OAuth.
const PRODUCTION_APP_URL = 'https://linkedin-theta-seven.vercel.app';

/**
 * API base for LinkedIn redirect_uri and token exchange.
 * Production builds always use the production host (no localhost in shipped bundle).
 */
const getApiBaseUrl = () => {
  if (import.meta.env.PROD) {
    return PRODUCTION_APP_URL;
  }
  const configured =
    import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_BACKEND_URL;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.replace(/\/$/, '');
  }
  return PRODUCTION_APP_URL;
};

/** Redirect URI for LinkedIn OAuth — must match exactly in auth URL and token exchange. */
export const getLinkedInRedirectUri = () => `${getApiBaseUrl()}/api/linkedin/callback`;

export const LINKEDIN_CONFIG = {
  clientId: import.meta.env.VITE_LINKEDIN_CLIENT_ID || '86j7ddjv9w7b8m',
  get redirectUri() {
    return getLinkedInRedirectUri();
  },
  scopes: ['openid', 'profile', 'email', 'w_member_social'],
};

export const generateLinkedInAuthUrl = (userId: string) => {
  // Check if there's a return path saved (e.g., from onboarding)
  const returnPath =
    typeof window !== 'undefined' ? localStorage.getItem('li_return_path') : null;

  const appOrigin =
    import.meta.env.VITE_APP_URL ||
    import.meta.env.VITE_BACKEND_URL ||
    PRODUCTION_APP_URL;
  const statePayload = JSON.stringify({
    userId,
    returnPath: returnPath || '/app/dashboard',
    appOrigin: appOrigin || undefined,
    nonce: Math.random().toString(36).substring(2, 15),
  });
  const state = btoa(statePayload);

  const redirectUri = getLinkedInRedirectUri();

  const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
  url.searchParams.append('response_type', 'code');
  url.searchParams.append('client_id', LINKEDIN_CONFIG.clientId);
  url.searchParams.append('redirect_uri', redirectUri);
  url.searchParams.append('state', state);
  url.searchParams.append('scope', LINKEDIN_CONFIG.scopes.join(' '));

  return url.toString();
};
