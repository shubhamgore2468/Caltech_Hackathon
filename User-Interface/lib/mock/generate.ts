import type { DoctorDashboardSummary } from '@/lib/clinical/dashboard';
import { CLINICAL_PILLARS, trendLabel } from '@/lib/clinical/metric-definitions';
import type { ClinicalPillarId } from '@/lib/clinical/metric-definitions';
import type { Alert, ConversationTurn, PatientTimeline, TimelinePoint } from '@/lib/types';
import type { WeeklyReport, WeeklyReportStatus } from '@/lib/clinical/weekly-reports';
import { DEMO_PATIENT_ID } from './config';

const WEEKS = 6;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function noise(scale: number, seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2 * scale;
}

export interface MockSession {
  id: string;
  patient_id: string;
  session_type: 'checkin';
  recorded_at: string;
  duration_seconds: number;
  biomarkers: Array<{
    category: string;
    metric_name: string;
    value: number;
    unit: string;
  }>;
  transcript: ConversationTurn[];
  cognitive_flags: Record<string, unknown>;
  parkinsons_score: number;
  dementia_score: number;
}

export interface MockProgressReport {
  week_label: string;
  recorded_at: string;
  summary: string;
  highlights: string[];
}

export interface MockPatientStore {
  patient_id: string;
  patient_name: string;
  diagnosis: string;
  sessions: MockSession[];
  timeline: PatientTimeline;
  dashboard: DoctorDashboardSummary;
  progress_reports: MockProgressReport[];
}

const stores = new Map<string, MockPatientStore>();

function generateSessions(patientId: string): MockSession[] {
  const sessions: MockSession[] = [];
  const now = Date.now();

  for (let i = 0; i < WEEKS; i++) {
    const t = i / (WEEKS - 1);
    const daysAgo = (WEEKS - 1 - i) * 7;
    const recordedAt = new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const sessionId = `mock-session-${i}`;

    const jitter = lerp(1.2, 2.6, t) + noise(0.1, i);
    const tremorScore = lerp(0.08, 0.32, t) + noise(0.02, i + 10);
    const shimmer = lerp(5.5, 8.2, t * 0.6) + noise(0.3, i + 20);
    const restingHr = lerp(70, 66, t * 0.4) + noise(1.5, i + 30);

    sessions.push({
      id: sessionId,
      patient_id: patientId,
      session_type: 'checkin',
      recorded_at: recordedAt,
      duration_seconds: 300,
      biomarkers: [
        { category: 'voice', metric_name: 'jitter_pct', value: jitter, unit: '%' },
        { category: 'voice', metric_name: 'shimmer_pct', value: shimmer, unit: '%' },
        { category: 'voice', metric_name: 'hnr_db', value: 18 - t * 3 + noise(0.4, i), unit: 'dB' },
        { category: 'motion', metric_name: 'tremor_score', value: tremorScore, unit: 'ratio' },
        { category: 'motion', metric_name: 'hand_tremor_hz', value: 4.8 + t * 0.6 + noise(0.2, i), unit: 'Hz' },
        { category: 'motion', metric_name: 'dominant_freq_hz', value: 5.1 + t * 0.4, unit: 'Hz' },
        { category: 'motion', metric_name: 'gait_variance', value: lerp(0.03, 0.07, t) + noise(0.004, i), unit: 'var' },
        { category: 'camera', metric_name: 'blink_rate_per_min', value: lerp(14, 10, t * 0.5) + noise(0.6, i), unit: '/min' },
        { category: 'wearable', metric_name: 'resting_hr', value: restingHr, unit: 'bpm' },
        { category: 'wearable', metric_name: 'sleep_quality', value: lerp(72, 58, t * 0.5) + noise(2, i), unit: 'score' },
        { category: 'cognitive', metric_name: 'word_recall_score', value: lerp(7.8, 6.2, t * 0.5) + noise(0.2, i), unit: 'score' },
      ],
      transcript: [
        {
          role: 'assistant',
          content: 'Good morning! How have you been feeling this week?',
          timestamp: recordedAt,
        },
        {
          role: 'user',
          content:
            t > 0.5
              ? 'More stiffness in my right hand lately, but no falls.'
              : 'Feeling fairly steady this week, sleep was okay.',
          timestamp: recordedAt,
        },
        {
          role: 'assistant',
          content: 'Thank you. Any changes in balance or medication timing?',
          timestamp: recordedAt,
        },
        {
          role: 'user',
          content: t > 0.7 ? 'Balance feels a bit off when tired.' : 'No major changes to report.',
          timestamp: recordedAt,
        },
      ],
      cognitive_flags: {
        word_recall: t > 0.6 ? 'mild_delay' : 'normal',
        mood: t > 0.7 ? 'concerned' : 'neutral',
      },
      parkinsons_score: lerp(0.28, 0.62, t),
      dementia_score: lerp(0.18, 0.35, t),
    });
  }

  return sessions;
}

function buildTimeline(patientId: string, sessions: MockSession[]): PatientTimeline {
  const metricNames = [
    'jitter_pct',
    'tremor_score',
    'gait_variance',
    'blink_rate_per_min',
    'sleep_quality',
    'shimmer_pct',
    'hand_tremor_hz',
    'resting_hr',
  ];

  const metrics: Record<string, TimelinePoint[]> = {};
  for (const name of metricNames) metrics[name] = [];

  for (const session of sessions) {
    for (const b of session.biomarkers) {
      if (metrics[b.metric_name]) {
        metrics[b.metric_name].push({
          recorded_at: session.recorded_at,
          session_id: session.id,
          value: b.value,
        });
      }
    }
  }

  const latest = sessions[sessions.length - 1];
  const alerts: Alert[] =
    latest.biomarkers.find((b) => b.metric_name === 'jitter_pct')!.value > 2.2
      ? [
          {
            id: 'mock-alert-1',
            patient_id: patientId,
            session_id: latest.id,
            metric_name: 'jitter_pct',
            severity: 'warn',
            message: 'Vocal tremor burden (jitter) is 2.4σ above 30-day baseline',
            baseline_value: 1.2,
            current_value: latest.biomarkers.find((b) => b.metric_name === 'jitter_pct')!.value,
            std_deviations: 2.4,
            acknowledged: false,
            created_at: latest.recorded_at,
          },
          {
            id: 'mock-alert-2',
            patient_id: patientId,
            session_id: latest.id,
            metric_name: 'tremor_score',
            severity: 'info',
            message: 'Kinematic tremor elevated vs prior month — monitor next weekly check-in',
            baseline_value: 0.1,
            current_value: latest.biomarkers.find((b) => b.metric_name === 'tremor_score')!.value,
            std_deviations: 1.8,
            acknowledged: false,
            created_at: latest.recorded_at,
          },
        ]
      : [];

  return {
    patient_id: patientId,
    metrics,
    risk_scores: sessions.map((s) => ({
      recorded_at: s.recorded_at,
      session_id: s.id,
      parkinsons_score: s.parkinsons_score,
      dementia_score: s.dementia_score,
    })),
    alerts,
  };
}

function buildDashboard(patientId: string, sessions: MockSession[]): DoctorDashboardSummary {
  const latest = sessions[sessions.length - 1];
  const prior = sessions[sessions.length - 2];
  const patient_name = 'Robert Halloway';
  const diagnosis = 'PD - Hoehn-Yahr Stage 2';

  function getMetric(session: MockSession, name: string) {
    return session.biomarkers.find((b) => b.metric_name === name);
  }

  function buildPillar(id: ClinicalPillarId) {
    const def = CLINICAL_PILLARS[id];
    const values: { name: string; value: number; unit: string }[] = [];
    for (const name of def.metrics) {
      const m = getMetric(latest, name);
      if (m) values.push({ name, value: m.value, unit: m.unit });
    }

    const primary = def.primaryMetric ? getMetric(latest, def.primaryMetric)?.value : null;
    const priorPrimary = def.primaryMetric && prior ? getMetric(prior, def.primaryMetric)?.value : null;
    const higherIsWorse = id !== 'resting_hr';

    return {
      id,
      values,
      trend:
        primary != null
          ? trendLabel(primary, priorPrimary ?? null, higherIsWorse)
          : 'No data',
      recorded_at: latest.recorded_at,
    };
  }

  const userLine = latest.transcript.filter((t) => t.role === 'user').pop()?.content ?? '';
  const flags = latest.cognitive_flags;

  return {
    patient_id: patientId,
    patient_name,
    diagnosis,
    last_checkin_at: latest.recorded_at,
    pillars: [
      buildPillar('kinematic_tremor'),
      buildPillar('vocal_tremor'),
      buildPillar('resting_hr'),
    ],
    checkin_summary: {
      session_id: latest.id,
      recorded_at: latest.recorded_at,
      excerpt: `Patient reported: "${userLine}" Cognitive note: word recall ${flags.word_recall}. Mood: ${flags.mood}.`,
      transcript: latest.transcript,
      cognitive_flags: flags,
    },
    alerts_count: 2,
  };
}

function buildProgressReports(sessions: MockSession[]): MockProgressReport[] {
  return [...sessions].reverse().map((s, i) => {
    const jitter = s.biomarkers.find((b) => b.metric_name === 'jitter_pct')!.value;
    const tremor = s.biomarkers.find((b) => b.metric_name === 'tremor_score')!.value;
    const date = new Date(s.recorded_at);
    const weekLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

    return {
      week_label: weekLabel,
      recorded_at: s.recorded_at,
      summary:
        i === 0
          ? 'Speech clarity slightly reduced. Kinematic tremor trending upward — neurologist notified.'
          : jitter > 2.0
            ? 'Voice metrics above your baseline. Movement and heart rate within expected range.'
            : 'Stable week overall. All key metrics near your personal baseline.',
      highlights: [
        `Vocal tremor burden: ${jitter.toFixed(1)}% jitter`,
        `Kinematic tremor: ${tremor.toFixed(3)} band power ratio`,
        `Resting HR: ${s.biomarkers.find((b) => b.metric_name === 'resting_hr')!.value.toFixed(0)} bpm`,
      ],
    };
  });
}

export function getMockPatientStore(patientId: string = DEMO_PATIENT_ID): MockPatientStore {
  if (!stores.has(patientId)) {
    const sessions = generateSessions(patientId);
    stores.set(patientId, {
      patient_id: patientId,
      patient_name: 'Robert Halloway',
      diagnosis: 'PD - Hoehn-Yahr Stage 2',
      sessions,
      timeline: buildTimeline(patientId, sessions),
      dashboard: buildDashboard(patientId, sessions),
      progress_reports: buildProgressReports(sessions),
    });
  }
  return stores.get(patientId)!;
}

export function getMockTimeline(patientId: string = DEMO_PATIENT_ID) {
  return getMockPatientStore(patientId).timeline;
}

export function getMockDashboard(patientId: string = DEMO_PATIENT_ID) {
  return getMockPatientStore(patientId).dashboard;
}

export function getMockProgressReports(patientId: string = DEMO_PATIENT_ID) {
  return getMockPatientStore(patientId).progress_reports;
}

function deriveStatus(jitter: number, tremor: number): WeeklyReportStatus {
  if (jitter > 2.2 || tremor > 0.28) return 'alert';
  if (jitter > 1.8 || tremor > 0.18) return 'watch';
  return 'stable';
}

export function getMockWeeklyReports(patientId: string = DEMO_PATIENT_ID): WeeklyReport[] {
  const sessions = getMockPatientStore(patientId).sessions;
  const reports = getMockProgressReports(patientId);

  return [...sessions].reverse().map((s, i) => {
    const jitter = s.biomarkers.find((b) => b.metric_name === 'jitter_pct')!.value;
    const tremor = s.biomarkers.find((b) => b.metric_name === 'tremor_score')!.value;
    const shimmer = s.biomarkers.find((b) => b.metric_name === 'shimmer_pct')!.value;
    const restingHr = s.biomarkers.find((b) => b.metric_name === 'resting_hr')!.value;
    const sleep = s.biomarkers.find((b) => b.metric_name === 'sleep_quality')!.value;
    const recall = s.biomarkers.find((b) => b.metric_name === 'word_recall_score')!.value;
    const date = new Date(s.recorded_at);
    const weekLabel = date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const userLine = s.transcript.filter((t) => t.role === 'user').pop()?.content ?? '';
    const report = reports[i];

    return {
      id: s.id,
      week_number: sessions.length - i,
      week_label: weekLabel,
      recorded_at: s.recorded_at,
      brief: userLine.length > 72 ? `${userLine.slice(0, 72)}…` : userLine || report.summary,
      summary: report.summary,
      status: deriveStatus(jitter, tremor),
      is_current: i === 0,
      dementia_score: s.dementia_score,
      metrics: {
        jitter_pct: jitter,
        tremor_score: tremor,
        shimmer_pct: shimmer,
        resting_hr: restingHr,
        sleep_quality: sleep,
        word_recall_score: recall,
      },
      highlights: report.highlights,
      transcript: s.transcript,
      cognitive_flags: s.cognitive_flags,
    };
  });
}

/** Completed week keys for patient calendar demo (all but current week). */
export function getMockCompletedWeekKeys(): string[] {
  const sessions = getMockPatientStore(DEMO_PATIENT_ID).sessions;
  const keys: string[] = [];
  for (let i = 0; i < sessions.length - 1; i++) {
    const d = new Date(sessions[i].recorded_at);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}
