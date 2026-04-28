import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * Ensures the current user has a profile row (user_id, email, created_at).
 * Called after sign-in/sign-up so the app can rely on profiles existing.
 */
export async function POST(request: NextRequest) {
  const res = NextResponse.next();
  const supabase = createServerSupabaseClient(request, res);

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: existing } = await supabase
    .from('profiles')
    .select('skills, topics')
    .eq('user_id', user.id)
    .maybeSingle();

  const { error: upsertError } = await supabase.from('profiles').upsert(
    {
      user_id: user.id,
      email: user.email ?? '',
      skills: (existing as { skills?: string | null } | null)?.skills ?? '',
      topics: (existing as { topics?: string | null } | null)?.topics ?? '',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (upsertError) {
    console.error('ensure-profile upsert error:', upsertError);
    return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 });
  }

  console.log('Profile upsert complete', { user_id: user.id, email: user.email ?? '' });
  return NextResponse.json({ ok: true });
}
