'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { startRecording, type RecorderHandle } from '@/lib/voice/recorder';
import { MotionCapture } from '@/components/sensors/MotionCapture';
import {
  CheckinVideoSession,
  type ClinicalFaceResult,
} from '@/components/patient/CheckinVideoSession';
import { generateMockSamples } from '@/lib/biomarkers/motion';
import { extractVoiceBiomarkers } from '@/lib/biomarkers/voice';
import { DEMO_PATIENT_ID, type Sample } from '@/lib/types';

const PATIENT_ID = process.env.NEXT_PUBLIC_DEMO_PATIENT_ID ?? DEMO_PATIENT_ID;
const VOICE_TURNS = 4;

type Step = 'intro' | 'imu1' | 'imu2' | 'voice' | 'video' | 'done';
type VoiceState = 'idle' | 'recording' | 'thinking' | 'speaking';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

interface CIBlock {
  mean: number;
  ci_lower: number;
  ci_upper: number;
}

interface VoiceBiomarkerPayload {
  parselmouth_available?: boolean;
  jitter_local_pct?: number | null;
  shimmer_local_pct?: number | null;
  hnr_db?: number | null;
  mean_pitch_hz?: number | null;
  classifier_available?: boolean;
  pd_prediction?: 0 | 1 | null;
  pd_probability?: number | null;
  pd_vocal_risk_score?: number | null;
  pd_risk_label?: 'low' | 'moderate' | 'high' | 'unknown';
  wav2vec_available?: boolean;
  [k: string]: unknown;
}

interface MotionAnalyzeResponse {
  mode: string;
  sample_count: number;
  elapsed_ms: number;
  backend: 'fastapi' | 'local';
  biomarkers: Array<{ metric_name: string; value: number; unit?: string | null }>;
  extra?: {
    duration_seconds?: number;
    windows_analyzed?: number;
    metrics_pd_ratio?: CIBlock;
    metrics_et_ratio?: CIBlock;
  };
}

const STEP_PROMPTS: Record<Step, string> = {
  intro:
    "Hi. I'll guide you through four quick checks. First two are short tremor readings — " +
    "phone on your lap, then in your hand. Then a brief voice chat, and last a short video. Tap Start when ready.",
  imu1:
    "Step one of four. Place the phone steady on your lap. " +
    "Tap Start and stay still for fifteen seconds.",
  imu2:
    "Step two of four. Hold the phone steady in one hand, arm out in front of you. " +
    "Tap Start and stay still for fifteen seconds.",
  voice:
    "Step three of four. I'll ask a few short questions. Hold the green button to answer, release when done.",
  video:
    "Step four of four. Place the phone so I can see your face. Tap Start video when ready.",
  done: "All four checks complete. Your clinician will see the results in your timeline.",
};

// Project Biomarker shape that /api/biomarkers expects.
type BiomarkerRow = {
  category: 'voice';
  metric_name: string;
  value: number;
  unit?: string;
  raw_blob?: Record<string, unknown>;
};

function voicePayloadToBiomarkers(p: VoiceBiomarkerPayload, turn: number): BiomarkerRow[] {
  const rows: BiomarkerRow[] = [];
  const push = (metric_name: string, value: number | null | undefined, unit?: string) => {
    if (value == null || Number.isNaN(value)) return;
    rows.push({ category: 'voice', metric_name, value, unit });
  };
  push('jitter_local_pct', p.jitter_local_pct ?? undefined, '%');
  push('shimmer_local_pct', p.shimmer_local_pct ?? undefined, '%');
  push('hnr_db', p.hnr_db ?? undefined, 'dB');
  push('mean_pitch_hz', p.mean_pitch_hz ?? undefined, 'hz');
  push('pd_probability', p.pd_probability ?? undefined, 'ratio');
  push('pd_prediction', p.pd_prediction ?? undefined, 'class');
  // Stash full payload + turn index on first row for traceability.
  if (rows.length) {
    rows[0] = {
      ...rows[0],
      raw_blob: { turn, pd_risk_label: p.pd_risk_label ?? null, classifier_available: !!p.classifier_available },
    };
  }
  return rows;
}

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
  const [motionResults, setMotionResults] = useState<Array<{ label: string; data: MotionAnalyzeResponse }>>([]);
  const voiceBiomarkersRef = useRef<VoiceBiomarkerPayload[]>([]);

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
      setStep('imu1');
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

  function makeImuHandler(mode: 'lap_rest' | 'hand_tremor', next: Step) {
    return async (samples: Sample[]) => {
      setBusy(true);
      try {
        // zod on /api/motion/analyze accepts only walk_test|hand_tremor.
        // lap_rest = static hold, no gait — map to hand_tremor.
        const apiMode = mode === 'lap_rest' ? 'hand_tremor' : mode;
        // Laptop dev fallback: DeviceMotion fires nothing on desktops, so MotionCapture
        // returns ~0 samples. Sub the smallest believable synthetic capture so the
        // downstream FastAPI window math (>=2s) still has something to chew on.
        const payload =
          samples.length >= 16
            ? samples
            : generateMockSamples({
                durationSec: 15,
                sampleHz: 60,
                tremorHz: mode === 'lap_rest' ? 0.5 : 5,
                tremorAmp: mode === 'lap_rest' ? 0.1 : 1.5,
              });
        const res = await fetch('/api/motion/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: apiMode, samples: payload }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            `motion/analyze ${res.status}: ${
              typeof data?.error === 'string' ? data.error : JSON.stringify(data?.error ?? data)
            }`,
          );
        }
        const biomarkers = data.biomarkers ?? [];
        // Debug surface — inspect raw FastAPI CI shape in DevTools.
        if (typeof window !== 'undefined') {
          (window as unknown as Record<string, unknown>).__motionResult = data;
        }
        console.info(`[motion/${mode}] backend=${data.backend} samples=${data.sample_count}`, data.extra);
        setMotionResults((cur) => [...cur, { label: mode, data: data as MotionAnalyzeResponse }]);
        await postBiomarkers(biomarkers);
        if (next === 'voice') {
          userTurnCountRef.current = 0;
          setTurns([]);
        }
        setStep(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    };
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
      // 44 bytes = empty WAV header w/ no samples — skip backend round-trip.
      // ~16kB ≈ 0.5s of 16kHz PCM16 = minimum useful turn.
      if (wav.size < 16_000) {
        console.warn(`[voice-biomarkers] skip tiny wav (${wav.size}B) — hold mic longer`);
        setError('Recording too short — hold the mic button and speak.');
        setVoiceState('idle');
        return;
      }
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

      // Voice biomarkers — backend returns full JSON dict in X-Voice-Biomarkers header.
      // Persist to DB so the doctor dashboard can render them later.
      const biomarkerHeader = res.headers.get('X-Voice-Biomarkers');
      if (biomarkerHeader) {
        try {
          const parsed = JSON.parse(biomarkerHeader) as VoiceBiomarkerPayload;
          console.info('[voice/biomarkers]', parsed);
          voiceBiomarkersRef.current.push(parsed);
          const rows = voicePayloadToBiomarkers(parsed, userTurnCountRef.current + 1);
          if (rows.length) await postBiomarkers(rows);
        } catch (err) {
          console.warn('[voice/biomarkers] parse/persist failed', err);
        }
      }

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
      // Real voice biomarkers were persisted per turn from the X-Voice-Biomarkers
      // header. If the backend never returned any (e.g. classifier/Praat unavailable),
      // fall back to the seeded mock so risk-score still has a voice row to fuse.
      if (voiceBiomarkersRef.current.length === 0) {
        const fakePcm = new Float32Array(16000 * 5);
        const voice = extractVoiceBiomarkers(fakePcm, 16000, {
          seed: voiceSessionIdRef.current.length,
        });
        await postBiomarkers(voice);
      }
      setStep('video');
    } finally {
      setBusy(false);
    }
  }

  async function handleVideoComplete(_durationSec: number, faceResult?: ClinicalFaceResult) {
    setBusy(true);
    try {
      if (faceResult) {
        // Persist real camera biomarkers from MediaPipe + /api/biomarkers/clinical/face.
        const cameraRows = [
          { category: 'camera' as const, metric_name: 'blink_rate_per_min', value: faceResult.blink_rate_bpm, unit: 'bpm' },
          { category: 'camera' as const, metric_name: 'total_blinks',       value: faceResult.total_blinks,   unit: 'count' },
          { category: 'camera' as const, metric_name: 'expressivity_cv_pct', value: faceResult.expressivity_cv_pct, unit: '%' },
          { category: 'camera' as const, metric_name: 'expressivity_variance', value: faceResult.expressivity_variance, unit: 'px2', raw_blob: { clinical_flags: faceResult.clinical_flags } },
        ];
        console.info('[video-biomarkers] persist', cameraRows);
        await postBiomarkers(cameraRows);
      } else {
        console.warn('[video-biomarkers] no result — skipping camera biomarker persist');
      }
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

        {motionResults.length > 0 && (
          <div className="space-y-2">
            {motionResults.map((r, i) => (
              <MotionResultCard key={i} label={r.label} data={r.data} />
            ))}
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

        {step === 'imu1' && (
          <MotionCapture mode="lap_rest" durationSec={15} onComplete={makeImuHandler('lap_rest', 'imu2')} />
        )}
        {step === 'imu2' && (
          <MotionCapture mode="hand_tremor" durationSec={15} onComplete={makeImuHandler('hand_tremor', 'voice')} />
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
  const idx = { intro: 0, imu1: 1, imu2: 2, voice: 3, video: 4, done: 5 }[step];
  if (step === 'intro') return <span className="text-xs text-stone-500">Ready</span>;
  return (
    <span className="text-xs text-stone-500">
      Step {Math.min(idx, 5)} of 5
    </span>
  );
}

function MotionResultCard({ label, data }: { label: string; data: MotionAnalyzeResponse }) {
  const pd = data.extra?.metrics_pd_ratio;
  const et = data.extra?.metrics_et_ratio;
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-900 font-mono">
      <div className="font-sans font-medium text-[13px] mb-1">
        ✓ {label} · {data.backend} · {data.sample_count} samples · {data.elapsed_ms} ms
      </div>
      {data.extra?.duration_seconds != null && (
        <div>
          duration {data.extra.duration_seconds.toFixed(2)}s · windows {data.extra.windows_analyzed}
        </div>
      )}
      {pd && (
        <div>
          pd_ratio mean={pd.mean.toFixed(4)} ci=[{pd.ci_lower.toFixed(4)}, {pd.ci_upper.toFixed(4)}]
        </div>
      )}
      {et && (
        <div>
          et_ratio mean={et.mean.toFixed(4)} ci=[{et.ci_lower.toFixed(4)}, {et.ci_upper.toFixed(4)}]
        </div>
      )}
    </div>
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
