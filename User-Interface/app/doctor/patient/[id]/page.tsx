'use client';

import { useEffect, useState } from 'react';
import { BackButton } from '@/components/BackButton';
import { format } from 'date-fns';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { ClinicalPillarCard, CheckinSummaryCard } from '@/components/doctor/ClinicalMetricCards';
import { WeeklyProgressExplorer } from '@/components/doctor/WeeklyProgressExplorer';
import type { DoctorDashboardSummary } from '@/lib/clinical/dashboard';
import type { WeeklyReport } from '@/lib/clinical/weekly-reports';
import type { PatientTimeline } from '@/lib/types';

export default function PatientDetailPage({ params }: { params: { id: string } }) {
  const [dashboard, setDashboard] = useState<DoctorDashboardSummary | null>(null);
  const [timeline, setTimeline] = useState<PatientTimeline | null>(null);
  const [weeklyReports, setWeeklyReports] = useState<WeeklyReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/patients/${params.id}/dashboard`).then((r) => r.json()),
      fetch(`/api/patients/${params.id}/timeline`).then((r) => r.json()),
      fetch(`/api/patients/${params.id}/weekly-reports`).then((r) => r.json()),
    ])
      .then(([dash, tl, weekly]) => {
        setDashboard(dash);
        setTimeline(tl);
        setWeeklyReports(weekly.weeks ?? []);
      })
      .finally(() => setLoading(false));
  }, [params.id]);

  const chartData = mergeTrendData(timeline);

  return (
    <main className="min-h-screen bg-white p-8">
      <BackButton href="/doctor" label="Patients" />

      {loading ? (
        <p className="mt-8 text-sm text-slate-500">Loading patient record…</p>
      ) : dashboard ? (
        <>
          <header className="mt-4 border-b border-slate-200 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{dashboard.patient_name}</h1>
                <p className="text-sm text-slate-600">
                  {dashboard.diagnosis} · {params.id}
                </p>
              </div>
              <div className="text-right">
                {dashboard.last_checkin_at && (
                  <p className="text-xs text-slate-500">
                    Last weekly check-in{' '}
                    <span className="font-medium text-slate-700">
                      {format(new Date(dashboard.last_checkin_at), 'MMM d, yyyy')}
                    </span>
                  </p>
                )}
                {dashboard.alerts_count > 0 && (
                  <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    {dashboard.alerts_count} active alert{dashboard.alerts_count > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          </header>

          {weeklyReports.length > 0 && (
            <section className="mt-8">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Week-by-week progress
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Current week shown in full. Click prior weeks for historical check-in details.
              </p>
              <div className="mt-4">
                <WeeklyProgressExplorer weeks={weeklyReports} />
              </div>
            </section>
          )}

          <section className="mt-10">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Key metrics from latest check-in
            </h2>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {dashboard.pillars.map((pillar) => (
                <ClinicalPillarCard key={pillar.id} pillar={pillar} />
              ))}
              <CheckinSummaryCard summary={dashboard.checkin_summary} />
            </div>
          </section>

          {timeline?.alerts.length ? (
            <section className="mt-6 space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Alerts</h2>
              {timeline.alerts.map((a) => (
                <div
                  key={a.id}
                  className={`rounded-lg px-3 py-2 text-sm ${
                    a.severity === 'critical'
                      ? 'border border-rose-200 bg-rose-50 text-rose-900'
                      : 'border border-amber-200 bg-amber-50 text-amber-900'
                  }`}
                >
                  ⚠ {a.message}
                </div>
              ))}
            </section>
          ) : null}

          {timeline?.risk_scores.length ? (
            <section className="mt-6">
              <div className="rounded-lg border border-slate-200 p-4 md:max-w-xs">
                <p className="text-xs uppercase text-slate-500">Dementia risk</p>
                <p className="font-mono text-2xl font-bold text-slate-900">
                  {(timeline.risk_scores.at(-1)!.dementia_score * 100).toFixed(0)}
                  <span className="text-sm font-normal text-slate-500"> / 100</span>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Cognitive comorbidity screening — all patients enrolled with Parkinson&apos;s
                </p>
              </div>
            </section>
          ) : null}

          {chartData.length > 0 && (
            <section className="mt-10">
              <h2 className="text-sm font-semibold text-slate-900">Longitudinal trends</h2>
              <p className="text-xs text-slate-500">
                Kinematic tremor vs vocal tremor burden over prior check-ins
              </p>
              <ResponsiveContainer width="100%" height={300} className="mt-4">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} unit="%" />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="jitter"
                    name="Vocal tremor (jitter %)"
                    stroke="#1e40af"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="tremor"
                    name="Kinematic tremor (ratio)"
                    stroke="#d97706"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}
        </>
      ) : null}
    </main>
  );
}

function mergeTrendData(timeline: PatientTimeline | null) {
  if (!timeline) return [];
  const jitter = timeline.metrics.jitter_pct ?? [];
  const tremor = timeline.metrics.tremor_score ?? [];
  const dates = new Set([
    ...jitter.map((p) => p.recorded_at.slice(0, 10)),
    ...tremor.map((p) => p.recorded_at.slice(0, 10)),
  ]);

  return Array.from(dates)
    .sort()
    .map((date) => ({
      date: format(new Date(date), 'MMM d'),
      jitter: jitter.find((p) => p.recorded_at.startsWith(date))?.value ?? null,
      tremor: tremor.find((p) => p.recorded_at.startsWith(date))?.value ?? null,
    }))
    .filter((d) => d.jitter !== null || d.tremor !== null);
}
