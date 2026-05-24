import { NextResponse } from 'next/server';
import { z } from 'zod';
import { extractMotionBiomarkers, type MotionMode } from '@/lib/biomarkers/motion';
import type { Biomarker, Sample } from '@/lib/types';

const SampleSchema = z.object({
  t: z.number(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

const BodySchema = z.object({
  mode: z.enum(['walk_test', 'hand_tremor']),
  samples: z.array(SampleSchema).min(16).max(50_000),
});

// FastAPI sidecar contract (spectral-subtraction tremor algo):
//   POST {MOTION_SVC_URL}/analyze
//   body: { patient_data: [{t,x,y,z},...], calibration_data?: [{t,x,y,z},...] }
//   200 -> {
//     duration_seconds: number,
//     windows_analyzed: number,
//     metrics_pd_ratio: { mean, ci_lower, ci_upper },   // 3-6Hz / 1-15Hz band power
//     metrics_et_ratio: { mean, ci_lower, ci_upper }    // 4-12Hz / 1-15Hz band power
//   }
//   Sidecar falls back to bundled IMUTable.json calibration when calibration_data omitted.
//   1.96-z 95% CI across sliding 2s STFT windows w/ 90% overlap.
//
// If MOTION_SVC_URL is unset, fall back to local TS implementation (legacy tremor_score etc.).

interface FastApiCI {
  mean: number;
  ci_lower: number;
  ci_upper: number;
}

interface FastApiResponse {
  duration_seconds: number;
  windows_analyzed: number;
  metrics_pd_ratio: FastApiCI;
  metrics_et_ratio: FastApiCI;
}

function fastApiToBiomarkers(r: FastApiResponse): Biomarker[] {
  const raw = {
    windows_analyzed: r.windows_analyzed,
    duration_seconds: r.duration_seconds,
  };
  return [
    { category: 'motion', metric_name: 'pd_ratio_mean', value: r.metrics_pd_ratio.mean, unit: 'ratio', raw_blob: raw },
    { category: 'motion', metric_name: 'pd_ratio_ci_lower', value: r.metrics_pd_ratio.ci_lower, unit: 'ratio' },
    { category: 'motion', metric_name: 'pd_ratio_ci_upper', value: r.metrics_pd_ratio.ci_upper, unit: 'ratio' },
    { category: 'motion', metric_name: 'et_ratio_mean', value: r.metrics_et_ratio.mean, unit: 'ratio', raw_blob: raw },
    { category: 'motion', metric_name: 'et_ratio_ci_lower', value: r.metrics_et_ratio.ci_lower, unit: 'ratio' },
    { category: 'motion', metric_name: 'et_ratio_ci_upper', value: r.metrics_et_ratio.ci_upper, unit: 'ratio' },
  ];
}

async function runAlgorithm(
  samples: Sample[],
  mode: MotionMode,
): Promise<{ biomarkers: Biomarker[]; backend: 'fastapi' | 'local'; extra?: unknown }> {
  const svc = process.env.MOTION_SVC_URL;
  if (svc) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(`${svc.replace(/\/$/, '')}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_data: samples }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`fastapi ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as FastApiResponse;
      if (!json?.metrics_pd_ratio || !json?.metrics_et_ratio) {
        throw new Error('fastapi response missing metrics_{pd,et}_ratio');
      }
      return {
        biomarkers: fastApiToBiomarkers(json),
        backend: 'fastapi',
        extra: json,
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return { biomarkers: extractMotionBiomarkers(samples, mode), backend: 'local' };
}

export async function POST(req: Request) {
  const t0 = performance.now();
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  const { samples, mode } = parsed.data;

  try {
    const { biomarkers, backend, extra } = await runAlgorithm(samples, mode);
    const elapsedMs = Math.round(performance.now() - t0);
    return NextResponse.json({
      mode,
      sample_count: samples.length,
      elapsed_ms: elapsedMs,
      backend,
      biomarkers,
      extra,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
