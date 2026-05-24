'use client';

import { format } from 'date-fns';
import { METRIC_LABELS, formatMetricValue } from '@/lib/clinical/metric-definitions';
import type { ClinicalPillarSnapshot, CheckinSummarySnapshot } from '@/lib/clinical/dashboard';
import { CLINICAL_PILLARS } from '@/lib/clinical/metric-definitions';

interface ClinicalPillarCardProps {
  pillar: ClinicalPillarSnapshot;
}

export function ClinicalPillarCard({ pillar }: ClinicalPillarCardProps) {
  const def = CLINICAL_PILLARS[pillar.id];
  const primary = pillar.values.find((v) => v.name === def.primaryMetric) ?? pillar.values[0];
  const isWorsening = pillar.trend.startsWith('↑');

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{def.title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{def.subtitle}</p>
        </div>
        {primary && (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isWorsening ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            {pillar.trend}
          </span>
        )}
      </div>

      {primary ? (
        <p className="mt-3 font-mono text-2xl font-bold text-slate-900">
          {formatMetricValue(primary.name, primary.value)}
          <span className="ml-1 text-sm font-normal text-slate-500">{primary.unit}</span>
        </p>
      ) : (
        <p className="mt-3 text-sm text-slate-400">No data from latest check-in</p>
      )}

      {pillar.values.length > 1 && (
        <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3">
          {pillar.values
            .filter((v) => v.name !== primary?.name)
            .map((v) => (
              <div key={v.name} className="flex justify-between text-xs">
                <dt className="text-slate-500">{METRIC_LABELS[v.name]?.label ?? v.name}</dt>
                <dd className="font-mono text-slate-700">
                  {formatMetricValue(v.name, v.value)} {v.unit}
                </dd>
              </div>
            ))}
        </dl>
      )}

      {pillar.recorded_at && (
        <p className="mt-2 text-[10px] text-slate-400">
          Last updated {format(new Date(pillar.recorded_at), 'MMM d, yyyy')}
        </p>
      )}
    </div>
  );
}

interface CheckinSummaryCardProps {
  summary: CheckinSummarySnapshot;
}

export function CheckinSummaryCard({ summary }: CheckinSummaryCardProps) {
  const def = CLINICAL_PILLARS.checkin_summary;

  return (
    <div className="rounded-xl border border-slate-200 p-4 md:col-span-2">
      <h3 className="text-sm font-semibold text-slate-900">{def.title}</h3>
      <p className="mt-0.5 text-xs text-slate-500">{def.subtitle}</p>

      <p className="mt-3 text-sm leading-relaxed text-slate-700">{summary.excerpt}</p>

      {summary.transcript.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-blue-800">
            View full conversation transcript
          </summary>
          <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3">
            {summary.transcript.map((turn, i) => (
              <p key={i} className="text-xs text-slate-600">
                <span className="font-medium capitalize text-slate-800">{turn.role}:</span>{' '}
                {turn.content}
              </p>
            ))}
          </div>
        </details>
      )}

      {summary.recorded_at && (
        <p className="mt-2 text-[10px] text-slate-400">
          Check-in {format(new Date(summary.recorded_at), 'MMM d, yyyy · h:mm a')}
        </p>
      )}
    </div>
  );
}
