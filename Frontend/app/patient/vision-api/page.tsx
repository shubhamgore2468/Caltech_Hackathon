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

interface ClinicalResult {
  blink_rate_bpm: number;
  total_blinks: number;
  expressivity_variance: number;
  expressivity_cv_pct: number;
  clinical_flags: string[];
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

export default function ClinicalFacePipeline() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const rafRef = useRef(0);
  const runningRef = useRef(false);
  const framesRef = useRef<FrameSample[]>([]);
  const captureStartRef = useRef<number | null>(null);
  const lastFaceRef = useRef<{x:number;y:number;z:number}[] | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [status, setStatus] = useState('Loading AI model…');
  const [result, setResult] = useState<ClinicalResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load model once on mount
  useEffect(() => {
    let cancelled = false;

    // Silence MediaPipe stdout/stderr routed through console.error (XNNPACK / GL info logs)
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
        setStatus('Model ready — click Start 20s Capture');
      } catch (err) {
        setStatus(`Model failed to load: ${err instanceof Error ? err.message : String(err)}`);
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

  const submitFrames = useCallback(async (frames: FrameSample[]) => {
    setIsPosting(true);
    setStatus('Analysing…');
    setError(null);

    const fps = frames.length / CAPTURE_DURATION_SEC;

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
        throw new Error(`Server ${res.status}: ${body}`);
      }

      const data = await res.json();
      setResult(data);
      setStatus('Analysis complete');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('Analysis failed');
    } finally {
      setIsPosting(false);
    }
  }, []);

  const predictWebcam = useCallback(() => {
    if (!runningRef.current) return;

    // ── Capture stop check — runs every RAF tick, independent of face detection ──
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

      // Only process + redraw when a new video frame is available
      if (video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime;
        const now = performance.now();

        const results = landmarker.detectForVideo(video, now);

        if (results.faceLandmarks?.length > 0) {
          const face = results.faceLandmarks[0];
          lastFaceRef.current = face; // cache for head-turn drop frames

          // ── Compute EAR — average both eyes ─────────────────────────────
          // Averaging cancels head-turn perspective distortion (one eye narrows,
          // the other widens) while a real blink dips both equally.
          const lV = euclidean(face[LANDMARK_INDICES.leftEyeTop],  face[LANDMARK_INDICES.leftEyeBottom], W, H);
          const lH = euclidean(face[LANDMARK_INDICES.leftEyeInner], face[LANDMARK_INDICES.leftEyeOuter],  W, H);
          const rV = euclidean(face[LANDMARK_INDICES.rightEyeTop],  face[LANDMARK_INDICES.rightEyeBottom], W, H);
          const rH = euclidean(face[LANDMARK_INDICES.rightEyeInner], face[LANDMARK_INDICES.rightEyeOuter],  W, H);
          const earL = lH > 0 ? lV / lH : 0;
          const earR = rH > 0 ? rV / rH : 0;
          const ear = (earL + earR) / 2;

          // ── Compute Mouth Area ───────────────────────────────────────────
          const mouthVertical = euclidean(face[LANDMARK_INDICES.mouthTop], face[LANDMARK_INDICES.mouthBottom], W, H);
          const mouthHorizontal = euclidean(face[LANDMARK_INDICES.mouthLeft], face[LANDMARK_INDICES.mouthRight], W, H);
          const mouthArea = mouthVertical * mouthHorizontal;

          // ── Collect frame during active capture ──────────────────────────
          if (captureStartRef.current !== null) {
            framesRef.current.push({
              timestamp_ms: now,
              ear: parseFloat(ear.toFixed(5)),
              mouth_area: parseFloat(mouthArea.toFixed(3)),
            });
          }

          if (!captureStartRef.current) {
            setStatus('Face detected — press Start Capture');
          }
        }
        // (no face this frame — skip status update, keep last canvas draw intact)

        // ── Redraw canvas with current or cached landmarks ───────────────
        // Only resize canvas when dimensions actually change to avoid resets
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
            ctx.arc(p.x * W, p.y * H, 4, 0, 2 * Math.PI);
            ctx.fill();
          };

          drawDot(LANDMARK_INDICES.leftEyeTop,     '#00FFFF');
          drawDot(LANDMARK_INDICES.leftEyeBottom,  '#00FFFF');
          drawDot(LANDMARK_INDICES.leftEyeInner,   '#00BFFF');
          drawDot(LANDMARK_INDICES.leftEyeOuter,   '#00BFFF');
          drawDot(LANDMARK_INDICES.rightEyeTop,    '#00FFFF');
          drawDot(LANDMARK_INDICES.rightEyeBottom, '#00FFFF');
          drawDot(LANDMARK_INDICES.rightEyeInner,  '#00BFFF');
          drawDot(LANDMARK_INDICES.rightEyeOuter,  '#00BFFF');
          drawDot(LANDMARK_INDICES.mouthTop,    '#39FF14');
          drawDot(LANDMARK_INDICES.mouthBottom, '#39FF14');
          drawDot(LANDMARK_INDICES.mouthLeft,   '#ADFF2F');
          drawDot(LANDMARK_INDICES.mouthRight,  '#ADFF2F');

          // ── Live metric overlay (only when we have fresh detection) ──────
          if (results.faceLandmarks?.[0]) {
            const _lV = euclidean(faceToDraw[LANDMARK_INDICES.leftEyeTop],   faceToDraw[LANDMARK_INDICES.leftEyeBottom], W, H);
            const _lH = euclidean(faceToDraw[LANDMARK_INDICES.leftEyeInner], faceToDraw[LANDMARK_INDICES.leftEyeOuter],  W, H);
            const _rV = euclidean(faceToDraw[LANDMARK_INDICES.rightEyeTop],  faceToDraw[LANDMARK_INDICES.rightEyeBottom], W, H);
            const _rH = euclidean(faceToDraw[LANDMARK_INDICES.rightEyeInner],faceToDraw[LANDMARK_INDICES.rightEyeOuter],  W, H);
            const ear = ((_lH > 0 ? _lV/_lH : 0) + (_rH > 0 ? _rV/_rH : 0)) / 2;
            const mV = euclidean(faceToDraw[LANDMARK_INDICES.mouthTop], faceToDraw[LANDMARK_INDICES.mouthBottom], W, H);
            const mH = euclidean(faceToDraw[LANDMARK_INDICES.mouthLeft], faceToDraw[LANDMARK_INDICES.mouthRight], W, H);
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(8, 8, 210, 56);
            ctx.fillStyle = '#FFFFFF';
            ctx.font = '13px monospace';
            ctx.fillText(`EAR:        ${ear.toFixed(3)}`, 16, 28);
            ctx.fillText(`Mouth area: ${(mV * mH).toFixed(1)} px²`, 16, 48);
          }
        }
      }
    }

    rafRef.current = requestAnimationFrame(predictWebcam);
  }, [submitFrames]);

  const startStream = async () => {
    if (!landmarkerRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });

      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      await new Promise<void>((resolve) => {
        if (video.readyState >= 2 && video.videoWidth > 0) { resolve(); return; }
        video.onloadeddata = () => resolve();
      });

      lastVideoTimeRef.current = -1;
      runningRef.current = true;
      setStatus('Camera on — detecting face…');
      rafRef.current = requestAnimationFrame(predictWebcam);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Webcam permission denied');
    }
  };

  // Countdown ticker — runs on its own interval, not tied to RAF or face detection
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

  const startCapture = () => {
    if (!runningRef.current) return;
    framesRef.current = [];
    captureStartRef.current = performance.now();
    setResult(null);
    setError(null);
    setIsRecording(true);
    setCountdown(CAPTURE_DURATION_SEC);
    setStatus(`Capturing ${CAPTURE_DURATION_SEC}s…`);
  };

  const stopCamera = () => {
    stopLoop();
    captureStartRef.current = null;
    lastFaceRef.current = null;
    setIsRecording(false);
    setCountdown(null);

    const video = videoRef.current;
    const stream = video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (video) video.srcObject = null;
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setStatus('Camera stopped');
  };

  useEffect(() => {
    return () => {
      stopLoop();
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stopLoop]);

  const cameraOn = !!(videoRef.current?.srcObject);

  return (
    <div className="flex flex-col items-center min-h-screen bg-zinc-950 p-8 gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white">Facial Bradykinesia & Hypomimia Tracker</h1>
        <p className="text-sm text-zinc-400 mt-1">Clinical PD biomarker pipeline — EAR blink detection + mouth expressivity</p>
      </div>

      {/* Video + canvas overlay */}
      <div className="relative w-full max-w-2xl aspect-video bg-black rounded-xl overflow-hidden border border-zinc-800">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-contain -scale-x-100"
          playsInline
          muted
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-contain -scale-x-100 pointer-events-none z-10"
        />

        {/* Countdown badge */}
        {countdown !== null && (
          <div className="absolute top-3 right-3 z-20 flex items-center gap-2 bg-red-600/90 text-white rounded-full px-4 py-1.5 text-sm font-mono font-bold shadow-lg">
            <span className="animate-pulse h-2 w-2 rounded-full bg-white inline-block" />
            {countdown}s
          </div>
        )}

        {/* Status bar */}
        <div className="absolute bottom-0 inset-x-0 z-20 bg-black/60 px-4 py-2">
          <p className="text-xs text-zinc-300 text-center">{status}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 justify-center">
        {!cameraOn ? (
          <button
            onClick={startStream}
            disabled={!isReady}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg font-medium transition-colors"
          >
            {isReady ? 'Start Camera' : 'Loading Model…'}
          </button>
        ) : (
          <>
            <button
              onClick={startCapture}
              disabled={isRecording || isPosting}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg font-medium transition-colors"
            >
              {isRecording ? `Capturing… ${countdown}s` : `Start ${CAPTURE_DURATION_SEC}s Capture`}
            </button>
            <button
              onClick={stopCamera}
              className="px-6 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg font-medium transition-colors"
            >
              Stop Camera
            </button>
          </>
        )}
      </div>

      {/* Legend */}
      <div className="flex gap-6 text-xs text-zinc-400">
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-cyan-400 mr-1" />Eye landmarks (EAR)</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-lime-400 mr-1" />Mouth landmarks (Hypomimia)</span>
      </div>

      {/* Loading spinner */}
      {isPosting && (
        <div className="flex items-center gap-3 text-zinc-300 text-sm">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          Running clinical analysis on server…
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="w-full max-w-2xl bg-red-950 border border-red-700 rounded-lg p-4 text-sm text-red-300">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Results panel */}
      {result && !isPosting && (
        <div className="w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-xl p-6 space-y-4">
          <h2 className="text-white font-semibold text-lg">Clinical Results</h2>

          <div className="grid grid-cols-3 gap-4">
            <Metric
              label="Blink Rate"
              value={`${result.blink_rate_bpm.toFixed(1)}`}
              unit="bpm"
              sub="Healthy: 15–20 bpm"
              alert={result.blink_rate_bpm < 10}
            />
            <Metric
              label="Total Blinks"
              value={`${result.total_blinks}`}
              unit={`in ${CAPTURE_DURATION_SEC}s`}
              sub={`Expected: ${Math.round(15 * CAPTURE_DURATION_SEC / 60)}–${Math.round(20 * CAPTURE_DURATION_SEC / 60)}`}
              alert={result.total_blinks < Math.round(10 * CAPTURE_DURATION_SEC / 60)}
            />
            <Metric
              label="Expressivity CV"
              value={`${result.expressivity_cv_pct.toFixed(1)}`}
              unit="%"
              sub="Low CV = hypomimia risk"
              alert={result.expressivity_cv_pct < 5}
            />
          </div>

          {result.clinical_flags.length > 0 && (
            <div className="bg-amber-950/50 border border-amber-700 rounded-lg p-3 space-y-1">
              <p className="text-amber-400 text-xs font-semibold uppercase tracking-wide">Clinical flags</p>
              {result.clinical_flags.map((f, i) => (
                <p key={i} className="text-amber-200 text-sm">• {f}</p>
              ))}
            </div>
          )}

          <p className="text-zinc-500 text-xs">
            Raw expressivity variance: {result.expressivity_variance.toFixed(3)} px² · {framesRef.current.length} frames @ ~{(framesRef.current.length / CAPTURE_DURATION_SEC).toFixed(1)} fps
          </p>
        </div>
      )}
    </div>
  );
}

function Metric({
  label, value, unit, sub, alert,
}: {
  label: string; value: string; unit: string; sub: string; alert: boolean;
}) {
  return (
    <div className={`rounded-lg p-4 border ${alert ? 'bg-red-950/40 border-red-700' : 'bg-zinc-800 border-zinc-700'}`}>
      <p className="text-xs text-zinc-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${alert ? 'text-red-400' : 'text-white'}`}>{value}</p>
      <p className="text-xs text-zinc-500">{unit}</p>
      <p className="text-xs text-zinc-500 mt-1">{sub}</p>
      {alert && <p className="text-xs text-red-400 mt-1 font-medium">Below normal range</p>}
    </div>
  );
}