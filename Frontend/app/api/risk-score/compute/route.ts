import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';
import { computeRiskScore } from '@/lib/biomarkers/fusion';
import type { Biomarker, CognitiveFlags } from '@/lib/types';

const BodySchema = z.object({
  session_id: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }
  const { session_id } = parsed.data;
  const supa = getServerSupabase();

  const [bioRes, convRes] = await Promise.all([
    supa.from('biomarkers').select('category, metric_name, value, unit, raw_blob').eq('session_id', session_id),
    supa.from('conversations').select('cognitive_flags').eq('session_id', session_id).maybeSingle(),
  ]);

  if (bioRes.error) {
    return NextResponse.json({ error: bioRes.error.message }, { status: 500 });
  }

  const biomarkers = (bioRes.data ?? []) as Biomarker[];
  const cognitive = (convRes.data?.cognitive_flags ?? null) as CognitiveFlags | null;

  if (biomarkers.length === 0 && !cognitive) {
    console.warn(`[risk-score] no data for session=${session_id}`);
    return NextResponse.json({ error: 'no biomarkers or conversation data for session' }, { status: 404 });
  }

  const score = computeRiskScore({ biomarkers, cognitive });
  console.info(
    `[risk-score] computed session=${session_id} biomarkers=${biomarkers.length} ` +
      `pd=${score.parkinsons_score.toFixed(4)} dem=${score.dementia_score.toFixed(4)}`,
  );

  const { data, error } = await supa
    .from('risk_scores')
    .insert({
      session_id,
      parkinsons_score: score.parkinsons_score,
      dementia_score: score.dementia_score,
      contributing_factors: score.contributing_factors,
    })
    .select('id, computed_at')
    .single();

  if (error) {
    console.warn('[risk-score] insert failed', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.info(`[risk-score] inserted id=${data.id} session=${session_id}`);
  return NextResponse.json({ ...score, id: data.id, computed_at: data.computed_at });
}
