import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { checkAndCreateAlert } from '@/lib/alerts';

const biomarkerBatchSchema = z.object({
  session_id: z.string().uuid(),
  patient_id: z.string(),
  biomarkers: z.array(
    z.object({
      category: z.enum(['voice', 'camera', 'motion', 'wearable', 'cognitive']),
      metric_name: z.string(),
      value: z.number(),
      unit: z.string().optional(),
    })
  ),
  recorded_at: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = biomarkerBatchSchema.parse(await request.json());
    const supabase = createServerClient();
    const recordedAt = body.recorded_at ?? new Date().toISOString();

    const rows = body.biomarkers.map((b) => ({
      session_id: body.session_id,
      patient_id: body.patient_id,
      category: b.category,
      metric_name: b.metric_name,
      value: b.value,
      unit: b.unit ?? null,
      recorded_at: recordedAt,
    }));

    const { data, error } = await supabase.from('biomarkers').insert(rows).select();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    for (const b of body.biomarkers) {
      await checkAndCreateAlert(body.patient_id, body.session_id, b.metric_name, b.value);
    }

    return NextResponse.json({ biomarkers: data }, { status: 201 });
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
  const sessionId = request.nextUrl.searchParams.get('session_id');
  const patientId = request.nextUrl.searchParams.get('patient_id');
  const supabase = createServerClient();

  let query = supabase.from('biomarkers').select('*').order('recorded_at', { ascending: false });

  if (sessionId) query = query.eq('session_id', sessionId);
  if (patientId) query = query.eq('patient_id', patientId);

  const { data, error } = await query.limit(500);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ biomarkers: data });
}
