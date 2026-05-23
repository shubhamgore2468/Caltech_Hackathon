'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BackButton } from '@/components/BackButton';
import { CheckinVideoSession } from '@/components/patient/CheckinVideoSession';
import { MotionCapture } from '@/components/sensors/MotionCapture';
import { extractCameraBiomarkers, cameraBiomarkersToRows } from '@/lib/biomarkers/camera';
import { extractVoiceBiomarkers, voiceBiomarkersToRows } from '@/lib/biomarkers/voice';
import { extractMotionBiomarkers, motionBiomarkersToRows } from '@/lib/biomarkers/motion';
import {
  getCurrentWeekStatus,
  getWeekKey,
  saveCheckinCompletion,
} from '@/lib/checkin/weekly';
import type { Sample } from '@/lib/types';

const DEMO_PATIENT_ID = process.env.NEXT_PUBLIC_DEMO_PATIENT_ID ?? 'demo-001';

type Step = 'gate' | 'video' | 'tremor' | 'complete';

export default function CheckinPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('gate');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const weekStatus = getCurrentWeekStatus(DEMO_PATIENT_ID);

  useEffect(() => {
    if (!weekStatus.canStart && step === 'gate') {
      setStep('gate');
    }
  }, [weekStatus.canStart, step]);

  async function startSession() {
    if (!weekStatus.canStart) return;

    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_id: DEMO_PATIENT_ID,
        session_type: 'checkin',
        duration_seconds: 0,
        notes: `weekly_checkin:${getWeekKey()}`,
      }),
    });
    const data = await res.json();
    setSessionId(data.session?.id ?? null);
    setStep('video');
  }

  async function handleVideoComplete(durationSec: number) {
    if (!sessionId) {
      setStep('tremor');
      return;
    }

    const voice = extractVoiceBiomarkers({
      durationSec,
      patientId: DEMO_PATIENT_ID,
      sessionId,
    });
    const camera = extractCameraBiomarkers({
      durationSec,
      patientId: DEMO_PATIENT_ID,
      sessionId,
    });

    await fetch('/api/biomarkers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        patient_id: DEMO_PATIENT_ID,
        biomarkers: [
          ...voiceBiomarkersToRows(voice).map((r) => ({ category: 'voice' as const, ...r })),
          ...cameraBiomarkersToRows(camera).map((r) => ({ category: 'camera' as const, ...r })),
        ],
      }),
    });

    // INTEGRATION POINT: post agent transcript to /api/conversations when Stream B is wired
    setStep('tremor');
  }

  async function handleTremorComplete(samples: Sample[]) {
    if (!sessionId) return;
    setSubmitting(true);

    try {
      const biomarkers = extractMotionBiomarkers(samples, 'tremor');
      await fetch('/api/biomarkers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          patient_id: DEMO_PATIENT_ID,
          biomarkers: motionBiomarkersToRows(biomarkers).map((r) => ({
            category: 'motion' as const,
            ...r,
          })),
        }),
      });

      await fetch('/api/risk-score/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, patient_id: DEMO_PATIENT_ID }),
      });

      saveCheckinCompletion(DEMO_PATIENT_ID, {
        weekKey: getWeekKey(),
        completedAt: new Date().toISOString(),
        sessionId,
      });

      setStep('complete');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-white p-6">
      <BackButton href="/patient" />
      <h1 className="mt-4 text-xl font-bold text-slate-900">Weekly Check-in</h1>
      <p className="text-sm text-slate-500">{weekStatus.weekLabel}</p>

      {!weekStatus.preferredDay && weekStatus.canStart && step !== 'complete' && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          For the most consistent trends, try to complete check-ins on Mondays when you can.
        </p>
      )}

      {step === 'gate' && !weekStatus.canStart && (
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm text-emerald-800">
            You&apos;ve already completed this week&apos;s check-in. Your next session opens{' '}
            {weekStatus.weekLabel.replace('Week of', 'the week of')}.
          </p>
          <BackButton href="/patient" label="Return home" className="mt-4" />
        </div>
      )}

      {step === 'gate' && weekStatus.canStart && (
        <div className="mt-6">
          <p className="text-sm text-slate-600">
            Two parts: a short video conversation with your care assistant, then a brief tremor
            measurement using your phone&apos;s motion sensors (~5 minutes total).
          </p>
          <button
            type="button"
            onClick={startSession}
            className="mt-4 rounded-lg bg-blue-800 px-4 py-2 text-sm font-medium text-white hover:bg-blue-900"
          >
            Begin weekly check-in
          </button>
        </div>
      )}

      {step === 'video' && (
        <div className="mt-6 space-y-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Step 1 of 2 · Video session
          </p>
          <CheckinVideoSession onComplete={handleVideoComplete} />
        </div>
      )}

      {step === 'tremor' && (
        <div className="mt-6 space-y-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Step 2 of 2 · Tremor (IMU)
          </p>
          <p className="text-sm text-slate-600">
            Hold your phone and follow the prompt. Tremor is measured via the device accelerometer.
          </p>
          <MotionCapture mode="tremor" durationSec={15} onComplete={handleTremorComplete} />
          {submitting && <p className="text-sm text-slate-500">Saving tremor data…</p>}
        </div>
      )}

      {step === 'complete' && (
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h2 className="font-semibold text-emerald-900">Weekly check-in complete</h2>
          <p className="mt-2 text-sm text-emerald-800">
            Session recorded for {weekStatus.weekLabel}. Your clinician will see updated trends in
            your progress report.
          </p>
          <div className="mt-4 flex gap-3">
            <Link
              href="/patient/progress-reports"
              className="rounded-lg bg-blue-800 px-4 py-2 text-sm text-white"
            >
              View progress report
            </Link>
            <button
              type="button"
              onClick={() => router.push('/patient')}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
