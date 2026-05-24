import { NextRequest, NextResponse } from 'next/server';
import { getMockProgressReports, shouldUseMockData } from '@/lib/mock';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (shouldUseMockData()) {
    return NextResponse.json({ reports: getMockProgressReports(id) });
  }
  return NextResponse.json({ reports: getMockProgressReports(id) });
}
