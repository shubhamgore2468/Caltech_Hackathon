import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import {
  analyzeProgression,
  type MetricConfig,
  type ProgressionPoint,
} from '@/lib/clinical/progression';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const METRIC_CONFIGS: Record<string, MetricConfig> = {
  pd_ratio_mean: { direction: 1, label: 'PD band ratio (motion)' },
  jitter_local_pct: { direction: 1, label: 'Voice jitter %' },
  pd_probability: { direction: 1, label: 'PD voice probability' },
  blink_rate_per_min: { direction: -1, label: 'Blink rate' },
};

const TRACKED = Object.keys(METRIC_CONFIGS);

interface BiomarkerRow {
  session_id: string;
  metric_name: string;
  value: number;
}

interface SessionRow {
  id: string;
  recorded_at: string | null;
  started_at: string | null;
}

function aggregatePerSession(rows: BiomarkerRow[]): Record<string, { mean: number; std: number }> {
  const grouped = new Map<string, number[]>();
  for (const r of rows) {
    if (!TRACKED.includes(r.metric_name)) continue;
    if (!grouped.has(r.metric_name)) grouped.set(r.metric_name, []);
    grouped.get(r.metric_name)!.push(r.value);
  }
  const out: Record<string, { mean: number; std: number }> = {};
  for (const [m, vals] of grouped) {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance =
      vals.length > 1 ? vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (vals.length - 1) : 0;
    out[m] = { mean, std: Math.sqrt(variance) };
  }
  return out;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: patientId } = await params;
  if (!UUID_RE.test(patientId)) {
    return NextResponse.json(
      { ok: false, reason: 'Patient id must be UUID for progression analysis.', individual_metrics: {}, overall: null, history_count: 0 },
      { status: 200 },
    );
  }

  try {
    const supa = getServerSupabase();
    const { data: sessions, error: sErr } = await supa
      .from('sessions')
      .select('id, recorded_at, started_at')
      .eq('patient_id', patientId)
      .order('started_at', { ascending: true });

    if (sErr) {
      console.warn('[progression] sessions fetch failed', sErr.message);
      return NextResponse.json({ ok: false, reason: sErr.message, individual_metrics: {}, overall: null, history_count: 0 });
    }
    if (!sessions?.length || sessions.length < 4) {
      // Need at least 3 historical + 1 current.
      return NextResponse.json({
        ok: false,
        reason: `Need ≥4 sessions total (3 historical + 1 current). Have ${sessions?.length ?? 0}.`,
        individual_metrics: {},
        overall: null,
        history_count: sessions?.length ?? 0,
      });
    }

    const sessionIds = sessions.map((s: SessionRow) => s.id);
    const { data: biomarkers, error: bErr } = await supa
      .from('biomarkers')
      .select('session_id, metric_name, value')
      .in('session_id', sessionIds)
      .in('metric_name', TRACKED);

    if (bErr) {
      console.warn('[progression] biomarkers fetch failed', bErr.message);
      return NextResponse.json({ ok: false, reason: bErr.message, individual_metrics: {}, overall: null, history_count: 0 });
    }

    const bySession = new Map<string, BiomarkerRow[]>();
    for (const r of (biomarkers ?? []) as BiomarkerRow[]) {
      if (!bySession.has(r.session_id)) bySession.set(r.session_id, []);
      bySession.get(r.session_id)!.push(r);
    }

    const history: Record<string, ProgressionPoint[]> = {};
    for (const m of TRACKED) history[m] = [];

    const sessionDates: Record<string, string> = {};
    for (const s of sessions as SessionRow[]) {
      sessionDates[s.id] = s.recorded_at ?? s.started_at ?? new Date().toISOString();
    }

    // Last session = current, earlier = history.
    const lastId = sessions[sessions.length - 1].id;
    const current: Record<string, ProgressionPoint> = {};

    for (const sid of sessionIds) {
      const agg = aggregatePerSession(bySession.get(sid) ?? []);
      const dt = sessionDates[sid];
      for (const m of TRACKED) {
        const point = agg[m];
        if (!point) continue;
        const pp: ProgressionPoint = {
          date_time: dt,
          value: point.mean,
          std: point.std,
          routine_deviation: false,
        };
        if (sid === lastId) current[m] = pp;
        else history[m].push(pp);
      }
    }

    const result = analyzeProgression(history, current, METRIC_CONFIGS);
    console.info(
      `[progression] patient=${patientId} sessions=${sessions.length} ok=${result.ok} ` +
        `combined_z=${result.overall?.combined_z_score?.toFixed?.(3) ?? '-'} status=${result.overall?.status ?? '-'}`,
    );

    return NextResponse.json({
      ...result,
      // Tack on the config so the UI can label metrics nicely without duplicating the map.
      metric_configs: METRIC_CONFIGS,
      sessions_total: sessions.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[progression] failed', msg);
    return NextResponse.json({ ok: false, reason: msg, individual_metrics: {}, overall: null, history_count: 0 });
  }
}
