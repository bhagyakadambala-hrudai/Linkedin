'use strict';

/**
 * Only fetch resume files hosted on Supabase Storage (prevents open SSRF).
 */
function assertAllowedStorageUrl(fileUrl) {
  let u;
  try {
    u = new URL(fileUrl);
  } catch {
    throw new Error('Invalid file URL');
  }
  if (!u.hostname.endsWith('supabase.co')) {
    throw new Error('Resume URL must be a Supabase Storage public URL');
  }
  if (!u.pathname.includes('/storage/v1/object/public/')) {
    throw new Error('Invalid Supabase storage object URL');
  }
}

module.exports = { assertAllowedStorageUrl };
