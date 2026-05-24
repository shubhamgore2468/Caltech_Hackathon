'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addMonths,
  buildMonthCalendar,
  format,
  getCurrentWeekStatus,
  getDaysUntilNextMonday,
  getStreakWeeks,
  subMonths,
} from '@/lib/checkin/weekly';

interface WeeklyCheckinCalendarProps {
  patientId: string;
}

export function WeeklyCheckinCalendar({ patientId }: WeeklyCheckinCalendarProps) {
  const [viewDate, setViewDate] = useState<Date | null>(null);

  useEffect(() => {
    setViewDate(new Date());
  }, []);

  const days = useMemo(
    () => (viewDate ? buildMonthCalendar(patientId, viewDate) : []),
    [patientId, viewDate]
  );
  const status = useMemo(() => getCurrentWeekStatus(patientId), [patientId]);
  const streak = useMemo(() => getStreakWeeks(patientId), [patientId]);

  if (!viewDate) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
        Loading calendar…
      </div>
    );
  }

  const weekRows: (typeof days)[] = [];
  for (let i = 0; i < days.length; i += 7) {
    weekRows.push(days.slice(i, i + 7));
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Weekly check-in calendar</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Today · {format(new Date(), 'EEE, MMM d, yyyy')}
          </p>
        </div>
        {streak > 0 && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            {streak} wk streak
          </span>
        )}
      </div>

      <div
        className={`mt-3 rounded-lg px-3 py-2 text-sm ${
          status.completed
            ? 'bg-emerald-50 text-emerald-800'
            : status.preferredDay
              ? 'bg-blue-50 text-blue-800'
              : 'bg-amber-50 text-amber-800'
        }`}
      >
        {status.completed ? (
          <>✓ {status.weekLabel} — check-in complete</>
        ) : status.preferredDay ? (
          <>Today is Monday — ideal day for your weekly check-in</>
        ) : (
          <>
            {status.weekLabel} — check-in due. For best consistency, aim for Mondays
            {!status.preferredDay && getDaysUntilNextMonday() > 0
              ? ` (next Monday in ${getDaysUntilNextMonday()} day${getDaysUntilNextMonday() === 1 ? '' : 's'})`
              : ''}
            .
          </>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setViewDate(subMonths(viewDate, 1))}
          className="rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
          aria-label="Previous month"
        >
          ←
        </button>
        <span className="text-sm font-medium text-slate-900">{format(viewDate, 'MMMM yyyy')}</span>
        <button
          type="button"
          onClick={() => setViewDate(addMonths(viewDate, 1))}
          className="rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
          aria-label="Next month"
        >
          →
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase text-slate-400">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="mt-1 space-y-1">
        {weekRows.map((row, ri) => {
          const weekCompleted = row.some((d) => d.completed && d.isMonday);
          const isCurrentWeek = row.some((d) => d.isCurrentWeek);

          return (
            <div
              key={ri}
              className={`grid grid-cols-7 gap-1 rounded-lg p-0.5 ${
                isCurrentWeek ? 'ring-1 ring-blue-200 bg-blue-50/40' : ''
              } ${weekCompleted ? 'bg-emerald-50/50' : ''}`}
            >
              {row.map((day) => (
                <div
                  key={day.date.toISOString()}
                  className={`flex flex-col items-center rounded py-1 ${
                    !day.inMonth ? 'opacity-30' : ''
                  } ${day.isToday ? 'font-semibold' : ''}`}
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${
                      day.isToday
                        ? 'bg-blue-800 text-white'
                        : day.isMonday && day.inMonth
                          ? 'text-blue-800'
                          : 'text-slate-700'
                    }`}
                  >
                    {format(day.date, 'd')}
                  </span>
                  {day.isMonday && day.inMonth && day.completed && (
                    <span className="mt-0.5 text-[9px] text-emerald-600">✓</span>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> Week completed
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-blue-800" /> Today
        </span>
        <span className="flex items-center gap-1">
          <span className="font-medium text-blue-800">Mon</span> Preferred check-in day
        </span>
      </div>
    </div>
  );
}
