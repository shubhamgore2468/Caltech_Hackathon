import { NextResponse } from 'next/server';

// FastAPI sidecar contract:
//   POST {VOICE_SVC_URL}/voice/turn
//   multipart/form-data:
//     audio: WAV PCM16 mono 16kHz
//     session_id: string
//     patient_id: string
//     include_biomarkers: 'true' to also extract Parselmouth + classifier features
//   Response: audio/wav body (TTS), headers:
//     X-User-Transcript: STT result
//     X-Assistant-Transcript: Claude reply text
//     X-Cognitive-Flags: optional JSON
//     X-Voice-Biomarkers: JSON dict (jitter/shimmer/hnr + pd_prediction/pd_probability)
//
// Backend owns conversation state keyed by session_id.

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
  console.log('[voice/turn] start svc_set=%s', Boolean(svc));
  if (!svc) {
    console.warn('[voice/turn] VOICE_SVC_URL missing');
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

  const includeBiomarkers = incoming.get('include_biomarkers');
  const forward = new FormData();
  forward.append('audio', audio, 'turn.wav');
  forward.append('session_id', String(sessionId));
  forward.append('patient_id', String(patientId));
  // Default ON — chunk 2 wiring. Frontend can pass 'false' to skip per-turn biomarkers.
  forward.append('include_biomarkers', includeBiomarkers === 'false' ? 'false' : 'true');

  const target = `${svc.replace(/\/$/, '')}/voice/turn`;
  const audioSize = audio instanceof Blob ? audio.size : 0;
  console.log('[voice/turn] fetch target=%s audio_bytes=%d session=%s', target, audioSize, sessionId);
  const ctrl = new AbortController();
  // Biomarker extraction adds ~5–15s (Praat + classifier). Was 30s; bump to 60s.
  const timer = setTimeout(() => {
    console.warn('[voice/turn] abort after 60s target=%s', target);
    ctrl.abort();
  }, 60_000);
  try {
    const res = await fetch(target, {
      method: 'POST',
      body: forward,
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[voice/turn] upstream status=%d body=%s', res.status, text.slice(0, 500));
      return NextResponse.json(
        { error: `voice service ${res.status}: ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const body = await res.arrayBuffer();
    const headers = new Headers();
    headers.set('Content-Type', res.headers.get('Content-Type') ?? 'audio/wav');
    const vbHeader = res.headers.get('X-Voice-Biomarkers');
    console.log(
      `[voice-biomarkers] proxy ${vbHeader ? 'header present' : 'header MISSING'} len=${vbHeader?.length ?? 0}`,
    );
    if (vbHeader) {
      try {
        const parsed = JSON.parse(vbHeader) as Record<string, unknown>;
        console.log('[voice-biomarkers] proxy parsed', {
          jitter_local_pct: parsed.jitter_local_pct,
          shimmer_local_pct: parsed.shimmer_local_pct,
          hnr_db: parsed.hnr_db,
          pd_probability: parsed.pd_probability,
          pd_risk_label: parsed.pd_risk_label,
          classifier_available: parsed.classifier_available,
        });
      } catch (err) {
        console.warn('[voice-biomarkers] proxy parse failed', err);
      }
    }
    for (const k of [
      'X-User-Transcript',
      'X-Assistant-Transcript',
      'X-Cognitive-Flags',
      'X-Voice-Biomarkers',
    ]) {
      const v = res.headers.get(k);
      if (v) headers.set(k, v);
    }
    console.log('[voice/turn] ok bytes=%d elapsed_ms=%d', body.byteLength, Date.now() - t0);
    return new Response(body, { status: 200, headers });
  } catch (e) {
    const info = describeError(e);
    console.error('[voice/turn] fetch failed target=%s elapsed_ms=%d %o', target, Date.now() - t0, info);
    return NextResponse.json(
      { error: 'voice turn fetch failed', detail: info, target },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
