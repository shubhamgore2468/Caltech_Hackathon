import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isMonday,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';

/** Week starts Monday (consistent weekly read). */
export function getWeekStart(date: Date = new Date()): Date {
  return startOfWeek(date, { weekStartsOn: 1 });
}

export function getWeekKey(date: Date = new Date()): string {
  return format(getWeekStart(date), 'yyyy-MM-dd');
}

export function isPreferredCheckinDay(date: Date = new Date()): boolean {
  return isMonday(date);
}

export function getDaysUntilNextMonday(date: Date = new Date()): number {
  const day = date.getDay();
  if (day === 1) return 0;
  return day === 0 ? 1 : 8 - day;
}

export interface WeeklyCheckinRecord {
  weekKey: string;
  completedAt: string;
  sessionId?: string;
}

const STORAGE_KEY = 'Parivo Health_weekly_checkins';

export function loadCheckinHistory(patientId: string): WeeklyCheckinRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${patientId}`);
    return raw ? (JSON.parse(raw) as WeeklyCheckinRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveCheckinCompletion(
  patientId: string,
  record: WeeklyCheckinRecord
): WeeklyCheckinRecord[] {
  const history = loadCheckinHistory(patientId).filter((r) => r.weekKey !== record.weekKey);
  const updated = [...history, record].sort((a, b) => a.weekKey.localeCompare(b.weekKey));
  localStorage.setItem(`${STORAGE_KEY}:${patientId}`, JSON.stringify(updated));
  return updated;
}

export function hasCompletedThisWeek(patientId: string, date: Date = new Date()): boolean {
  const weekKey = getWeekKey(date);
  return loadCheckinHistory(patientId).some((r) => r.weekKey === weekKey);
}

export function getCurrentWeekStatus(patientId: string, date: Date = new Date()) {
  const weekKey = getWeekKey(date);
  const completed = hasCompletedThisWeek(patientId, date);
  const record = loadCheckinHistory(patientId).find((r) => r.weekKey === weekKey);
  const preferredDay = isPreferredCheckinDay(date);

  return {
    weekKey,
    completed,
    record,
    preferredDay,
    weekLabel: `Week of ${format(getWeekStart(date), 'MMM d, yyyy')}`,
    canStart: !completed,
  };
}

export interface CalendarDay {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  isMonday: boolean;
  weekKey: string;
  completed: boolean;
  isCurrentWeek: boolean;
}

export function buildMonthCalendar(
  patientId: string,
  viewDate: Date = new Date()
): CalendarDay[] {
  const monthStart = startOfMonth(viewDate);
  const monthEnd = endOfMonth(viewDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const today = new Date();
  const currentWeekKey = getWeekKey(today);
  const completedWeeks = new Set(loadCheckinHistory(patientId).map((r) => r.weekKey));

  return eachDayOfInterval({ start: gridStart, end: gridEnd }).map((date) => {
    const weekKey = getWeekKey(date);
    return {
      date,
      inMonth: isSameMonth(date, viewDate),
      isToday: isSameDay(date, today),
      isMonday: isMonday(date),
      weekKey,
      completed: completedWeeks.has(weekKey),
      isCurrentWeek: weekKey === currentWeekKey,
    };
  });
}

export function getStreakWeeks(patientId: string): number {
  const history = loadCheckinHistory(patientId);
  if (!history.length) return 0;

  let streak = 0;
  let cursor = getWeekStart(new Date());

  while (true) {
    const key = format(cursor, 'yyyy-MM-dd');
    if (history.some((r) => r.weekKey === key)) {
      streak++;
      cursor = addDays(cursor, -7);
    } else {
      break;
    }
  }
  return streak;
}

export { addMonths, subMonths, format };
