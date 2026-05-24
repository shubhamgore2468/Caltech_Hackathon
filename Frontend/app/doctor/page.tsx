'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BackButton } from '@/components/BackButton';
import { formatMetricValue } from '@/lib/clinical/metric-definitions';
import type { DoctorDashboardSummary } from '@/lib/clinical/dashboard';

const DEMO_PATIENT_ID = process.env.NEXT_PUBLIC_DEMO_PATIENT_ID ?? 'demo-001';
const LIVE_PATIENT_ID = '00000000-0000-0000-0000-000000000001';

interface LivePatientSummary {
  patient: { id: string; name?: string | null; diagnosis?: string | null };
  session: { recorded_at?: string | null; started_at?: string | null } | null;
  biomarkers: { metric_name: string; value: number }[];
  risk_score: { parkinsons_score: number; dementia_score: number } | null;
  mock: boolean;
}

export default function DoctorHome() {
  const [dashboard, setDashboard] = useState<DoctorDashboardSummary | null>(null);
  const [live, setLive] = useState<LivePatientSummary | null>(null);

  useEffect(() => {
    fetch(`/api/patients/${DEMO_PATIENT_ID}/dashboard`)
      .then((r) => r.json())
      .then(setDashboard);
    fetch(`/api/patients/${LIVE_PATIENT_ID}/latest`)
      .then((r) => r.json())
      .then(setLive)
      .catch(() => setLive(null));
  }, []);

  const kinematic = dashboard?.pillars.find((p) => p.id === 'kinematic_tremor');
  const vocal = dashboard?.pillars.find((p) => p.id === 'vocal_tremor');
  const hr = dashboard?.pillars.find((p) => p.id === 'resting_hr');

  return (
    <main className="min-h-screen bg-white p-8">
      <BackButton href="/" label="Home" />
      <h1 className="mt-4 text-2xl font-bold text-slate-900">Doctor Dashboard</h1>
      <p className="mt-1 text-sm text-slate-600">
        Weekly check-in monitoring · kinematic, vocal, autonomic &amp; clinical context
      </p>

      <div className="mt-8 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Patients</h2>

        {/* ── Live patient card (real Supabase data) ─────────────────── */}
        <Link
          href={`/doctor/patient/${LIVE_PATIENT_ID}`}
          className="block rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 hover:border-emerald-500 transition-colors"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-slate-900">
                  {live?.patient?.name ?? 'Demo Patient'}
                </p>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                  Live
                </span>
              </div>
              <p className="text-sm text-slate-500">{live?.patient?.diagnosis ?? '—'}</p>
              <p className="mt-0.5 text-[11px] font-mono text-slate-400 truncate">{LIVE_PATIENT_ID}</p>
              {live?.session?.recorded_at || live?.session?.started_at ? (
                <p className="mt-1 text-xs text-slate-400">
                  Last check-in:{' '}
                  {new Date(live.session.recorded_at ?? live.session.started_at!).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-400">No sessions yet</p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <RiskPill label="PD" score={live?.risk_score?.parkinsons_score ?? null} />
              <RiskPill label="DEM" score={live?.risk_score?.dementia_score ?? null} />
            </div>
          </div>
          {live?.biomarkers?.length ? (
            <p className="mt-3 text-xs text-slate-500 border-t border-emerald-200 pt-2">
              {live.biomarkers.length} biomarkers captured · click to review →
            </p>
          ) : null}
        </Link>

        {/* ── Legacy mock-driven card ─────────────────────────────────── */}
        <Link
          href={`/doctor/patient/${DEMO_PATIENT_ID}`}
          className="block rounded-lg border border-slate-200 p-4 hover:border-blue-800"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-slate-900">
                {dashboard?.patient_name ?? 'Robert Halloway'}
              </p>
              <p className="text-sm text-slate-500">
                {dashboard?.diagnosis ?? 'PD - Hoehn-Yahr Stage 2'}
              </p>
              {dashboard?.last_checkin_at && (
                <p className="mt-1 text-xs text-slate-400">
                  Last check-in:{' '}
                  {new Date(dashboard.last_checkin_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              )}
            </div>
            {(dashboard?.alerts_count ?? 0) > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                {dashboard?.alerts_count} alert{(dashboard?.alerts_count ?? 0) > 1 ? 's' : ''}
              </span>
            )}
          </div>

          {dashboard && (
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 md:grid-cols-4">
              <MetricPreview
                label="Kinematic Tremor"
                value={kinematic?.values[0]}
                trend={kinematic?.trend}
              />
              <MetricPreview label="Vocal Tremor" value={vocal?.values[0]} trend={vocal?.trend} />
              <MetricPreview label="Resting HR" value={hr?.values[0]} trend={hr?.trend} />
              <div className="rounded-lg bg-slate-50 p-2">
                <p className="text-[10px] font-medium uppercase text-slate-500">Check-in Summary</p>
                <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                  {dashboard.checkin_summary.excerpt}
                </p>
              </div>
            </div>
          )}
        </Link>
      </div>

      <Link href="/doctor/cohort" className="mt-6 inline-block text-sm text-blue-800">
        Cohort analytics →
      </Link>
    </main>
  );
}

function RiskPill({ label, score }: { label: string; score: number | null }) {
  if (score == null) {
    return (
      <div className="rounded-md border border-slate-200 bg-white px-2 py-1 text-center min-w-[56px]">
        <p className="text-[9px] font-semibold uppercase text-slate-400">{label}</p>
        <p className="font-mono text-sm font-semibold text-slate-400">—</p>
      </div>
    );
  }
  const pct = score * 100;
  const cls =
    pct >= 65
      ? 'border-rose-300 bg-rose-50 text-rose-900'
      : pct >= 35
        ? 'border-amber-300 bg-amber-50 text-amber-900'
        : 'border-emerald-300 bg-emerald-50 text-emerald-900';
  return (
    <div className={`rounded-md border px-2 py-1 text-center min-w-[56px] ${cls}`}>
      <p className="text-[9px] font-semibold uppercase opacity-70">{label}</p>
      <p className="font-mono text-sm font-semibold">{pct.toFixed(0)}</p>
    </div>
  );
}

function MetricPreview({
  label,
  value,
  trend,
}: {
  label: string;
  value?: { name: string; value: number; unit: string };
  trend?: string;
}) {
  return (
    <div className="rounded-lg bg-slate-50 p-2">
      <p className="text-[10px] font-medium uppercase text-slate-500">{label}</p>
      {value ? (
        <>
          <p className="mt-1 font-mono text-sm font-semibold text-slate-900">
            {formatMetricValue(value.name, value.value)}
            <span className="text-xs font-normal text-slate-500"> {value.unit}</span>
          </p>
          {trend && (
            <p
              className={`text-[10px] ${trend.startsWith('↑') ? 'text-amber-700' : 'text-emerald-700'}`}
            >
              {trend}
            </p>
          )}
        </>
      ) : (
        <p className="mt-1 text-xs text-slate-400">—</p>
      )}
    </div>
  );
}
