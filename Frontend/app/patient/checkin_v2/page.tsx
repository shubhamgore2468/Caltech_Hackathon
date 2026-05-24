'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { startRecording, type RecorderHandle } from '@/lib/voice/recorder';
import { MotionCapture } from '@/components/sensors/MotionCapture';
import { useMotionCapture } from '@/components/sensors/useMotionCapture';
import { generateMockSamples } from '@/lib/biomarkers/motion';
import { DEMO_PATIENT_ID, type Sample } from '@/lib/types';

const PATIENT_ID = process.env.NEXT_PUBLIC_DEMO_PATIENT_ID ?? DEMO_PATIENT_ID;
const VOICE_TURNS = 4;
const VIDEO_CAPTURE_SEC = 20;
const MOTION_SLICE_SEC = 15;

// MediaPipe landmark indices (mirrors vision-api + CheckinVideoSession)
const LANDMARK_INDICES = {
  leftEyeTop: 159,
  leftEyeBottom: 145,
  leftEyeInner: 33,
  leftEyeOuter: 133,
  rightEyeTop: 386,
  rightEyeBottom: 374,
  rightEyeInner: 362,
  rightEyeOuter: 263,
  mouthTop: 13,
  mouthBottom: 14,
  mouthLeft: 78,
  mouthRight: 308,
};

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8000';

type Step = 'welcome' | 'lap_rest' | 'convo' | 'done';
type VoiceState = 'idle' | 'recording' | 'thinking' | 'speaking';
type PermState = 'pending' | 'requesting' | 'granted' | 'denied';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

interface VoiceBiomarkerPayload {
  jitter_local_pct?: number | null;
  shimmer_local_pct?: number | null;
  hnr_db?: number | null;
  mean_pitch_hz?: number | null;
  classifier_available?: boolean;
  pd_probability?: number | null;
  pd_prediction?: 0 | 1 | null;
  pd_risk_label?: 'low' | 'moderate' | 'high' | 'unknown';
  [k: string]: unknown;
}

function euclidean(
  a: { x: number; y: number },
  b: { x: number; y: number },
  W: number,
  H: number,
): number {
  const dx = (a.x - b.x) * W;
  const dy = (a.y - b.y) * H;
  return Math.sqrt(dx * dx + dy * dy);
}

function sliceLastSeconds(samples: Sample[], secs: number): Sample[] {
  if (samples.length === 0) return samples;
  const cutoff = samples[samples.length - 1].t - secs * 1000;
  // samples are append-only ordered by t — find first idx >= cutoff
  let lo = 0;
  let hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t < cutoff) lo = mid + 1;
    else hi = mid;
  }
  return samples.slice(lo);
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\?{2,}/g, '')
    .trim();
}

export default function CheckinV2Page() {
  const [step, setStep] = useState<Step>('welcome');
  const [permState, setPermState] = useState<PermState>('pending');
  const [permError, setPermError] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>('');

  // ── refs ───────────────────────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<RecorderHandle | null>(null);
  const userTurnCountRef = useRef(0);
  const voiceSessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sess-${Date.now()}`,
  );
  const voiceBiomarkersRef = useRef<VoiceBiomarkerPayload[]>([]);
  const turnsSnapshotRef = useRef<Turn[]>([]);

  // Cached media stream from upfront permission grab — reused for cam (video) + recorder (mic).
  const grantedStreamRef = useRef<MediaStream | null>(null);

  // Hidden video for MediaPipe + RAF state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const rafRef = useRef(0);
  const videoRunningRef = useRef(false);
  const framesRef = useRef<{ timestamp_ms: number; ear: number; mouth_area: number }[]>([]);
  const videoStartRef = useRef<number | null>(null);
  const videoDoneRef = useRef(false);

  // Continuous motion capture for the convo phase
  const mc = useMotionCapture({ sampleRate: 60 });
  const motionStartedRef = useRef(false);

  // ── upfront permission gate ────────────────────────────────────────────
  async function requestAllPermissions() {
    setPermError(null);
    setPermState('requesting');
    try {
      // 1. Camera + mic (single getUserMedia call — covers both at once).
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      grantedStreamRef.current = stream;

      // 2. iOS DeviceMotion — explicit user-gesture permission ask.
      const reqMotion = (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> })
        .requestPermission;
      if (typeof reqMotion === 'function') {
        try {
          const result = await reqMotion.call(DeviceMotionEvent);
          if (result !== 'granted') {
            throw new Error('Motion permission denied (iOS).');
          }
        } catch (err) {
          console.warn('[checkin_v2] motion permission skipped/denied', err);
          // Non-fatal on desktop where DeviceMotion has no permission API.
        }
      }

      console.info('[checkin_v2] permissions granted (cam, mic, motion)');
      setPermState('granted');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPermError(msg);
      setPermState('denied');
      console.warn('[checkin_v2] permission failed', msg);
    }
  }

  // ── audio playback ─────────────────────────────────────────────────────
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
        /* best-effort */
      }
    },
    [play],
  );

  // ── helpers ────────────────────────────────────────────────────────────
  async function postBiomarkers(biomarkers: unknown[]) {
    if (!sessionId) return;
    await fetch('/api/biomarkers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, patient_id: PATIENT_ID, biomarkers }),
    });
  }

  function voicePayloadToBiomarkers(p: VoiceBiomarkerPayload, turn: number) {
    const rows: Record<string, unknown>[] = [];
    const push = (metric_name: string, value: number | null | undefined, unit?: string) => {
      if (value == null || Number.isNaN(value)) return;
      rows.push({ category: 'voice', metric_name, value, unit, step: 'voice', turn_index: turn });
    };
    push('jitter_local_pct', p.jitter_local_pct ?? undefined, '%');
    push('shimmer_local_pct', p.shimmer_local_pct ?? undefined, '%');
    push('hnr_db', p.hnr_db ?? undefined, 'dB');
    push('mean_pitch_hz', p.mean_pitch_hz ?? undefined, 'hz');
    push('pd_probability', p.pd_probability ?? undefined, 'ratio');
    push('pd_prediction', p.pd_prediction ?? undefined, 'class');
    if (rows.length) {
      rows[0] = {
        ...rows[0],
        raw_blob: { pd_risk_label: p.pd_risk_label ?? null, classifier_available: !!p.classifier_available },
      };
    }
    return rows;
  }

  // ── session lifecycle ──────────────────────────────────────────────────
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
          notes: 'guided_checkin_v2',
        }),
      });
      const data = await res.json().catch(() => ({}));
      setSessionId(data.session?.id ?? data.id ?? null);
      setStep('lap_rest');
      void speak("First, place the phone on your lap. We'll measure briefly while you sit still.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── lap rest IMU (visible) ─────────────────────────────────────────────
  async function handleLapRest(samples: Sample[]) {
    setBusy(true);
    try {
      const payload =
        samples.length >= 16
          ? samples
          : generateMockSamples({ durationSec: 15, sampleHz: 60, tremorHz: 0.5, tremorAmp: 0.1 });
      const res = await fetch('/api/motion/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'hand_tremor', samples: payload }),
      });
      const data = await res.json().catch(() => ({}));
      const biomarkers = (data.biomarkers ?? []).map((b: Record<string, unknown>) => ({
        ...b,
        step: 'imu_lap_rest',
      }));
      console.info('[checkin_v2] lap_rest', { backend: data.backend, samples: data.sample_count, extra: data.extra });
      await postBiomarkers(biomarkers);
      setStatusMsg('Motion captured. Starting conversation in 3s…');
      await new Promise((r) => setTimeout(r, 3000));
      enterConvo();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── convo entry ────────────────────────────────────────────────────────
  function enterConvo() {
    setStep('convo');
    userTurnCountRef.current = 0;
    turnsSnapshotRef.current = [];
    voiceBiomarkersRef.current = [];
    framesRef.current = [];
    videoDoneRef.current = false;
    videoStartRef.current = null;
    setTurns([]);
    setStatusMsg('Camera warming up…');
  }

  // ── Load MediaPipe + start camera as soon as convo step mounts ─────────
  useEffect(() => {
    if (step !== 'convo') return;
    let cancelled = false;

    const origError = console.error;
    const origWarn = console.warn;
    const origInfo = console.info;
    const isMpNoise = (args: unknown[]) => {
      const s = args.map((a) => (typeof a === 'string' ? a : '')).join(' ');
      return (
        s.includes('face_landmarker_graph') ||
        s.includes('gl_context') ||
        s.includes('XNNPACK') ||
        s.includes('TensorFlow Lite') ||
        s.includes('vision_wasm_internal')
      );
    };
    console.error = (...args: unknown[]) => {
      if (!isMpNoise(args)) origError(...args);
    };
    console.warn = (...args: unknown[]) => {
      if (!isMpNoise(args)) origWarn(...args);
    };
    console.info = (...args: unknown[]) => {
      if (!isMpNoise(args)) origInfo(...args);
    };

    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
        );
        const create = (delegate: 'GPU' | 'CPU') =>
          FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate },
            runningMode: 'VIDEO',
            numFaces: 1,
          });

        let landmarker: FaceLandmarker;
        try {
          landmarker = await create('GPU');
        } catch {
          landmarker = await create('CPU');
        }
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;

        // Attach existing granted stream to hidden video element.
        const video = videoRef.current;
        const stream = grantedStreamRef.current;
        if (video && stream) {
          video.srcObject = stream;
          await video.play().catch(() => {});
          await new Promise<void>((resolve) => {
            if (video.readyState >= 2 && video.videoWidth > 0) {
              resolve();
              return;
            }
            video.onloadeddata = () => resolve();
          });
        }

        // Start motion capture continuously for the rest of the convo.
        if (!motionStartedRef.current) {
          motionStartedRef.current = true;
          void mc.start();
        }

        // Kick off video frame loop + auto-stop at VIDEO_CAPTURE_SEC.
        lastVideoTimeRef.current = -1;
        videoRunningRef.current = true;
        videoStartRef.current = performance.now();
        rafRef.current = requestAnimationFrame(videoLoop);

        setStatusMsg('Listening — say hello when ready.');
        // Auto-greet to bootstrap the convo audibly without taking a turn.
        void speak(
          "I'll ask you a few quick questions about your day. Hold the green button to answer.",
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[checkin_v2] video bootstrap failed', msg);
      }
    })();

    return () => {
      cancelled = true;
      console.error = origError;
      console.warn = origWarn;
      console.info = origInfo;
      videoRunningRef.current = false;
      cancelAnimationFrame(rafRef.current);
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function videoLoop() {
    if (!videoRunningRef.current) return;

    // Auto-stop after VIDEO_CAPTURE_SEC + submit once.
    if (!videoDoneRef.current && videoStartRef.current !== null) {
      const elapsed = (performance.now() - videoStartRef.current) / 1000;
      if (elapsed >= VIDEO_CAPTURE_SEC) {
        videoDoneRef.current = true;
        const captured = [...framesRef.current];
        void submitFaceFrames(captured);
        stopVideoStream();
        return;
      }
    }

    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (video && landmarker && video.readyState >= 2 && video.videoWidth > 0) {
      const W = video.videoWidth;
      const H = video.videoHeight;
      if (video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime;
        const now = performance.now();
        const results = landmarker.detectForVideo(video, now);
        if (results.faceLandmarks?.length > 0) {
          const face = results.faceLandmarks[0];
          const lV = euclidean(face[LANDMARK_INDICES.leftEyeTop], face[LANDMARK_INDICES.leftEyeBottom], W, H);
          const lH = euclidean(face[LANDMARK_INDICES.leftEyeInner], face[LANDMARK_INDICES.leftEyeOuter], W, H);
          const rV = euclidean(face[LANDMARK_INDICES.rightEyeTop], face[LANDMARK_INDICES.rightEyeBottom], W, H);
          const rH = euclidean(face[LANDMARK_INDICES.rightEyeInner], face[LANDMARK_INDICES.rightEyeOuter], W, H);
          const earL = lH > 0 ? lV / lH : 0;
          const earR = rH > 0 ? rV / rH : 0;
          const ear = (earL + earR) / 2;
          const mouthV = euclidean(face[LANDMARK_INDICES.mouthTop], face[LANDMARK_INDICES.mouthBottom], W, H);
          const mouthH = euclidean(face[LANDMARK_INDICES.mouthLeft], face[LANDMARK_INDICES.mouthRight], W, H);
          framesRef.current.push({
            timestamp_ms: now,
            ear: parseFloat(ear.toFixed(5)),
            mouth_area: parseFloat((mouthV * mouthH).toFixed(3)),
          });
        }
      }
    }

    rafRef.current = requestAnimationFrame(videoLoop);
  }

  function stopVideoStream() {
    videoRunningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    // Keep the audio track alive for the mic; stop only video tracks.
    const stream = grantedStreamRef.current;
    stream?.getVideoTracks().forEach((t) => t.stop());
    const video = videoRef.current;
    if (video) video.srcObject = null;
  }

  async function submitFaceFrames(frames: { timestamp_ms: number; ear: number; mouth_area: number }[]) {
    if (frames.length < 30) {
      console.warn(`[checkin_v2] video too few frames (${frames.length}) — skipping`);
      return;
    }
    const fps = frames.length / VIDEO_CAPTURE_SEC;
    console.info(`[checkin_v2] video submit frames=${frames.length} fps=${fps.toFixed(2)}`);
    try {
      const res = await fetch(`${BASE_URL}/api/biomarkers/clinical/face`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          duration_sec: VIDEO_CAPTURE_SEC,
          fps: parseFloat(fps.toFixed(2)),
          frames,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`face ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      console.info('[checkin_v2] video result', data);
      const rows = [
        { category: 'camera', metric_name: 'blink_rate_per_min', value: data.blink_rate_bpm, unit: 'bpm', step: 'video' },
        { category: 'camera', metric_name: 'total_blinks',       value: data.total_blinks,   unit: 'count', step: 'video' },
        { category: 'camera', metric_name: 'expressivity_cv_pct', value: data.expressivity_cv_pct, unit: '%', step: 'video' },
        {
          category: 'camera',
          metric_name: 'expressivity_variance',
          value: data.expressivity_variance,
          unit: 'px2',
          step: 'video',
          raw_blob: { clinical_flags: data.clinical_flags ?? [] },
        },
      ];
      await postBiomarkers(rows);
    } catch (err) {
      console.warn('[checkin_v2] video submit failed', err);
    }
  }

  // ── voice turn lifecycle (push-to-talk) ────────────────────────────────
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
      if (wav.size < 16_000) {
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

      const biomarkerHeader = res.headers.get('X-Voice-Biomarkers');
      if (biomarkerHeader) {
        try {
          const parsed = JSON.parse(biomarkerHeader) as VoiceBiomarkerPayload;
          console.info('[checkin_v2] voice biomarkers', parsed);
          voiceBiomarkersRef.current.push(parsed);
          const rows = voicePayloadToBiomarkers(parsed, userTurnCountRef.current + 1);
          if (rows.length) await postBiomarkers(rows);
        } catch (err) {
          console.warn('[checkin_v2] voice biomarker parse failed', err);
        }
      }

      const newPair: Turn[] = [
        { role: 'user', text: userText || '(no speech)' },
        { role: 'assistant', text: assistantText },
      ];
      setTurns((cur) => [...cur, ...newPair]);
      turnsSnapshotRef.current.push(...newPair);
      userTurnCountRef.current += 1;

      // Slice last 15s of motion → analyze as imu_hand_tremor for this turn.
      void runMotionSliceForTurn(userTurnCountRef.current);

      setVoiceState('speaking');
      await play(audioBuf, res.headers.get('Content-Type') ?? 'audio/wav');
      setVoiceState('idle');

      if (userTurnCountRef.current >= VOICE_TURNS) {
        await finishConvo();
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

  async function runMotionSliceForTurn(turnIdx: number) {
    try {
      const all = mc.samples;
      const slice = sliceLastSeconds(all, MOTION_SLICE_SEC);
      const payload =
        slice.length >= 16
          ? slice
          : generateMockSamples({ durationSec: MOTION_SLICE_SEC, sampleHz: 60, tremorHz: 5, tremorAmp: 1.2 });
      console.info(`[checkin_v2] motion slice turn=${turnIdx} samples=${slice.length} (sent=${payload.length})`);
      const res = await fetch('/api/motion/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'hand_tremor', samples: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn(`[checkin_v2] motion turn=${turnIdx} ${res.status}`, data?.error);
        return;
      }
      const biomarkers = (data.biomarkers ?? []).map((b: Record<string, unknown>) => ({
        ...b,
        step: 'imu_hand_tremor',
        turn_index: turnIdx,
      }));
      await postBiomarkers(biomarkers);
    } catch (err) {
      console.warn('[checkin_v2] motion slice failed', err);
    }
  }

  async function finishConvo() {
    setBusy(true);
    setStatusMsg('Wrapping up — saving your check-in.');
    try {
      // Stop continuous motion capture and release mic stream.
      if (motionStartedRef.current) {
        mc.stop();
        motionStartedRef.current = false;
      }
      grantedStreamRef.current?.getTracks().forEach((t) => t.stop());
      grantedStreamRef.current = null;

      // Persist transcript + cognitive aggregate.
      if (sessionId && turnsSnapshotRef.current.length > 0) {
        const transcript = turnsSnapshotRef.current.map((t) => ({
          role: t.role,
          content: t.text,
          timestamp: new Date().toISOString(),
        }));
        const aggregateFlags = voiceBiomarkersRef.current.reduce<Record<string, unknown>>(
          (acc, b, i) => {
            if (b.pd_risk_label) acc[`turn_${i + 1}_pd_risk_label`] = b.pd_risk_label;
            if (b.classifier_available != null) acc[`turn_${i + 1}_classifier`] = b.classifier_available;
            return acc;
          },
          {},
        );
        await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            patient_id: PATIENT_ID,
            transcript,
            cognitive_flags: aggregateFlags,
          }),
        });
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
      setStatusMsg('All set — finalizing your report…');
      await new Promise((r) => setTimeout(r, 3000));
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Unmount cleanup
  useEffect(() => {
    return () => {
      grantedStreamRef.current?.getTracks().forEach((t) => t.stop());
      grantedStreamRef.current = null;
      if (motionStartedRef.current) mc.stop();
      cancelAnimationFrame(rafRef.current);
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── render ─────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200 px-4 py-3 max-w-md mx-auto w-full">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-slate-900">Weekly Check-in</h1>
          <StepBadge step={step} />
        </div>
      </header>

      <section className="max-w-md mx-auto w-full px-4 py-5 space-y-4">
        {/* Hidden video element used by the MediaPipe pipeline. Kept tiny + offscreen. */}
        <video ref={videoRef} className="hidden" playsInline muted />

        {error && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {step === 'welcome' && (
          <WelcomeStep
            permState={permState}
            permError={permError}
            onRequest={requestAllPermissions}
            onContinue={beginSession}
            busy={busy}
          />
        )}

        {step === 'lap_rest' && (
          <div className="space-y-3">
            <AgentBubble text="Place the phone flat on your lap and sit relaxed. We'll measure for 15 seconds." />
            <MotionCapture mode="lap_rest" durationSec={15} onComplete={handleLapRest} />
          </div>
        )}

        {step === 'convo' && (
          <ConvoPanel
            turns={turns}
            voiceState={voiceState}
            count={userTurnCountRef.current}
            target={VOICE_TURNS}
            statusMsg={statusMsg}
            onStart={startHold}
            onEnd={endHold}
            onCancel={cancelHold}
          />
        )}

        {step === 'done' && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
            <p className="text-sm text-emerald-900 font-medium">Check-in saved.</p>
            <div className="flex gap-2">
              <Link
                href="/patient/progress-reports"
                className="flex-1 text-center rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-900 hover:border-blue-800"
              >
                View progress
              </Link>
              <Link
                href="/patient"
                className="flex-1 text-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
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
  const labels: Record<Step, string> = {
    welcome: 'Setup',
    lap_rest: 'Step 1 of 2',
    convo: 'Step 2 of 2',
    done: 'Complete',
  };
  return <span className="text-xs text-slate-500">{labels[step]}</span>;
}

function AgentBubble({ text }: { text: string }) {
  return (
    <div className="flex gap-2 items-start">
      <div className="h-8 w-8 rounded-full bg-blue-800 text-white text-xs flex items-center justify-center font-semibold shrink-0">
        AI
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded-2xl rounded-tl-sm px-4 py-2.5 text-[15px] leading-relaxed text-slate-800">
        {text}
      </div>
    </div>
  );
}

function WelcomeStep({
  permState,
  permError,
  onRequest,
  onContinue,
  busy,
}: {
  permState: PermState;
  permError: string | null;
  onRequest: () => void;
  onContinue: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-4">
      <AgentBubble
        text="I'll guide you through a short check-in: a brief rest measurement, then a conversation. I just need access to your camera, microphone, and motion sensor first."
      />
      <ul className="text-sm text-slate-600 space-y-1.5">
        <li>· Camera — observes blink rate + facial expressivity briefly at the start of the chat.</li>
        <li>· Microphone — captures your replies during the conversation.</li>
        <li>· Motion — measures tremor signals while you hold the phone.</li>
      </ul>

      {permState !== 'granted' ? (
        <button
          type="button"
          disabled={permState === 'requesting'}
          onClick={onRequest}
          className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-semibold text-emerald-900 hover:border-emerald-800 disabled:opacity-60"
        >
          {permState === 'requesting' ? 'Requesting access…' : 'Allow access'}
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={onContinue}
          className="w-full rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 font-semibold text-blue-900 hover:border-blue-800 disabled:opacity-60"
        >
          {busy ? 'Starting…' : 'Start check-in'}
        </button>
      )}

      {permError && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          {permError}
        </div>
      )}
    </div>
  );
}

function ConvoPanel({
  turns,
  voiceState,
  count,
  target,
  statusMsg,
  onStart,
  onEnd,
  onCancel,
}: {
  turns: Turn[];
  voiceState: VoiceState;
  count: number;
  target: number;
  statusMsg: string;
  onStart: () => void;
  onEnd: () => void;
  onCancel: () => void;
}) {
  const busy = voiceState === 'thinking' || voiceState === 'speaking';
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [turns.length, voiceState]);

  const progress = Math.min(count, target) / target;
  const stateLabel: Record<VoiceState, string> = {
    idle: 'Hold to talk',
    recording: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      {/* Progress + status */}
      <div className="space-y-1.5 pb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-slate-700">
            Question {Math.min(count + 1, target)} of {target}
          </span>
          {statusMsg && <span className="text-slate-500">{statusMsg}</span>}
        </div>
        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-blue-800 transition-all duration-500"
            style={{ width: `${Math.max(progress * 100, 4)}%` }}
          />
        </div>
      </div>

      {/* Transcript scroll area */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2"
      >
        {turns.length === 0 ? (
          <p className="text-center text-xs text-slate-400 pt-6">
            Conversation will appear here as you speak.
          </p>
        ) : (
          turns.map((t, i) => (
            <div
              key={i}
              className={`flex ${t.role === 'assistant' ? 'justify-start' : 'justify-end'}`}
            >
              <div
                className={`max-w-[85%] text-sm rounded-2xl px-3 py-2 ${
                  t.role === 'assistant'
                    ? 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
                    : 'bg-blue-800 text-white rounded-tr-sm'
                }`}
              >
                {t.text}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Sticky mic footer */}
      <div className="flex flex-col items-center gap-2 pt-4 pb-2 bg-white">
        <button
          disabled={busy}
          onMouseDown={onStart}
          onMouseUp={onEnd}
          onMouseLeave={() => voiceState === 'recording' && onCancel()}
          onTouchStart={(e) => {
            e.preventDefault();
            onStart();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            onEnd();
          }}
          className={`relative h-20 w-20 rounded-full flex items-center justify-center shadow-lg transition-all select-none touch-none ${
            voiceState === 'recording'
              ? 'bg-rose-500 scale-110'
              : busy
                ? 'bg-slate-300 cursor-not-allowed'
                : 'bg-blue-800 active:scale-95'
          }`}
        >
          {voiceState === 'idle' && (
            <span className="absolute inset-0 rounded-full border-2 border-blue-300 animate-ping opacity-40" />
          )}
          {voiceState === 'recording' && (
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
        <span
          className={`text-xs font-medium ${
            voiceState === 'recording'
              ? 'text-rose-600'
              : voiceState === 'thinking' || voiceState === 'speaking'
                ? 'text-blue-700'
                : 'text-slate-600'
          }`}
        >
          {stateLabel[voiceState]}
        </span>
      </div>
    </div>
  );
}
