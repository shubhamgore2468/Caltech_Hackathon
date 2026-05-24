import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const patientId = request.nextUrl.searchParams.get('patient_id');
  if (!patientId) {
    return NextResponse.json({ error: 'patient_id required' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('biomarkers')
    .select('session_id, recorded_at, category, metric_name, value, unit')
    .eq('patient_id', patientId)
    .order('recorded_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const header = 'session_id,timestamp,category,metric_name,value,unit\n';
  const rows = (data ?? [])
    .map(
      (r) =>
        `${r.session_id},${r.recorded_at},${r.category},${r.metric_name},${r.value},${r.unit ?? ''}`
    )
    .join('\n');

  return new NextResponse(header + rows, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="Parivo Health-${patientId}-export.csv"`,
    },
  });
}
