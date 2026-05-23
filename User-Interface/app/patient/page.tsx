'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BackButton } from '@/components/BackButton';
import { WeeklyCheckinCalendar } from '@/components/patient/WeeklyCheckinCalendar';
import { getCurrentWeekStatus } from '@/lib/checkin/weekly';

const DEMO_PATIENT_ID = process.env.NEXT_PUBLIC_DEMO_PATIENT_ID ?? 'demo-001';

export default function PatientHome() {
  const [weekStatus, setWeekStatus] = useState<{ canStart: boolean; preferredDay: boolean } | null>(
    null
  );

  useEffect(() => {
    setWeekStatus(getCurrentWeekStatus(DEMO_PATIENT_ID));
  }, []);

  return (
    <main className="min-h-screen bg-white p-6">
      <div className="mx-auto max-w-md">
        <BackButton href="/" label="Home" />
        <h1 className="mt-4 text-2xl font-bold text-slate-900">NeuroTrack</h1>
        <p className="mt-1 text-sm text-slate-600">Your weekly monitoring companion</p>

        <div className="mt-6">
          <WeeklyCheckinCalendar patientId={DEMO_PATIENT_ID} />
        </div>

        <div className="mt-6 space-y-3">
          {weekStatus === null ? (
            <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
              Loading weekly status…
            </div>
          ) : weekStatus.canStart ? (
            <Link
              href="/patient/checkin"
              className="block rounded-xl border border-blue-200 bg-blue-50 p-4 hover:border-blue-800"
            >
              <h2 className="font-semibold text-slate-900">Start Weekly Check-in</h2>
              <p className="text-sm text-slate-600">
                Video session with your care assistant, then IMU tremor capture
              </p>
              {!weekStatus.preferredDay && (
                <p className="mt-2 text-xs text-amber-700">
                  Tip: Mondays give the most consistent week-over-week comparison
                </p>
              )}
            </Link>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <h2 className="font-semibold text-emerald-900">Weekly check-in complete</h2>
              <p className="text-sm text-emerald-800">
                You&apos;ve finished this week&apos;s session. Come back next Monday for your next
                check-in.
              </p>
            </div>
          )}

          <Link
            href="/patient/progress-reports"
            className="block rounded-xl border border-slate-200 p-4 hover:border-blue-800"
          >
            <h2 className="font-semibold text-slate-900">Progress Reports</h2>
            <p className="text-sm text-slate-500">
              Weekly summaries of voice, movement, and cognitive trends
            </p>
          </Link>
        </div>
      </div>
    </main>
  );
}
