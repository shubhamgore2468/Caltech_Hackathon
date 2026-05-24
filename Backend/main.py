import json
from pathlib import Path
from typing import Any, List

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import numpy as np
from scipy.signal import butter, filtfilt, find_peaks, medfilt, welch
from scipy.ndimage import uniform_filter1d

from analysis import get_session_confidence_intervals
from voice import VoiceConfigError, reset_session, synthesize, voice_turn
from voice_biomarkers import extract_voice_biomarkers

app = FastAPI(title="IMU Tremor + Voice API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "X-User-Transcript",
        "X-Assistant-Transcript",
        "X-Cognitive-Flags",
        "X-Voice-Biomarkers",
    ],
)


class IMUSample(BaseModel):
    t: float
    x: float
    y: float
    z: float


class AnalyzeRequest(BaseModel):
    patient_data: List[IMUSample] = Field(..., min_length=1)

# ── Existing camera biomarker models ──────────────────────────────────────────

class FrameData(BaseModel):
    timestamp_ms: float
    jaw_displacement: float
    forehead_green: float

class CameraPayload(BaseModel):
    duration_sec: float
    fps: float
    frames: List[FrameData]

# ── New clinical face models ───────────────────────────────────────────────────

class FaceFrame(BaseModel):
    timestamp_ms: float
    ear: float          # Eye Aspect Ratio (vertical / horizontal distance)
    mouth_area: float   # mouthVertical * mouthHorizontal (pixel units)

class FacePayload(BaseModel):
    duration_sec: float
    fps: float
    frames: List[FaceFrame]



@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    patient = [s.model_dump() for s in req.patient_data]
    try:
        return get_session_confidence_intervals(patient)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")


@app.post("/voice/turn")
async def voice_turn_endpoint(
    audio: UploadFile = File(...),
    session_id: str = Form(...),
    patient_id: str = Form(...),
    include_biomarkers: bool = Form(False),
):
    wav_bytes = await audio.read()
    if not wav_bytes:
        raise HTTPException(status_code=400, detail="Empty audio")

    try:
        result = await voice_turn(session_id, wav_bytes)
    except VoiceConfigError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Voice turn failed: {e}")

    headers: dict[str, str] = {
        "X-User-Transcript":    _sanitize_header(result["user_transcript"]),
        "X-Assistant-Transcript": _sanitize_header(result["assistant_transcript"]),
        "X-Cognitive-Flags":    json.dumps(result["cognitive_flags"]),
        "X-Patient-Id":         patient_id,
    }

    if include_biomarkers:
        try:
            biomarkers = await extract_voice_biomarkers(wav_bytes)
        except Exception:
            biomarkers = {}
        headers["X-Voice-Biomarkers"] = _sanitize_header(json.dumps(biomarkers))

    return Response(
        content=result["audio_wav"],
        media_type="audio/wav",
        headers=headers,
    )


_MAX_AUDIO_BYTES = 10 * 1024 * 1024  # 10 MB


@app.post("/voice/biomarkers")
async def voice_biomarkers_endpoint(
    audio: UploadFile = File(...),
    patient_id: str = Form(...),
):
    """
    Voice biomarker extraction endpoint for Parkinson's vocal risk assessment.

    Request  — multipart/form-data:
        audio      (file)   WAV audio, 16 kHz mono recommended, 3–5 s sustained vowel
        patient_id (string) Patient identifier

    Response — JSON:
        patient_id            string
        biomarkers            object  (all keys always present, failed values are null)
          parselmouth_available   bool
          jitter_local_pct        float | null   — elevated in PD
          shimmer_local_pct       float | null   — elevated in PD
          hnr_db                  float | null   — reduced in PD
          mean_pitch_hz           float | null
          classifier_available    bool           — true when pkl artifacts loaded
          pd_prediction           0 | 1 | null   — 0 healthy, 1 Parkinson's risk
          pd_probability          float | null   — 0.0–1.0 from predict_proba
          pd_vocal_risk_score     float | null   — same as pd_probability (compat alias)
          pd_risk_label           "low" | "moderate" | "high" | "unknown"
          wav2vec_available       bool

    Benchmark: 61% sensitivity on 28 independent UCI PD patients (held-out test set).
    Classifier: GradientBoostingClassifier trained on UCI Parkinson Speech Dataset
                (1040 samples, 26 Praat features, 70% 10-fold CV accuracy).
    Retrain:    python Backend/scripts/train_parkinson_classifier.py
    """
    wav_bytes = await audio.read()
    if not wav_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")
    if len(wav_bytes) > _MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Audio file too large ({len(wav_bytes):,} bytes). Max 10 MB.",
        )

    try:
        biomarkers: dict[str, Any] = await extract_voice_biomarkers(wav_bytes)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Biomarker extraction failed: {e}")

    return {
        "patient_id": patient_id,
        "biomarkers": biomarkers,
    }


@app.post("/voice/reset")
def voice_reset(session_id: str = Form(...)):
    reset_session(session_id)
    return {"status": "ok"}


class SayRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)


@app.post("/voice/say")
async def voice_say(req: SayRequest):
    """One-shot TTS: text -> Deepgram WAV. No session state mutated."""
    try:
        audio = await synthesize(req.text)
    except VoiceConfigError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS failed: {e}")
    return Response(content=audio, media_type="audio/wav")


def _sanitize_header(value: str) -> str:
    # HTTP headers must be latin-1 safe; strip newlines, escape non-ascii.
    return value.replace("\n", " ").replace("\r", " ").encode("ascii", "replace").decode("ascii")

def apply_bandpass(signal: np.ndarray, fps: float, lowcut: float, highcut: float, order: int = 3) -> np.ndarray:
    nyquist = 0.5 * fps
    low = lowcut / nyquist
    high = highcut / nyquist
    b, a = butter(order, [low, high], btype="band")
    return filtfilt(b, a, signal)

def extract_dominant_frequency(signal: np.ndarray, fps: float, min_hz: float, max_hz: float) -> float:
    frequencies, psd = welch(signal, fs=fps, nperseg=min(len(signal), 256))
    valid_idx = np.where((frequencies >= min_hz) & (frequencies <= max_hz))[0]
    if len(valid_idx) == 0:
        return 0.0
    peak_idx = np.argmax(psd[valid_idx])
    return float(frequencies[valid_idx][peak_idx])


# ── Existing endpoint: rPPG + facial tremor ───────────────────────────────────

@app.post("/api/biomarkers/camera")
async def process_camera_biomarkers(payload: CameraPayload):
    if len(payload.frames) < payload.fps * 5:
        raise HTTPException(status_code=400, detail="Insufficient frame data (need ≥5 s).")

    fps = payload.fps
    jaw_signal = np.array([f.jaw_displacement for f in payload.frames])
    green_signal = np.array([f.forehead_green for f in payload.frames])

    jaw_signal = jaw_signal - np.mean(jaw_signal)
    filtered_jaw = apply_bandpass(jaw_signal, fps, lowcut=3.5, highcut=7.0)
    tremor_amplitude = float(np.sqrt(np.mean(filtered_jaw ** 2)))
    tremor_hz = extract_dominant_frequency(filtered_jaw, fps, 4.0, 6.0)

    green_signal = green_signal - np.mean(green_signal)
    filtered_green = apply_bandpass(green_signal, fps, lowcut=0.7, highcut=4.0)
    hr_hz = extract_dominant_frequency(filtered_green, fps, 0.7, 4.0)
    heart_rate_bpm = hr_hz * 60.0

    return {
        "status": "success",
        "metrics": {
            "facial_tremor_amplitude": round(tremor_amplitude, 4),
            "facial_tremor_hz": round(tremor_hz, 2),
            "rppg_heart_rate_bpm": round(heart_rate_bpm, 1),
            "effective_fps": round(fps, 1),
        },
    }


# ── New endpoint: EAR blink rate + hypomimia score ────────────────────────────

@app.post("/api/biomarkers/clinical/face")
async def process_clinical_face(payload: FacePayload):
    """
    Accepts per-frame EAR + mouth area arrays from the Next.js client and returns:
      - blink_rate_bpm  : spontaneous blink rate (PD baseline < 10 bpm)
      - total_blinks    : raw count over the capture window
      - expressivity_variance : std of mouth area (low = hypomimia risk)
      - expressivity_cv_pct   : coefficient of variation (std/mean × 100) — scale-free
      - clinical_flags  : list of human-readable warnings
    """
    if len(payload.frames) < 30:
        raise HTTPException(status_code=400, detail="Need at least 30 frames for reliable analysis.")

    fps = payload.fps
    duration_sec = payload.duration_sec

    ear_array = np.array([f.ear for f in payload.frames], dtype=float)
    mouth_array = np.array([f.mouth_area for f in payload.frames], dtype=float)

    # ── 1. Blink Detection via EAR ─────────────────────────────────────────
    # Why rolling-baseline instead of detrend():
    #   detrend() only removes a linear slope — a head turn mid-test creates a
    #   non-linear EAR shift that still crosses a fixed threshold.
    #   Rolling baseline tracks the "open eye level" over a 2 s window, so any
    #   slow pose drift is absorbed into the baseline; only fast, deep drops
    #   (genuine blinks) show up in the residual.
    #
    # Pipeline:
    #  a) Median filter k=5 — kills single-frame jitter / tracking glitches
    #  b) Rolling baseline (2 s uniform window) — local open-eye reference
    #  c) ear_drop = baseline − smoothed: positive = eye is closing
    #  d) find_peaks on ear_drop with:
    #     height ≥ 0.06  → eye must drop 6% below its local baseline
    #                       (genuine blink ~12–18%; head artifact < 3–4%)
    #     prominence ≥ 0.05 → drop must be a distinct event, not gradual drift
    #     distance = 300 ms → physiological minimum inter-blink interval
    #     width = 65–500 ms → rejects single-frame spikes AND sustained closes

    # medfilt k=3: kills single-frame tracking glitches without erasing real blinks.
    # k=5 was too aggressive — a 3-frame blink at 15–20fps gets median-voted back to
    # "open" by the surrounding open-eye frames.
    smoothed_ear = medfilt(ear_array, kernel_size=3).astype(float)

    # Rolling baseline over 1.5 s: tracks the open-eye resting level while ignoring
    # individual blink dips (a 200ms blink in a 1.5s window shifts the baseline < 3%).
    baseline_frames = max(3, int(1.5 * fps))
    rolling_baseline = uniform_filter1d(smoothed_ear, size=baseline_frames, mode="nearest")

    ear_drop = rolling_baseline - smoothed_ear   # positive when eye is closing

    min_dist  = max(1, int(0.30 * fps))          # 300 ms min between blinks
    min_width = max(1, int(0.06 * fps))           # ~60 ms minimum blink width
    max_width = max(min_width + 1, int(0.45 * fps))  # 450 ms cap

    peaks, _ = find_peaks(
        ear_drop,
        height=0.04,        # eye must drop ≥4% below local baseline
                            # genuine blink drop ~12–18%; head artifact <3%
        prominence=0.03,    # distinct peak above surrounding noise
        distance=min_dist,
        width=(min_width, max_width),
    )

    total_blinks = int(len(peaks))
    blink_rate_bpm = (total_blinks / duration_sec) * 60.0

    # ── 2. Hypomimia Score via Mouth Area Variance ─────────────────────────
    # Remove outlier frames where no face was tracked (area == 0).
    valid_mouth = mouth_array[mouth_array > 0]
    if len(valid_mouth) < 10:
        expressivity_variance = 0.0
        expressivity_cv_pct = 0.0
    else:
        expressivity_variance = float(np.std(valid_mouth))
        mean_area = float(np.mean(valid_mouth))
        # Coefficient of variation: scale-free relative expressivity measure.
        # Healthy range typically > 5–10 %. PD hypomimia often < 3–5 %.
        expressivity_cv_pct = (expressivity_variance / mean_area * 100.0) if mean_area > 0 else 0.0

    # ── 3. Clinical flags ──────────────────────────────────────────────────
    flags: list[str] = []

    if blink_rate_bpm < 10.0:
        flags.append(
            f"Reduced blink rate ({blink_rate_bpm:.1f} bpm) — PD baseline is often < 10 bpm "
            f"(healthy: 15–20 bpm). Consistent with bradykinesia."
        )
    if expressivity_cv_pct < 5.0:
        flags.append(
            f"Low facial expressivity (CV = {expressivity_cv_pct:.1f} %) — may indicate "
            f"hypomimia (masked face). Healthy CV typically > 5–10 %."
        )
    if total_blinks == 0:
        flags.append("No blinks detected — verify face was fully in frame and EAR signal is valid.")

    return {
        "blink_rate_bpm": round(blink_rate_bpm, 2),
        "total_blinks": total_blinks,
        "expressivity_variance": round(expressivity_variance, 4),
        "expressivity_cv_pct": round(expressivity_cv_pct, 2),
        "clinical_flags": flags,
        "meta": {
            "frames_analysed": len(payload.frames),
            "valid_mouth_frames": int(len(valid_mouth)),
            "effective_fps": round(fps, 2),
            "duration_sec": duration_sec,
        },
    }