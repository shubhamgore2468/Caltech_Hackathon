import type { ClinicalPillarId } from '@/lib/clinical/metric-definitions';
import { getMockDashboard } from '@/lib/mock/generate';
import type { ConversationTurn } from '@/lib/types';

export interface PillarMetricValue {
  name: string;
  value: number;
  unit: string;
}

export interface ClinicalPillarSnapshot {
  id: ClinicalPillarId;
  values: PillarMetricValue[];
  trend: string;
  recorded_at: string | null;
}

export interface CheckinSummarySnapshot {
  session_id: string | null;
  recorded_at: string | null;
  excerpt: string;
  transcript: ConversationTurn[];
  cognitive_flags: Record<string, unknown>;
}

export interface DoctorDashboardSummary {
  patient_id: string;
  patient_name: string;
  diagnosis: string;
  last_checkin_at: string | null;
  pillars: ClinicalPillarSnapshot[];
  checkin_summary: CheckinSummarySnapshot;
  alerts_count: number;
}

export function buildDemoDashboard(patientId: string): DoctorDashboardSummary {
  return getMockDashboard(patientId);
}
