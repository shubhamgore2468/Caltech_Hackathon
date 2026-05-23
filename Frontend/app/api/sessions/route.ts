import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';

const CreateSessionSchema = z.object({
  patient_id: z.string().uuid(),
  mode: z.enum(['walk_test', 'hand_tremor', 'daily_checkin']),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = CreateSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  const supa = getServerSupabase();
  const { data, error } = await supa
    .from('sessions')
    .insert({ patient_id: parsed.data.patient_id, mode: parsed.data.mode })
    .select('id, patient_id, mode, started_at')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
