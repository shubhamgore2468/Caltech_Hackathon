export type BiomarkerCategory = 'voice' | 'camera' | 'motion' | 'wearable';
export type SessionMode = 'walk_test' | 'hand_tremor' | 'daily_checkin';

export interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
}

export interface Biomarker {
  category: BiomarkerCategory;
  metric_name: string;
  value: number;
  unit?: string;
  raw_blob?: Record<string, unknown>;
}

export interface RiskScore {
  parkinsons_score: number;
  dementia_score: number;
  contributing_factors: Record<string, number>;
}

export interface Patient {
  id: string;
  name: string;
  date_of_birth: string | null;
  enrolled_at: string;
}

export interface Session {
  id: string;
  patient_id: string;
  started_at: string;
  ended_at: string | null;
  mode: SessionMode;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface CognitiveFlags {
  word_recall_errors?: number;
  response_latency_ms?: number;
  fluency_count?: number;
}

export const DEMO_PATIENT_ID = '00000000-0000-0000-0000-000000000001';
