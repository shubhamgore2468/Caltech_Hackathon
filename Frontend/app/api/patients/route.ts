import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supa = getServerSupabase();

    const { data: patients, error } = await supa
      .from('patients')
      .select('id, name, diagnosis, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!patients?.length) return NextResponse.json([]);

    const enriched = await Promise.all(
      patients.map(async (p) => {
        const { data: sessions } = await supa
          .from('sessions')
          .select('id, started_at, recorded_at, session_type')
          .eq('patient_id', p.id)
          .order('started_at', { ascending: false })
          .limit(1);

        const latestSession = sessions?.[0] ?? null;

        let riskScore: { parkinsons_score: number; dementia_score: number } | null = null;
        if (latestSession) {
          const { data: rs } = await supa
            .from('risk_scores')
            .select('parkinsons_score, dementia_score')
            .eq('session_id', latestSession.id)
            .order('computed_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          riskScore = rs ?? null;
        }

        return {
          id: p.id,
          name: p.name ?? 'Unknown Patient',
          diagnosis: p.diagnosis ?? '—',
          last_session: latestSession
            ? { at: latestSession.recorded_at ?? latestSession.started_at }
            : null,
          risk_score: riskScore,
        };
      }),
    );

    return NextResponse.json(enriched);
  } catch (err) {
    console.warn('[api/patients] failed', err);
    return NextResponse.json({ error: 'Failed to fetch patients' }, { status: 500 });
  }
}
