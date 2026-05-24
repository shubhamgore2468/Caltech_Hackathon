import { NextResponse } from 'next/server';

// FastAPI sidecar contract:
//   POST {VOICE_SVC_URL}/voice/turn
//   multipart/form-data:
//     audio: WAV PCM16 mono 16kHz
//     session_id: string
//     patient_id: string
//   Response: audio/wav body (TTS), headers:
//     X-User-Transcript: STT result
//     X-Assistant-Transcript: Claude reply text
//     X-Cognitive-Flags: optional JSON
//
// Backend owns conversation state keyed by session_id.

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const svc = process.env.VOICE_SVC_URL;
  if (!svc) {
    return NextResponse.json(
      { error: 'VOICE_SVC_URL not configured' },
      { status: 503 },
    );
  }

  const incoming = await req.formData();
  const audio = incoming.get('audio');
  const sessionId = incoming.get('session_id');
  const patientId = incoming.get('patient_id');

  if (!(audio instanceof Blob) || !sessionId || !patientId) {
    return NextResponse.json(
      { error: 'missing audio | session_id | patient_id' },
      { status: 400 },
    );
  }

  const forward = new FormData();
  forward.append('audio', audio, 'turn.wav');
  forward.append('session_id', String(sessionId));
  forward.append('patient_id', String(patientId));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${svc.replace(/\/$/, '')}/voice/turn`, {
      method: 'POST',
      body: forward,
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `voice service ${res.status}: ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const body = await res.arrayBuffer();
    const headers = new Headers();
    headers.set('Content-Type', res.headers.get('Content-Type') ?? 'audio/wav');
    for (const k of ['X-User-Transcript', 'X-Assistant-Transcript', 'X-Cognitive-Flags']) {
      const v = res.headers.get(k);
      if (v) headers.set(k, v);
    }
    return new Response(body, { status: 200, headers });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
