'use client';

import { useEffect, useRef } from 'react';
import { useMotionCapture } from './useMotionCapture';
import type { Sample, SessionMode } from '@/lib/types';
import { Button } from '@/components/ui/button';

const GRAPH_WINDOW_SEC = 5;

interface MotionCaptureProps {
  mode: Extract<SessionMode, 'walk_test' | 'hand_tremor'>;
  durationSec?: number;
  onComplete?: (samples: Sample[]) => void;
}

// Ported live-graph + capture UI from IMU/index.html.
export function MotionCapture({ mode, durationSec, onComplete }: MotionCaptureProps) {
  const defaultDur = mode === 'walk_test' ? 30 : 15;
  const dur = durationSec ?? defaultDur;
  const sampleRate = 60;

  const mc = useMotionCapture({ sampleRate, autoStopSec: dur });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ringRef = useRef({
    size: sampleRate * GRAPH_WINDOW_SEC,
    x: new Float32Array(sampleRate * GRAPH_WINDOW_SEC),
    y: new Float32Array(sampleRate * GRAPH_WINDOW_SEC),
    z: new Float32Array(sampleRate * GRAPH_WINDOW_SEC),
    i: 0,
    filled: 0,
  });
  const prevRecording = useRef(false);

  // push latest into ring buffer for live graph (drives even when not recording)
  useEffect(() => {
    const r = ringRef.current;
    r.x[r.i] = mc.latest.x;
    r.y[r.i] = mc.latest.y;
    r.z[r.i] = mc.latest.z;
    r.i = (r.i + 1) % r.size;
    if (r.filled < r.size) r.filled++;
  }, [mc.latest]);

  // draw loop
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = cv.getBoundingClientRect();
      cv.width = Math.floor(rect.width * dpr);
      cv.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const rect = cv.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const r = ringRef.current;

      ctx.fillStyle = '#0b0e14';
      ctx.fillRect(0, 0, w, h);

      // zero line
      ctx.strokeStyle = '#30363d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      const drawAxis = (arr: Float32Array, color: string, range: number) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        const n = r.filled;
        if (n < 2) return;
        const start = (r.i - n + r.size) % r.size;
        for (let k = 0; k < n; k++) {
          const v = arr[(start + k) % r.size];
          const x = (k / (r.size - 1)) * w;
          const y = h / 2 - (v / range) * (h / 2 - 4);
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };

      const range = 20; // m/s^2
      drawAxis(r.x, '#f85149', range);
      drawAxis(r.y, '#3fb950', range);
      drawAxis(r.z, '#58a6ff', range);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  // fire onComplete when recording transitions true → false
  useEffect(() => {
    if (prevRecording.current && !mc.recording) {
      onComplete?.(mc.samples.slice());
    }
    prevRecording.current = mc.recording;
  }, [mc.recording, mc.samples, onComplete]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-zinc-900 p-4">
        <div className="text-xs text-zinc-400 uppercase tracking-wider">
          {mode === 'walk_test' ? 'Walk Test' : 'Hand Tremor Test'}
        </div>
        <div className="text-3xl font-bold tabular-nums">
          {mc.sampleCount.toLocaleString()}
          <span className="text-sm font-normal text-zinc-400 ml-2">samples</span>
        </div>
        <div className="text-xs text-zinc-500 mt-1">{mc.status}</div>
        {mc.error && <div className="text-xs text-red-400 mt-1">{mc.error}</div>}
      </div>

      <canvas ref={canvasRef} className="w-full h-40 rounded-xl border border-zinc-800" />

      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <span className="inline-block w-3 h-3 rounded-full bg-[#f85149]" /> X
        <span className="inline-block w-3 h-3 rounded-full bg-[#3fb950] ml-3" /> Y
        <span className="inline-block w-3 h-3 rounded-full bg-[#58a6ff] ml-3" /> Z
      </div>

      <Button
        size="lg"
        className="w-full text-lg py-6"
        onClick={() => (mc.recording ? mc.stop() : mc.start())}
        variant={mc.recording ? 'destructive' : 'default'}
      >
        {mc.recording ? `Stop (${dur}s auto)` : `Start ${dur}s capture`}
      </Button>
    </div>
  );
}
