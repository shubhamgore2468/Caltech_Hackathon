from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
import numpy as np
from scipy.signal import butter, filtfilt, welch, find_peaks
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Longevity Biomarkers API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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

# ── Shared DSP helpers ─────────────────────────────────────────────────────────

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
    # Blinks manifest as sharp dips in EAR. Invert so dips become peaks for
    # find_peaks. A prominence of 0.02 (~10 % of a typical EAR range of 0.2)
    # filters noise while catching genuine blinks.
    # Minimum inter-blink distance: 200 ms (blinks can't follow faster than ~5 Hz).
    inverted_ear = -ear_array
    min_distance_frames = max(1, int(0.20 * fps))  # 200 ms guard

    peaks, properties = find_peaks(
        inverted_ear,
        prominence=0.02,
        distance=min_distance_frames,
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
