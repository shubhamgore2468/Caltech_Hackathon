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

interface ErrCause {
  code?: string;
  errno?: string;
  syscall?: string;
  hostname?: string;
  address?: string;
  port?: number;
}

function describeError(e: unknown) {
  if (!(e instanceof Error)) return { message: String(e) };
  const cause = (e as { cause?: ErrCause }).cause ?? {};
  return {
    name: e.name,
    message: e.message,
    code: cause.code,
    errno: cause.errno,
    syscall: cause.syscall,
    hostname: cause.hostname,
    address: cause.address,
    port: cause.port,
  };
}

async function runAlgorithm(
  samples: Sample[],
  mode: MotionMode,
): Promise<{ biomarkers: Biomarker[]; backend: 'fastapi' | 'local'; extra?: unknown; upstreamError?: unknown }> {
  const svc = process.env.MOTION_SVC_URL;
  console.log('[motion/analyze] svc_set=%s mode=%s samples=%d', Boolean(svc), mode, samples.length);
  if (svc) {
    const base = /^https?:\/\//i.test(svc) ? svc : `https://${svc}`;
    const target = `${base.replace(/\/$/, '')}/analyze`;
    const ctrl = new AbortController();
    const t0 = Date.now();
    const timer = setTimeout(() => {
      console.warn('[motion/analyze] abort after 15s target=%s', target);
      ctrl.abort();
    }, 15_000);
    try {
      console.log('[motion/analyze] fetch target=%s', target);
      const res = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_data: samples }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        console.error('[motion/analyze] upstream status=%d body=%s', res.status, text.slice(0, 500));
        throw new Error(`fastapi ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as FastApiResponse;
      if (!json?.metrics_pd_ratio || !json?.metrics_et_ratio) {
        console.error('[motion/analyze] bad response shape %o', json);
        throw new Error('fastapi response missing metrics_{pd,et}_ratio');
      }
      console.log('[motion/analyze] fastapi ok elapsed_ms=%d windows=%d', Date.now() - t0, json.windows_analyzed);
      return {
        biomarkers: fastApiToBiomarkers(json),
        backend: 'fastapi',
        extra: json,
      };
    } catch (e) {
      const info = describeError(e);
      console.error('[motion/analyze] fastapi failed target=%s elapsed_ms=%d %o', target, Date.now() - t0, info);
      throw Object.assign(new Error('motion fastapi failed'), { detail: info, target });
    } finally {
      clearTimeout(timer);
    }
  }
  console.log('[motion/analyze] using local TS fallback');
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
    const detail = (e as { detail?: unknown }).detail;
    const target = (e as { target?: string }).target;
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : String(e),
        detail,
        target,
      },
      { status: 502 },
    );
  }
}
