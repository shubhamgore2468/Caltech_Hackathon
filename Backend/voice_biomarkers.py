"""
Voice biomarker extraction for Parkinson's disease vocal risk assessment.

Pipeline:
  1. Parselmouth (Praat) — 26 acoustic features → GradientBoosting classifier
  2. Wav2Vec2 (facebook/wav2vec2-base-960h) — deep speech embeddings (optional)
  3. PD risk score from real trained classifier (falls back to heuristic if
     model files are missing)

Classifier artifacts (produced by Backend/scripts/train_parkinson_classifier.py):
    Backend/models/parkinson_classifier.pkl
    Backend/models/parkinson_scaler.pkl
    Backend/models/feature_names.json
"""

import io
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

import numpy as np

# ── Model paths ───────────────────────────────────────────────────────────────
_BACKEND_DIR = Path(__file__).resolve().parent
_CLASSIFIER_PATH = _BACKEND_DIR / "models" / "parkinson_classifier.pkl"
_SCALER_PATH = _BACKEND_DIR / "models" / "parkinson_scaler.pkl"

logger = logging.getLogger(__name__)

# ── Lazy-loaded models ────────────────────────────────────────────────────────
_wav2vec_processor = None
_wav2vec_model = None
_wav2vec_load_attempted = False

_pd_classifier = None
_pd_scaler = None
_pd_classifier_load_attempted = False


def _load_pd_classifier():
    """Load GradientBoosting classifier + scaler lazily on first call."""
    global _pd_classifier, _pd_scaler, _pd_classifier_load_attempted
    if _pd_classifier_load_attempted:
        return _pd_classifier, _pd_scaler
    _pd_classifier_load_attempted = True
    try:
        import joblib

        if not _CLASSIFIER_PATH.exists() or not _SCALER_PATH.exists():
            logger.warning(
                "Parkinson classifier artifacts not found at %s — "
                "run Backend/scripts/train_parkinson_classifier.py first. "
                "Falling back to heuristic.",
                _CLASSIFIER_PATH.parent,
            )
            return None, None

        _pd_classifier = joblib.load(_CLASSIFIER_PATH)
        _pd_scaler = joblib.load(_SCALER_PATH)
        logger.info("Parkinson classifier loaded from %s", _CLASSIFIER_PATH)
    except Exception as exc:
        logger.error("Failed to load Parkinson classifier: %s", exc)
    return _pd_classifier, _pd_scaler


def _load_wav2vec():
    global _wav2vec_processor, _wav2vec_model, _wav2vec_load_attempted
    if _wav2vec_load_attempted:
        return _wav2vec_processor, _wav2vec_model
    _wav2vec_load_attempted = True
    try:
        import torch  # noqa: F401
        from transformers import Wav2Vec2Model, Wav2Vec2Processor

        model_name = os.getenv("WAV2VEC_MODEL", "facebook/wav2vec2-base-960h")
        logger.info("Loading Wav2Vec2 model '%s' (first call – may take ~30s)...", model_name)
        _wav2vec_processor = Wav2Vec2Processor.from_pretrained(model_name, local_files_only=True)
        _wav2vec_model = Wav2Vec2Model.from_pretrained(model_name, local_files_only=True)
        _wav2vec_model.eval()
        logger.info("Wav2Vec2 model loaded successfully.")
    except (ImportError, OSError) as exc:
        # OSError covers Windows DLL load failures (e.g. conda torch ABI mismatch)
        logger.warning("torch/transformers unavailable; Wav2Vec2 features disabled. (%s)", exc)
    except Exception as exc:
        logger.error("Failed to load Wav2Vec2 model: %s", exc)
    return _wav2vec_processor, _wav2vec_model


# ── Wav2Vec2 feature extraction ───────────────────────────────────────────────

def extract_wav2vec_features(wav_bytes: bytes) -> dict[str, Any]:
    """
    Load the Wav2Vec2 model exactly as shown in the reference code (memory.md),
    accepting raw WAV bytes instead of a file path.

    Returns the mean-pooled embedding L2 norm and a cosine distance from a
    hardcoded healthy reference vector.

    INTEGRATION POINT: replace HEALTHY_REFERENCE_EMBEDDING below with a
    pre-computed mean embedding from real healthy speaker recordings.
    """
    try:
        import torch
        import librosa

        processor, model = _load_wav2vec()
        if processor is None or model is None:
            return {"wav2vec_available": False}

        # ── Step 1: load and resample to 16 kHz (matches reference code) ─────
        speech, _ = librosa.load(io.BytesIO(wav_bytes), sr=16000, mono=True)

        # ── Step 2: tokenise input audio and extract embeddings ──────────────
        inputs = processor(speech, sampling_rate=16000, return_tensors="pt", padding=True)
        with torch.no_grad():
            outputs = model(**inputs)

        # ── Step 3: mean-pool over time dimension ────────────────────────────
        audio_embeddings = torch.mean(outputs.last_hidden_state, dim=1).numpy()  # (1, 768)
        embedding: np.ndarray = audio_embeddings[0]  # (768,)

        l2_norm = float(np.linalg.norm(embedding))

        # ── Cosine distance from healthy reference ───────────────────────────
        # INTEGRATION POINT: replace with pre-computed healthy mean embedding.
        # Using a unit vector (all equal components) as a neutral placeholder.
        dim = embedding.shape[0]
        healthy_ref = np.ones(dim) / np.sqrt(dim)  # unit vector placeholder
        cos_sim = float(np.dot(embedding, healthy_ref) / (l2_norm * np.linalg.norm(healthy_ref) + 1e-9))
        cos_distance = round(1.0 - cos_sim, 6)

        return {
            "wav2vec_available": True,
            "voice_embedding_l2norm": round(l2_norm, 4),
            "voice_embedding_dim": int(dim),
            "voice_embedding_cosine_distance_healthy": cos_distance,
        }

    except (ImportError, OSError) as exc:
        return {"wav2vec_available": False, "wav2vec_error": f"Dependency unavailable: {exc}"}
    except Exception as exc:
        logger.error("Wav2Vec2 feature extraction failed: %s", exc)
        return {"wav2vec_available": False, "wav2vec_error": str(exc)}


# ── Parselmouth (Praat) feature extraction ────────────────────────────────────

def _safe(value: float | None, digits: int = 6) -> float | None:
    if value is None:
        return None
    if isinstance(value, float) and (value != value):  # NaN
        return None
    return round(float(value), digits)


def extract_parselmouth_features(wav_bytes: bytes) -> dict[str, Any]:
    """
    Extract clinical-grade voice biomarkers used in the Max Little / UCI
    Parkinson's dataset: jitter, shimmer, and HNR.

    Jitter  — cycle-to-cycle pitch period perturbation (%) → elevated in PD
    Shimmer — cycle-to-cycle amplitude perturbation (%)    → elevated in PD
    HNR     — harmonics-to-noise ratio (dB)               → reduced in PD
    """
    try:
        import parselmouth
        from parselmouth.praat import call

        # parselmouth.Sound requires a file path in v0.4.x — use a temp file.
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".wav")
        try:
            os.write(tmp_fd, wav_bytes)
            os.close(tmp_fd)
            sound = parselmouth.Sound(tmp_path)
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

        # Pitch
        pitch = sound.to_pitch()
        mean_pitch = call(pitch, "Get mean", 0, 0, "Hertz")

        # Glottal pulse train for jitter / shimmer
        point_process = call(sound, "To PointProcess (periodic, cc)", 75, 500)

        # Jitter measures
        jitter_local     = call(point_process, "Get jitter (local)",          0, 0, 0.0001, 0.02, 1.3)
        jitter_local_abs = call(point_process, "Get jitter (local, absolute)", 0, 0, 0.0001, 0.02, 1.3)
        jitter_rap       = call(point_process, "Get jitter (rap)",             0, 0, 0.0001, 0.02, 1.3)
        jitter_ppq5      = call(point_process, "Get jitter (ppq5)",            0, 0, 0.0001, 0.02, 1.3)
        jitter_ddp       = call(point_process, "Get jitter (ddp)",             0, 0, 0.0001, 0.02, 1.3)

        # Shimmer measures
        shimmer_local    = call([sound, point_process], "Get shimmer (local)",    0, 0, 0.0001, 0.02, 1.3, 1.6)
        try:
            shimmer_local_db = call([sound, point_process], "Get shimmer (local, dB)", 0, 0, 0.0001, 0.02, 1.3, 1.6)
        except Exception:
            shimmer_local_db = None
        shimmer_apq3     = call([sound, point_process], "Get shimmer (apq3)",     0, 0, 0.0001, 0.02, 1.3, 1.6)
        shimmer_apq5     = call([sound, point_process], "Get shimmer (apq5)",     0, 0, 0.0001, 0.02, 1.3, 1.6)
        shimmer_dda      = call([sound, point_process], "Get shimmer (dda)",      0, 0, 0.0001, 0.02, 1.3, 1.6)

        # Harmonics-to-Noise Ratio
        harmonicity = call(sound, "To Harmonicity (cc)", 0.01, 75, 0.1, 1.0)
        hnr = call(harmonicity, "Get mean", 0, 0)

        return {
            "parselmouth_available": True,
            "mean_pitch_hz":         _safe(mean_pitch, 2),
            "jitter_local_pct":      _safe(jitter_local * 100 if jitter_local else None, 4),
            "jitter_local_abs_sec":  _safe(jitter_local_abs, 8),
            "jitter_rap":            _safe(jitter_rap, 6),
            "jitter_ppq5":           _safe(jitter_ppq5, 6),
            "jitter_ddp":            _safe(jitter_ddp, 6),
            "shimmer_local_pct":     _safe(shimmer_local * 100 if shimmer_local else None, 4),
            "shimmer_local_db":      _safe(shimmer_local_db, 4),
            "shimmer_apq3":          _safe(shimmer_apq3, 6),
            "shimmer_apq5":          _safe(shimmer_apq5, 6),
            "shimmer_dda":           _safe(shimmer_dda, 6),
            "hnr_db":                _safe(hnr, 4),
        }

    except ImportError:
        return {"parselmouth_available": False, "parselmouth_error": "parselmouth not installed"}
    except Exception as exc:
        logger.error("Parselmouth feature extraction failed: %s", exc)
        return {"parselmouth_available": False, "parselmouth_error": str(exc)}


# ── PD vocal risk — classifier + heuristic fallback ──────────────────────────

def _heuristic_pd_risk(parselmouth_feats: dict, wav2vec_feats: dict) -> dict[str, Any]:
    """
    Threshold-based fallback used when the trained classifier is unavailable.
    Derived from Max Little et al. (2009) UCI Parkinson's reference ranges.
    """
    risk_factors: list[str] = []
    components: list[float] = []

    jitter  = parselmouth_feats.get("jitter_local_pct")
    shimmer = parselmouth_feats.get("shimmer_local_pct")
    hnr     = parselmouth_feats.get("hnr_db")

    if jitter is not None:
        if jitter > 2.0:
            components.append(1.0); risk_factors.append("high_jitter")
        elif jitter > 1.0:
            components.append(0.6); risk_factors.append("elevated_jitter")
        else:
            components.append(0.0)

    if shimmer is not None:
        if shimmer > 7.0:
            components.append(1.0); risk_factors.append("high_shimmer")
        elif shimmer > 4.0:
            components.append(0.5); risk_factors.append("elevated_shimmer")
        else:
            components.append(0.0)

    if hnr is not None:
        if hnr < 10.0:
            components.append(1.0); risk_factors.append("low_hnr")
        elif hnr < 16.0:
            components.append(0.5); risk_factors.append("reduced_hnr")
        else:
            components.append(0.0)

    cos_dist = wav2vec_feats.get("voice_embedding_cosine_distance_healthy")
    if cos_dist is not None and wav2vec_feats.get("wav2vec_available"):
        components.append(min(float(cos_dist) / 2.0, 1.0) * 0.25)

    if not components:
        return {
            "classifier_available": False,
            "pd_vocal_risk_score": None,
            "pd_probability": None,
            "pd_prediction": None,
            "pd_risk_label": "unknown",
            "pd_risk_factors": [],
        }

    score = float(np.mean(components))
    label = "low" if score < 0.25 else ("moderate" if score < 0.55 else "high")
    return {
        "classifier_available": False,
        "pd_vocal_risk_score": round(score, 4),
        "pd_probability": round(score, 4),
        "pd_prediction": int(score >= 0.5),
        "pd_risk_label": label,
        "pd_risk_factors": risk_factors,
    }


def compute_pd_risk_score(
    parselmouth_feats: dict,
    wav2vec_feats: dict,
    wav_bytes: bytes | None = None,
) -> dict[str, Any]:
    """
    Compute a PD vocal risk score using the trained GradientBoosting classifier
    when model artifacts are available, otherwise fall back to the heuristic.

    Returns keys:
        classifier_available  bool
        pd_prediction         int  0 (healthy) or 1 (PD)
        pd_probability        float 0.0–1.0
        pd_vocal_risk_score   float (same value — kept for frontend compat)
        pd_risk_label         "low" / "moderate" / "high"
    """
    classifier, scaler = _load_pd_classifier()

    if classifier is None or scaler is None or wav_bytes is None:
        return _heuristic_pd_risk(parselmouth_feats, wav2vec_feats)

    # Extract 26 Praat features needed by the trained model.
    try:
        from parkinson_features import safe_extract_features

        result = safe_extract_features(wav_bytes)
        if not result["ok"]:
            logger.warning(
                "26-feature extraction failed (%s); using heuristic.", result["error"]
            )
            out = _heuristic_pd_risk(parselmouth_feats, wav2vec_feats)
            out["feature_extraction_error"] = result["error"]
            return out

        X = result["features"]               # shape (1, 26)
        X_scaled = scaler.transform(X)

        pred = int(classifier.predict(X_scaled)[0])
        if hasattr(classifier, "predict_proba"):
            prob = float(classifier.predict_proba(X_scaled)[0][1])
        else:
            prob = float(pred)

        if prob < 0.35:
            label = "low"
        elif prob < 0.65:
            label = "moderate"
        else:
            label = "high"

        return {
            "classifier_available": True,
            "pd_prediction": pred,
            "pd_probability": round(prob, 4),
            "pd_vocal_risk_score": round(prob, 4),
            "pd_risk_label": label,
        }

    except Exception as exc:
        logger.error("Classifier inference failed: %s", exc)
        out = _heuristic_pd_risk(parselmouth_feats, wav2vec_feats)
        out["classifier_error"] = str(exc)
        return out


# ── Public API ────────────────────────────────────────────────────────────────

async def extract_voice_biomarkers(wav_bytes: bytes) -> dict[str, Any]:
    """
    Full extraction pipeline called by the FastAPI endpoint.
    Runs parselmouth synchronously and Wav2Vec2 synchronously (both are
    CPU-bound; offload to thread pool at the call site if needed).
    """
    parselmouth_feats = extract_parselmouth_features(wav_bytes)
    wav2vec_feats     = extract_wav2vec_features(wav_bytes)
    risk              = compute_pd_risk_score(parselmouth_feats, wav2vec_feats, wav_bytes)

    return {
        **parselmouth_feats,
        **wav2vec_feats,
        **risk,
    }
