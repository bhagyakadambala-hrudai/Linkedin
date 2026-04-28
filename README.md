
# LinkedIn Automation Configuration

## 1. OAuth Setup
- Redirect URI: `https://[your-domain].com/#/auth/linkedin/callback`
- Scopes: `openid profile w_member_social email`

## 2. Make.com Integration (UGC Post)
To automate posts from Make.com using the stored tokens:

### Module 1: Supabase (Get Row)
- Table: `profiles`
- Column: `linkedin_token`, `linkedin_profile_id`

### Module 2: HTTP (Make a request)
- **URL**: `https://api.linkedin.com/v2/ugcPosts`
- **Method**: POST
- **Headers**:
    - `Authorization`: `Bearer {{supabase.linkedin_token}}`
    - `X-Restli-Protocol-Version`: `2.0.0`
    - `Content-Type`: `application/json`
- **Body (JSON)**:
```json
{
    "author": "urn:li:person:{{supabase.linkedin_profile_id}}",
    "lifecycleState": "PUBLISHED",
    "specificContent": {
        "com.linkedin.ugc.ShareContent": {
            "shareCommentary": {
                "text": "{{gemini_generated_post_content}}"
            },
            "shareMediaCategory": "NONE"
        }
    },
    "visibility": {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
    }
}
```

## 3. Environment Variables (Supabase Edge Function)
Add these in your Supabase Dashboard or CLI:
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
