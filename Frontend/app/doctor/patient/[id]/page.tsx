'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { BackButton } from '@/components/BackButton';
import { format } from 'date-fns';
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts';

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

interface ConvTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

interface LatestResponse {
  patient: { id: string; name: string; diagnosis?: string | null };
  session: {
    id: string;
    session_type?: string | null;
    started_at?: string | null;
    ended_at?: string | null;
    recorded_at?: string | null;
  } | null;
  prior_session: { id: string; started_at?: string } | null;
  biomarkers: BiomarkerRow[];
  prior_biomarkers: BiomarkerRow[];
  conversation: { transcript: ConvTurn[]; cognitive_flags: Record<string, unknown> } | null;
  risk_score: {
    parkinsons_score: number;
    dementia_score: number;
    contributing_factors: Record<string, unknown>;
    computed_at?: string;
  } | null;
  mock: boolean;
}

interface TimelineResponse {
  risk_scores: { computed_at?: string; recorded_at?: string; parkinsons_score: number; dementia_score: number }[];
}

interface ProgressionMetric {
  actual: number;
  expected: number;
  trend_slope: number;
  lower_bound_95: number;
  upper_bound_95: number;
  z_score: number;
  adjusted_z: number;
  status: 'Worse' | 'Better' | 'Stable';
  is_significant: boolean;
}

interface ProgressionResponse {
  ok: boolean;
  reason?: string;
  individual_metrics: Record<string, ProgressionMetric>;
  overall: { combined_z_score: number; status: string; k: number } | null;
  history_count: number;
  sessions_total?: number;
  metric_configs?: Record<string, { direction: 1 | -1; label: string }>;
}

const PILLARS = [
  {
    id: 'kinematic',
    title: 'Kinematic tremor',
    subtitle: 'IMU · hand-tremor band',
    metric: 'pd_ratio_mean',
    unit: 'ratio',
    higherIsWorse: true,
    format: (v: number) => v.toFixed(4),
  },
  {
    id: 'vocal',
    title: 'Vocal tremor',
    subtitle: 'Praat jitter %',
    metric: 'jitter_local_pct',
    unit: '%',
    higherIsWorse: true,
    format: (v: number) => `${v.toFixed(2)}%`,
  },
  {
    id: 'pd_voice',
    title: 'PD voice probability',
    subtitle: 'GradientBoosting classifier',
    metric: 'pd_probability',
    unit: '',
    higherIsWorse: true,
    format: (v: number) => `${(v * 100).toFixed(1)}%`,
  },
  {
    id: 'blink',
    title: 'Blink rate',
    subtitle: 'MediaPipe EAR',
    metric: 'blink_rate_per_min',
    unit: 'bpm',
    higherIsWorse: false,
    format: (v: number) => `${v.toFixed(1)} bpm`,
  },
] as const;

function latestValueForMetric(rows: BiomarkerRow[], metric: string): number | null {
  const matches = rows.filter((r) => r.metric_name === metric);
  if (!matches.length) return null;
  // average across turns when multiple rows exist (e.g. voice jitter across 4 turns)
  return matches.reduce((acc, r) => acc + r.value, 0) / matches.length;
}

function deltaLabel(curr: number | null, prev: number | null, higherIsWorse: boolean) {
  if (curr == null || prev == null) return { text: '—', color: 'text-slate-400', dir: 'flat' as const };
  const diff = curr - prev;
  const pct = prev !== 0 ? (diff / Math.abs(prev)) * 100 : 0;
  const worse = higherIsWorse ? diff > 0 : diff < 0;
  const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
  return {
    text: `${arrow} ${Math.abs(pct).toFixed(1)}% vs prior`,
    color: worse ? 'text-rose-600' : 'text-emerald-600',
    dir: diff > 0 ? ('up' as const) : diff < 0 ? ('down' as const) : ('flat' as const),
  };
}

function groupByStep(rows: BiomarkerRow[]) {
  const groups = new Map<string, BiomarkerRow[]>();
  for (const r of rows) {
    const key = r.step ?? 'unstepped';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

export default function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [latest, setLatest] = useState<LatestResponse | null>(null);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [progression, setProgression] = useState<ProgressionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [l, t, p] = await Promise.all([
          fetch(`/api/patients/${id}/latest`).then((r) => r.json()),
          fetch(`/api/patients/${id}/timeline`).then((r) => r.json()),
          fetch(`/api/patients/${id}/progression`).then((r) => r.json()),
        ]);
        setLatest(l);
        setTimeline(t);
        setProgression(p);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const chartData = useMemo(() => {
    if (!timeline?.risk_scores) return [];
    return timeline.risk_scores
      .map((r) => ({
        date: format(new Date(r.computed_at ?? r.recorded_at ?? Date.now()), 'MMM d'),
        pd: +(r.parkinsons_score * 100).toFixed(1),
        dem: +(r.dementia_score * 100).toFixed(1),
      }))
      .slice(-12);
  }, [timeline]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <BackButton href="/doctor" label="Patients" />
        <p className="mt-8 text-sm text-slate-500">Loading patient record…</p>
      </main>
    );
  }

  if (error || !latest) {
    return (
      <main className="min-h-screen bg-slate-50 p-8">
        <BackButton href="/doctor" label="Patients" />
        <p className="mt-8 text-sm text-rose-600">Failed to load: {error ?? 'unknown'}</p>
      </main>
    );
  }

  const session = latest.session;
  const pdScore = latest.risk_score?.parkinsons_score ?? null;
  const demScore = latest.risk_score?.dementia_score ?? null;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl p-6 lg:p-8 space-y-6">
        <BackButton href="/doctor" label="Patients" />

        {/* ── Header ───────────────────────────────────────────────────── */}
        <header className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">{latest.patient.name}</h1>
              <p className="text-sm text-slate-500">
                {latest.patient.diagnosis ?? '—'} · <span className="font-mono text-xs">{latest.patient.id}</span>
              </p>
              {session?.recorded_at || session?.started_at ? (
                <p className="mt-1 text-xs text-slate-500">
                  Last check-in{' '}
                  <span className="font-medium text-slate-700">
                    {format(new Date(session.recorded_at ?? session.started_at!), "MMM d, yyyy 'at' h:mm a")}
                  </span>
                </p>
              ) : null}
            </div>
            <div className="flex gap-3">
              <RiskBadge label="Parkinson's" score={pdScore} />
              <RiskBadge label="Dementia" score={demScore} />
            </div>
          </div>
          {latest.mock && (
            <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 inline-block">
              Showing mock data — no live sessions yet
            </p>
          )}
        </header>

        {/* ── Progression analysis (Theil-Sen + Stouffer's Z) ──────────── */}
        {progression && <ProgressionSection prog={progression} />}

        {/* ── Risk trend chart ─────────────────────────────────────────── */}
        {chartData.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-900">Risk score trend</h2>
              <p className="text-xs text-slate-500">Recent {chartData.length} check-ins</p>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ left: -10, right: 12, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#94a3b8" unit="%" />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="pd" name="Parkinson's" stroke="#dc2626" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="dem" name="Dementia" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </section>
        )}

        {/* ── Pillar cards ─────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {PILLARS.map((p) => {
            const curr = latestValueForMetric(latest.biomarkers, p.metric);
            const prev = latestValueForMetric(latest.prior_biomarkers, p.metric);
            const delta = deltaLabel(curr, prev, p.higherIsWorse);
            return (
              <div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{p.title}</p>
                <p className="text-[10px] text-slate-400">{p.subtitle}</p>
                <p className="mt-2 font-mono text-2xl font-semibold text-slate-900">
                  {curr != null ? p.format(curr) : '—'}
                </p>
                <p className={`text-xs ${delta.color}`}>{delta.text}</p>
              </div>
            );
          })}
        </section>

        {/* ── Transcript + cognitive flags ─────────────────────────────── */}
        {latest.conversation && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <button
              type="button"
              onClick={() => setTranscriptOpen((v) => !v)}
              className="flex w-full items-center justify-between text-left"
            >
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Check-in transcript</h2>
                <p className="text-xs text-slate-500">
                  {latest.conversation.transcript.length} turns ·{' '}
                  {Object.keys(latest.conversation.cognitive_flags ?? {}).length} cognitive flags
                </p>
              </div>
              <span className="text-xs text-slate-500">{transcriptOpen ? 'Hide' : 'Show'}</span>
            </button>

            {transcriptOpen && (
              <div className="mt-4 space-y-3">
                <div className="space-y-2 max-h-80 overflow-y-auto pr-2">
                  {latest.conversation.transcript.map((t, i) => (
                    <div
                      key={i}
                      className={`rounded-xl px-3 py-2 text-sm ${
                        t.role === 'assistant'
                          ? 'bg-slate-50 border border-slate-200 text-slate-800'
                          : 'bg-blue-50 border border-blue-200 text-blue-900 ml-6'
                      }`}
                    >
                      <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">{t.role}</p>
                      {t.content}
                    </div>
                  ))}
                </div>

                {Object.keys(latest.conversation.cognitive_flags ?? {}).length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-amber-700 mb-1">Cognitive flags</p>
                    <pre className="text-xs font-mono text-amber-900 whitespace-pre-wrap">
                      {JSON.stringify(latest.conversation.cognitive_flags, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ── Per-step breakdown ───────────────────────────────────────── */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Per-step capture breakdown</h2>
          <p className="text-xs text-slate-500 mb-4">Raw biomarker rows for the latest check-in</p>
          <div className="space-y-4">
            {groupByStep(latest.biomarkers).map(([step, rows]) => (
              <StepGroup key={step} step={step} rows={rows} />
            ))}
            {latest.biomarkers.length === 0 && (
              <p className="text-xs text-slate-400">No biomarker rows for this session yet.</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function ProgressionSection({ prog }: { prog: ProgressionResponse }) {
  if (!prog.ok) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-900">Progression analysis</h2>
          <p className="text-xs text-slate-500">Theil-Sen trend + Stouffer&apos;s Z</p>
        </div>
        <p className="text-sm text-slate-500">{prog.reason ?? 'Insufficient history.'}</p>
        {prog.sessions_total != null && (
          <p className="mt-1 text-xs text-slate-400">{prog.sessions_total} session{prog.sessions_total === 1 ? '' : 's'} in record.</p>
        )}
      </section>
    );
  }

  const overall = prog.overall!;
  const verdictTone = overall.status.includes('WORSENING')
    ? 'border-rose-300 bg-rose-50 text-rose-900'
    : overall.status.includes('IMPROVEMENT')
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : 'border-slate-300 bg-slate-50 text-slate-900';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Progression analysis</h2>
        <p className="text-xs text-slate-500">Theil-Sen trend + Stouffer&apos;s Z · {overall.k} metric{overall.k === 1 ? '' : 's'}</p>
      </div>

      <div className={`rounded-xl border px-4 py-3 ${verdictTone}`}>
        <p className="text-[10px] uppercase tracking-wide opacity-70">Overall verdict</p>
        <p className="mt-0.5 text-lg font-semibold">{overall.status}</p>
        <p className="mt-1 text-xs font-mono opacity-80">
          combined Z = {overall.combined_z_score.toFixed(2)} (significant at |Z| &gt; 1.96)
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="py-1.5 pr-3">Metric</th>
              <th className="py-1.5 pr-3 text-right">Actual</th>
              <th className="py-1.5 pr-3 text-right">Expected</th>
              <th className="py-1.5 pr-3 text-right">95% interval</th>
              <th className="py-1.5 pr-3 text-right">Adj. Z</th>
              <th className="py-1.5 pr-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(prog.individual_metrics).map(([metric, m]) => {
              const label = prog.metric_configs?.[metric]?.label ?? metric;
              const tone =
                m.status === 'Worse'
                  ? 'text-rose-700'
                  : m.status === 'Better'
                    ? 'text-emerald-700'
                    : 'text-slate-600';
              return (
                <tr key={metric} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3">
                    <p className="font-medium text-slate-800">{label}</p>
                    <p className="text-[10px] font-mono text-slate-400">{metric}</p>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">{m.actual.toFixed(4)}</td>
                  <td className="py-2 pr-3 text-right font-mono text-slate-500">{m.expected.toFixed(4)}</td>
                  <td className="py-2 pr-3 text-right font-mono text-slate-500">
                    [{m.lower_bound_95.toFixed(3)}, {m.upper_bound_95.toFixed(3)}]
                  </td>
                  <td className={`py-2 pr-3 text-right font-mono font-semibold ${tone}`}>
                    {m.adjusted_z.toFixed(2)}
                  </td>
                  <td className={`py-2 pr-3 font-semibold ${tone}`}>{m.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RiskBadge({ label, score }: { label: string; score: number | null }) {
  if (score == null) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 min-w-[110px]">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
        <p className="font-mono text-lg font-semibold text-slate-400">—</p>
      </div>
    );
  }
  const pct = score * 100;
  const tone = pct >= 65 ? 'rose' : pct >= 35 ? 'amber' : 'emerald';
  const cls = {
    rose: 'border-rose-200 bg-rose-50 text-rose-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[tone];
  return (
    <div className={`rounded-xl border px-4 py-2 min-w-[110px] ${cls}`}>
      <p className="text-[10px] uppercase tracking-wide opacity-70">{label}</p>
      <p className="font-mono text-2xl font-semibold">{pct.toFixed(0)}<span className="text-xs font-normal opacity-70">/100</span></p>
    </div>
  );
}

function StepGroup({ step, rows }: { step: string; rows: BiomarkerRow[] }) {
  // For voice + hand_tremor steps, sub-group by turn_index.
  const turns = new Map<string, BiomarkerRow[]>();
  for (const r of rows) {
    const key = r.turn_index != null ? `turn ${r.turn_index}` : 'single';
    if (!turns.has(key)) turns.set(key, []);
    turns.get(key)!.push(r);
  }
  const sortedTurns = Array.from(turns.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-slate-800 font-mono">{step}</h3>
        <span className="text-[10px] text-slate-500">{rows.length} rows</span>
      </div>
      {sortedTurns.map(([turnKey, turnRows]) => (
        <div key={turnKey} className="mb-2">
          {turnKey !== 'single' && (
            <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{turnKey}</p>
          )}
          <table className="w-full text-xs font-mono">
            <tbody>
              {turnRows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  <td className="py-1 pr-2 text-slate-600">{r.metric_name}</td>
                  <td className="py-1 pr-2 text-right text-slate-900">{r.value.toFixed(4)}</td>
                  <td className="py-1 pl-2 text-slate-400 w-16">{r.unit ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
