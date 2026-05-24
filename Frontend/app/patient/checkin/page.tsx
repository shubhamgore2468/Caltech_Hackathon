'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { startRecording, type RecorderHandle } from '@/lib/voice/recorder';
import { MotionCapture } from '@/components/sensors/MotionCapture';
import { CheckinVideoSession } from '@/components/patient/CheckinVideoSession';
import { extractMotionBiomarkers } from '@/lib/biomarkers/motion';
import { extractVoiceBiomarkers } from '@/lib/biomarkers/voice';
import { DEMO_PATIENT_ID, type Sample } from '@/lib/types';

const PATIENT_ID = process.env.NEXT_PUBLIC_DEMO_PATIENT_ID ?? DEMO_PATIENT_ID;
const VOICE_TURNS = 3;

type Step = 'intro' | 'imu' | 'voice' | 'video' | 'done';
type VoiceState = 'idle' | 'recording' | 'thinking' | 'speaking';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

const STEP_PROMPTS: Record<Step, string> = {
  intro:
    "Hi. I'll guide you through three quick checks. First, a short hand tremor reading. " +
    "Then a brief chat so I can listen to your voice. Last, a short video check. Tap Start when ready.",
  imu:
    "Step one of three. Hold the phone steady in one hand, arm out in front of you. " +
    "Tap Start and stay still for fifteen seconds.",
  voice:
    "Step two of three. I'll ask a few short questions. Hold the green button to answer, release when done.",
  video:
    "Step three of three. Place the phone so I can see your face. Tap Start video when ready.",
  done: "All three checks complete. Your clinician will see the results in your timeline.",
};

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\?{2,}/g, '')
    .replace(/\s+\?\s+/g, ' ')
    .trim();
}

export default function CheckinPage() {
  const [step, setStep] = useState<Step>('intro');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<RecorderHandle | null>(null);
  const userTurnCountRef = useRef(0);
  const spokenStepsRef = useRef<Set<Step>>(new Set());
  const voiceSessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `sess-${Date.now()}`,
  );

  const play = useCallback(async (buf: ArrayBuffer, mime: string) => {
    return new Promise<void>((resolve, reject) => {
      const blob = new Blob([buf], { type: mime });
      const url = URL.createObjectURL(blob);
      const el = audioRef.current ?? new Audio();
      audioRef.current = el;
      el.src = url;
      el.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      el.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('audio playback failed'));
      };
      void el.play().catch(reject);
    });
  }, []);

  const speak = useCallback(
    async (text: string) => {
      try {
        const res = await fetch('/api/voice/say', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        await play(buf, res.headers.get('Content-Type') ?? 'audio/wav');
      } catch {
        // best-effort — fall through silently
      }
    },
    [play],
  );

  // Auto-speak each step's prompt on entry (once per step).
  useEffect(() => {
    if (spokenStepsRef.current.has(step)) return;
    spokenStepsRef.current.add(step);
    void speak(STEP_PROMPTS[step]);
  }, [step, speak]);

  async function beginSession() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: PATIENT_ID,
          session_type: 'checkin',
          duration_seconds: 0,
          notes: 'guided_checkin',
        }),
      });
      const data = await res.json().catch(() => ({}));
      setSessionId(data.session?.id ?? null);
      setStep('imu');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function postBiomarkers(biomarkers: unknown[]) {
    if (!sessionId) return;
    await fetch('/api/biomarkers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, patient_id: PATIENT_ID, biomarkers }),
    });
  }

  async function handleImuComplete(samples: Sample[]) {
    setBusy(true);
    try {
      const biomarkers = extractMotionBiomarkers(samples, 'hand_tremor');
      await postBiomarkers(biomarkers);
      userTurnCountRef.current = 0;
      setTurns([]);
      setStep('voice');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function startHold() {
    if (voiceState !== 'idle') return;
    setError(null);
    try {
      const handle = await startRecording();
      recRef.current = handle;
      setVoiceState('recording');
    } catch (e) {
      setError(`mic: ${e instanceof Error ? e.message : String(e)}`);
      setVoiceState('idle');
    }
  }

  async function endHold() {
    if (voiceState !== 'recording' || !recRef.current) return;
    const handle = recRef.current;
    recRef.current = null;
    setVoiceState('thinking');
    try {
      const wav = await handle.stop();
      const form = new FormData();
      form.append('audio', wav, 'turn.wav');
      form.append('session_id', voiceSessionIdRef.current);
      form.append('patient_id', PATIENT_ID);

      const res = await fetch('/api/voice/turn', { method: 'POST', body: form });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`turn failed: ${text.slice(0, 200)}`);
      }
      const userText = stripMarkdown(res.headers.get('X-User-Transcript') ?? '');
      const assistantText = stripMarkdown(res.headers.get('X-Assistant-Transcript') ?? '');
      const audioBuf = await res.arrayBuffer();

      setTurns((cur) => [
        ...cur,
        { role: 'user', text: userText || '(no speech)' },
        { role: 'assistant', text: assistantText },
      ]);
      userTurnCountRef.current += 1;

      setVoiceState('speaking');
      await play(audioBuf, res.headers.get('Content-Type') ?? 'audio/wav');
      setVoiceState('idle');

      if (userTurnCountRef.current >= VOICE_TURNS) {
        await finishVoiceStep();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setVoiceState('idle');
    }
  }

  function cancelHold() {
    recRef.current?.cancel();
    recRef.current = null;
    setVoiceState('idle');
  }

  async function finishVoiceStep() {
    setBusy(true);
    try {
      // Voice biomarkers — placeholder PCM seeded by session length. Real DSP lives
      // in /voice/biomarkers backend route; wire later if needed.
      const fakePcm = new Float32Array(16000 * 5);
      const voice = extractVoiceBiomarkers(fakePcm, 16000, {
        seed: voiceSessionIdRef.current.length,
      });
      await postBiomarkers(voice);
      setStep('video');
    } finally {
      setBusy(false);
    }
  }

  async function handleVideoComplete(durationSec: number) {
    setBusy(true);
    try {
      const fakePcm = new Float32Array(Math.max(1, Math.round(durationSec * 16000)));
      const voice = extractVoiceBiomarkers(fakePcm, 16000, {
        seed: (sessionId ?? '').length + 1,
      });
      await postBiomarkers(voice);
      if (sessionId) {
        await fetch('/api/risk-score/compute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, patient_id: PATIENT_ID }),
        });
        await fetch(`/api/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ended_at: new Date().toISOString() }),
        });
      }
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 text-stone-900">
      <header className="sticky top-0 z-10 bg-stone-50/90 backdrop-blur border-b border-stone-200 px-4 py-3 max-w-md mx-auto w-full">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-medium">Guided Check-in</h1>
          <StepBadge step={step} />
        </div>
      </header>

      <section className="max-w-md mx-auto w-full px-4 py-5 space-y-4">
        <AgentBubble text={STEP_PROMPTS[step]} />

        {error && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {step === 'intro' && (
          <button
            disabled={busy}
            onClick={beginSession}
            className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-white font-medium disabled:bg-stone-300"
          >
            {busy ? 'Starting…' : 'Start check-in'}
          </button>
        )}

        {step === 'imu' && (
          <MotionCapture mode="hand_tremor" durationSec={15} onComplete={handleImuComplete} />
        )}

        {step === 'voice' && (
          <VoicePanel
            turns={turns}
            state={voiceState}
            count={userTurnCountRef.current}
            target={VOICE_TURNS}
            onStart={startHold}
            onEnd={endHold}
            onCancel={cancelHold}
            onSkip={finishVoiceStep}
          />
        )}

        {step === 'video' && <CheckinVideoSession onComplete={handleVideoComplete} />}

        {step === 'done' && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
            <p className="text-sm text-emerald-900 font-medium">Check-in saved.</p>
            <div className="flex gap-2">
              <Link
                href="/patient/progress-reports"
                className="flex-1 text-center rounded-lg bg-blue-800 px-3 py-2 text-sm text-white"
              >
                View progress
              </Link>
              <Link
                href="/patient"
                className="flex-1 text-center rounded-lg border border-stone-300 px-3 py-2 text-sm"
              >
                Done
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function StepBadge({ step }: { step: Step }) {
  const idx = { intro: 0, imu: 1, voice: 2, video: 3, done: 3 }[step];
  if (step === 'intro') return <span className="text-xs text-stone-500">Ready</span>;
  return (
    <span className="text-xs text-stone-500">
      Step {Math.min(idx, 3)} of 3
    </span>
  );
}

function AgentBubble({ text }: { text: string }) {
  return (
    <div className="flex gap-2 items-start">
      <div className="h-8 w-8 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center font-medium shrink-0">
        AI
      </div>
      <div className="bg-white border border-stone-200 rounded-2xl rounded-tl-sm px-4 py-2.5 text-[15px] leading-relaxed shadow-sm">
        {text}
      </div>
    </div>
  );
}

function VoicePanel({
  turns,
  state,
  count,
  target,
  onStart,
  onEnd,
  onCancel,
  onSkip,
}: {
  turns: Turn[];
  state: VoiceState;
  count: number;
  target: number;
  onStart: () => void;
  onEnd: () => void;
  onCancel: () => void;
  onSkip: () => void;
}) {
  const busy = state === 'thinking' || state === 'speaking';
  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-500">Question {Math.min(count + 1, target)} of {target}</p>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {turns.map((t, i) => (
          <div
            key={i}
            className={`text-sm rounded-xl px-3 py-2 ${
              t.role === 'assistant'
                ? 'bg-white border border-stone-200'
                : 'bg-emerald-600 text-white ml-8'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
      <div className="flex flex-col items-center gap-2 pt-2">
        <button
          disabled={busy}
          onMouseDown={onStart}
          onMouseUp={onEnd}
          onMouseLeave={() => state === 'recording' && onCancel()}
          onTouchStart={(e) => {
            e.preventDefault();
            onStart();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            onEnd();
          }}
          className={`relative h-20 w-20 rounded-full flex items-center justify-center shadow-lg transition-all select-none touch-none ${
            state === 'recording'
              ? 'bg-rose-500 scale-110'
              : busy
                ? 'bg-stone-300 cursor-not-allowed'
                : 'bg-emerald-600 active:scale-95'
          }`}
        >
          {state === 'recording' && (
            <span className="absolute inset-0 rounded-full bg-rose-500 animate-ping opacity-60" />
          )}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-white relative">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
        <span className="text-xs text-stone-500">
          {state === 'idle' ? 'Hold to talk' : state}
        </span>
        {count >= target - 1 && state === 'idle' && (
          <button
            onClick={onSkip}
            className="text-xs text-stone-500 underline underline-offset-4 hover:text-stone-800"
          >
            Continue to video →
          </button>
        )}
      </div>
    </div>
  );
}
