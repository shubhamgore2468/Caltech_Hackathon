"""
test_direct.py — Test the PD classifier pipeline WITHOUT a running server.

Records from mic (or uses an existing WAV), calls extract_voice_biomarkers()
directly in-process.  No HTTP, no server, no firewall issues.

Usage:
    cd Backend
    python scripts/test_direct.py                   # 4-second mic recording
    python scripts/test_direct.py --duration 5      # 5-second recording
    python scripts/test_direct.py --file ahh.wav    # use existing file
    python scripts/test_direct.py --save ahh.wav    # also save recording
"""

import argparse
import asyncio
import io
import json
import struct
import sys
import wave
from pathlib import Path

# ── make sure Backend/ is on sys.path ────────────────────────────────────────
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import numpy as np
import sounddevice as sd

from voice_biomarkers import extract_voice_biomarkers

SAMPLE_RATE = 16000
CHANNELS    = 1


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--duration", type=float, default=4.0)
    p.add_argument("--file",     type=str,   default=None)
    p.add_argument("--save",     type=str,   default=None)
    return p.parse_args()


def record(duration: float) -> bytes:
    print(f"\n  Say 'ahhhhh' now — recording {duration:.0f} seconds ...")
    print("  (Hold a steady vowel sound into your mic)\n")
    frames = sd.rec(int(duration * SAMPLE_RATE), samplerate=SAMPLE_RATE,
                    channels=CHANNELS, dtype="int16")
    sd.wait()
    print("  Done recording.\n")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        samples = frames.flatten()
        wf.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    return buf.getvalue()


def print_results(result: dict) -> None:
    prob   = result.get("pd_probability")
    pred   = result.get("pd_prediction")
    label  = result.get("pd_risk_label", "unknown")
    clf_ok = result.get("classifier_available", False)
    p_ok   = result.get("parselmouth_available", False)

    print("=" * 55)
    print("  TREMELO — VOICE BIOMARKER RESULTS")
    print("=" * 55)

    if clf_ok and prob is not None:
        bar  = "█" * int(prob * 30) + "░" * (30 - int(prob * 30))
        icon = {"low": "GREEN  (low risk)", "moderate": "YELLOW (moderate)", "high": "RED    (high risk)"}.get(label, label)
        print(f"\n  PD probability : {prob:.1%}  {icon}")
        print(f"  [{bar}]")
        print(f"  Prediction     : {'Parkinsons risk' if pred == 1 else 'Healthy'}")
    else:
        print(f"\n  classifier_available : {clf_ok}")
        print(f"  pd_vocal_risk_score  : {result.get('pd_vocal_risk_score')}  ({label})")

    if p_ok:
        print(f"\n  Parselmouth features:")
        print(f"    jitter_local_pct  : {result.get('jitter_local_pct')}")
        print(f"    shimmer_local_pct : {result.get('shimmer_local_pct')}")
        print(f"    hnr_db            : {result.get('hnr_db')}")
        print(f"    mean_pitch_hz     : {result.get('mean_pitch_hz')}")
    else:
        print(f"\n  parselmouth error : {result.get('parselmouth_error')}")

    print(f"\n  wav2vec_available : {result.get('wav2vec_available', False)}")
    print("=" * 55)
    print("\n  Full JSON:")
    print(json.dumps(result, indent=4))


def main():
    args = parse_args()

    if args.file:
        print(f"  Using file: {args.file}")
        with open(args.file, "rb") as f:
            wav_bytes = f.read()
    else:
        wav_bytes = record(args.duration)

    if args.save and not args.file:
        with open(args.save, "wb") as f:
            f.write(wav_bytes)
        print(f"  Saved to: {args.save}\n")

    print("  Running classifier pipeline (no server needed)...\n")
    result = asyncio.run(extract_voice_biomarkers(wav_bytes))
    print_results(result)


if __name__ == "__main__":
    main()
