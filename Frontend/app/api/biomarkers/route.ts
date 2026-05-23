import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase } from '@/lib/supabase/server';

const BiomarkerSchema = z.object({
  category: z.enum(['voice', 'camera', 'motion', 'wearable']),
  metric_name: z.string().min(1).max(64),
  value: z.number().finite(),
  unit: z.string().max(32).optional(),
  raw_blob: z.record(z.string(), z.unknown()).optional(),
});

const BatchSchema = z.object({
  session_id: z.string().uuid(),
  biomarkers: z.array(BiomarkerSchema).min(1).max(500),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = BatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  const { session_id, biomarkers } = parsed.data;
  const rows = biomarkers.map((b) => ({
    session_id,
    category: b.category,
    metric_name: b.metric_name,
    value: b.value,
    unit: b.unit ?? null,
    raw_blob: b.raw_blob ?? null,
  }));

  const supa = getServerSupabase();
  const { data, error } = await supa
    .from('biomarkers')
    .insert(rows)
    .select('id');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ inserted: data?.length ?? 0 });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const session_id = url.searchParams.get('session_id');
  if (!session_id) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  }

  const supa = getServerSupabase();
  const { data, error } = await supa
    .from('biomarkers')
    .select('*')
    .eq('session_id', session_id)
    .order('computed_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
