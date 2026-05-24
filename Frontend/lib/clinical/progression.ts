// Theil-Sen slope + Stouffer's combined Z progression analysis.
// TS port of the Python reference in the team handoff.

export interface ProgressionPoint {
  date_time: string; // ISO
  value: number;
  std: number;
  routine_deviation: boolean;
}

export interface MetricConfig {
  // direction: +1 = higher is worse, -1 = higher is better.
  direction: 1 | -1;
  label: string;
}

export interface MetricResult {
  actual: number;
  expected: number;
  trend_slope: number;
  lower_bound_95: number;
  upper_bound_95: number;
  z_score: number;
  adjusted_z: number;
  status: 'Worse' | 'Better' | 'Stable';
  is_significant: boolean;
}

export interface OverallResult {
  combined_z_score: number;
  status: 'Stable / Expected Progression' | 'SIGNIFICANT OVERALL WORSENING' | 'SIGNIFICANT OVERALL IMPROVEMENT';
  k: number;
}

export interface ProgressionResponse {
  ok: boolean;
  reason?: string;
  individual_metrics: Record<string, MetricResult>;
  overall: OverallResult | null;
  history_count: number;
}

// Theil-Sen median slope. O(n^2). Fine for n<200.
function theilSenSlope(x: number[], y: number[]): { slope: number; intercept: number } {
  const n = x.length;
  const slopes: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = x[j] - x[i];
      if (dx === 0) continue;
      slopes.push((y[j] - y[i]) / dx);
    }
  }
  slopes.sort((a, b) => a - b);
  const slope = slopes.length === 0 ? 0 : slopes[Math.floor(slopes.length / 2)];

  // Intercept = median(y_i - slope * x_i)
  const intercepts = x.map((xi, i) => y[i] - slope * xi).sort((a, b) => a - b);
  const intercept = intercepts[Math.floor(intercepts.length / 2)];

  return { slope, intercept };
}

// Inverse CDF of student's t at p w/ df. Approximation good enough for df>=3.
// Falls back to z = 1.96 for high df.
function studentTInv975(df: number): number {
  if (df < 1) return 12.706;
  // Hill 1970 approximation for two-sided 95%.
  const table: Record<number, number> = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    15: 2.131, 20: 2.086, 30: 2.042, 50: 2.009, 100: 1.984,
  };
  if (table[df]) return table[df];
  // pick nearest below
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  let last = 12.706;
  for (const k of keys) {
    if (k <= df) last = table[k];
    else break;
  }
  return df >= 100 ? 1.96 : last;
}

export function analyzeProgression(
  history: Record<string, ProgressionPoint[]>,
  current: Record<string, ProgressionPoint>,
  configs: Record<string, MetricConfig>,
): ProgressionResponse {
  const individual: Record<string, MetricResult> = {};
  const directionalZ: number[] = [];

  const metricsWithEnoughHistory: string[] = [];

  for (const [metric, cfg] of Object.entries(configs)) {
    const points = (history[metric] ?? []).filter((p) => !p.routine_deviation);
    if (points.length < 3) continue;

    const newPoint = current[metric];
    if (!newPoint) continue;

    const t0 = Math.min(...points.map((p) => +new Date(p.date_time)));
    const x = points.map((p) => (+new Date(p.date_time) - t0) / (1000 * 60 * 60 * 24));
    const y = points.map((p) => p.value);
    const newX = (+new Date(newPoint.date_time) - t0) / (1000 * 60 * 60 * 24);
    const newY = newPoint.value;
    const newStd = newPoint.std ?? 0;

    const n = x.length;
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const sumSqX = x.reduce((acc, xi) => acc + (xi - meanX) ** 2, 0);

    const { slope, intercept } = theilSenSlope(x, y);
    const expectedY = intercept + slope * newX;

    // Residual SE on history
    const residuals = x.map((xi, i) => y[i] - (intercept + slope * xi));
    const ssr = residuals.reduce((acc, r) => acc + r * r, 0);
    const se = n > 2 ? Math.sqrt(ssr / (n - 2)) : 0;
    const seForecast = se * Math.sqrt(1 + 1 / n + (sumSqX > 0 ? (newX - meanX) ** 2 / sumSqX : 0));
    const totalSe = Math.max(Math.sqrt(seForecast ** 2 + newStd ** 2), 1e-9);

    const tCrit = studentTInv975(n - 2);
    const margin = tCrit * totalSe;
    const lower = expectedY - margin;
    const upper = expectedY + margin;

    const z = (newY - expectedY) / totalSe;
    const adjZ = z * cfg.direction;
    directionalZ.push(adjZ);
    metricsWithEnoughHistory.push(metric);

    const isSig = Math.abs(z) > tCrit;
    const status: MetricResult['status'] = isSig ? (adjZ > 0 ? 'Worse' : 'Better') : 'Stable';

    individual[metric] = {
      actual: newY,
      expected: expectedY,
      trend_slope: slope,
      lower_bound_95: lower,
      upper_bound_95: upper,
      z_score: z,
      adjusted_z: adjZ,
      status,
      is_significant: isSig,
    };
  }

  if (directionalZ.length === 0) {
    return {
      ok: false,
      reason: 'Not enough historical data (need ≥3 prior sessions per metric).',
      individual_metrics: {},
      overall: null,
      history_count: 0,
    };
  }

  const k = directionalZ.length;
  const combinedZ = directionalZ.reduce((a, b) => a + b, 0) / Math.sqrt(k);
  const overallStatus: OverallResult['status'] =
    combinedZ > 1.96
      ? 'SIGNIFICANT OVERALL WORSENING'
      : combinedZ < -1.96
        ? 'SIGNIFICANT OVERALL IMPROVEMENT'
        : 'Stable / Expected Progression';

  return {
    ok: true,
    individual_metrics: individual,
    overall: { combined_z_score: combinedZ, status: overallStatus, k },
    history_count: metricsWithEnoughHistory.length,
  };
}
