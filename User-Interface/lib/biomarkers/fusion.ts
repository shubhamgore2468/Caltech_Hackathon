import type { BiomarkerInput, ContributingFactors } from '@/lib/types';

/** Reference population means (Max Little 2007 / mPower-inspired healthy controls). */
export const REFERENCE_MEANS: Record<string, { mean: number; std: number; higherIsWorse: boolean }> = {
  jitter_pct: { mean: 0.75, std: 0.2, higherIsWorse: true },
  shimmer_pct: { mean: 3.0, std: 0.8, higherIsWorse: true },
  hnr_db: { mean: 22, std: 3, higherIsWorse: false },
  speech_rate_wpm: { mean: 160, std: 20, higherIsWorse: false },
  blink_rate_per_min: { mean: 17, std: 3, higherIsWorse: false },
  facial_affect_displacement: { mean: 0.85, std: 0.1, higherIsWorse: false },
  tremor_score: { mean: 0.05, std: 0.03, higherIsWorse: true },
  hand_tremor_hz: { mean: 0, std: 1, higherIsWorse: true },
  gait_variance: { mean: 0.02, std: 0.01, higherIsWorse: true },
  rms_acceleration: { mean: 9.8, std: 1.5, higherIsWorse: false },
  word_recall_score: { mean: 9, std: 1, higherIsWorse: false },
  hrv_rmssd: { mean: 50, std: 10, higherIsWorse: false },
  sleep_quality: { mean: 85, std: 8, higherIsWorse: false },
};

const CATEGORY_WEIGHTS = {
  voice: 0.3,
  motion: 0.35,
  camera: 0.15,
  cognitive: 0.15,
  wearable: 0.05,
} as const;

function zScore(value: number, mean: number, std: number, higherIsWorse: boolean): number {
  const z = (value - mean) / (std || 1);
  return higherIsWorse ? z : -z;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export interface FusionResult {
  parkinsons_score: number;
  dementia_score: number;
  contributing_factors: ContributingFactors;
}

/**
 * Heuristic weighted risk fusion, z-scored vs reference means.
 * INTEGRATION POINT: replace with trained model post-hackathon.
 */
export function fuseRiskScores(biomarkers: BiomarkerInput[]): FusionResult {
  const byCategory: Record<string, Record<string, number>> = {};
  const zByMetric: Record<string, number> = {};

  for (const b of biomarkers) {
    if (!byCategory[b.category]) byCategory[b.category] = {};
    byCategory[b.category][b.metric_name] = b.value;

    const ref = REFERENCE_MEANS[b.metric_name];
    if (ref) {
      zByMetric[b.metric_name] = zScore(b.value, ref.mean, ref.std, ref.higherIsWorse);
    }
  }

  const categoryZ: Record<string, number> = {};
  for (const [category, metrics] of Object.entries(byCategory)) {
    const zs = Object.entries(metrics)
      .map(([name, val]) => {
        const ref = REFERENCE_MEANS[name];
        return ref ? zScore(val, ref.mean, ref.std, ref.higherIsWorse) : 0;
      })
      .filter((z) => !Number.isNaN(z));
    categoryZ[category] = zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : 0;
  }

  const motorMetrics = ['tremor_score', 'gait_variance', 'hand_tremor_hz', 'rms_acceleration'];
  const voiceMetrics = ['jitter_pct', 'shimmer_pct', 'hnr_db', 'speech_rate_wpm'];
  const cognitiveMetrics = ['word_recall_score'];

  const motorZ =
    motorMetrics
      .filter((m) => zByMetric[m] !== undefined)
      .reduce((s, m) => s + zByMetric[m], 0) /
    Math.max(motorMetrics.filter((m) => zByMetric[m] !== undefined).length, 1);

  const voiceZ =
    voiceMetrics
      .filter((m) => zByMetric[m] !== undefined)
      .reduce((s, m) => s + zByMetric[m], 0) /
    Math.max(voiceMetrics.filter((m) => zByMetric[m] !== undefined).length, 1);

  const cognitiveZ =
    cognitiveMetrics
      .filter((m) => zByMetric[m] !== undefined)
      .reduce((s, m) => s + zByMetric[m], 0) /
    Math.max(cognitiveMetrics.filter((m) => zByMetric[m] !== undefined).length, 1);

  const cameraZ = categoryZ.camera ?? 0;
  const wearableZ = categoryZ.wearable ?? 0;

  const pdComposite =
    motorZ * 0.4 + voiceZ * 0.35 + cameraZ * 0.15 + wearableZ * 0.1;
  const dementiaComposite =
    cognitiveZ * 0.4 + voiceZ * 0.25 + cameraZ * 0.2 + wearableZ * 0.15;

  return {
    parkinsons_score: Math.min(1, Math.max(0, sigmoid(pdComposite - 0.5))),
    dementia_score: Math.min(1, Math.max(0, sigmoid(dementiaComposite - 0.5))),
    contributing_factors: {
      voice: byCategory.voice,
      camera: byCategory.camera,
      motion: byCategory.motion,
      cognitive: byCategory.cognitive,
      wearable: byCategory.wearable,
      weights: { ...CATEGORY_WEIGHTS },
    },
  };
}
