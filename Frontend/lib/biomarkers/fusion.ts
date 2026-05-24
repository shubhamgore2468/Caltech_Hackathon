// Risk fusion: weighted z-score across biomarker categories → [0,1] per disease.
// Weights per CLAUDE.md. Reference means/stds from Max Little / mPower priors (rough).
// INTEGRATION POINT: replace heuristic with trained model (e.g., logistic regression on UCI Parkinson's dataset).

import type { Biomarker, CognitiveFlags, RiskScore } from '@/lib/types';

type Direction = 1 | -1; // 1 = higher value worsens risk, -1 = lower value worsens
interface Ref {
  mean: number;
  std: number;
  dir: Direction;
}

// metric_name → reference. Disease-specific direction handled below where needed.
const REF: Record<string, Ref> = {
  // voice — legacy mock names (kept for fallback)
  jitter_percent: { mean: 0.6, std: 0.4, dir: 1 },
  shimmer_percent: { mean: 4.0, std: 2.0, dir: 1 },
  hnr_db: { mean: 20, std: 4, dir: -1 },
  pitch_std_hz: { mean: 30, std: 12, dir: -1 }, // monotone speech = lower std
  speech_rate_sps: { mean: 4.0, std: 0.8, dir: -1 },
  pause_ratio: { mean: 0.15, std: 0.06, dir: 1 },
  // voice — real sidecar/Praat names actually persisted by /api/voice/turn
  jitter_local_pct: { mean: 0.6, std: 0.4, dir: 1 },
  shimmer_local_pct: { mean: 4.0, std: 2.0, dir: 1 },
  mean_pitch_hz: { mean: 165, std: 35, dir: -1 }, // lower mean pitch + reduced range = monotone
  pd_probability: { mean: 0.3, std: 0.2, dir: 1 }, // sidecar classifier output
  // motion
  tremor_score: { mean: 0.05, std: 0.05, dir: 1 },
  hand_tremor_hz: { mean: 0, std: 1, dir: 1 }, // 0 at rest; nonzero = tremor
  gait_variance: { mean: 0.05, std: 0.05, dir: 1 },
  // motion — spectral-subtraction sidecar (3-6Hz PD band / total)
  pd_ratio_mean: { mean: 0.15, std: 0.1, dir: 1 },
  et_ratio_mean: { mean: 0.35, std: 0.12, dir: 1 }, // 4-12Hz; not PD-specific but tremor-band
  // camera
  facial_tremor: { mean: 0.02, std: 0.02, dir: 1 },
  blink_rate_per_min: { mean: 17, std: 5, dir: -1 }, // lower in PD
  hypomimia_proxy: { mean: 0.5, std: 0.2, dir: -1 }, // lower expressivity = worse
  // camera — real sidecar (MediaPipe face landmarker) names
  expressivity_cv_pct: { mean: 12, std: 5, dir: -1 }, // lower CV = hypomimia
  total_blinks: { mean: 17, std: 7, dir: -1 }, // raw count over ~60s window
  // wearable
  hrv_ms: { mean: 45, std: 15, dir: -1 },
  sleep_quality: { mean: 0.75, std: 0.15, dir: -1 },
  steps_per_day: { mean: 6500, std: 2500, dir: -1 },
  // conversation (from CognitiveFlags)
  word_recall_errors: { mean: 0.5, std: 0.7, dir: 1 },
  // Measured client-side as user-finish → assistant-response, includes Deepgram STT +
  // Claude + Deepgram TTS roundtrip (~5-10s baseline). Real cognitive slowing adds on top.
  response_latency_ms: { mean: 7000, std: 2500, dir: 1 },
  // Unique content words per user turn in unstructured speech. Lower = worse.
  // (Original mean=16 was for animal-fluency probe; we use spontaneous speech.)
  fluency_count: { mean: 10, std: 4, dir: -1 },
};

const CATEGORY_WEIGHTS = {
  parkinsons: { voice: 0.4, motion: 0.3, camera: 0.2, wearable: 0.1, conversation: 0.0 },
  // Dementia: cognitive flags dominate. Camera (hypomimia/blink) added as distinct signal
  // so dem curve doesn't mirror PD when voice is the only present input.
  dementia: { conversation: 0.4, voice: 0.2, camera: 0.2, wearable: 0.15, motion: 0.05 },
} as const;

// Which metrics contribute to which disease (subset of REF keys per category).
const PD_METRICS = {
  voice: [
    'jitter_percent', 'shimmer_percent', 'pitch_std_hz', // legacy mock names
    'jitter_local_pct', 'shimmer_local_pct', 'hnr_db', 'pd_probability', // real sidecar names
  ],
  motion: ['tremor_score', 'hand_tremor_hz', 'pd_ratio_mean'],
  camera: ['facial_tremor', 'blink_rate_per_min', 'hypomimia_proxy', 'expressivity_cv_pct'],
  wearable: ['hrv_ms', 'sleep_quality'],
} as const;

const DEM_METRICS = {
  conversation: ['word_recall_errors', 'response_latency_ms', 'fluency_count'],
  // Voice quality degradation correlates w/ cognitive decline. Use whatever voice metrics
  // are present — legacy mock OR real Praat output. categoryZ averages only present ones.
  voice: [
    'speech_rate_sps', 'pause_ratio', // legacy mock
    'mean_pitch_hz', // monotone speech — cognitive-load proxy, distinct from PD jitter
  ],
  // Hypomimia + reduced blink also implicated in DLB / late dementia. Distinct from PD
  // signal because we weight expressivity here, not facial tremor.
  camera: ['expressivity_cv_pct', 'blink_rate_per_min', 'hypomimia_proxy'],
  wearable: ['sleep_quality', 'hrv_ms'],
  motion: ['gait_variance'],
} as const;

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function zScore(value: number, ref: Ref): number {
  // Returns risk-direction z: positive = worse.
  const raw = (value - ref.mean) / (ref.std || 1);
  return raw * ref.dir;
}

function categoryZ(metrics: readonly string[], byName: Map<string, number>): { z: number; used: Record<string, number> } {
  const used: Record<string, number> = {};
  let sum = 0;
  let n = 0;
  for (const m of metrics) {
    const v = byName.get(m);
    const ref = REF[m];
    if (v == null || !ref) continue;
    const z = zScore(v, ref);
    used[m] = z;
    sum += z;
    n += 1;
  }
  return { z: n > 0 ? sum / n : 0, used };
}

export interface FusionInput {
  biomarkers: Biomarker[];
  cognitive?: CognitiveFlags | null;
}

export function fuseRiskScores(biomarkers: Biomarker[], cognitive?: CognitiveFlags | null): RiskScore {
  return computeRiskScore({ biomarkers, cognitive });
}

export function computeRiskScore({ biomarkers, cognitive }: FusionInput): RiskScore {
  // Flatten biomarkers + cognitive into a name→value map.
  const byName = new Map<string, number>();
  for (const b of biomarkers) byName.set(b.metric_name, b.value);
  if (cognitive) {
    if (cognitive.word_recall_errors != null) byName.set('word_recall_errors', cognitive.word_recall_errors);
    if (cognitive.response_latency_ms != null) byName.set('response_latency_ms', cognitive.response_latency_ms);
    if (cognitive.fluency_count != null) byName.set('fluency_count', cognitive.fluency_count);
  }

  const contributing: Record<string, number> = {};

  // Parkinson's
  let pdAgg = 0;
  for (const [cat, metrics] of Object.entries(PD_METRICS) as [keyof typeof PD_METRICS, readonly string[]][]) {
    const { z, used } = categoryZ(metrics, byName);
    const w = CATEGORY_WEIGHTS.parkinsons[cat];
    pdAgg += w * z;
    for (const [m, mz] of Object.entries(used)) contributing[`pd_${m}`] = +mz.toFixed(3);
  }

  // Dementia
  let demAgg = 0;
  for (const [cat, metrics] of Object.entries(DEM_METRICS) as [keyof typeof DEM_METRICS, readonly string[]][]) {
    const { z, used } = categoryZ(metrics, byName);
    const w = CATEGORY_WEIGHTS.dementia[cat as keyof typeof CATEGORY_WEIGHTS.dementia] ?? 0;
    demAgg += w * z;
    for (const [m, mz] of Object.entries(used)) contributing[`dem_${m}`] = +mz.toFixed(3);
  }

  // Squash to [0,1]. Scale factor tuned so z=2 (~2σ deviation) → ~0.88.
  const SCALE = 1.0;
  return {
    parkinsons_score: +sigmoid(SCALE * pdAgg).toFixed(4),
    dementia_score: +sigmoid(SCALE * demAgg).toFixed(4),
    contributing_factors: contributing,
  };
}
