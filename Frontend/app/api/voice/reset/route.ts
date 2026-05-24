import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const svc = process.env.VOICE_SVC_URL;
  if (!svc) {
    return NextResponse.json({ error: 'VOICE_SVC_URL not configured' }, { status: 503 });
  }

  const incoming = await req.formData();
  const sessionId = incoming.get('session_id');
  if (!sessionId) {
    return NextResponse.json({ error: 'missing session_id' }, { status: 400 });
  }

  const forward = new FormData();
  forward.append('session_id', String(sessionId));

  try {
    const res = await fetch(`${svc.replace(/\/$/, '')}/voice/reset`, {
      method: 'POST',
      body: forward,
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `reset ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
    }
    return NextResponse.json({ status: 'ok' });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
