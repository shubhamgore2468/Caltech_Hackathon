/** Clinical display names for doctor dashboard pillars */

export const CLINICAL_PILLARS = {
  kinematic_tremor: {
    id: 'kinematic_tremor',
    title: 'Kinematic Tremor',
    subtitle: 'Device-measured limb tremor (accelerometer, 4–6 Hz)',
    metrics: ['tremor_score', 'hand_tremor_hz', 'dominant_freq_hz'],
    primaryMetric: 'tremor_score',
    unit: 'ratio',
  },
  vocal_tremor: {
    id: 'vocal_tremor',
    title: 'Vocal Tremor Burden',
    subtitle: 'Speech-derived tremor markers (jitter & shimmer)',
    metrics: ['jitter_pct', 'shimmer_pct'],
    primaryMetric: 'jitter_pct',
    unit: '%',
  },
  resting_hr: {
    id: 'resting_hr',
    title: 'Resting Heart Rate',
    subtitle: 'Wearable-derived autonomic signal',
    metrics: ['resting_hr'],
    primaryMetric: 'resting_hr',
    unit: 'bpm',
  },
  checkin_summary: {
    id: 'checkin_summary',
    title: 'Weekly Check-in Summary',
    subtitle: 'AI-assisted conversation & patient-reported context',
    metrics: [],
    primaryMetric: null,
    unit: null,
  },
} as const;

export type ClinicalPillarId = keyof typeof CLINICAL_PILLARS;

export const METRIC_LABELS: Record<string, { label: string; unit: string }> = {
  tremor_score: { label: 'Tremor band power', unit: 'ratio' },
  hand_tremor_hz: { label: 'Peak tremor frequency', unit: 'Hz' },
  dominant_freq_hz: { label: 'Dominant frequency', unit: 'Hz' },
  jitter_pct: { label: 'Jitter', unit: '%' },
  shimmer_pct: { label: 'Shimmer', unit: '%' },
  resting_hr: { label: 'Resting HR', unit: 'bpm' },
};

export function formatMetricValue(name: string, value: number): string {
  if (name === 'tremor_score') return value.toFixed(3);
  if (name.includes('hz') || name.includes('_hr')) return value.toFixed(1);
  return value.toFixed(2);
}

export function trendLabel(current: number, prior: number | null, higherIsWorse = true): string {
  if (prior === null) return 'No prior week';
  const delta = current - prior;
  if (Math.abs(delta) < 0.01) return 'Stable vs last week';
  const worsening = higherIsWorse ? delta > 0 : delta < 0;
  return worsening ? '↑ vs last week' : '↓ vs last week';
}
