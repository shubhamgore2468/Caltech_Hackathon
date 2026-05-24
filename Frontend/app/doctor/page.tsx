'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BackButton } from '@/components/BackButton';

interface PatientRow {
  id: string;
  name: string;
  diagnosis: string;
  last_session: { at: string } | null;
  risk_score: { parkinsons_score: number; dementia_score: number } | null;
}

export default function DoctorHome() {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/patients')
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load');
        return r.json();
      })
      .then((data) => {
        setPatients(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => {
        setError('Could not load patient data.');
        setLoading(false);
      });
  }, []);

  return (
    <main className="min-h-screen bg-[#FDFCFB] p-8">
      <BackButton href="/" label="Home" />
      <h1 className="mt-4 text-2xl font-bold text-slate-900">Doctor Dashboard</h1>
      <p className="mt-1 text-sm text-slate-600">
        Weekly check-in monitoring · kinematic, vocal, autonomic &amp; clinical context
      </p>

      <div className="mt-8 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Patients</h2>

        {loading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-zinc-100" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {!loading && !error && patients.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            No patients have registered yet. Share the app link to get started.
          </div>
        )}

        {patients.map((p) => (
          <Link
            key={p.id}
            href={`/doctor/patient/${p.id}`}
            className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 transition-shadow hover:border-slate-300 hover:shadow-md"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-slate-900 truncate">{p.name}</p>
                {p.last_session && (
                  <span className="hidden rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 sm:inline">
                    Active
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500 truncate">{p.diagnosis}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {p.last_session
                  ? `Last check-in: ${new Date(p.last_session.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                  : 'No check-ins yet'}
              </p>
            </div>

            <div className="flex shrink-0 gap-2">
              <RiskPill label="PD" score={p.risk_score?.parkinsons_score ?? null} />
              <RiskPill label="DEM" score={p.risk_score?.dementia_score ?? null} />
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}

function RiskPill({ label, score }: { label: string; score: number | null }) {
  if (score == null) {
    return (
      <div className="min-w-[56px] rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-center">
        <p className="text-[9px] font-semibold uppercase text-slate-400">{label}</p>
        <p className="font-mono text-sm font-semibold text-slate-300">—</p>
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
    <div className={`min-w-[56px] rounded-lg border px-2 py-1 text-center ${cls}`}>
      <p className="text-[9px] font-semibold uppercase opacity-70">{label}</p>
      <p className="font-mono text-sm font-semibold">{pct.toFixed(0)}</p>
    </div>
  );
}
