'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// Clinical landmark indices (MediaPipe 468-point mesh)
// Left eye:  vertical 159→145, horizontal 33→133
// Right eye: vertical 386→374, horizontal 362→263  (mirrored mesh)
// Mouth:     vertical 13→14,   horizontal 78→308
const LANDMARK_INDICES = {
  leftEyeTop: 159,
  leftEyeBottom: 145,
  leftEyeInner: 33,
  leftEyeOuter: 133,
  rightEyeTop: 386,
  rightEyeBottom: 374,
  rightEyeInner: 362,
  rightEyeOuter: 263,
  mouthTop: 13,
  mouthBottom: 14,
  mouthLeft: 78,
  mouthRight: 308,
};

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8000';
const CAPTURE_DURATION_SEC = 20;

interface FrameSample {
  timestamp_ms: number;
  ear: number;
  mouth_area: number;
}

export interface ClinicalFaceResult {
  blink_rate_bpm: number;
  total_blinks: number;
  expressivity_variance: number;
  expressivity_cv_pct: number;
  clinical_flags: string[];
}

interface CheckinVideoSessionProps {
  onComplete: (durationSec: number, result?: ClinicalFaceResult) => void;
}

function euclidean(
  a: { x: number; y: number },
  b: { x: number; y: number },
  W: number,
  H: number,
): number {
  const dx = (a.x - b.x) * W;
  const dy = (a.y - b.y) * H;
  return Math.sqrt(dx * dx + dy * dy);
}

export function CheckinVideoSession({ onComplete }: CheckinVideoSessionProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const rafRef = useRef(0);
  const runningRef = useRef(false);
  const framesRef = useRef<FrameSample[]>([]);
  const captureStartRef = useRef<number | null>(null);
  const lastFaceRef = useRef<{ x: number; y: number; z: number }[] | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [status, setStatus] = useState('Loading face model…');
  const [result, setResult] = useState<ClinicalFaceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load MediaPipe model once
  useEffect(() => {
    let cancelled = false;

    const origError = console.error;
    const origWarn = console.warn;
    const origInfo = console.info;
    const isMpNoise = (args: unknown[]) => {
      const s = args.map((a) => (typeof a === 'string' ? a : '')).join(' ');
      return (
        s.includes('face_landmarker_graph') ||
        s.includes('gl_context') ||
        s.includes('XNNPACK') ||
        s.includes('TensorFlow Lite') ||
        s.includes('vision_wasm_internal')
      );
    };
    console.error = (...args: unknown[]) => {
      if (isMpNoise(args)) return;
      origError(...args);
    };
    console.warn = (...args: unknown[]) => {
      if (isMpNoise(args)) return;
      origWarn(...args);
    };
    console.info = (...args: unknown[]) => {
      if (isMpNoise(args)) return;
      origInfo(...args);
    };

    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
        );

        const create = (delegate: 'GPU' | 'CPU') =>
          FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: '/models/face_landmarker.task',
              delegate,
            },
            runningMode: 'VIDEO',
            numFaces: 1,
          });

        let landmarker: FaceLandmarker;
        try {
          landmarker = await create('GPU');
        } catch {
          landmarker = await create('CPU');
        }

        if (cancelled) {
          landmarker.close();
          return;
        }

        landmarkerRef.current = landmarker;
        setIsReady(true);
        setStatus('Model ready — tap Start Camera.');
      } catch (err) {
        setStatus(
          `Model failed to load: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();

    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      console.error = origError;
      console.warn = origWarn;
      console.info = origInfo;
    };
  }, []);

  const stopLoop = useCallback(() => {
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    lastVideoTimeRef.current = -1;
  }, []);

  const submitFrames = useCallback(
    async (frames: FrameSample[]) => {
      setIsPosting(true);
      setStatus('Analysing…');
      setError(null);

      const fps = frames.length / CAPTURE_DURATION_SEC;
      console.info(
        `[video-biomarkers] submit frames=${frames.length} fps=${fps.toFixed(2)}`,
      );

      try {
        const res = await fetch(`${BASE_URL}/api/biomarkers/clinical/face`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            duration_sec: CAPTURE_DURATION_SEC,
            fps: parseFloat(fps.toFixed(2)),
            frames,
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Server ${res.status}: ${body.slice(0, 200)}`);
        }

        const data = (await res.json()) as ClinicalFaceResult;
        console.info('[video-biomarkers] result', data);
        setResult(data);
        setStatus('Analysis complete.');
        // Stop the camera once we have a result — caller persists then advances.
        stopCamera();
        onComplete(CAPTURE_DURATION_SEC, data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[video-biomarkers] FAIL', msg);
        setError(msg);
        setStatus('Analysis failed.');
        // Even on failure, advance the checkin flow so user is not stuck.
        stopCamera();
        onComplete(CAPTURE_DURATION_SEC, undefined);
      } finally {
        setIsPosting(false);
      }
    },
    // stopCamera + onComplete are stable enough; we intentionally close over them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onComplete],
  );

  const predictWebcam = useCallback(() => {
    if (!runningRef.current) return;

    if (captureStartRef.current !== null) {
      const elapsed = (performance.now() - captureStartRef.current) / 1000;
      if (elapsed >= CAPTURE_DURATION_SEC) {
        runningRef.current = false;
        const captured = [...framesRef.current];
        captureStartRef.current = null;
        setIsRecording(false);
        setCountdown(null);
        submitFrames(captured);
        return;
      }
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;

    if (video && canvas && landmarker && video.readyState >= 2 && video.videoWidth > 0) {
      const W = video.videoWidth;
      const H = video.videoHeight;
      const ctx = canvas.getContext('2d')!;

      if (video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime;
        const now = performance.now();
        const results = landmarker.detectForVideo(video, now);

        if (results.faceLandmarks?.length > 0) {
          const face = results.faceLandmarks[0];
          lastFaceRef.current = face;

          const lV = euclidean(face[LANDMARK_INDICES.leftEyeTop], face[LANDMARK_INDICES.leftEyeBottom], W, H);
          const lH = euclidean(face[LANDMARK_INDICES.leftEyeInner], face[LANDMARK_INDICES.leftEyeOuter], W, H);
          const rV = euclidean(face[LANDMARK_INDICES.rightEyeTop], face[LANDMARK_INDICES.rightEyeBottom], W, H);
          const rH = euclidean(face[LANDMARK_INDICES.rightEyeInner], face[LANDMARK_INDICES.rightEyeOuter], W, H);
          const earL = lH > 0 ? lV / lH : 0;
          const earR = rH > 0 ? rV / rH : 0;
          const ear = (earL + earR) / 2;

          const mouthVertical = euclidean(face[LANDMARK_INDICES.mouthTop], face[LANDMARK_INDICES.mouthBottom], W, H);
          const mouthHorizontal = euclidean(face[LANDMARK_INDICES.mouthLeft], face[LANDMARK_INDICES.mouthRight], W, H);
          const mouthArea = mouthVertical * mouthHorizontal;

          if (captureStartRef.current !== null) {
            framesRef.current.push({
              timestamp_ms: now,
              ear: parseFloat(ear.toFixed(5)),
              mouth_area: parseFloat(mouthArea.toFixed(3)),
            });
          }

          if (!captureStartRef.current) {
            setStatus('Face detected — tap Start Capture.');
          }
        }

        if (canvas.width !== W || canvas.height !== H) {
          canvas.width = W;
          canvas.height = H;
        }
        ctx.clearRect(0, 0, W, H);

        const faceToDraw = results.faceLandmarks?.[0] ?? lastFaceRef.current;
        if (faceToDraw) {
          const drawDot = (idx: number, color: string) => {
            const p = faceToDraw[idx];
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(p.x * W, p.y * H, 3, 0, 2 * Math.PI);
            ctx.fill();
          };

          drawDot(LANDMARK_INDICES.leftEyeTop, '#00FFFF');
          drawDot(LANDMARK_INDICES.leftEyeBottom, '#00FFFF');
          drawDot(LANDMARK_INDICES.leftEyeInner, '#00BFFF');
          drawDot(LANDMARK_INDICES.leftEyeOuter, '#00BFFF');
          drawDot(LANDMARK_INDICES.rightEyeTop, '#00FFFF');
          drawDot(LANDMARK_INDICES.rightEyeBottom, '#00FFFF');
          drawDot(LANDMARK_INDICES.rightEyeInner, '#00BFFF');
          drawDot(LANDMARK_INDICES.rightEyeOuter, '#00BFFF');
          drawDot(LANDMARK_INDICES.mouthTop, '#39FF14');
          drawDot(LANDMARK_INDICES.mouthBottom, '#39FF14');
          drawDot(LANDMARK_INDICES.mouthLeft, '#ADFF2F');
          drawDot(LANDMARK_INDICES.mouthRight, '#ADFF2F');
        }
      }
    }

    rafRef.current = requestAnimationFrame(predictWebcam);
  }, [submitFrames]);

  // Countdown ticker — runs on its own interval
  useEffect(() => {
    if (!isRecording) return;
    const id = setInterval(() => {
      if (captureStartRef.current === null) return;
      const elapsed = (performance.now() - captureStartRef.current) / 1000;
      const remaining = Math.ceil(CAPTURE_DURATION_SEC - elapsed);
      setCountdown(remaining > 0 ? remaining : 0);
    }, 250);
    return () => clearInterval(id);
  }, [isRecording]);

  async function startStream() {
    if (!landmarkerRef.current) return;
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });

      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      await new Promise<void>((resolve) => {
        if (video.readyState >= 2 && video.videoWidth > 0) {
          resolve();
          return;
        }
        video.onloadeddata = () => resolve();
      });

      lastVideoTimeRef.current = -1;
      runningRef.current = true;
      setCameraOn(true);
      setStatus('Camera on — detecting face…');
      rafRef.current = requestAnimationFrame(predictWebcam);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Webcam permission denied');
      setStatus('Camera permission denied.');
    }
  }

  function startCapture() {
    if (!runningRef.current) return;
    framesRef.current = [];
    captureStartRef.current = performance.now();
    setResult(null);
    setError(null);
    setIsRecording(true);
    setCountdown(CAPTURE_DURATION_SEC);
    setStatus(`Capturing ${CAPTURE_DURATION_SEC}s…`);
  }

  function stopCamera() {
    stopLoop();
    captureStartRef.current = null;
    lastFaceRef.current = null;
    setIsRecording(false);
    setCountdown(null);

    const video = videoRef.current;
    const stream = video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (video) video.srcObject = null;
    const c = canvasRef.current;
    if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setCameraOn(false);
  }

  useEffect(() => {
    return () => {
      stopLoop();
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stopLoop]);

  return (
    <div className="space-y-3">
      <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-stone-300">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover -scale-x-100"
          playsInline
          muted
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover -scale-x-100 pointer-events-none z-10"
        />

        {countdown !== null && (
          <div className="absolute top-3 right-3 z-20 flex items-center gap-2 bg-red-600/90 text-white rounded-full px-3 py-1 text-xs font-mono font-bold shadow">
            <span className="animate-pulse h-2 w-2 rounded-full bg-white inline-block" />
            {countdown}s
          </div>
        )}

        <div className="absolute bottom-0 inset-x-0 z-20 bg-black/60 px-3 py-1.5">
          <p className="text-[11px] text-zinc-200 text-center">{status}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 justify-center">
        {!cameraOn ? (
          <button
            type="button"
            onClick={startStream}
            disabled={!isReady}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:bg-stone-300"
          >
            {isReady ? 'Start Camera' : 'Loading model…'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={startCapture}
              disabled={isRecording || isPosting}
              className="px-4 py-2 rounded-lg bg-blue-800 text-white text-sm font-medium disabled:bg-stone-300"
            >
              {isRecording ? `Capturing… ${countdown ?? CAPTURE_DURATION_SEC}s` : `Start ${CAPTURE_DURATION_SEC}s capture`}
            </button>
            <button
              type="button"
              onClick={stopCamera}
              className="px-4 py-2 rounded-lg border border-stone-300 text-sm"
            >
              Stop camera
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {result && !isPosting && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 font-mono space-y-0.5">
          <div className="font-sans font-medium text-[13px]">✓ video analysis</div>
          <div>blink rate {result.blink_rate_bpm.toFixed(1)} bpm · {result.total_blinks} blinks</div>
          <div>expressivity CV {result.expressivity_cv_pct.toFixed(1)}%</div>
          {result.clinical_flags.length > 0 && (
            <div className="text-amber-800 mt-1 space-y-0.5">
              {result.clinical_flags.map((f, i) => (
                <div key={i}>· {f}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
