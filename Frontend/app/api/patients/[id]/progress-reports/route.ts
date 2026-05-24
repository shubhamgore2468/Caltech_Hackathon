import { NextRequest, NextResponse } from 'next/server';
import { getMockProgressReports, shouldUseMockData } from '@/lib/mock';
import { getServerSupabase } from '@/lib/supabase/server';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface ProgressReport {
  week_label: string;
  recorded_at: string;
  summary: string;
  highlights: string[];
}

interface BiomarkerRow {
  session_id: string;
  category: string;
  metric_name: string;
  value: number;
  unit: string | null;
  computed_at: string;
}

interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  mode: string;
}

function getWeekStart(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday as week start
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function pickLatest(biomarkers: BiomarkerRow[], metric: string): number | null {
  const matches = biomarkers
    .filter((b) => b.metric_name === metric)
    .sort((a, b) => new Date(b.computed_at).getTime() - new Date(a.computed_at).getTime());
  return matches.length ? matches[0].value : null;
}

function buildReport(
  weekSessions: SessionRow[],
  weekBiomarkers: BiomarkerRow[],
  isLatest: boolean
): ProgressReport {
  const latestSession = weekSessions[weekSessions.length - 1];
  const recordedAt = latestSession.started_at;
  const weekStart = getWeekStart(new Date(recordedAt));
  const weekLabel = weekStart.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const jitterRaw =
    pickLatest(weekBiomarkers, 'jitter_percent') ?? pickLatest(weekBiomarkers, 'jitter');
  // DB stores jitter as ratio (e.g. 0.009). Convert to percent for display.
  const jitter =
    jitterRaw !== null
      ? jitterRaw < 1
        ? jitterRaw * 100
        : jitterRaw
      : null;
  const tremor =
    pickLatest(weekBiomarkers, 'pd_ratio_mean') ??
    pickLatest(weekBiomarkers, 'tremor_score');
  const shimmer = pickLatest(weekBiomarkers, 'shimmer');
  const hnr = pickLatest(weekBiomarkers, 'hnr');
  const speechRate = pickLatest(weekBiomarkers, 'speech_rate');
  const etTremor = pickLatest(weekBiomarkers, 'et_ratio_mean');

  const elevatedJitter = jitter !== null && jitter > 2.0;
  const elevatedTremor = tremor !== null && tremor > 0.25;

  let summary: string;
  if (isLatest && (elevatedJitter || elevatedTremor)) {
    summary =
      'Some metrics trending above your baseline this week — worth flagging at your next visit.';
  } else if (elevatedJitter) {
    summary = 'Voice metrics above your baseline. Movement and heart rate within expected range.';
  } else if (elevatedTremor) {
    summary = 'Kinematic tremor elevated. Voice metrics near baseline.';
  } else {
    summary = 'Stable week overall. All key metrics near your personal baseline.';
  }

  const highlights: string[] = [];
  if (jitter !== null) highlights.push(`Vocal tremor burden: ${jitter.toFixed(2)}% jitter`);
  if (shimmer !== null) highlights.push(`Shimmer: ${(shimmer * 100).toFixed(2)}%`);
  if (hnr !== null && highlights.length < 3) highlights.push(`HNR: ${hnr.toFixed(1)} dB`);
  if (tremor !== null && highlights.length < 3)
    highlights.push(`Parkinsonian tremor ratio: ${tremor.toFixed(3)}`);
  if (etTremor !== null && highlights.length < 3)
    highlights.push(`Essential tremor ratio: ${etTremor.toFixed(3)}`);
  if (speechRate !== null && highlights.length < 3)
    highlights.push(`Speech rate: ${speechRate.toFixed(0)} wpm`);
  if (highlights.length === 0)
    highlights.push(
      `${weekSessions.length} session${weekSessions.length === 1 ? '' : 's'} this week`,
    );

  return { week_label: weekLabel, recorded_at: recordedAt, summary, highlights };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (shouldUseMockData() || !UUID_RE.test(id)) {
    return NextResponse.json({ reports: getMockProgressReports(id) });
  }

  try {
    const supa = getServerSupabase();
    const { data: sessions, error: sErr } = await supa
      .from('sessions')
      .select('id, started_at, ended_at, mode')
      .eq('patient_id', id)
      .order('started_at', { ascending: false })
      .limit(60);

    if (sErr) throw new Error(sErr.message);
    if (!sessions || sessions.length === 0) {
      return NextResponse.json({ reports: [] });
    }

    const sessionIds = sessions.map((s) => s.id);
    const { data: biomarkers, error: bErr } = await supa
      .from('biomarkers')
      .select('session_id, category, metric_name, value, unit, computed_at')
      .in('session_id', sessionIds);

    if (bErr) throw new Error(bErr.message);

    const bmBySession = new Map<string, BiomarkerRow[]>();
    for (const b of biomarkers ?? []) {
      const arr = bmBySession.get(b.session_id) ?? [];
      arr.push(b as BiomarkerRow);
      bmBySession.set(b.session_id, arr);
    }

    const weekMap = new Map<string, { sessions: SessionRow[]; biomarkers: BiomarkerRow[] }>();
    for (const s of sessions as SessionRow[]) {
      const wk = getWeekStart(new Date(s.started_at)).toISOString();
      const entry = weekMap.get(wk) ?? { sessions: [], biomarkers: [] };
      entry.sessions.push(s);
      entry.biomarkers.push(...(bmBySession.get(s.id) ?? []));
      weekMap.set(wk, entry);
    }

    const weeksSorted = Array.from(weekMap.entries()).sort(
      (a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()
    );

    const reports = weeksSorted
      .slice(0, 6)
      .map(([, entry], i) => buildReport(entry.sessions, entry.biomarkers, i === 0));

    return NextResponse.json({ reports });
  } catch (err) {
    console.error('[progress-reports] DB query failed, falling back to mock:', err);
    return NextResponse.json({ reports: getMockProgressReports(id) });
  }
}
