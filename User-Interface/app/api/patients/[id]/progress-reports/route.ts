import { NextRequest, NextResponse } from 'next/server';
import { getMockProgressReports, shouldUseMockData } from '@/lib/mock';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (shouldUseMockData()) {
    return NextResponse.json({ reports: getMockProgressReports(params.id) });
  }

  // INTEGRATION POINT: fetch from Supabase when live
  return NextResponse.json({ reports: getMockProgressReports(params.id) });
}
