import type { ConversationTurn } from '@/lib/types';

export type WeeklyReportStatus = 'stable' | 'watch' | 'alert';

export interface WeeklyReport {
  id: string;
  week_number: number;
  week_label: string;
  recorded_at: string;
  brief: string;
  summary: string;
  status: WeeklyReportStatus;
  is_current: boolean;
  dementia_score: number;
  metrics: {
    jitter_pct: number;
    tremor_score: number;
    shimmer_pct: number;
    resting_hr: number;
    sleep_quality: number;
    word_recall_score: number;
  };
  highlights: string[];
  transcript: ConversationTurn[];
  cognitive_flags: Record<string, unknown>;
}
