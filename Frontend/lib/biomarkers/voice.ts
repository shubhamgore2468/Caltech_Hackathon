import type { Biomarker } from '@/lib/types';

// MOCKED voice biomarkers.
// INTEGRATION POINT: replace body w/ real DSP. Future plan:
//   - Python FastAPI sidecar service running librosa + parselmouth (Praat wrapper)
//   - Compute jitter (5 variants), shimmer (6 variants), HNR, NHR, DFA, PPE, spread1/2, D2, RPDE
//   - sklearn SVM/RF model trained on UCI Max Little dataset returns parkinsons_voice_ml_score
//   - This function POSTs PCM to that service and returns the feature vector + ML score.
// Signature stays stable so swap-in is local.

interface MockOpts {
  // Optional seed for deterministic outputs (use patient_id hash or session start time)
  seed?: number;
  // If you want to bias values toward "concerning" range (for demo session at end of seed curve)
  severityBias?: number; // 0 = healthy, 1 = severe
}

// Mulberry32 PRNG
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jitter(rand: () => number, severity: number): number {
  // Healthy: ~0.5%, mild PD: ~1.0%, severe: ~2.0%
  const base = 0.005 + severity * 0.015;
  return base + (rand() - 0.5) * 0.003;
}

function shimmer(rand: () => number, severity: number): number {
  // Healthy: ~3%, severe: ~12%
  const base = 0.03 + severity * 0.09;
  return base + (rand() - 0.5) * 0.015;
}

function hnr(rand: () => number, severity: number): number {
  // Harmonic-to-noise ratio in dB. Healthy: ~22dB. Severe: ~10dB.
  const base = 22 - severity * 12;
  return base + (rand() - 0.5) * 3;
}

function speechRate(rand: () => number, severity: number): number {
  // Words/min. Healthy: 160. Slower w/ severity: 100.
  const base = 160 - severity * 60;
  return base + (rand() - 0.5) * 20;
}

function pitchVariability(rand: () => number, severity: number): number {
  // Stddev of f0 in semitones. Monotone in PD: lower variance.
  // Healthy: ~2.5 semitones. Severe: ~0.8.
  const base = 2.5 - severity * 1.7;
  return Math.max(0.2, base + (rand() - 0.5) * 0.4);
}

function pauseRatio(rand: () => number, severity: number): number {
  // Fraction of audio that is silence. Healthy: 0.15. Severe: 0.35.
  const base = 0.15 + severity * 0.2;
  return Math.max(0, base + (rand() - 0.5) * 0.05);
}

// Input PCM is currently ignored — mock. Sample rate used only to log a sensible duration.
export function extractVoiceBiomarkers(
  pcm: Float32Array,
  sampleRate: number,
  opts: MockOpts = {},
): Biomarker[] {
  // INTEGRATION POINT: replace this whole body w/ real DSP / Python sidecar call.
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const severity = Math.max(0, Math.min(1, opts.severityBias ?? 0.2));
  const rand = mulberry32(seed);
  const durationSec = pcm.length / Math.max(1, sampleRate);

  return [
    { category: 'voice', metric_name: 'jitter', value: round(jitter(rand, severity)), unit: 'ratio' },
    { category: 'voice', metric_name: 'shimmer', value: round(shimmer(rand, severity)), unit: 'ratio' },
    { category: 'voice', metric_name: 'hnr', value: round(hnr(rand, severity)), unit: 'db' },
    { category: 'voice', metric_name: 'speech_rate', value: round(speechRate(rand, severity)), unit: 'wpm' },
    { category: 'voice', metric_name: 'pitch_variability', value: round(pitchVariability(rand, severity)), unit: 'semitones' },
    { category: 'voice', metric_name: 'pause_ratio', value: round(pauseRatio(rand, severity)), unit: 'ratio' },
    {
      category: 'voice',
      metric_name: 'analysis_duration',
      value: round(durationSec),
      unit: 's',
      raw_blob: { mock: true, severity_bias: severity },
    },
  ];
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
