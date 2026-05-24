import { NextResponse } from 'next/server';

// FastAPI: POST {VOICE_SVC_URL}/voice/say  body {text} -> audio/wav
export const runtime = 'nodejs';

interface ErrCause {
  code?: string;
  errno?: string;
  syscall?: string;
  hostname?: string;
  address?: string;
  port?: number;
}

function describeError(e: unknown) {
  if (!(e instanceof Error)) return { message: String(e) };
  const cause = (e as { cause?: ErrCause }).cause ?? {};
  return {
    name: e.name,
    message: e.message,
    code: cause.code,
    errno: cause.errno,
    syscall: cause.syscall,
    hostname: cause.hostname,
    address: cause.address,
    port: cause.port,
  };
}

export async function POST(req: Request) {
  const t0 = Date.now();
  const svc = process.env.VOICE_SVC_URL;
  console.log('[voice/say] start svc_set=%s', Boolean(svc));
  if (!svc) {
    console.warn('[voice/say] VOICE_SVC_URL missing');
    return NextResponse.json({ error: 'VOICE_SVC_URL not configured' }, { status: 503 });
  }
  let body: { text?: string };
  try {
    body = await req.json();
  } catch (e) {
    console.warn('[voice/say] invalid JSON', describeError(e));
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const text = (body.text ?? '').trim();
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });

  const base = /^https?:\/\//i.test(svc) ? svc : `https://${svc}`;
  const target = `${base.replace(/\/$/, '')}/voice/say`;
  console.log('[voice/say] fetch target=%s text_len=%d', target, text.length);

  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    console.warn('[voice/say] abort after 20s target=%s', target);
    ctrl.abort();
  }, 20_000);
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('[voice/say] upstream status=%d body=%s', res.status, t.slice(0, 500));
      return NextResponse.json(
        { error: `voice service ${res.status}: ${t.slice(0, 300)}` },
        { status: 502 },
      );
    }
    const buf = await res.arrayBuffer();
    console.log('[voice/say] ok bytes=%d elapsed_ms=%d', buf.byteLength, Date.now() - t0);
    return new Response(buf, {
      status: 200,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'audio/wav' },
    });
  } catch (e) {
    const info = describeError(e);
    console.error('[voice/say] fetch failed target=%s elapsed_ms=%d %o', target, Date.now() - t0, info);
    return NextResponse.json(
      { error: 'voice fetch failed', detail: info, target },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
