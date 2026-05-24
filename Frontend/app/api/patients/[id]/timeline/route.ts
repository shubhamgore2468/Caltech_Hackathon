import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';

// Accept any UUID format (incl. nil/seed UUIDs). z.string().uuid() in zod v4 is strict v4-only.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const ParamSchema = z.object({ id: z.string().regex(UUID_RE) });

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolved = await params;
  const parsed = ParamSchema.safeParse(resolved);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid patient id' }, { status: 400 });
  }
  const patient_id = parsed.data.id;

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '180', 10) || 180, 500);

  const supa = getServerSupabase();

  // Fetch sessions for patient, then risk_scores + biomarkers joined.
  const { data: sessions, error: sErr } = await supa
    .from('sessions')
    .select('id, started_at, ended_at, mode')
    .eq('patient_id', patient_id)
    .order('started_at', { ascending: true })
    .limit(limit);

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
  const sessionIds = (sessions ?? []).map((s) => s.id);

  if (sessionIds.length === 0) {
    return NextResponse.json({ patient_id, sessions: [], risk_scores: [], biomarkers: [] });
  }

  const [rsRes, bmRes] = await Promise.all([
    supa
      .from('risk_scores')
      .select('session_id, parkinsons_score, dementia_score, contributing_factors, computed_at')
      .in('session_id', sessionIds)
      .order('computed_at', { ascending: true }),
    supa
      .from('biomarkers')
      .select('session_id, category, metric_name, value, unit, computed_at')
      .in('session_id', sessionIds)
      .order('computed_at', { ascending: true }),
  ]);

  if (rsRes.error) return NextResponse.json({ error: rsRes.error.message }, { status: 500 });
  if (bmRes.error) return NextResponse.json({ error: bmRes.error.message }, { status: 500 });

  return NextResponse.json({
    patient_id,
    sessions,
    risk_scores: rsRes.data ?? [],
    biomarkers: bmRes.data ?? [],
  });
}
