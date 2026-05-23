import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { fuseRiskScores } from '@/lib/biomarkers/fusion';

const computeSchema = z.object({
  session_id: z.string().uuid(),
  patient_id: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const body = computeSchema.parse(await request.json());
    const supabase = createServerClient();

    const { data: biomarkers, error } = await supabase
      .from('biomarkers')
      .select('category, metric_name, value, unit')
      .eq('session_id', body.session_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!biomarkers?.length) {
      return NextResponse.json({ error: 'No biomarkers for session' }, { status: 404 });
    }

    const fusion = fuseRiskScores(
      biomarkers.map((b) => ({
        category: b.category as 'voice' | 'camera' | 'motion' | 'wearable' | 'cognitive',
        metric_name: b.metric_name,
        value: b.value,
        unit: b.unit ?? undefined,
      }))
    );

    const { data: riskScore, error: insertError } = await supabase
      .from('risk_scores')
      .insert({
        session_id: body.session_id,
        patient_id: body.patient_id,
        parkinsons_score: fusion.parkinsons_score,
        dementia_score: fusion.dementia_score,
        contributing_factors: fusion.contributing_factors,
        recorded_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json(riskScore);
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
