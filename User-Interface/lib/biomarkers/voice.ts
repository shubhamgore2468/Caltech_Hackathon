import type { VoiceBiomarkers } from '@/lib/types';

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

export interface VoiceExtractOptions {
  durationSec: number;
  patientId?: string;
  sessionId?: string;
}

/**
 * Mock voice biomarker extraction.
 * INTEGRATION POINT: replace mock with real DSP (WebAudio jitter/shimmer/HNR pipeline).
 */
export function extractVoiceBiomarkers(options: VoiceExtractOptions): VoiceBiomarkers {
  const seed = hashString(`${options.patientId ?? 'demo'}:${options.sessionId ?? ''}:${Math.floor(options.durationSec)}`);
  const rand = seededRandom(seed);

  const durationFactor = Math.min(options.durationSec / 60, 1);

  return {
    jitter_pct: 0.5 + rand() * 1.5 + durationFactor * 0.3,
    shimmer_pct: 3 + rand() * 9,
    hnr_db: 12 + rand() * 13,
    speech_rate_wpm: 100 + rand() * 80,
  };
}

export function voiceBiomarkersToRows(
  biomarkers: VoiceBiomarkers
): Array<{ metric_name: string; value: number; unit: string }> {
  return [
    { metric_name: 'jitter_pct', value: biomarkers.jitter_pct, unit: '%' },
    { metric_name: 'shimmer_pct', value: biomarkers.shimmer_pct, unit: '%' },
    { metric_name: 'hnr_db', value: biomarkers.hnr_db, unit: 'dB' },
    { metric_name: 'speech_rate_wpm', value: biomarkers.speech_rate_wpm, unit: 'wpm' },
  ];
}
