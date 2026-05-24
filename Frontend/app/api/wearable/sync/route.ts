import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { fetchWearableData, wearableToBiomarkers } from '@/lib/wearable/terra';
import { fuseRiskScores } from '@/lib/biomarkers/fusion';

export async function POST(request: NextRequest) {
  try {
    const { patient_id } = await request.json();
    if (!patient_id) {
      return NextResponse.json({ error: 'patient_id required' }, { status: 400 });
    }

    const wearable = await fetchWearableData(patient_id);
    const biomarkers = wearableToBiomarkers(wearable);
    const supabase = createServerClient();

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        patient_id,
        session_type: 'wearable_sync',
        recorded_at: wearable.recorded_at,
        duration_seconds: null,
      })
      .select()
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: sessionError?.message }, { status: 500 });
    }

    const rows = biomarkers.map((b) => ({
      session_id: session.id,
      patient_id,
      category: b.category,
      metric_name: b.metric_name,
      value: b.value,
      unit: b.unit ?? null,
      recorded_at: wearable.recorded_at,
    }));

    const { error: bmErr } = await supabase.from('biomarkers').insert(rows);
    if (bmErr) console.warn('[wearable] biomarker insert failed', bmErr.message);
    else console.info(`[wearable] inserted ${rows.length} biomarker rows session=${session.id}`);

    const fusion = fuseRiskScores(biomarkers);
    const { error: rsErr } = await supabase.from('risk_scores').insert({
      session_id: session.id,
      patient_id,
      parkinsons_score: fusion.parkinsons_score,
      dementia_score: fusion.dementia_score,
      contributing_factors: fusion.contributing_factors,
      recorded_at: wearable.recorded_at,
    });
    if (rsErr) console.warn('[wearable] risk_score insert failed', rsErr.message);
    else console.info(`[wearable] risk_score inserted session=${session.id} pd=${fusion.parkinsons_score} dem=${fusion.dementia_score}`);

    return NextResponse.json({ session, biomarkers: rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
