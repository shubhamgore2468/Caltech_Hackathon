import { NextResponse } from 'next/server';

// FastAPI: POST {VOICE_SVC_URL}/voice/say  body {text} -> audio/wav
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const svc = process.env.VOICE_SVC_URL;
  if (!svc) {
    return NextResponse.json({ error: 'VOICE_SVC_URL not configured' }, { status: 503 });
  }
  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const text = (body.text ?? '').trim();
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`${svc.replace(/\/$/, '')}/voice/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json(
        { error: `voice service ${res.status}: ${t.slice(0, 300)}` },
        { status: 502 },
      );
    }
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'audio/wav' },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
