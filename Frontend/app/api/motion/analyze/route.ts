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

// FastAPI sidecar contract:
//   POST {MOTION_SVC_URL}/analyze
//   body: { mode: 'walk_test' | 'hand_tremor', samples: [{t,x,y,z}, ...] }
//   200 -> { biomarkers: Biomarker[], extra?: Record<string, unknown> }
//   Biomarker shape: { category: 'motion', metric_name: string, value: number, unit?: string, raw_blob?: object }
//
// If MOTION_SVC_URL is unset, fall back to local TS implementation.
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
        body: JSON.stringify({ mode, samples }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`fastapi ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as { biomarkers?: Biomarker[]; extra?: unknown };
      if (!Array.isArray(json.biomarkers)) {
        throw new Error('fastapi response missing biomarkers[]');
      }
      return { biomarkers: json.biomarkers, backend: 'fastapi', extra: json.extra };
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
