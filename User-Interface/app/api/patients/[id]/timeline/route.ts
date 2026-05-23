import { NextRequest, NextResponse } from 'next/server';
import { getMockTimeline, shouldUseMockData } from '@/lib/mock';
import { createServerClient } from '@/lib/supabase/server';
import type { PatientTimeline, TimelinePoint } from '@/lib/types';

const TRACKED_METRICS = [
  'jitter_pct',
  'tremor_score',
  'gait_variance',
  'blink_rate_per_min',
  'sleep_quality',
  'shimmer_pct',
  'hand_tremor_hz',
  'resting_hr',
];

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const patientId = params.id;

  if (shouldUseMockData()) {
    return NextResponse.json(getMockTimeline(patientId));
  }

  try {
    const supabase = createServerClient();

    const [{ data: biomarkers }, { data: riskScores }, { data: alerts }] = await Promise.all([
      supabase
        .from('biomarkers')
        .select('session_id, metric_name, value, recorded_at')
        .eq('patient_id', patientId)
        .in('metric_name', TRACKED_METRICS)
        .order('recorded_at', { ascending: true }),
      supabase
        .from('risk_scores')
        .select('session_id, parkinsons_score, dementia_score, recorded_at')
        .eq('patient_id', patientId)
        .order('recorded_at', { ascending: true }),
      supabase
        .from('alerts')
        .select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    const metrics: Record<string, TimelinePoint[]> = {};
    for (const metric of TRACKED_METRICS) {
      metrics[metric] = [];
    }

    for (const b of biomarkers ?? []) {
      if (!metrics[b.metric_name]) metrics[b.metric_name] = [];
      metrics[b.metric_name].push({
        recorded_at: b.recorded_at,
        session_id: b.session_id,
        value: b.value,
      });
    }

    const timeline: PatientTimeline = {
      patient_id: patientId,
      metrics,
      risk_scores: (riskScores ?? []).map((r) => ({
        recorded_at: r.recorded_at,
        session_id: r.session_id,
        parkinsons_score: r.parkinsons_score,
        dementia_score: r.dementia_score,
      })),
      alerts: alerts ?? [],
    };

    if (!biomarkers?.length) {
      return NextResponse.json(getMockTimeline(patientId));
    }

    return NextResponse.json(timeline);
  } catch {
    return NextResponse.json(getMockTimeline(patientId));
  }
}
