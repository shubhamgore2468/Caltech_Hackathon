"""
record_and_test.py — Record a sustained vowel from mic and send to /voice/biomarkers.

Usage:
    python Backend/scripts/record_and_test.py                  # 4s recording, default server
    python Backend/scripts/record_and_test.py --duration 5     # 5 second recording
    python Backend/scripts/record_and_test.py --url http://localhost:8000
    python Backend/scripts/record_and_test.py --save ahh.wav   # also save the wav file
    python Backend/scripts/record_and_test.py --file ahh.wav   # skip recording, use existing file

Requirements (already in your env):
    pip install sounddevice numpy
    pip install httpx   (or requests)
"""

import argparse
import io
import json
import struct
import sys
import wave

import numpy as np
import sounddevice as sd


# ── CLI args ──────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Record 'ahhh' and send to /voice/biomarkers")
    p.add_argument("--duration",    type=float, default=4.0,
                   help="Recording duration in seconds (default: 4)")
    p.add_argument("--url",         type=str,   default="http://localhost:8000",
                   help="Backend base URL (default: http://localhost:8000)")
    p.add_argument("--patient-id",  type=str,   default="demo-001",
                   help="Patient ID sent in the form field (default: demo-001)")
    p.add_argument("--save",        type=str,   default=None,
                   help="Optional path to save the recorded WAV (e.g. ahh.wav)")
    p.add_argument("--file",        type=str,   default=None,
                   help="Skip recording and send this existing WAV file instead")
    return p.parse_args()


# ── Recording ─────────────────────────────────────────────────────────────────

SAMPLE_RATE = 16000   # Hz — matches UCI training data
CHANNELS    = 1       # mono


def record(duration: float) -> bytes:
    """Record `duration` seconds of audio from the default mic. Returns PCM16 WAV bytes."""
    print(f"\n🎙  Say 'ahhhhh' now — recording for {duration:.0f} seconds ...")
    print("    (Speak clearly into your mic. Hold a steady sustained vowel.)\n")

    frames = sd.rec(
        int(duration * SAMPLE_RATE),
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype="int16",
    )
    sd.wait()   # block until recording is complete
    print("    Recording done.\n")

    return _to_wav_bytes(frames.flatten())


def _to_wav_bytes(samples: np.ndarray) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)           # 16-bit = 2 bytes
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    return buf.getvalue()


# ── HTTP request ──────────────────────────────────────────────────────────────

def send(wav_bytes: bytes, base_url: str, patient_id: str) -> dict:
    """POST wav_bytes to /voice/biomarkers. Uses httpx if available, else requests."""
    endpoint = base_url.rstrip("/") + "/voice/biomarkers"
    print(f"Sending {len(wav_bytes):,} bytes → {endpoint} ...\n")

    files   = {"audio":      ("recording.wav", wav_bytes, "audio/wav")}
    data    = {"patient_id": patient_id}

    try:
        import httpx
        with httpx.Client(timeout=120) as client:
            resp = client.post(endpoint, files=files, data=data)
    except ImportError:
        import requests
        resp = requests.post(endpoint, files=files, data=data, timeout=120)

    resp.raise_for_status()
    return resp.json()


# ── Pretty print ──────────────────────────────────────────────────────────────

def print_results(result: dict) -> None:
    bm = result.get("biomarkers", result)   # handle both wrapped and flat response

    # Classifier verdict
    clf_ok   = bm.get("classifier_available", False)
    prob     = bm.get("pd_probability")
    pred     = bm.get("pd_prediction")
    label    = bm.get("pd_risk_label", "unknown")
    p_label  = bm.get("parselmouth_available", False)

    print("=" * 55)
    print("  TREMELO — VOICE BIOMARKER RESULTS")
    print("=" * 55)

    if clf_ok and prob is not None:
        bar_len = int(prob * 30)
        bar = "█" * bar_len + "░" * (30 - bar_len)
        risk_emoji = {"low": "🟢", "moderate": "🟡", "high": "🔴"}.get(label, "⚪")
        print(f"\n  PD probability : {prob:.1%}  {risk_emoji} {label.upper()}")
        print(f"  [{bar}]")
        print(f"  Prediction     : {'Parkinsons risk' if pred == 1 else 'Healthy'}")
    else:
        print(f"\n  classifier_available : {clf_ok}")
        print(f"  pd_vocal_risk_score  : {bm.get('pd_vocal_risk_score')}  ({label})")

    if p_label:
        print(f"\n  Parselmouth features (for doctor charts):")
        print(f"    jitter_local_pct   : {bm.get('jitter_local_pct')}")
        print(f"    shimmer_local_pct  : {bm.get('shimmer_local_pct')}")
        print(f"    hnr_db             : {bm.get('hnr_db')}")
        print(f"    mean_pitch_hz      : {bm.get('mean_pitch_hz')}")
    else:
        print(f"\n  parselmouth error: {bm.get('parselmouth_error')}")

    print(f"\n  wav2vec_available    : {bm.get('wav2vec_available', False)}")
    print("=" * 55)
    print("\n  Full JSON response:")
    print(json.dumps(result, indent=4))


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    args = parse_args()

    if args.file:
        print(f"Using existing file: {args.file}")
        with open(args.file, "rb") as f:
            wav_bytes = f.read()
    else:
        wav_bytes = record(args.duration)

    if args.save and not args.file:
        with open(args.save, "wb") as f:
            f.write(wav_bytes)
        print(f"WAV saved to: {args.save}\n")

    try:
        result = send(wav_bytes, args.url, args.patient_id)
        print_results(result)
    except Exception as exc:
        print(f"\nERROR calling server: {exc}")
        print("Is the server running?  →  uvicorn main:app --reload --port 8000")
        sys.exit(1)


if __name__ == "__main__":
    main()
