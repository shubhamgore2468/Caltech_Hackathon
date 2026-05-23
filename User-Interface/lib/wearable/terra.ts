import type { BiomarkerInput } from '@/lib/types';

export interface TerraWearableData {
  steps: number;
  hrv_rmssd: number;
  sleep_quality: number;
  rem_minutes: number;
  resting_hr: number;
  recorded_at: string;
}

/**
 * Mock Terra wearable client.
 * INTEGRATION POINT: real Terra OAuth + webhook sync.
 */
export async function fetchWearableData(patientId: string): Promise<TerraWearableData> {
  void patientId; // INTEGRATION POINT: pass to Terra OAuth
  return {
    steps: 4200 + Math.floor(Math.random() * 3000),
    hrv_rmssd: 25 + Math.random() * 30,
    sleep_quality: 55 + Math.random() * 35,
    rem_minutes: 60 + Math.floor(Math.random() * 60),
    resting_hr: 62 + Math.floor(Math.random() * 15),
    recorded_at: new Date().toISOString(),
  };
}

export function wearableToBiomarkers(data: TerraWearableData): BiomarkerInput[] {
  return [
    { category: 'wearable', metric_name: 'steps', value: data.steps, unit: 'count' },
    { category: 'wearable', metric_name: 'hrv_rmssd', value: data.hrv_rmssd, unit: 'ms' },
    { category: 'wearable', metric_name: 'sleep_quality', value: data.sleep_quality, unit: 'score' },
    { category: 'wearable', metric_name: 'rem_minutes', value: data.rem_minutes, unit: 'min' },
    { category: 'wearable', metric_name: 'resting_hr', value: data.resting_hr, unit: 'bpm' },
  ];
}
