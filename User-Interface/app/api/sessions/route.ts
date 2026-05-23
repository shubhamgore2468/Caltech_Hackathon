import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { fuseRiskScores } from '@/lib/biomarkers/fusion';
import { checkAndCreateAlert } from '@/lib/alerts';

const createSessionSchema = z.object({
  patient_id: z.string(),
  session_type: z.enum(['checkin', 'walk_test', 'tremor_test', 'wearable_sync']),
  recorded_at: z.string().optional(),
  duration_seconds: z.number().optional(),
  notes: z.string().optional(),
  biomarkers: z
    .array(
      z.object({
        category: z.enum(['voice', 'camera', 'motion', 'wearable', 'cognitive']),
        metric_name: z.string(),
        value: z.number(),
        unit: z.string().optional(),
      })
    )
    .optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = createSessionSchema.parse(await request.json());
    const supabase = createServerClient();
    const recordedAt = body.recorded_at ?? new Date().toISOString();

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        patient_id: body.patient_id,
        session_type: body.session_type,
        recorded_at: recordedAt,
        duration_seconds: body.duration_seconds ?? null,
        notes: body.notes ?? null,
      })
      .select()
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: sessionError?.message ?? 'Failed to create session' }, { status: 500 });
    }

    const biomarkers = body.biomarkers ?? [];
    if (biomarkers.length > 0) {
      const rows = biomarkers.map((b) => ({
        session_id: session.id,
        patient_id: body.patient_id,
        category: b.category,
        metric_name: b.metric_name,
        value: b.value,
        unit: b.unit ?? null,
        recorded_at: recordedAt,
      }));

      const { error: biomarkerError } = await supabase.from('biomarkers').insert(rows);
      if (biomarkerError) {
        return NextResponse.json({ error: biomarkerError.message }, { status: 500 });
      }

      const fusion = fuseRiskScores(biomarkers);
      await supabase.from('risk_scores').insert({
        session_id: session.id,
        patient_id: body.patient_id,
        parkinsons_score: fusion.parkinsons_score,
        dementia_score: fusion.dementia_score,
        contributing_factors: fusion.contributing_factors,
        recorded_at: recordedAt,
      });

      for (const b of biomarkers) {
        await checkAndCreateAlert(body.patient_id, session.id, b.metric_name, b.value);
      }
    }

    return NextResponse.json({ session, biomarker_count: biomarkers.length }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const patientId = request.nextUrl.searchParams.get('patient_id');
  const supabase = createServerClient();

  let query = supabase.from('sessions').select('*').order('recorded_at', { ascending: false });

  if (patientId) {
    query = query.eq('patient_id', patientId);
  }

  const { data, error } = await query.limit(50);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sessions: data });
}
