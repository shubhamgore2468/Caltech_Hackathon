import { createServerClient } from '@/lib/supabase/server';

export interface BaselineStats {
  mean: number;
  stddev: number;
  count: number;
}

export async function computeBaseline(
  patientId: string,
  metricName: string,
  windowDays = 30
): Promise<BaselineStats> {
  const supabase = createServerClient();
  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  const { data, error } = await supabase
    .from('biomarkers')
    .select('value')
    .eq('patient_id', patientId)
    .eq('metric_name', metricName)
    .gte('recorded_at', since.toISOString())
    .order('recorded_at', { ascending: false });

  if (error || !data?.length) {
    return { mean: 0, stddev: 1, count: 0 };
  }

  const values = data.map((r) => r.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance) || 1;

  return { mean, stddev, count: values.length };
}

export async function checkAndCreateAlert(
  patientId: string,
  sessionId: string,
  metricName: string,
  currentValue: number,
  windowDays = 30
): Promise<{ flagged: boolean; stdDeviations: number }> {
  const ref = await computeBaseline(patientId, metricName, windowDays);
  if (ref.count < 3) return { flagged: false, stdDeviations: 0 };

  const stdDeviations = (currentValue - ref.mean) / ref.stddev;
  const absDev = Math.abs(stdDeviations);

  if (absDev <= 2) return { flagged: false, stdDeviations };

  const severity = absDev > 3 ? 'critical' : 'warn';
  const direction = stdDeviations > 0 ? 'above' : 'below';

  const supabase = createServerClient();
  await supabase.from('alerts').insert({
    patient_id: patientId,
    session_id: sessionId,
    metric_name: metricName,
    severity,
    message: `${metricName} is ${absDev.toFixed(1)}σ ${direction} 30-day baseline`,
    baseline_value: ref.mean,
    current_value: currentValue,
    std_deviations: stdDeviations,
  });

  return { flagged: true, stdDeviations };
}
