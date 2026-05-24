'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BackButton } from '@/components/BackButton';
import { formatMetricValue } from '@/lib/clinical/metric-definitions';
import type { DoctorDashboardSummary } from '@/lib/clinical/dashboard';

const DEMO_PATIENT_ID = process.env.NEXT_PUBLIC_DEMO_PATIENT_ID ?? 'demo-001';

export default function DoctorHome() {
  const [dashboard, setDashboard] = useState<DoctorDashboardSummary | null>(null);

  useEffect(() => {
    fetch(`/api/patients/${DEMO_PATIENT_ID}/dashboard`)
      .then((r) => r.json())
      .then(setDashboard);
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

      <div className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Patients</h2>
        <Link
          href={`/doctor/patient/${DEMO_PATIENT_ID}`}
          className="mt-3 block rounded-lg border border-slate-200 p-4 hover:border-blue-800"
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
