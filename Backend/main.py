import json
from pathlib import Path
from typing import List

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from analysis import get_session_confidence_intervals
from voice import VoiceConfigError, reset_session, voice_turn

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

    headers = {
        "X-User-Transcript": _sanitize_header(result["user_transcript"]),
        "X-Assistant-Transcript": _sanitize_header(result["assistant_transcript"]),
        "X-Cognitive-Flags": json.dumps(result["cognitive_flags"]),
        "X-Patient-Id": patient_id,
    }
    return Response(
        content=result["audio_wav"],
        media_type="audio/wav",
        headers=headers,
    )


@app.post("/voice/reset")
def voice_reset(session_id: str = Form(...)):
    reset_session(session_id)
    return {"status": "ok"}


def _sanitize_header(value: str) -> str:
    # HTTP headers must be latin-1 safe; strip newlines, escape non-ascii.
    return value.replace("\n", " ").replace("\r", " ").encode("ascii", "replace").decode("ascii")
