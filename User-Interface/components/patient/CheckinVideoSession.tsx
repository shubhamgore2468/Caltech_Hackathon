'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Video } from 'lucide-react';

interface CheckinVideoSessionProps {
  onComplete: (durationSec: number) => void;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Live video check-in session — camera + mic preview with ephemeral recording.
 * Raw video is held in memory only for real-time analysis and discarded on end.
 *
 * INTEGRATION POINT: Stream B agent overlays questions on the video feed,
 * processes frames/audio live, and posts transcript to /api/conversations.
 */
export function CheckinVideoSession({ onComplete }: CheckinVideoSessionProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const [phase, setPhase] = useState<'intro' | 'live' | 'ending'>('intro');
  const [error, setError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const stopStream = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);

  async function startSession() {
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      chunksRef.current = [];
      if (typeof MediaRecorder !== 'undefined') {
        const recorder = new MediaRecorder(stream);
        recorderRef.current = recorder;
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.start(1000);
      }

      startTimeRef.current = Date.now();
      setElapsedSec(0);
      timerRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      setPhase('live');
    } catch {
      setError('Camera and microphone access are required for your check-in.');
    }
  }

  function endSession() {
    setPhase('ending');

    const durationSec = Math.max(1, Math.floor((Date.now() - startTimeRef.current) / 1000));

    recorderRef.current?.stop();
    recorderRef.current = null;
    // Ephemeral — discard chunks; real pipeline extracts biomarkers/transcript live
    chunksRef.current = [];
    stopStream();

    onComplete(durationSec);
  }

  if (phase === 'intro') {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
            <Video className="h-6 w-6 text-blue-800" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Video check-in</h2>
            <p className="text-sm text-slate-600">Speak naturally — your care assistant guides you</p>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">
          You&apos;ll see yourself on camera while a care assistant asks about sleep, alcohol use,
          mood, and how you&apos;ve been feeling. Video is processed during the session to extract
          clinical signals — it isn&apos;t stored as a recording file.
        </p>
        <ul className="mt-3 space-y-1 text-xs text-slate-500">
          <li>· Front camera + microphone</li>
          <li>· Spoken conversation (no typing)</li>
          <li>· Transcript and metrics saved for your clinician</li>
        </ul>
        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        <button
          type="button"
          onClick={startSession}
          className="mt-5 rounded-lg bg-blue-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-900"
        >
          Start video session
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl bg-slate-900 shadow-lg">
        <video
          ref={videoRef}
          playsInline
          muted
          className="aspect-[3/4] w-full object-cover sm:aspect-video"
        />

        {phase === 'live' && (
          <>
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 backdrop-blur-sm">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <span className="text-xs font-medium text-white">REC {formatElapsed(elapsedSec)}</span>
            </div>

            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 pt-12">
              <div className="flex items-center gap-1.5 text-xs font-medium text-white/90">
                <Sparkles className="h-3.5 w-3.5" />
                Care assistant
              </div>
              <p className="mt-1 text-sm text-white/80">
                Agent integration coming soon — questions about sleep, alcohol, symptoms, and more
                will appear here during your session.
              </p>
            </div>
          </>
        )}

        {phase === 'ending' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <p className="text-sm text-white">Processing session…</p>
          </div>
        )}
      </div>

      {phase === 'live' && (
        <button
          type="button"
          onClick={endSession}
          className="w-full rounded-lg bg-blue-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-900"
        >
          End session &amp; continue to tremor →
        </button>
      )}
    </div>
  );
}
