'use client';

import { useEffect } from 'react';
import { getMockCompletedWeekKeys } from '@/lib/mock/generate';

const STORAGE_KEY = 'Parivo Health_weekly_checkins';
const DEMO_PATIENT_ID = process.env.NEXT_PUBLIC_DEMO_PATIENT_ID ?? 'demo-001';

/** Seeds localStorage with completed weekly check-ins when running in mock mode. */
export function MockDataBootstrap() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA !== 'true') return;

    const key = `${STORAGE_KEY}:${DEMO_PATIENT_ID}`;
    const existing = localStorage.getItem(key);
    if (existing && JSON.parse(existing).length > 0) return;

    const records = getMockCompletedWeekKeys().map((weekKey) => ({
      weekKey,
      completedAt: new Date(weekKey).toISOString(),
      sessionId: `mock-${weekKey}`,
    }));

    localStorage.setItem(key, JSON.stringify(records));
  }, []);

  return null;
}
