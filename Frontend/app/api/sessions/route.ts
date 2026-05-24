import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';

const CreateSessionSchema = z.object({
  patient_id: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
  // Accept either legacy mode OR new session_type. At least one required.
  mode: z.enum(['walk_test', 'hand_tremor', 'daily_checkin']).optional(),
  session_type: z.string().min(1).max(32).optional(),
  recorded_at: z.string().datetime().optional(),
  duration_seconds: z.number().nonnegative().optional(),
  notes: z.string().max(2000).optional(),
}).refine((v) => v.mode || v.session_type, {
  message: 'either mode or session_type required',
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = CreateSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  const { patient_id, mode, session_type, recorded_at, duration_seconds, notes } = parsed.data;

  const supa = getServerSupabase();
  const { data, error } = await supa
    .from('sessions')
    .insert({
      patient_id,
      mode: mode ?? null,
      session_type: session_type ?? null,
      recorded_at: recorded_at ?? null,
      duration_seconds: duration_seconds ?? null,
      notes: notes ?? null,
    })
    .select('id, patient_id, mode, session_type, started_at, recorded_at')
    .single();

  if (error) {
    console.warn('[sessions] insert failed', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  console.info(`[sessions] created id=${data.id} session_type=${session_type ?? '-'} mode=${mode ?? '-'}`);
  // Checkin client reads `data.session?.id` — wrap shape for compat.
  return NextResponse.json({ session: data, ...data });
}
