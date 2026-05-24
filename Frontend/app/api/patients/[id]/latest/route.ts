import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { getMockPatientStore, shouldUseMockData } from '@/lib/mock';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface BiomarkerRow {
  category: string;
  metric_name: string;
  value: number;
  unit: string | null;
  step: string | null;
  turn_index: number | null;
  raw_blob: Record<string, unknown> | null;
  recorded_at: string | null;
}

function mockResponse(patientId: string) {
  const store = getMockPatientStore(patientId);
  const latest = store.sessions[store.sessions.length - 1];
  const prior = store.sessions.length > 1 ? store.sessions[store.sessions.length - 2] : null;
  const biomarkers = latest.biomarkers.map((b) => ({
    ...b,
    step: null,
    turn_index: null,
    raw_blob: null,
    recorded_at: latest.recorded_at,
    unit: b.unit,
  }));
  return {
    patient: { id: patientId, name: store.patient_name, diagnosis: store.diagnosis },
    session: { id: latest.id, started_at: latest.recorded_at, ended_at: latest.recorded_at, session_type: 'checkin' },
    prior_session: prior ? { id: prior.id, started_at: prior.recorded_at } : null,
    biomarkers,
    prior_biomarkers: prior
      ? prior.biomarkers.map((b) => ({ ...b, step: null, turn_index: null, raw_blob: null, recorded_at: prior.recorded_at, unit: b.unit }))
      : [],
    conversation: { transcript: latest.transcript, cognitive_flags: latest.cognitive_flags },
    risk_score: {
      parkinsons_score: latest.parkinsons_score,
      dementia_score: latest.dementia_score,
      contributing_factors: {},
      computed_at: latest.recorded_at,
    },
    mock: true,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: patientId } = await params;
  const requestedSessionId = req.nextUrl.searchParams.get('session_id');

  if (!UUID_RE.test(patientId)) {
    // String IDs (e.g. 'demo-001') always go through mock.
    return NextResponse.json(mockResponse(patientId));
  }

  if (shouldUseMockData()) {
    return NextResponse.json(mockResponse(patientId));
  }

  try {
    const supa = getServerSupabase();

    const { data: patient } = await supa.from('patients').select('*').eq('id', patientId).maybeSingle();

    type SessionRow = {
      id: string;
      patient_id: string;
      session_type: string | null;
      mode: string | null;
      started_at: string | null;
      ended_at: string | null;
      recorded_at: string | null;
      duration_seconds: number | null;
      notes: string | null;
    };
    let latest: SessionRow;
    let prior: SessionRow | null = null;

    if (requestedSessionId && UUID_RE.test(requestedSessionId)) {
      const { data: target } = await supa
        .from('sessions')
        .select('id, patient_id, session_type, mode, started_at, ended_at, recorded_at, duration_seconds, notes')
        .eq('patient_id', patientId)
        .eq('id', requestedSessionId)
        .maybeSingle();
      if (!target) {
        return NextResponse.json({ error: 'session not found for patient' }, { status: 404 });
      }
      latest = target;
      // prior = most recent session strictly before this one
      const { data: priorRow } = await supa
        .from('sessions')
        .select('id, patient_id, session_type, mode, started_at, ended_at, recorded_at, duration_seconds, notes')
        .eq('patient_id', patientId)
        .lt('started_at', target.started_at ?? new Date().toISOString())
        .not('ended_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      prior = priorRow ?? null;
    } else {
      // Prefer completed sessions (ended_at IS NOT NULL). /patient/checkin_v2 creates a
      // session row on page load; if the user bails before finishing, we get an empty stub
      // that has 0 biomarkers and would otherwise show as the "latest" on the doctor page.
      const { data: completedRows } = await supa
        .from('sessions')
        .select('id, patient_id, session_type, mode, started_at, ended_at, recorded_at, duration_seconds, notes')
        .eq('patient_id', patientId)
        .not('ended_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(2);

      let sessions = completedRows ?? [];
      if (sessions.length === 0) {
        const { data: any_ } = await supa
          .from('sessions')
          .select('id, patient_id, session_type, mode, started_at, ended_at, recorded_at, duration_seconds, notes')
          .eq('patient_id', patientId)
          .order('started_at', { ascending: false })
          .limit(2);
        sessions = any_ ?? [];
      }

      if (!sessions.length) {
        return NextResponse.json(mockResponse(patientId));
      }
      latest = sessions[0];
      prior = sessions[1] ?? null;
    }

    const [{ data: biomarkers }, { data: priorBiomarkers }, { data: conversation }, { data: riskScore }] =
      await Promise.all([
        supa
          .from('biomarkers')
          .select('category, metric_name, value, unit, step, turn_index, raw_blob, recorded_at')
          .eq('session_id', latest.id)
          .order('recorded_at', { ascending: true }),
        prior
          ? supa
              .from('biomarkers')
              .select('category, metric_name, value, unit, step, turn_index, raw_blob, recorded_at')
              .eq('session_id', prior.id)
          : Promise.resolve({ data: [] as BiomarkerRow[] }),
        supa
          .from('conversations')
          .select('transcript, cognitive_flags, created_at')
          .eq('session_id', latest.id)
          .maybeSingle(),
        supa
          .from('risk_scores')
          .select('parkinsons_score, dementia_score, contributing_factors, computed_at')
          .eq('session_id', latest.id)
          .order('computed_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    return NextResponse.json({
      patient: patient ?? { id: patientId, name: 'Unknown Patient', diagnosis: '—' },
      session: latest,
      prior_session: prior,
      biomarkers: biomarkers ?? [],
      prior_biomarkers: priorBiomarkers ?? [],
      conversation: conversation ?? null,
      risk_score: riskScore ?? null,
      mock: false,
    });
  } catch (err) {
    console.warn('[patients/latest] supabase failed, falling back to mock', err);
    return NextResponse.json(mockResponse(patientId));
  }
}
