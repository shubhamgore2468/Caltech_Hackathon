"""
train_parkinson_classifier.py — Train Parkinson's GradientBoosting classifier.

Downloads final2.csv from the vmarpadge GitHub repo (UCI Parkinson Speech
Dataset, 1040 samples × 26 acoustic features), trains the same
GradientBoostingClassifier used in the reference implementation, and saves:

    Backend/models/parkinson_classifier.pkl   — trained GradientBoostingClassifier
    Backend/models/parkinson_scaler.pkl       — fitted StandardScaler
    Backend/models/feature_names.json         — 26 feature names in column order

Run from the repo root:
    python Backend/scripts/train_parkinson_classifier.py

Or from anywhere with an explicit path:
    python "c:/path/to/Backend/scripts/train_parkinson_classifier.py"
"""

import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.preprocessing import StandardScaler

# ── Paths ─────────────────────────────────────────────────────────────────────
# Script lives at Backend/scripts/; walk up two levels to repo root.
REPO_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = REPO_ROOT / "Backend" / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

CSV_URL = (
    "https://raw.githubusercontent.com/"
    "vmarpadge/Parkinsons-Detection-Using-Machine-Learning/master/final2.csv"
)

# Column layout of final2.csv (no header row):
#   col 0          — Subject ID (ignored)
#   cols 1–26      — 26 acoustic features
#   col 27         — excluded (data-leakage column in source repo)
#   col 28         — binary label (1 = Parkinson's, 0 = Healthy)
FEATURE_COLS = list(range(1, 27))
LABEL_COL = 28

FEATURE_NAMES: list[str] = [
    "jitter_local_pct",
    "jitter_local_abs_sec",
    "jitter_rap_pct",
    "jitter_ppq5_pct",
    "jitter_ddp_pct",
    "shimmer_local_pct",
    "shimmer_local_db",
    "shimmer_apq3_pct",
    "shimmer_apq5_pct",
    "shimmer_apq11_pct",
    "shimmer_dda_pct",
    "ac_autocorrelation",
    "nth_noise_to_harmonics",
    "htn_harmonics_to_noise_db",
    "median_pitch_hz",
    "mean_pitch_hz",
    "pitch_sd_hz",
    "min_pitch_hz",
    "max_pitch_hz",
    "num_pulses",
    "num_periods",
    "mean_period_sec",
    "sd_period_sec",
    "frac_unvoiced_frames_pct",
    "num_voice_breaks",
    "degree_voice_breaks_pct",
]


# ── Data loading ──────────────────────────────────────────────────────────────

def load_dataset() -> pd.DataFrame:
    print(f"Downloading dataset from:\n  {CSV_URL}\n")
    try:
        df = pd.read_csv(CSV_URL, header=None)
    except Exception as exc:
        sys.exit(
            f"ERROR: Failed to download CSV: {exc}\n"
            "Fix: check internet access, or manually place final2.csv beside this script\n"
            "and update the load_dataset() call to pd.read_csv('final2.csv', header=None)."
        )

    print(f"Loaded {len(df)} rows × {len(df.columns)} columns.")
    assert len(df.columns) >= 29, (
        f"Expected ≥29 columns in final2.csv, got {len(df.columns)}."
    )
    return df


# ── Training ──────────────────────────────────────────────────────────────────

def train(df: pd.DataFrame) -> None:
    X = df.iloc[:, FEATURE_COLS].values.astype(float)
    y = df.iloc[:, LABEL_COL].values.astype(int)

    n_healthy = int((y == 0).sum())
    n_pd = int((y == 1).sum())
    print(f"Class balance — Healthy: {n_healthy}, Parkinson's: {n_pd}")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=0, stratify=y
    )

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)

    classifier = GradientBoostingClassifier(
        n_estimators=200,
        learning_rate=0.1,
        max_depth=5,
        random_state=0,
    )
    print("Training GradientBoostingClassifier(n_estimators=200, lr=0.1, depth=5) …")
    classifier.fit(X_train_s, y_train)

    cv = StratifiedKFold(n_splits=10, shuffle=True, random_state=42)
    scores = cross_val_score(classifier, X_train_s, y_train, cv=cv, scoring="accuracy")
    print(f"10-fold CV accuracy: {scores.mean():.4f} ± {scores.std():.4f}")

    y_pred = classifier.predict(X_test_s)
    print(f"\nTest-set confusion matrix:\n{confusion_matrix(y_test, y_pred)}")
    print(
        f"\nClassification report:\n"
        f"{classification_report(y_test, y_pred, target_names=['Healthy', 'Parkinsons'])}"
    )

    # ── Feature importance (top 5 for a quick sanity check) ───────────────────
    importances = classifier.feature_importances_
    top_idx = np.argsort(importances)[::-1][:5]
    print("Top-5 features by importance:")
    for rank, i in enumerate(top_idx, 1):
        print(f"  {rank}. {FEATURE_NAMES[i]:35s}  {importances[i]:.4f}")

    # ── Save artifacts ─────────────────────────────────────────────────────────
    clf_path = MODELS_DIR / "parkinson_classifier.pkl"
    scaler_path = MODELS_DIR / "parkinson_scaler.pkl"
    names_path = MODELS_DIR / "feature_names.json"

    joblib.dump(classifier, clf_path)
    joblib.dump(scaler, scaler_path)
    names_path.write_text(json.dumps(FEATURE_NAMES, indent=2), encoding="utf-8")

    print(
        f"\nArtifacts saved:\n"
        f"  {clf_path}\n"
        f"  {scaler_path}\n"
        f"  {names_path}\n"
        "\nDone — wire Backend/voice_biomarkers.py to load these and call predict_proba()."
    )


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    df = load_dataset()
    train(df)
