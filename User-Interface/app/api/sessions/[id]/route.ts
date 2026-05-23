import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerClient();

  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', params.id)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const [{ data: biomarkers }, { data: riskScore }, { data: conversation }] = await Promise.all([
    supabase.from('biomarkers').select('*').eq('session_id', params.id),
    supabase.from('risk_scores').select('*').eq('session_id', params.id).maybeSingle(),
    supabase.from('conversations').select('*').eq('session_id', params.id).maybeSingle(),
  ]);

  return NextResponse.json({
    session,
    biomarkers: biomarkers ?? [],
    risk_score: riskScore,
    conversation,
  });
}
