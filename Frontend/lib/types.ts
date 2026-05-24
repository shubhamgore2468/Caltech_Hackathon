export type BiomarkerCategory = 'voice' | 'camera' | 'motion' | 'wearable' | 'cognitive';
export type SessionType = 'checkin' | 'walk_test' | 'tremor_test' | 'wearable_sync';
export type SessionMode = 'walk_test' | 'hand_tremor' | 'daily_checkin' | SessionType;
export type AlertSeverity = 'info' | 'warn' | 'critical';

export interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
}

export interface Patient {
  id: string;
  full_name?: string;
  name?: string;
  date_of_birth: string | null;
  sex?: 'M' | 'F' | 'O' | null;
  diagnosis?: string | null;
  enrolled_at: string;
}

export interface Session {
  id: string;
  patient_id: string;
  session_type?: SessionType;
  mode?: SessionMode;
  recorded_at?: string;
  started_at?: string;
  ended_at?: string | null;
  duration_seconds?: number | null;
  notes?: string | null;
  created_at?: string;
}

export interface Biomarker {
  id?: string;
  session_id?: string;
  patient_id?: string;
  category: BiomarkerCategory;
  metric_name: string;
  value: number;
  unit?: string | null;
  recorded_at?: string;
  raw_blob?: Record<string, unknown>;
}

export interface RiskScore {
  id?: string;
  session_id?: string;
  patient_id?: string;
  parkinsons_score: number;
  dementia_score: number;
  contributing_factors: ContributingFactors | Record<string, number>;
  recorded_at?: string;
}

export interface ContributingFactors {
  voice?: Record<string, number>;
  camera?: Record<string, number>;
  motion?: Record<string, number>;
  cognitive?: Record<string, number>;
  wearable?: Record<string, number>;
  weights?: Record<string, number>;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string | number;
}

export interface Conversation {
  id: string;
  session_id: string;
  patient_id: string;
  transcript: ConversationTurn[];
  cognitive_flags: Record<string, unknown>;
  created_at: string;
}

export interface CognitiveFlags {
  word_recall_errors?: number;
  response_latency_ms?: number;
  fluency_count?: number;
}

export interface Alert {
  id: string;
  patient_id: string;
  session_id: string | null;
  metric_name: string;
  severity: AlertSeverity;
  message: string;
  baseline_value: number | null;
  current_value: number | null;
  std_deviations: number | null;
  acknowledged: boolean;
  created_at: string;
}

export interface MotionBiomarkers {
  tremor_score: number;
  hand_tremor_hz: number;
  dominant_freq_hz: number;
  rms_acceleration: number;
  gait_variance: number;
}

export interface VoiceBiomarkers {
  jitter_pct: number;
  shimmer_pct: number;
  hnr_db: number;
  speech_rate_wpm: number;
}

export interface CameraBiomarkers {
  blink_rate_per_min: number;
  facial_affect_displacement: number;
}

export interface BiomarkerInput {
  category: BiomarkerCategory;
  metric_name: string;
  value: number;
  unit?: string;
}

export interface CreateSessionRequest {
  patient_id: string;
  session_type: SessionType;
  recorded_at?: string;
  duration_seconds?: number;
  notes?: string;
  biomarkers?: BiomarkerInput[];
}

export interface ComputeRiskScoreRequest {
  session_id: string;
  patient_id: string;
}

export interface TimelinePoint {
  recorded_at: string;
  session_id: string;
  value: number;
}

export interface PatientTimeline {
  patient_id: string;
  metrics: Record<string, TimelinePoint[]>;
  risk_scores: Array<{
    recorded_at: string;
    session_id: string;
    parkinsons_score: number;
    dementia_score: number;
  }>;
  alerts: Alert[];
}

export const DEMO_PATIENT_ID = '00000000-0000-0000-0000-000000000001';
