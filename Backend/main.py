import json
from pathlib import Path
from typing import Any, List

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from analysis import get_session_confidence_intervals
from voice import VoiceConfigError, reset_session, voice_turn
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


def _sanitize_header(value: str) -> str:
    # HTTP headers must be latin-1 safe; strip newlines, escape non-ascii.
    return value.replace("\n", " ").replace("\r", " ").encode("ascii", "replace").decode("ascii")
