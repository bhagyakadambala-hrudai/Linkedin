# LinkedIn Token Storage - Security Fixes ✅

## Problem Found ❌
Your database was storing `linkedin_token: TRUE` (boolean) instead of the actual OAuth access token string.

**Root Cause**: The Onboarding page's "Connect LinkedIn" button was just setting a boolean flag (`linkedInConnected: true`) instead of triggering the actual OAuth flow with LinkedIn.

---

## What Was Fixed

### 1. **Onboarding.tsx - Line 338**
**Before (BROKEN):**
```tsx
onClick={() => setFormData({...formData, linkedInConnected: true})}
```
**After (FIXED):**
```tsx
onClick={async () => {
  try {
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;
    if (!userId) throw new Error('User not authenticated');
    const { generateLinkedInAuthUrl } = await import('../lib/linkedin');
    const url = generateLinkedInAuthUrl(userId);
    localStorage.setItem('li_auth_state', new URL(url).searchParams.get('state') || '');
    window.location.href = url;
  } catch (err) {
    setError('Failed to initiate LinkedIn connection');
  }
}}
```
✅ Now properly redirects to LinkedIn OAuth flow

---

### 2. **SettingsPage.tsx - handleConnect()**
**Added:**
- State parameter validation
- Error handling
- Proper localStorage state storage

```typescript
const handleConnect = () => {
  if (!userId) {
    setError("User ID not found. Please refresh.");
    return;
  }
  try {
    const url = generateLinkedInAuthUrl(userId);
    const stateParam = new URL(url).searchParams.get('state');
    if (stateParam) {
      localStorage.setItem('li_auth_state', stateParam);
    }
    window.location.href = url;
  } catch (err: any) {
    setError("Failed to initiate LinkedIn connection: " + err.message);
  }
};
```

---

### 3. **api.ts - Token Validation Functions**
**Added Security Checks:**

```typescript
/**
 * Validate LinkedIn token is in proper format
 * Ensures token is NOT a boolean or empty string
 */
export const validateLinkedInToken = (token: any): boolean => {
  if (!token) return false;
  if (typeof token !== 'string') return false;
  if (token === 'true' || token === 'false') return false; // ← Catches boolean bugs!
  if (token.length < 10) return false;
  return true;
};

/**
 * Get valid token with expiry checking
 */
export const getValidLinkedInToken = async (userId: string): Promise<string | null> => {
  const { data } = await supabase
    .from('profiles')
    .select('linkedin_token, linkedin_token_expires_at')
    .eq('user_id', userId)
    .single();

  // Check if token expired
  if (data?.linkedin_token_expires_at) {
    const expiryTime = new Date(data.linkedin_token_expires_at);
    if (new Date() > expiryTime) {
      console.warn("LinkedIn token expired");
      return null;
    }
  }
  return validateLinkedInToken(data?.linkedin_token) ? data.linkedin_token : null;
};

/**
 * Updated storage function with validation
 */
export const updateLinkedInConnection = async (
  userId: string,
  email: string,
  profileUrl: string,
  token: string,
  expiresAt?: string
) => {
  // Validate token before storing
  if (!token || token === 'true' || token === 'false') {
    throw new Error('Invalid token: token must be a non-empty string');
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({
      email,
      linkedin_profile_url: profileUrl,
      linkedin_token: token, // ← Now stores actual token string
      linkedin_connected: true,
      linkedin_token_expires_at: expiresAt
    })
    .eq('user_id', userId);

  if (error) throw error;
  return data;
};
```

---

### 4. **app/api/linkedin/callback/route.ts - Token Validation**
**Added Validation Before Storage:**
```typescript
if (userId) {
  // Validate token before saving
  if (!accessToken || typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('Invalid token received from LinkedIn');
  }

  const { error: dbError } = await supabase
    .from('profiles')
    .update({
      linkedin_token: accessToken, // ← Actual token string
      linkedin_profile_id: linkedinId,
      linkedin_connected: true,
      linkedin_token_expires_at: expiresAt.toISOString()
    })
    .eq('user_id', userId);

  if (dbError) throw dbError;
  console.log(`Successfully stored LinkedIn token for user: ${userId}`);
} else {
  throw new Error("No userId found in OAuth state. Cannot update profile.");
}
```

---

### 5. **supabase/functions/linkedin-exchange/index.ts - Edge Function**
**Added Token Format Validation:**
```typescript
const tokenData = await tokenResponse.json()
if (!tokenResponse.ok) throw new Error(tokenData.error_description || 'Token exchange failed')

// SECURITY: Validate token is valid format before storing
if (!tokenData.access_token || typeof tokenData.access_token !== 'string' || tokenData.access_token.length < 10) {
  throw new Error('Invalid token format received from LinkedIn')
}
```

---

### 6. **server.js - Token Validation**
**Added Validation:**
```javascript
const tokenData = await tokenResponse.json();
if (!tokenResponse.ok) throw new Error(tokenData.error_description || 'Token exchange failed');

// SECURITY: Validate token format before storing in database
if (!tokenData.access_token || typeof tokenData.access_token !== 'string' || tokenData.access_token.length < 10) {
  throw new Error('Invalid token format received from LinkedIn');
}
```

---

## Token Flow Now ✅

```
User clicks "Connect LinkedIn" 
  ↓
Redirects to LinkedIn OAuth URL (with encoded user ID in state)
  ↓
User approves permissions on LinkedIn
  ↓
LinkedIn redirects to /api/linkedin/callback with authorization code
  ↓
Backend exchanges code for access_token
  ↓
✅ TOKEN VALIDATION: Checks token is string, not empty, not boolean
  ↓
Fetches LinkedIn profile info (to get LinkedIn profile ID)
  ↓
✅ STORES IN DATABASE:
   - linkedin_token: "AQGZ_rN4xY_z7..." (actual token)
   - linkedin_profile_id: "K7h3x5mZ..." 
   - linkedin_connected: true
   - linkedin_token_expires_at: "2026-02-25T03:58:41.298Z"
  ↓
Frontend callback handler shows success message
  ↓
✅ User is connected! Token can now be used for posting
```

---

## Database Now Stores

```
linkedin_token: "AQGZ_rN4xY_z7mPs1k2h9Y4sNpQrXtUvWxYzAbCdEfGhIjKlMnOpQrStUvWx" ✅
linkedin_token_expires_at: "2026-02-25T03:58:41.298Z" ✅
linkedin_profile_id: "K7h3x5mZ9pLqRsT0" ✅
linkedin_connected: true ✅
```

**NOT:**
```
linkedin_token: true ❌
```

---

## Security Best Practices Applied

| Check | Implementation |
|-------|-----------------|
| **Token Format Validation** | Checks if string, not empty, length > 10 |
| **Boolean Detection** | Explicitly rejects 'true' and 'false' strings |
| **Token Expiry** | Stores & checks expiration time |
| **State Validation** | Encodes user ID in OAuth state param |
| **Error Handling** | Throws on any token validation failure |
| **Type Checking** | Validates token type is 'string' |

---

## How to Use Stored Token

```typescript
// Get valid token for posting
const token = await getValidLinkedInToken(userId);

if (token) {
  // Use in LinkedIn API calls
  const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`, // ← Real token!
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      author: `urn:li:person:${linkedinProfileId}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: {
            text: "Your AI-generated post content"
          }
        }
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
      }
    })
  });
} else {
  // Token expired or invalid - need to reconnect
  console.log('LinkedIn token invalid. User needs to reconnect.');
}
```

---

## Testing Checklist ✅

- [ ] Clear browser cache and localStorage
- [ ] Click "Connect LinkedIn" button
- [ ] Authorize on LinkedIn
- [ ] Check database - verify `linkedin_token` is a long string, not TRUE/FALSE
- [ ] Verify `linkedin_connected` is `true`
- [ ] Verify `linkedin_token_expires_at` has a timestamp
- [ ] Try posting via Make.com webhook - token should work now

---

## Environment Variables Required

```env
LINKEDIN_CLIENT_ID=86j7ddjv9w7b8m
LINKEDIN_CLIENT_SECRET=your_client_secret_here
SUPABASE_URL=https://fjghdbrqwbnzebeawvfg.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_key
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

---

**Status**: ✅ All fixes applied and token validation implemented