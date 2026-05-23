'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Sample } from '@/lib/types';

const SAMPLE_INTERVAL_MS = 1000 / 60; // 60Hz throttle
const MAX_SAMPLES = 36000; // ~10 min at 60Hz

export type MotionCaptureMode = 'tremor' | 'walk';

export interface UseMotionCaptureOptions {
  mode?: MotionCaptureMode;
  durationSec?: number;
}

export interface UseMotionCaptureReturn {
  samples: Sample[];
  isCapturing: boolean;
  sampleCount: number;
  error: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

/**
 * DeviceMotion capture hook — ported from IMU/index.html.
 * 60Hz throttle, {t,x,y,z} format, ~36k sample cap.
 */
export function useMotionCapture(options: UseMotionCaptureOptions = {}): UseMotionCaptureReturn {
  const { durationSec } = options;
  const [samples, setSamples] = useState<Sample[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const samplesRef = useRef<Sample[]>([]);
  const lastSampleTimeRef = useRef(0);
  const startTimeRef = useRef(0);
  const handlerRef = useRef<((e: DeviceMotionEvent) => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    samplesRef.current = [];
    setSamples([]);
    lastSampleTimeRef.current = 0;
    setError(null);
  }, []);

  const stop = useCallback(() => {
    setIsCapturing(false);
    if (handlerRef.current) {
      window.removeEventListener('devicemotion', handlerRef.current);
      handlerRef.current = null;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setSamples([...samplesRef.current]);
  }, []);

  const start = useCallback(() => {
    if (typeof window === 'undefined') return;

    if (!window.isSecureContext) {
      setError('DeviceMotion requires HTTPS. Use next dev --experimental-https or a tunnel.');
      return;
    }

    reset();
    startTimeRef.current = performance.now();
    lastSampleTimeRef.current = 0;
    setIsCapturing(true);
    setError(null);

    const handler = (event: DeviceMotionEvent) => {
      const now = performance.now();
      const elapsed = now - startTimeRef.current;

      if (lastSampleTimeRef.current && now - lastSampleTimeRef.current < SAMPLE_INTERVAL_MS) {
        return;
      }
      lastSampleTimeRef.current = now;

      const acc = event.accelerationIncludingGravity;
      if (!acc) return;

      const sample: Sample = {
        t: elapsed / 1000,
        x: acc.x ?? 0,
        y: acc.y ?? 0,
        z: acc.z ?? 0,
      };

      if (samplesRef.current.length >= MAX_SAMPLES) {
        stop();
        return;
      }

      samplesRef.current.push(sample);
    };

    handlerRef.current = handler;
    window.addEventListener('devicemotion', handler);

    if (durationSec && durationSec > 0) {
      timerRef.current = setTimeout(() => stop(), durationSec * 1000);
    }
  }, [durationSec, reset, stop]);

  useEffect(() => {
    return () => {
      if (handlerRef.current) {
        window.removeEventListener('devicemotion', handlerRef.current);
      }
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    samples,
    isCapturing,
    sampleCount: samples.length,
    error,
    start,
    stop,
    reset,
  };
}

interface MotionCaptureProps {
  mode?: MotionCaptureMode;
  durationSec?: number;
  onComplete?: (samples: Sample[]) => void;
  className?: string;
}

export function MotionCapture({
  mode = 'tremor',
  durationSec = 15,
  onComplete,
  className = '',
}: MotionCaptureProps) {
  const { samples, isCapturing, sampleCount, error, start, stop, reset } = useMotionCapture({
    mode,
    durationSec,
  });

  const prevCapturing = useRef(false);
  useEffect(() => {
    if (prevCapturing.current && !isCapturing && samples.length > 0) {
      onComplete?.(samples);
    }
    prevCapturing.current = isCapturing;
  }, [isCapturing, samples, onComplete]);

  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {mode === 'tremor' ? 'Tremor Test' : 'Walk Test'}
          </h3>
          <p className="text-xs text-slate-500">
            {mode === 'tremor'
              ? 'Hold phone steady, then extend arm with tremor'
              : 'Walk naturally while holding phone'}
          </p>
        </div>
        <span className="font-mono text-xs text-slate-600">{sampleCount} samples</span>
      </div>

      {error && (
        <div className="mb-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</div>
      )}

      <div className="flex gap-2">
        {!isCapturing ? (
          <>
            <button
              type="button"
              onClick={start}
              className="rounded-md bg-blue-800 px-4 py-2 text-sm font-medium text-white hover:bg-blue-900"
            >
              Start {durationSec}s Capture
            </button>
            {sampleCount > 0 && (
              <button
                type="button"
                onClick={reset}
                className="rounded-md border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Reset
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={stop}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
          >
            Stop
          </button>
        )}
      </div>

      {isCapturing && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full animate-pulse bg-blue-800" style={{ width: '100%' }} />
        </div>
      )}
    </div>
  );
}
