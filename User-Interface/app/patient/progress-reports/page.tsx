'use client';

import { useEffect, useState } from 'react';
import { BackButton } from '@/components/BackButton';

const DEMO_PATIENT_ID = process.env.NEXT_PUBLIC_DEMO_PATIENT_ID ?? 'demo-001';

interface ProgressReport {
  week_label: string;
  recorded_at: string;
  summary: string;
  highlights: string[];
}

export default function ProgressReportsPage() {
  const [reports, setReports] = useState<ProgressReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/patients/${DEMO_PATIENT_ID}/progress-reports`)
      .then((r) => r.json())
      .then((data) => setReports(data.reports ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-white p-6">
      <BackButton href="/patient" />
      <h1 className="mt-4 text-xl font-bold text-slate-900">Progress Reports</h1>
      <p className="mt-2 text-sm text-slate-600">
        Weekly summaries of voice, movement, and cognitive trends — shareable with your care team.
      </p>

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">Loading reports…</p>
      ) : (
        <div className="mt-6 space-y-3">
          {reports.map((report, i) => (
            <div
              key={report.recorded_at}
              className={`rounded-xl border p-4 ${
                i === 0 ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200'
              }`}
            >
              <p
                className={`text-xs font-medium uppercase ${
                  i === 0 ? 'text-emerald-700' : 'text-slate-500'
                }`}
              >
                {i === 0 ? 'This week' : `Week of ${report.week_label}`}
              </p>
              <p
                className={`mt-1 text-sm ${i === 0 ? 'text-emerald-900' : 'text-slate-700'}`}
              >
                {report.summary}
              </p>
              <ul className="mt-2 space-y-0.5">
                {report.highlights.map((h) => (
                  <li key={h} className="font-mono text-xs text-slate-500">
                    · {h}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
