import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://fjghdbrqwbnzebeawvfg.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_cecJvTPntPgw9VfmwN5eCg_8sOx4Pq0';

/**
 * Create Supabase server client for middleware (Edge).
 * Pass the request and response so cookies can be read and set.
 */
export function createServerSupabaseClient(
  request: NextRequest,
  response: NextResponse
) {
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });
}
