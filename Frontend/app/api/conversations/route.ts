import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';

const schema = z.object({
  session_id: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
  patient_id: z.string(),
  transcript: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      timestamp: z.string(),
    })
  ),
  cognitive_flags: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('conversations')
      .insert({
        session_id: body.session_id,
        patient_id: body.patient_id,
        transcript: body.transcript,
        cognitive_flags: body.cognitive_flags ?? {},
      })
      .select()
      .single();

    if (error) {
      console.warn('[conversations] insert failed', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.info(
      `[conversations] inserted id=${data.id} session=${body.session_id} ` +
        `turns=${body.transcript.length} flags=${Object.keys(body.cognitive_flags ?? {}).length}`,
    );
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
