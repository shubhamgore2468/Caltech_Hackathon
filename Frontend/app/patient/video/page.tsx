'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BackButton } from '@/components/BackButton';
import { CheckinVideoSession } from '@/components/patient/CheckinVideoSession';
import { MotionCapture } from '@/components/sensors/MotionCapture';
import { extractMotionBiomarkers } from '@/lib/biomarkers/motion';
import { extractVoiceBiomarkers } from '@/lib/biomarkers/voice';
import {
  getCurrentWeekStatus,
  getWeekKey,
  saveCheckinCompletion,
} from '@/lib/checkin/weekly';
import { DEMO_PATIENT_ID, type Sample } from '@/lib/types';

const PATIENT_ID = process.env.NEXT_PUBLIC_DEMO_PATIENT_ID ?? DEMO_PATIENT_ID;

type Step = 'gate' | 'video' | 'tremor' | 'complete';

export default function CheckinVideoPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('gate');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const weekStatus = getCurrentWeekStatus(PATIENT_ID);

  async function startSession() {
    if (!weekStatus.canStart) return;
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_id: PATIENT_ID,
        session_type: 'checkin',
        duration_seconds: 0,
        notes: `weekly_checkin:${getWeekKey()}`,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSessionId(data.session?.id ?? null);
    setStep('video');
  }

  async function handleVideoComplete(durationSec: number) {
    if (!sessionId) {
      setStep('tremor');
      return;
    }
    const fakePcm = new Float32Array(Math.max(1, Math.round(durationSec * 16000)));
    const voice = extractVoiceBiomarkers(fakePcm, 16000, { seed: sessionId.length });
    await fetch('/api/biomarkers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        patient_id: PATIENT_ID,
        biomarkers: voice,
      }),
    });
    setStep('tremor');
  }

  async function handleTremorComplete(samples: Sample[]) {
    if (!sessionId) return;
    setSubmitting(true);
    try {
      const biomarkers = extractMotionBiomarkers(samples, 'hand_tremor');
      await fetch('/api/biomarkers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          patient_id: PATIENT_ID,
          biomarkers,
        }),
      });
      await fetch('/api/risk-score/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, patient_id: PATIENT_ID }),
      });
      saveCheckinCompletion(PATIENT_ID, {
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

      {step === 'gate' && !weekStatus.canStart && (
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm text-emerald-800">
            Already completed this week&apos;s check-in.
          </p>
          <BackButton href="/patient" label="Return home" className="mt-4" />
        </div>
      )}

      {step === 'gate' && weekStatus.canStart && (
        <div className="mt-6">
          <p className="text-sm text-slate-600">
            Two parts: short video conversation, then ~15s tremor measurement.
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
          <MotionCapture mode="hand_tremor" durationSec={15} onComplete={handleTremorComplete} />
          {submitting && <p className="text-sm text-slate-500">Saving tremor data…</p>}
        </div>
      )}

      {step === 'complete' && (
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h2 className="font-semibold text-emerald-900">Weekly check-in complete</h2>
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
