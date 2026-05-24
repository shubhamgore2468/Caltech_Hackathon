'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Calendar, ChevronRight, Heart, MessageSquare, Mic } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { formatMetricValue } from '@/lib/clinical/metric-definitions';
import type { WeeklyReport, WeeklyReportStatus } from '@/lib/clinical/weekly-reports';

interface WeeklyProgressExplorerProps {
  weeks: WeeklyReport[];
}

const STATUS_STYLES: Record<
  WeeklyReportStatus,
  { label: string; badge: string; accent: string }
> = {
  stable: {
    label: 'Stable',
    badge: 'bg-emerald-50 text-emerald-700',
    accent: 'border-emerald-200',
  },
  watch: {
    label: 'Watch',
    badge: 'bg-amber-50 text-amber-700',
    accent: 'border-amber-200',
  },
  alert: {
    label: 'Alert',
    badge: 'bg-rose-50 text-rose-700',
    accent: 'border-rose-200',
  },
};

export function WeeklyProgressExplorer({ weeks }: WeeklyProgressExplorerProps) {
  const currentWeek = weeks.find((w) => w.is_current) ?? weeks[0];
  const [selectedId, setSelectedId] = useState(currentWeek?.id ?? '');
  const selected = weeks.find((w) => w.id === selectedId) ?? currentWeek;
  const priorWeeks = weeks.filter((w) => w.id !== selected?.id);

  if (!selected) return null;

  const jumpToCurrent = () => {
    if (currentWeek) setSelectedId(currentWeek.id);
  };

  return (
    <div className="w-full">
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Featured week — largest panel */}
        <motion.div
          layout
          className="min-w-0 flex-1"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <AnimatePresence mode="wait">
            <FeaturedWeekPanel key={selected.id} week={selected} onBackToCurrent={jumpToCurrent} />
          </AnimatePresence>
        </motion.div>

        {/* Prior weeks — compact cards */}
        <div className="lg:w-80">
          <div className="mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-medium text-slate-900">Previous weeks</h3>
          </div>
          <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
            {priorWeeks.map((week) => (
              <WeekCard
                key={week.id}
                week={week}
                compact
                onSelect={() => setSelectedId(week.id)}
                isSelected={false}
              />
            ))}
          </div>
        </div>
      </div>

      {selected.is_current && priorWeeks.length > 0 && (
        <p className="mt-4 text-xs text-slate-500">
          Showing current week in detail. Select a prior week card to review historical check-ins.
        </p>
      )}
    </div>
  );
}

function FeaturedWeekPanel({
  week,
  onBackToCurrent,
}: {
  week: WeeklyReport;
  onBackToCurrent?: () => void;
}) {
  const status = STATUS_STYLES[week.status];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'rounded-2xl border-2 p-6',
        'bg-white',
        week.is_current ? 'border-blue-800 shadow-md' : 'border-slate-200',
        status.accent
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {week.is_current && (
              <span className="rounded-full bg-blue-800 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                Current week
              </span>
            )}
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', status.badge)}>
              {status.label}
            </span>
          </div>
          <h3 className="mt-2 text-xl font-bold text-slate-900">
            Week {week.week_number} · {week.week_label}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Check-in {format(new Date(week.recorded_at), 'EEEE, MMM d, yyyy')}
          </p>
          {!week.is_current && onBackToCurrent && (
            <button
              type="button"
              onClick={onBackToCurrent}
              className="mt-2 text-xs font-medium text-blue-800 hover:underline"
            >
              ← Back to current week
            </button>
          )}
        </div>
        <div className="flex gap-3">
          <RiskPill label="Dementia risk" value={week.dementia_score} />
        </div>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-slate-700">{week.summary}</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricTile
          icon={<Mic className="h-4 w-4" />}
          label="Vocal tremor (jitter)"
          value={formatMetricValue('jitter_pct', week.metrics.jitter_pct)}
          unit="%"
        />
        <MetricTile
          icon={<Activity className="h-4 w-4" />}
          label="Kinematic tremor"
          value={formatMetricValue('tremor_score', week.metrics.tremor_score)}
          unit="ratio"
        />
        <MetricTile
          icon={<Heart className="h-4 w-4" />}
          label="Resting heart rate"
          value={formatMetricValue('resting_hr', week.metrics.resting_hr)}
          unit="bpm"
        />
        <MetricTile
          label="Shimmer"
          value={formatMetricValue('shimmer_pct', week.metrics.shimmer_pct)}
          unit="%"
        />
        <MetricTile
          label="Sleep quality"
          value={week.metrics.sleep_quality.toFixed(0)}
          unit="/ 100"
        />
        <MetricTile
          label="Word recall"
          value={week.metrics.word_recall_score.toFixed(1)}
          unit="/ 10"
        />
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-blue-800" />
          <h4 className="text-sm font-semibold text-slate-900">Weekly check-in summary</h4>
        </div>
        <div className="mt-3 space-y-2">
          {week.transcript.map((turn, i) => (
            <p key={i} className="text-sm text-slate-600">
              <span className="font-medium capitalize text-slate-800">{turn.role}:</span>{' '}
              {turn.content}
            </p>
          ))}
        </div>
        {Object.keys(week.cognitive_flags).length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            Cognitive flags:{' '}
            {Object.entries(week.cognitive_flags)
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(', ')}
          </p>
        )}
      </div>

      <ul className="mt-4 space-y-1">
        {week.highlights.map((h) => (
          <li key={h} className="font-mono text-xs text-slate-500">
            · {h}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

function WeekCard({
  week,
  compact,
  onSelect,
  isSelected,
}: {
  week: WeeklyReport;
  compact?: boolean;
  onSelect: () => void;
  isSelected: boolean;
}) {
  const status = STATUS_STYLES[week.status];

  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={onSelect}
      className={cn(
        'group w-full text-left',
        compact ? 'p-3 rounded-xl' : 'p-4 rounded-xl',
        'bg-white',
        'border transition-all duration-200',
        isSelected
          ? 'border-blue-800 ring-1 ring-blue-200'
          : 'border-slate-200 hover:border-slate-300'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-900">Week {week.week_number}</span>
            <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', status.badge)}>
              {status.label}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">{week.week_label}</p>
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-600">{week.brief}</p>
          <div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] text-slate-500">
            <span>Jitter {week.metrics.jitter_pct.toFixed(1)}%</span>
            <span>·</span>
            <span>Tremor {week.metrics.tremor_score.toFixed(2)}</span>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
      </div>
    </motion.button>
  );
}

function MetricTile({
  icon,
  label,
  value,
  unit,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-1.5 text-slate-500">
        {icon}
        <span className="text-[10px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1 font-mono text-lg font-semibold text-slate-900">
        {value}
        <span className="ml-1 text-xs font-normal text-slate-500">{unit}</span>
      </p>
    </div>
  );
}

function RiskPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 text-center">
      <p className="text-[10px] uppercase text-slate-500">{label}</p>
      <p className="font-mono text-lg font-bold text-slate-900">{(value * 100).toFixed(0)}</p>
    </div>
  );
}
