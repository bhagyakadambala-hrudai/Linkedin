# LinkedIn OAuth Callback – Production Setup

## 1. Correct folder structure

The serverless callback **must** live at the project **root** (same level as `package.json`), **not** inside `src/`:

```
autolink-ai (4)/
├── package.json
├── vercel.json
├── api/
│   └── linkedin/
│       └── callback.js    ← Vercel serverless function
├── src/
├── pages/
└── lib/
```

- **`/api/linkedin/callback.js`** → Vercel exposes this as **`/api/linkedin/callback`**.
- Do **not** put the callback under `src/` or `lib/`; Vercel only deploys functions from the root `api/` folder.

## 2. What was wrong before

| Issue | Cause | Fix |
|-------|--------|-----|
| **404** | Callback file in wrong place (e.g. under `src/` or wrong path), or Vercel not seeing `api/`. | Use **`/api/linkedin/callback.js`** at project root. |
| **500** | Missing env in Vercel, unhandled errors, or sending JSON/empty response instead of redirect. | Validate env at start; on any error **redirect** to settings; never return JSON; use `safeRedirect` and a `finally` fallback so a response is always sent. |
| No redirect | Handler threw or returned without calling `res.redirect()` / `res.end()`. | All branches and catch block call `safeRedirect()`; `finally` checks `!res.headersSent` and redirects to `/#/app/settings`. |

## 3. Environment variables (Vercel Production)

In **Vercel** → Project → **Settings** → **Environment Variables**, set:

| Variable | Required | Example / note |
|----------|----------|-----------------|
| `SUPABASE_URL` | Yes | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (not anon key) |
| `LINKEDIN_CLIENT_ID` | Yes | From LinkedIn Developer app |
| `LINKEDIN_CLIENT_SECRET` | Yes | From LinkedIn Developer app |
| `FRONTEND_URL` | No | Default: `https://linkedin-saas-three.vercel.app` |

Apply to **Production** (and Preview if you use it).

## 4. LinkedIn app configuration

In **LinkedIn Developer Portal** → Your app → **Auth** → **OAuth 2.0 settings**:

- **Authorized redirect URLs** must contain **exactly**:
  ```text
  https://linkedin-saas-three.vercel.app/api/linkedin/callback
  ```
- No trailing slash, no path difference. Any typo causes token exchange to fail.

## 5. Callback behavior (no 404, no 500, always redirect)

- **Success**: redirect to  
  `https://<FRONTEND_URL>/#/app/settings?linkedin=connected&linkedin_connected=true`
- **Error** (missing code, bad state, token/Supabase failure): redirect to  
  `https://<FRONTEND_URL>/#/app/settings?error=linkedin_failed`
- **Fallback**: if for any reason no redirect was sent, the handler sends a redirect to `/#/app/settings`.

The handler **never** returns JSON and **never** leaves the request without a response.

## 6. Steps to redeploy

1. Commit and push:
   ```bash
   git add api/linkedin/callback.js
   git commit -m "fix: production-safe LinkedIn OAuth callback"
   git push
   ```
2. Let Vercel build and deploy (or trigger deploy from the Vercel dashboard).
3. Confirm in Vercel → **Deployments** that the latest deployment succeeded and that **Functions** include `api/linkedin/callback`.

## 7. How to test

1. **Env**: In Vercel, confirm all four required variables are set for Production.
2. **Redirect URL**: In LinkedIn, confirm the redirect URL is exactly  
   `https://linkedin-saas-three.vercel.app/api/linkedin/callback`.
3. **Flow**:
   - Log in to your app and open **Settings**.
   - Click “Connect LinkedIn”.
   - On LinkedIn, approve the app.
   - You should be sent back to **Settings** with a success state (no 404, no 500).
4. **If it fails**: Open Vercel → **Project** → **Logs** (or **Functions** → `api/linkedin/callback` → Logs). The callback logs `Query:`, `LinkedIn Token Response:`, and `Supabase response:` so you can see where it failed.

## 8. Duplicate / other implementations

- **`api/linkedin/callback.js`** (at root) is the **production** callback used by Vercel. LinkedIn must redirect here.
- **`server.js`** defines an Express route `/api/linkedin/callback` for **local dev** only (`node server.js`). Production does not use it.
- **`pages/LinkedInCallback.tsx`** is a client page for `/#/auth/linkedin/callback` (e.g. if you ever use a client-side callback or Edge Function flow). The main production flow is: LinkedIn → `api/linkedin/callback` → redirect to `/#/app/settings?linkedin=connected`.
- **`lib/linkedin.ts`** only builds the auth URL and redirect URI; it does not implement the callback endpoint.
