import { NextRequest, NextResponse } from 'next/server';
import { getMockDashboard, shouldUseMockData } from '@/lib/mock';
import { createServerClient } from '@/lib/supabase/server';
import {
  type CheckinSummarySnapshot,
  type ClinicalPillarSnapshot,
  type DoctorDashboardSummary,
  type PillarMetricValue,
} from '@/lib/clinical/dashboard';
import { CLINICAL_PILLARS, METRIC_LABELS, trendLabel } from '@/lib/clinical/metric-definitions';
import type { ClinicalPillarId } from '@/lib/clinical/metric-definitions';
import type { ConversationTurn } from '@/lib/types';

const PILLAR_METRICS = [
  'tremor_score',
  'hand_tremor_hz',
  'dominant_freq_hz',
  'jitter_pct',
  'shimmer_pct',
  'resting_hr',
];

function latestByMetric(
  rows: Array<{ metric_name: string; value: number; unit: string | null; recorded_at: string }>
) {
  const map = new Map<string, (typeof rows)[0]>();
  for (const row of rows) {
    map.set(row.metric_name, row);
  }
  return map;
}

function priorByMetric(
  sessions: Array<{ id: string; recorded_at: string }>,
  biomarkers: Array<{ session_id: string; metric_name: string; value: number }>
) {
  if (sessions.length < 2) return new Map<string, number>();
  const priorSessionId = sessions[1].id;
  const map = new Map<string, number>();
  for (const b of biomarkers) {
    if (b.session_id === priorSessionId) map.set(b.metric_name, b.value);
  }
  return map;
}

function buildPillar(
  id: ClinicalPillarId,
  latest: Map<string, { value: number; unit: string | null; recorded_at: string }>,
  prior: Map<string, number>
): ClinicalPillarSnapshot {
  const def = CLINICAL_PILLARS[id];
  const values: PillarMetricValue[] = [];
  for (const name of def.metrics) {
    const row = latest.get(name);
    if (!row) continue;
    values.push({
      name,
      value: row.value,
      unit: row.unit ?? METRIC_LABELS[name]?.unit ?? '',
    });
  }

  const primary = def.primaryMetric ? latest.get(def.primaryMetric)?.value : null;
  const priorPrimary = def.primaryMetric ? prior.get(def.primaryMetric) ?? null : null;
  const higherIsWorse = id !== 'resting_hr';

  return {
    id,
    values,
    trend:
      primary !== null && primary !== undefined
        ? trendLabel(primary, priorPrimary, higherIsWorse)
        : 'No data',
    recorded_at: values[0] ? latest.get(values[0].name)?.recorded_at ?? null : null,
  };
}

function summarizeTranscript(transcript: ConversationTurn[], flags: Record<string, unknown>): string {
  const userLines = transcript.filter((t) => t.role === 'user').map((t) => t.content);
  const parts: string[] = [];
  if (userLines.length) {
    parts.push(`Patient reported: "${userLines[userLines.length - 1]}"`);
  }
  if (flags.word_recall) parts.push(`Cognitive note: word recall ${flags.word_recall}.`);
  if (flags.mood) parts.push(`Mood: ${flags.mood}.`);
  return parts.length
    ? parts.join(' ')
    : 'No conversation transcript available for the latest check-in.';
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const patientId = params.id;

  if (shouldUseMockData()) {
    return NextResponse.json(getMockDashboard(patientId));
  }

  try {
    const supabase = createServerClient();

    const [{ data: patient }, { data: sessions }, { data: biomarkers }, { data: alerts }] =
      await Promise.all([
        supabase.from('patients').select('*').eq('id', patientId).maybeSingle(),
        supabase
          .from('sessions')
          .select('id, recorded_at')
          .eq('patient_id', patientId)
          .eq('session_type', 'checkin')
          .order('recorded_at', { ascending: false })
          .limit(5),
        supabase
          .from('biomarkers')
          .select('session_id, metric_name, value, unit, recorded_at')
          .eq('patient_id', patientId)
          .in('metric_name', PILLAR_METRICS)
          .order('recorded_at', { ascending: false }),
        supabase
          .from('alerts')
          .select('id')
          .eq('patient_id', patientId)
          .eq('acknowledged', false),
      ]);

    if (!sessions?.length || !biomarkers?.length) {
      return NextResponse.json(getMockDashboard(patientId));
    }

    const latestSession = sessions[0];
    const latestRows = biomarkers.filter((b) => b.session_id === latestSession.id);
    const latest = latestByMetric(latestRows);
    const prior = priorByMetric(sessions, biomarkers);

    const { data: conversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('session_id', latestSession.id)
      .maybeSingle();

    const transcript = (conversation?.transcript as ConversationTurn[]) ?? [];
    const cognitiveFlags = (conversation?.cognitive_flags as Record<string, unknown>) ?? {};

    const checkin_summary: CheckinSummarySnapshot = {
      session_id: latestSession.id,
      recorded_at: latestSession.recorded_at,
      excerpt: summarizeTranscript(transcript, cognitiveFlags),
      transcript,
      cognitive_flags: cognitiveFlags,
    };

    const summary: DoctorDashboardSummary = {
      patient_id: patientId,
      patient_name: patient?.full_name ?? 'Unknown Patient',
      diagnosis: patient?.diagnosis ?? '—',
      last_checkin_at: latestSession.recorded_at,
      pillars: [
        buildPillar('kinematic_tremor', latest, prior),
        buildPillar('vocal_tremor', latest, prior),
        buildPillar('resting_hr', latest, prior),
      ],
      checkin_summary,
      alerts_count: alerts?.length ?? 0,
    };

    return NextResponse.json(summary);
  } catch {
    return NextResponse.json(getMockDashboard(patientId));
  }
}
