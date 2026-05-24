/** When true, all API routes serve synthetic demo data (no Supabase required). */
export function shouldUseMockData(): boolean {
  if (process.env.USE_MOCK_DATA === 'true') return true;
  if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') return true;
  const hasSupabase =
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return !hasSupabase;
}

export const DEMO_PATIENT_ID = process.env.DEMO_PATIENT_ID ?? 'demo-001';
