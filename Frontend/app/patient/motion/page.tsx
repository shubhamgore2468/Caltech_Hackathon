'use client';

import { useEffect, useRef, useState } from 'react';
import { useMotionCapture } from '../../../MotionCapture';
import { useMotionCapture } from '../../../components/sensors/useMotionCapture';
import { type MotionMode } from '@/lib/biomarkers/motion';
import type { Biomarker, Sample } from '@/lib/types';

const COLORS = {
  bg: '#0b0e14',
  fg: '#e6edf3',
  muted: '#8b949e',
  accent: '#2da44e',
  danger: '#cf222e',
  x: '#f85149',
  y: '#3fb950',
  z: '#58a6ff',
  card: '#161b22',
  border: '#30363d',
  graphBg: '#0d1117',
  gridMid: '#21262d',
  gridLow: '#161b22',
};

const SAMPLE_RATE = 60;
const GRAPH_WINDOW_SEC = 5;
const RING_SIZE = SAMPLE_RATE * GRAPH_WINDOW_SEC;

const DURATION: Record<MotionMode, number> = {
  hand_tremor: 15,
  walk_test: 30,
};

const INSTRUCTIONS: Record<MotionMode, string> = {
  hand_tremor: 'Hold phone still in your dominant hand. Rest your elbow on a surface. Stay relaxed.',
  walk_test: 'Put phone in your front pocket. When you tap Start, walk normally for 30 seconds.',
};

const LABEL: Record<MotionMode, string> = {
  hand_tremor: 'Hand Tremor Test',
  walk_test: 'Walk Test',
};

type Phase = 'idle' | 'recording' | 'analyzing' | 'done' | 'error';

interface AnalyzeResult {
  mode: MotionMode;
  sample_count: number;
  elapsed_ms: number;
  biomarkers: Biomarker[];
}

export default function MotionPage() {
  const [mode, setMode] = useState<MotionMode>('hand_tremor');
  const [phase, setPhase] = useState<Phase>('idle');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mc = useMotionCapture({ sampleRate: SAMPLE_RATE, autoStopSec: DURATION[mode] });
  const wasRecording = useRef(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Detect recording → stopped transition → kick off analyze
  useEffect(() => {
    if (wasRecording.current && !mc.recording) {
      void analyzeSamples(mc.stop());
    }
    wasRecording.current = mc.recording;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mc.recording]);

  // Countdown timer
  useEffect(() => {
    if (phase !== 'recording') {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    setSecondsLeft(DURATION[mode]);
    const startedAt = Date.now();
    tickRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const left = Math.max(0, DURATION[mode] - elapsed);
      setSecondsLeft(left);
    }, 100);
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [phase, mode]);

  async function handleStart() {
    setErrorMsg(null);
    setResult(null);
    setPhase('recording');
    await mc.start();
    // If start failed (permission denied), useMotionCapture sets error but recording stays false
    if (mc.error) {
      setErrorMsg(mc.error);
      setPhase('error');
    }
  }

  async function analyzeSamples(samples: Sample[]) {
    if (samples.length < 16) {
      setErrorMsg('Capture too short. Try again.');
      setPhase('error');
      return;
    }
    setPhase('analyzing');
    try {
      const res = await fetch('/api/motion/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, samples }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t);
      }
      const json = (await res.json()) as AnalyzeResult;
      setResult(json);
      setPhase('done');
      (window as unknown as { __imuResult?: AnalyzeResult; __imuSamples?: Sample[] }).__imuSamples = samples;
      (window as unknown as { __imuResult?: AnalyzeResult }).__imuResult = json;
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }

  function reset() {
    setResult(null);
    setErrorMsg(null);
    setPhase('idle');
    mc.reset();
  }

  // ---- Live graph (only meaningful while recording, but we keep it always) ----
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ringRef = useRef({
    x: new Float32Array(RING_SIZE),
    y: new Float32Array(RING_SIZE),
    z: new Float32Array(RING_SIZE),
    i: 0,
    filled: 0,
  });

  useEffect(() => {
    const r = ringRef.current;
    r.x[r.i] = mc.latest.x;
    r.y[r.i] = mc.latest.y;
    r.z[r.i] = mc.latest.z;
    r.i = (r.i + 1) % RING_SIZE;
    if (r.filled < RING_SIZE) r.filled++;
  }, [mc.latest]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = cv.getBoundingClientRect();
      cv.width = Math.floor(rect.width * dpr);
      cv.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const drawLine = (arr: Float32Array, color: string, w: number, h: number, range: number) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      const r = ringRef.current;
      const n = r.filled;
      if (n < 2) return;
      const start = (r.i - n + RING_SIZE) % RING_SIZE;
      for (let k = 0; k < n; k++) {
        const v = arr[(start + k) % RING_SIZE];
        const x = (k / (RING_SIZE - 1)) * w;
        const y = h / 2 - (v / range) * (h / 2 - 4);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    const loop = () => {
      const rect = cv.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = COLORS.gridMid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      const range = 20;
      drawLine(ringRef.current.x, COLORS.x, w, h, range);
      drawLine(ringRef.current.y, COLORS.y, w, h, range);
      drawLine(ringRef.current.z, COLORS.z, w, h, range);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const showGraph = phase === 'recording';

  return (
    <main
      className="min-h-screen flex flex-col gap-4 px-4"
      style={{
        background: COLORS.bg,
        color: COLORS.fg,
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <h1 className="text-lg font-semibold tracking-wide mt-4">{LABEL[mode]}</h1>

      {phase === 'idle' && (
        <>
          <div className="flex gap-2">
            <button
              onClick={() => setMode('hand_tremor')}
              className="flex-1 rounded-md py-2 px-3 text-sm font-medium border"
              style={{
                background: mode === 'hand_tremor' ? COLORS.accent : '#21262d',
                color: '#fff',
                borderColor: COLORS.border,
              }}
            >
              Hand Tremor
            </button>
            <button
              onClick={() => setMode('walk_test')}
              className="flex-1 rounded-md py-2 px-3 text-sm font-medium border"
              style={{
                background: mode === 'walk_test' ? COLORS.accent : '#21262d',
                color: '#fff',
                borderColor: COLORS.border,
              }}
            >
              Walk
            </button>
          </div>

          <div
            className="rounded-xl p-4 border text-sm"
            style={{ background: COLORS.card, borderColor: COLORS.border, color: COLORS.muted }}
          >
            {INSTRUCTIONS[mode]}
          </div>

          <button
            onClick={handleStart}
            className="w-full rounded-2xl py-6 text-xl font-bold mt-2"
            style={{
              background: COLORS.accent,
              color: '#fff',
              WebkitTapHighlightColor: 'transparent',
              touchAction: 'manipulation',
            }}
          >
            Start {DURATION[mode]}s test
          </button>
        </>
      )}

      {phase === 'recording' && (
        <>
          <div
            className="rounded-xl p-4 border"
            style={{ background: COLORS.card, borderColor: COLORS.border }}
          >
            <div className="text-5xl font-bold tabular-nums text-center">
              {secondsLeft.toFixed(1)}
              <span className="text-base font-normal ml-2" style={{ color: COLORS.muted }}>
                s left
              </span>
            </div>
            <div className="text-xs text-center mt-2" style={{ color: COLORS.muted }}>
              {mc.sampleCount.toLocaleString()} samples
            </div>
          </div>

          {showGraph && (
            <div
              className="rounded-xl p-3 border"
              style={{ background: COLORS.card, borderColor: COLORS.border }}
            >
              <canvas
                ref={canvasRef}
                className="w-full block rounded-md"
                style={{ height: 180, background: COLORS.graphBg }}
              />
            </div>
          )}

          <div className="text-xs text-center" style={{ color: COLORS.muted }}>
            Stay still and steady. Don't move the phone.
          </div>
        </>
      )}

      {phase === 'analyzing' && (
        <div
          className="rounded-xl p-6 border text-center"
          style={{ background: COLORS.card, borderColor: COLORS.border }}
        >
          <div className="text-xl font-semibold">Analyzing…</div>
          <div className="text-xs mt-2" style={{ color: COLORS.muted }}>
            Running biomarker algorithm on server
          </div>
        </div>
      )}

      {phase === 'done' && result && (
        <>
          <div
            className="rounded-xl p-4 border"
            style={{ background: COLORS.card, borderColor: COLORS.border }}
          >
            <div className="text-xs uppercase tracking-wider mb-3" style={{ color: COLORS.muted }}>
              Result · {result.sample_count.toLocaleString()} samples · {result.elapsed_ms}ms
            </div>
            <div className="flex flex-col gap-2">
              {result.biomarkers.map((b) => (
                <div key={b.metric_name} className="flex items-center justify-between text-sm">
                  <span>{b.metric_name}</span>
                  <span className="tabular-nums" style={{ color: COLORS.muted }}>
                    {b.value.toFixed(3)}
                    {b.unit ? ` ${b.unit}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={reset}
            className="w-full rounded-2xl py-5 text-lg font-bold"
            style={{
              background: COLORS.accent,
              color: '#fff',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            Run another test
          </button>
        </>
      )}

      {phase === 'error' && (
        <>
          <div
            className="rounded-xl p-4 border"
            style={{ background: COLORS.card, borderColor: COLORS.border, color: COLORS.danger }}
          >
            {errorMsg ?? 'Something went wrong.'}
          </div>
          <button
            onClick={reset}
            className="w-full rounded-2xl py-5 text-lg font-bold"
            style={{ background: COLORS.accent, color: '#fff' }}
          >
            Try again
          </button>
        </>
      )}
    </main>
  );
}
