import type { CameraBiomarkers } from '@/lib/types';

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export interface CameraExtractOptions {
  durationSec: number;
  patientId?: string;
  sessionId?: string;
}

/**
 * Mock camera biomarker extraction.
 * INTEGRATION POINT: replace mock with real DSP (MediaPipe landmarks + blink/affect analysis).
 */
export function extractCameraBiomarkers(options: CameraExtractOptions): CameraBiomarkers {
  const seed = hashString(`cam:${options.patientId ?? 'demo'}:${options.sessionId ?? ''}:${Math.floor(options.durationSec)}`);
  const rand = seededRandom(seed);

  return {
    blink_rate_per_min: 12 + rand() * 13,
    facial_affect_displacement: 0.3 + rand() * 0.7,
  };
}

export function cameraBiomarkersToRows(
  biomarkers: CameraBiomarkers
): Array<{ metric_name: string; value: number; unit: string }> {
  return [
    { metric_name: 'blink_rate_per_min', value: biomarkers.blink_rate_per_min, unit: '/min' },
    {
      metric_name: 'facial_affect_displacement',
      value: biomarkers.facial_affect_displacement,
      unit: 'norm',
    },
  ];
}
