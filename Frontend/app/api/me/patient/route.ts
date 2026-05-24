import { NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { getServerSupabase } from '@/lib/supabase/server';

/**
 * GET /api/me/patient
 *
 * Returns (or auto-creates) the Supabase `patients` row for the currently
 * logged-in Clerk user.  Used by the patient check-in pages so that every
 * session is stored under the real user's UUID instead of the hardcoded demo
 * patient ID.
 *
 * Response: { patient_id: string; name: string; created: boolean }
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const supa = getServerSupabase();

  // Fast path — patient already exists for this Clerk user.
  const { data: existing } = await supa
    .from('patients')
    .select('id, name')
    .eq('clerk_user_id', userId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ patient_id: existing.id, name: existing.name, created: false });
  }

  // First time — create a patient row from Clerk profile info.
  const user = await currentUser();
  const nameFromParts = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  const name =
    user?.fullName ??
    (nameFromParts || user?.emailAddresses?.[0]?.emailAddress) ??
    'Patient';

  const { data: created, error } = await supa
    .from('patients')
    .insert({
      clerk_user_id: userId,
      name,
      diagnosis: "Parkinson's Disease",
    })
    .select('id, name')
    .single();

  if (error) {
    console.warn('[me/patient] insert failed', error.message);
    // Could be a race condition (duplicate clerk_user_id) — try reading again.
    const { data: retry } = await supa
      .from('patients')
      .select('id, name')
      .eq('clerk_user_id', userId)
      .maybeSingle();

    if (retry) {
      return NextResponse.json({ patient_id: retry.id, name: retry.name, created: false });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.info(`[me/patient] created patient_id=${created.id} name="${created.name}"`);
  return NextResponse.json({ patient_id: created.id, name: created.name, created: true });
}
