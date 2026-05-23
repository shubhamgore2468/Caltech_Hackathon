import { NextRequest, NextResponse } from 'next/server';
import { getMockWeeklyReports, shouldUseMockData } from '@/lib/mock';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  // INTEGRATION POINT: Supabase weekly sessions when live
  if (shouldUseMockData()) {
    return NextResponse.json({ weeks: getMockWeeklyReports(params.id) });
  }
  return NextResponse.json({ weeks: getMockWeeklyReports(params.id) });
}
