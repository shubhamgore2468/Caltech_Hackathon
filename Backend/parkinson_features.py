"""
parkinson_features.py — Praat acoustic feature extraction for PD classifier.

Ports vmarpadge/Parkinsons-Detection-Using-Machine-Learning/features.py to
accept in-memory WAV bytes instead of a file path, so it works with FastAPI
UploadFile without touching the filesystem.

The 26 features produced here match exactly the column order of final2.csv
(columns 1–26, 0-indexed), which is what the trained scaler and classifier
were fitted on.  Do NOT reorder FEATURE_NAMES.

Note: parselmouth.Sound() requires a filesystem path (not BytesIO) in v0.4.x.
      We write bytes to a NamedTemporaryFile and clean up immediately after load.
"""

import logging
import os
import re
import tempfile
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# Ordered list of the 26 feature names — must match final2.csv column order.
FEATURE_NAMES: list[str] = [
    "jitter_local_pct",           # col 1
    "jitter_local_abs_sec",       # col 2
    "jitter_rap_pct",             # col 3
    "jitter_ppq5_pct",            # col 4
    "jitter_ddp_pct",             # col 5
    "shimmer_local_pct",          # col 6
    "shimmer_local_db",           # col 7
    "shimmer_apq3_pct",           # col 8
    "shimmer_apq5_pct",           # col 9
    "shimmer_apq11_pct",          # col 10
    "shimmer_dda_pct",            # col 11
    "ac_autocorrelation",         # col 12
    "nth_noise_to_harmonics",     # col 13
    "htn_harmonics_to_noise_db",  # col 14
    "median_pitch_hz",            # col 15
    "mean_pitch_hz",              # col 16
    "pitch_sd_hz",                # col 17
    "min_pitch_hz",               # col 18
    "max_pitch_hz",               # col 19
    "num_pulses",                 # col 20
    "num_periods",                # col 21
    "mean_period_sec",            # col 22
    "sd_period_sec",              # col 23
    "frac_unvoiced_frames_pct",   # col 24
    "num_voice_breaks",           # col 25
    "degree_voice_breaks_pct",    # col 26
]

_MIN_REPORT_NUMBERS = 40


def _load_sound_from_bytes(wav_bytes: bytes):
    """
    Write WAV bytes to a temp file and return parselmouth.Sound.
    Caller is responsible for deleting tmp_path when done.
    Returns (sound, tmp_path).
    """
    import parselmouth

    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".wav")
    try:
        os.write(tmp_fd, wav_bytes)
        os.close(tmp_fd)
        return parselmouth.Sound(tmp_path), tmp_path
    except Exception:
        try:
            os.close(tmp_fd)
        except OSError:
            pass
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def extract_features_from_bytes(wav_bytes: bytes) -> np.ndarray:
    """
    Extract 26 Praat acoustic features from in-memory WAV bytes.

    Returns:
        numpy array of shape (1, 26) in final2.csv column order.

    Raises:
        ImportError  — parselmouth not installed.
        ValueError   — audio too short or no voiced content detected.
        RuntimeError — Praat voice report could not be parsed.
    """
    import parselmouth.praat

    sound, tmp_path = _load_sound_from_bytes(wav_bytes)
    try:
        if sound.duration < 0.1:
            raise ValueError(
                f"Audio too short ({sound.duration:.3f}s); "
                "need ≥0.1 s of sustained phonation."
            )

        pitch = sound.to_pitch()
        pulses = parselmouth.praat.call([sound, pitch], "To PointProcess (cc)")
        voice_report: str = parselmouth.praat.call(
            [sound, pitch, pulses],
            "Voice report", 0.0, 0.0, 75, 600, 1.3, 1.6, 0.03, 0.45,
        )
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    # Parse every integer/float from the text report (order is stable in Praat).
    # Scientific-notation values appear as two consecutive matches:
    #   e.g. "2.348e-04" → ["2.348", "-04"] → joined as "2.348E-04"
    nums = re.findall(r"-?\d+\.?\d*", voice_report)

    if len(nums) < _MIN_REPORT_NUMBERS:
        raise ValueError(
            f"Praat voice report has only {len(nums)} numbers "
            f"(expected ≥{_MIN_REPORT_NUMBERS}). "
            "Recording may lack voiced content — use a sustained 'ahhh' vowel ≥1 s."
        )

    # Map report positions → 26 features (mirrors features.py from vmarpadge repo).
    features: list[float] = [
        float(nums[21]),                       # 1:  Jitter (local) %
        float(nums[22] + "E" + nums[23]),      # 2:  Jitter (local, absolute) sec
        float(nums[24]),                       # 3:  Jitter (rap) %
        float(nums[26]),                       # 4:  Jitter (ppq5) %
        float(nums[27]),                       # 5:  Jitter (ddp) %
        float(nums[28]),                       # 6:  Shimmer (local) %
        float(nums[29]),                       # 7:  Shimmer (local, dB)
        float(nums[31]),                       # 8:  Shimmer (apq3) %
        float(nums[33]),                       # 9:  Shimmer (apq5) %
        float(nums[35]),                       # 10: Shimmer (apq11) %
        float(nums[36]),                       # 11: Shimmer (dda) %
        float(nums[37]),                       # 12: AC (autocorrelation)
        float(nums[38]),                       # 13: NTH (noise-to-harmonics)
        float(nums[39]),                       # 14: HTN (harmonics-to-noise) dB
        float(nums[3]),                        # 15: Median pitch Hz
        float(nums[4]),                        # 16: Mean pitch Hz
        float(nums[5]),                        # 17: SD pitch Hz
        float(nums[6]),                        # 18: Min pitch Hz
        float(nums[7]),                        # 19: Max pitch Hz
        float(nums[8]),                        # 20: Number of pulses
        float(nums[9]),                        # 21: Number of periods
        float(nums[10] + "E" + nums[11]),      # 22: Mean period sec
        float(nums[12] + "E" + nums[13]),      # 23: SD period sec
        float(nums[14]),                       # 24: Fraction unvoiced frames %
        float(nums[17]),                       # 25: Number of voice breaks
        float(nums[18]),                       # 26: Degree of voice breaks %
    ]

    return np.array(features, dtype=float).reshape(1, -1)


def safe_extract_features(wav_bytes: bytes) -> dict[str, Any]:
    """
    Non-raising wrapper around extract_features_from_bytes.

    Returns one of:
        {"ok": True,  "features": np.ndarray shape (1, 26)}
        {"ok": False, "error": str}
    """
    try:
        arr = extract_features_from_bytes(wav_bytes)
        return {"ok": True, "features": arr}
    except ImportError as exc:
        return {"ok": False, "error": f"parselmouth not installed: {exc}"}
    except Exception as exc:
        logger.warning("Parkinson feature extraction failed: %s", exc)
        return {"ok": False, "error": str(exc)}
