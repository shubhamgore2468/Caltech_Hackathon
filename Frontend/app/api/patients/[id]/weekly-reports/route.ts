import { NextRequest, NextResponse } from 'next/server';
import { getMockWeeklyReports, shouldUseMockData } from '@/lib/mock';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (shouldUseMockData()) {
    return NextResponse.json({ weeks: getMockWeeklyReports(id) });
  }
  return NextResponse.json({ weeks: getMockWeeklyReports(id) });
}
