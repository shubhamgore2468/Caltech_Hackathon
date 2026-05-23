'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Sample } from '@/lib/types';

interface UseMotionCaptureOpts {
  sampleRate?: number;
  maxSamples?: number;
  autoStopSec?: number;
}

interface UseMotionCaptureReturn {
  samples: Sample[];
  recording: boolean;
  sampleCount: number;
  effectiveHz: number;
  status: string;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Sample[];
  reset: () => void;
  latest: { x: number; y: number; z: number };
}

// Ported from IMU/index.html. Phone DeviceMotion @ ~60Hz with throttle.
export function useMotionCapture(opts: UseMotionCaptureOpts = {}): UseMotionCaptureReturn {
  const sampleRate = opts.sampleRate ?? 60;
  const maxSamples = opts.maxSamples ?? sampleRate * 60 * 10;
  const sampleIntervalMs = 1000 / sampleRate;

  const samplesRef = useRef<Sample[]>([]);
  const recordingRef = useRef(false);
  const lastSampleAtRef = useRef(0);
  const startedAtRef = useRef(0);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({ x: 0, y: 0, z: 0 });

  const [recording, setRecording] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  const [effectiveHz, setEffectiveHz] = useState(0);
  const [status, setStatus] = useState('Idle');
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState({ x: 0, y: 0, z: 0 });

  const round = (v: number) => Math.round(v * 1000) / 1000;

  const onMotion = useCallback(
    (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity || e.acceleration;
      if (!a) return;
      const x = a.x ?? 0;
      const y = a.y ?? 0;
      const z = a.z ?? 0;
      latestRef.current = { x, y, z };
      setLatest({ x: round(x), y: round(y), z: round(z) });

      if (!recordingRef.current) return;
      const now = performance.now();
      if (now - lastSampleAtRef.current < sampleIntervalMs) return;
      lastSampleAtRef.current = now;

      if (samplesRef.current.length >= maxSamples) {
        stopInternal('Hit maxSamples cap');
        return;
      }

      samplesRef.current.push({
        t: Date.now(),
        x: round(x),
        y: round(y),
        z: round(z),
      });
      setSampleCount(samplesRef.current.length);
    },
    [sampleIntervalMs, maxSamples],
  );

  const stopInternal = useCallback((reason: string) => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    window.removeEventListener('devicemotion', onMotion as EventListener);
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    const secs = (performance.now() - startedAtRef.current) / 1000;
    const hz = secs > 0 ? samplesRef.current.length / secs : 0;
    setEffectiveHz(Math.round(hz * 10) / 10);
    setRecording(false);
    setStatus(`Stopped. ${samplesRef.current.length} samples in ${secs.toFixed(1)}s (~${hz.toFixed(1)} Hz). ${reason}`);
  }, [onMotion]);

  const start = useCallback(async () => {
    setError(null);
    if (typeof DeviceMotionEvent === 'undefined') {
      setError('DeviceMotion not supported on this device.');
      return;
    }
    // iOS Safari permission gate
    const requestPermission = (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    if (typeof requestPermission === 'function') {
      try {
        const result = await requestPermission.call(DeviceMotionEvent);
        if (result !== 'granted') {
          setError('Motion permission denied.');
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    samplesRef.current = [];
    lastSampleAtRef.current = 0;
    startedAtRef.current = performance.now();
    setSampleCount(0);
    setEffectiveHz(0);

    window.addEventListener('devicemotion', onMotion as EventListener);
    recordingRef.current = true;
    setRecording(true);
    setStatus('Recording…');

    if (opts.autoStopSec) {
      autoStopTimerRef.current = setTimeout(() => {
        stopInternal('Auto-stop reached');
      }, opts.autoStopSec * 1000);
    }
  }, [onMotion, opts.autoStopSec, stopInternal]);

  const stop = useCallback((): Sample[] => {
    stopInternal('Manual stop');
    return samplesRef.current.slice();
  }, [stopInternal]);

  const reset = useCallback(() => {
    samplesRef.current = [];
    setSampleCount(0);
    setEffectiveHz(0);
    setStatus('Idle');
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        window.removeEventListener('devicemotion', onMotion as EventListener);
      }
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
    };
  }, [onMotion]);

  return {
    samples: samplesRef.current,
    recording,
    sampleCount,
    effectiveHz,
    status,
    error,
    start,
    stop,
    reset,
    latest,
  };
}
