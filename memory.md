# Parivo Health — 24h Hackathon Plan

## Context

Caltech Longevity Hackathon, 4-person team, 24h. Build Parivo Health: research data-gathering platform for Parkinson's & dementia longitudinal tracking. Two portals — patient (mobile, friendly) + doctor (clinical dashboard). Demo arc: patient does AI voice check-in + walk/tremor test → biomarkers extracted → composite risk score → doctor sees longitudinal trends + alerts.

User is tech lead coordinating all 4 streams. Original spec assumed IMU was an HTTP server; investigation shows it is actually a self-contained phone-side DeviceMotion capture UI (`/Users/shubhamgore/Development/Caltech/IMU/index.html`). Plan corrects for that and locks fidelity tradeoffs: real motion capture, mocked voice/camera (realistic values, no DSP), synthetic 6-week history with live session appended at demo time.

## Scope deltas vs. original spec

1. **IMU integration**: NOT a server. Port DeviceMotion + sample buffering logic from `IMU/index.html` (esp. the 60Hz throttle, `{t,x,y,z}` format, start/stop toggle, ~36k sample cap) into a React component `components/sensors/MotionCapture.tsx`. Drop `NEXT_PUBLIC_IMU_SERVER_URL` env var. Drop `fetchIMUSamples` HTTP function — replaced by `useMotionCapture()` hook returning `Sample[]` directly.
2. **Voice/camera biomarkers**: skip real DSP. `lib/biomarkers/voice.ts` and `lib/biomarkers/camera.ts` export same signatures as spec but return seeded/randomized plausible values (jitter 0.5–2%, shimmer 3–12%, blink_rate 12–25/min, etc.) keyed off session duration + patient seed. Mark every function with `// INTEGRATION POINT: replace mock with real DSP`. Saves ~6h.
3. **Motion biomarkers**: REAL. Inline Cooley-Tukey FFT, tremor_score (4–6Hz band power ratio), dominant_freq_hz, rms_acceleration, gait_variance. This is the centerpiece — phone is honest sensor.
4. **Seed strategy**: `scripts/seed-demo-data.ts` writes 6 weeks of synthetic sessions per demo patient with monotonic degradation curve. Live demo session appended at end of trend. Without seed, charts empty → demo fails.

## Shared contracts (lock at hour 2, do not change after)

Schema, types, API routes, env vars — use spec as-is, with two edits:
- Remove `NEXT_PUBLIC_IMU_SERVER_URL` from env.
- Add `DEMO_PATIENT_ID=demo-001` for hardcoded demo (no auth this cut).

All integration boundaries marked `// INTEGRATION POINT:` per spec.

## Stream assignments

### Stream A — Sensors + inference (tech lead)
Owns scaffold, schema, motion biomarkers (real), voice/camera mocks, risk fusion endpoint, all `/api/*` routes.

Critical files:
- `app/api/sessions/route.ts`, `app/api/sessions/[id]/route.ts`
- `app/api/biomarkers/route.ts`
- `app/api/risk-score/compute/route.ts`
- `app/api/patients/[id]/timeline/route.ts`
- `lib/biomarkers/motion.ts` — real FFT + tremor/gait
- `lib/biomarkers/voice.ts` — mocked, same signature as spec
- `lib/biomarkers/camera.ts` — mocked, same signature as spec
- `lib/biomarkers/fusion.ts` — heuristic weighted score, z-scored vs hardcoded reference means (constants from Max Little / mPower)
- `lib/supabase/{client,server}.ts`
- `lib/types.ts` — shared types per spec
- `components/sensors/MotionCapture.tsx` — ported from `IMU/index.html`, exposes `useMotionCapture({mode, durationSec})` hook
- `supabase/migrations/0001_init.sql`

### Stream B — Patient app + AI conversation (Teammate 2)
Owns `/patient/*` routes, Claude voice assistant, sensor orchestration, family caregiver view.

Critical files:
- `app/patient/page.tsx` — home, three flows
- `app/patient/checkin/page.tsx` — AI conversation, Web Speech API STT, browser TTS, embedded cognitive probes (3-word recall, animal fluency, optional clock drawing)
- `app/patient/test/page.tsx` — walk/tremor tests, consumes `useMotionCapture()` from Stream A
- `app/patient/family/page.tsx` — read-only caregiver summary
- `app/api/conversation/turn/route.ts` — streams Claude (claude-sonnet-4-5) with warm-assistant system prompt, weaves cognitive probes
- `lib/voice/transcribe.ts` — Web Speech API wrapper + text-input fallback

While in conversation: Stream B calls `extractVoiceBiomarkers()` + `extractCameraBiomarkers()` every 5s (both mocked), POSTs to `/api/biomarkers`. Logs transcript + cognitive_flags to `conversations` table.

### Stream C1 — Doctor charts + alerts (Teammate 3)
Owns `/doctor/*` routes, all Recharts, baseline alerts.

Critical files:
- `app/doctor/page.tsx` — patient list sortable by latest risk, alert badges
- `app/doctor/patient/[id]/page.tsx` — composite risk gauge, line charts (jitter, tremor_score, gait_variance, blink_rate, sleep), alert strip, session history table, transcript modal
- `app/doctor/cohort/page.tsx` — aggregate distributions, n≥5 guard
- `lib/alerts.ts` — `computeBaseline(patientId, metric, windowDays=30)` returns mean/stddev, flag when latest >2σ deviation

### Stream C2 — Wearable + export + seed (Teammate 4)
Owns wearable mock, CSV export, **seed data (highest demo priority)**.

Critical files:
- `lib/wearable/terra.ts` — mock client returning fixture (steps, HRV, sleep_quality, REM_minutes), `// INTEGRATION POINT: real Terra OAuth`
- `app/api/wearable/sync/route.ts` — pulls fixture, writes wearable biomarkers
- `app/api/export/csv/route.ts` — long-format CSV (session_id, timestamp, category, metric_name, value, unit)
- `scripts/seed-demo-data.ts` — **CRITICAL**: 6 weeks × ~3 sessions/week, monotonic degradation curve on jitter + tremor_score + gait_variance, flat-ish on others. Run before every demo rehearsal.

## Timeline

| Hour | Milestone |
|------|-----------|
| 0–2  | Stream A: scaffold, schema deployed, env shared, `MotionCapture` component ported from `IMU/index.html`. Push to repo. |
| 2    | B + C clone, install, verify local Supabase connection. Contracts frozen. |
| 2–8  | Parallel build. A: biomarker modules + risk fusion. B: patient routes + Claude conversation. C1: doctor list + charts skeleton. C2: seed script + wearable mock. |
| 8    | **Contract check**: B sends fake biomarker batch → A confirms in DB → C1 renders on chart. End-to-end pipe alive. |
| 8–14 | A: risk fusion endpoint. B: walk/tremor flow wired to real motion. C2: seed script run, charts populate. |
| 14   | **Full vertical slice**: live check-in → biomarkers → risk score → doctor chart. |
| 14–18| Polish, error states, loading states, permission denial flows. |
| 18   | Feature freeze. |
| 18–20| Bug fix only. |
| 20   | Run end-to-end demo 3× back-to-back. |
| 22   | Record backup video. |
| 23   | Slides + pitch rehearsal. |

## Verification (run before demo)

1. `pnpm dev` boots clean, no console errors on `/patient` and `/doctor`.
2. Seed: `pnpm tsx scripts/seed-demo-data.ts` populates 6wk history; `/doctor/patient/demo-001` shows full trend.
3. Tremor test on real phone: 15s capture → `motion` biomarkers row in Supabase with `tremor_score`, `hand_tremor_hz`, `rms_acceleration` non-zero. Confirm dominant_freq sits in 4–6Hz when shaking, ~0Hz at rest.
4. Walk test 30s → `gait_variance` populated.
5. Daily check-in: Claude conversation runs ≥3 turns, embeds at least one cognitive probe, transcript saved to `conversations`, voice + camera mocked biomarker rows written.
6. `POST /api/risk-score/compute` returns 0–1 scores for both diseases, `contributing_factors` jsonb populated.
7. Doctor view: latest live session appears at end of seeded trend, alert badge fires (because seed degradation curve crosses 2σ on jitter).
8. `GET /api/export/csv?patient_id=demo-001` downloads valid long-format CSV, opens in Excel.
9. Run full demo script (see spec section "Demo script") 3× without manual intervention between steps.

## Voice Classifier — Status (completed, branch: AbdulDag-voice-jitter)

Real GradientBoosting PD classifier is **live** in `Backend/voice_biomarkers.py`. No longer a mock or heuristic.

### What was built
- `Backend/parkinson_features.py` — ports vmarpadge `features.py` to accept in-memory WAV bytes (temp-file pattern for parselmouth 0.4.x)
- `Backend/models/parkinson_classifier.pkl` + `parkinson_scaler.pkl` + `feature_names.json` — trained artifacts
- `Backend/scripts/train_parkinson_classifier.py` — downloads UCI final2.csv, trains GradientBoostingClassifier, saves pkl
- `Backend/scripts/test_direct.py` — in-process test (no server needed): `python Backend/scripts/test_direct.py`
- `Backend/scripts/record_and_test.py` — mic recorder + HTTP test

### Dataset
UCI Parkinson Speech Dataset (Sakar 2013) via vmarpadge repo:
- 1040 samples × 26 Praat acoustic features, 56 subjects, balanced 520/520
- Training: `final2.csv` downloaded directly from GitHub
- Retrain: `python Backend/scripts/train_parkinson_classifier.py`

### Performance
- 10-fold CV accuracy: **70.1% ± 3.4%** (training set)
- Test set accuracy: **67%** (held-out 20% split)
- Independent benchmark: **61% sensitivity** on 28 held-out UCI PD patients (test_data.txt, never seen during training)
- Mean PD probability assigned to PD patients: 0.569

### API contract (`POST /voice/biomarkers`)
Request: `multipart/form-data` — `audio` (WAV file, 3–5s sustained vowel "ahhh") + `patient_id` (string). Max 10 MB.

Response always contains ALL keys (never absent, failed = null):
```json
{
  "patient_id": "demo-001",
  "biomarkers": {
    "parselmouth_available": true,
    "jitter_local_pct": 0.42,
    "shimmer_local_pct": 3.15,
    "hnr_db": 19.8,
    "mean_pitch_hz": 148.2,
    "classifier_available": true,
    "pd_prediction": 0,
    "pd_probability": 0.23,
    "pd_vocal_risk_score": 0.23,
    "pd_risk_label": "low",
    "wav2vec_available": false
  }
}
```

Graceful degradation: if pkl files missing → falls back to threshold heuristic with `classifier_available: false`.

### Production notes
- CPU-bound Praat + sklearn runs in thread pool (event loop never blocked)
- 10 MB file size cap enforced at endpoint
- `local_files_only=True` on wav2vec prevents accidental HuggingFace download hang
- NaN floats scrubbed from response (JSON spec violation)

## Non-goals (do not touch)

Auth, native mobile, real Terra OAuth, HIPAA. All marked with `// INTEGRATION POINT:` for post-hackathon.

## Risks

- **Web Speech API on iOS Safari**: spotty. Stream B must ship text-input fallback day-one, not as polish.
- **Phone HTTPS**: DeviceMotion permission requires secure context. Use `next dev --experimental-https` or tunnel via `ngrok`/`cloudflared` for phone testing. Stream A sets this up at hour 0.
- **Seed script timing**: if C2 slips past hour 14, demo charts are empty. C2's seed is higher priority than wearable + CSV.
- **Claude conversation latency**: stream tokens, don't await full response. System prompt kept short.


Why B over A: PD-fine-tuned models on Hub = sparse, sketchy provenance, trained on tiny datasets
  (often Italian PC-GITA sustained vowels). Demo on English spontaneous speech → garbage. Embeddings
   + your own light head = honest + matches your existing // INTEGRATION POINT story.

  Hackathon reality (24h, demo > accuracy):
  - No labeled clinical data to train SVM/XGBoost head. UCI Max Little dataset = jitter/shimmer
  features, NOT raw wav → can't train on wav2vec embeddings directly.
  - Real options:
    a. Ship embeddings only — extract WavLM/HuBERT mean-pooled vector, store as biomarker
  voice_embedding_l2norm + cosine-distance vs healthy ref vector hardcoded from 1-2 sample clips.
  Cheap proxy, honest framing ("distance from healthy speech manifold").
    b. Skip wav2vec, do classic on Deepgram audio — parselmouth jitter/shimmer/HNR on the WAV
  /voice/turn already receives. Train tiny logreg on UCI offline → ship .pkl. Matches your CLAUDE.md
    b. Skip wav2vec, do classic on Deepgram audio — parselmouth jitter/shimmer/HNR on the WAV /voice/turn already
  receives. Train tiny logreg on UCI offline → ship .pkl. Matches your CLAUDE.md plan exactly.
    c. Pretrained PD model direct — pick one (e.g. search Hub parkinson), wrap in pipeline, accept it'll be wrong on
  demo audio. Lowest effort, highest demo-risk if judge tests it.

  Recommend #2 — fits existing mocked lib/biomarkers/voice.ts signature, swap mock for real numbers, no model-mismatch
  can't train on wav2vec embeddings directly.
  - Real options:
    a. Ship embeddings only — extract WavLM/HuBERT mean-pooled vector, store as biomarker voice_embedding_l2norm +
  cosine-distance vs healthy ref vector hardcoded from 1-2 sample clips. Cheap proxy, honest framing ("distance from
  healthy speech manifold").
    b. Skip wav2vec, do classic on Deepgram audio — parselmouth jitter/shimmer/HNR on the WAV /voice/turn already
  receives. Train tiny logreg on UCI offline → ship .pkl. Matches your CLAUDE.md plan exactly.
    c. Pretrained PD model direct — pick one (e.g. search Hub parkinson), wrap in pipeline, accept it'll be wrong on
  demo audio. Lowest effort, highest demo-risk if judge tests it.

  Recommend #2 — fits existing mocked lib/biomarkers/voice.ts signature, swap mock for real numbers, no model-mismatch
  failure mode, runs CPU-fast in FastAPI. Add WavLM embedding as bonus biomarker later if time.

  Where it slots:
  - Backend/voice.py /voice/turn already has WAV → tee audio bytes to new Backend/voice_biomarkers.py async after
  Deepgram call.
  - Return extra header X-Voice-Biomarkers JSON or (better) frontend POSTs to /api/biomarkers w/ values from response
  body.
  - Schema: no migration needed — biomarkers table already typed.

  Gotchas:
  - 16kHz resample mandatory for any HF model (you're already capturing 16kHz mono PCM16, good).
  - Sustained-vowel vs conversational: UCI = sustained "ahh". Your checkin = spontaneous. Jitter/shimmer still degrade
  w/ PD on spontaneous but reference means shift. Add cognitive probe "say ahh for 5 seconds" as one checkin turn →
  clean sustained sample for the classifier.
  - Deepgram already strips noise some. If raw bad, noisereduce pip one-liner.

  Want me to wire #2 (parselmouth + UCI logreg sidecar route)? Or want full Wav2Vec2 embedding path despite the dataset
  gap?


  use this as reference: 

  import torch
import librosa
from transformers import Wav2Vec2Model, Wav2Vec2Processor
import joblib # To load your trained ML head

# 1. Load the raw audio and resample to 16kHz (Standard for HF audio models)
audio_path = "patient_voice_sample.wav"
speech, sample_rate = librosa.load(audio_path, sr=16000)

# 2. Load the processor and model from Hugging Face
processor = Wav2Vec2Processor.from_pretrained("facebook/wav2vec2-base-960h")
model = Wav2Vec2Model.from_pretrained("facebook/wav2vec2-base-960h")

# 3. Tokenize input audio and extract embeddings
inputs = processor(speech, sampling_rate=16000, return_tensors="pt", padding=True)
with torch.no_grad():
    outputs = model(**inputs)

# Pool the embeddings over the time dimension (Mean pooling)
audio_embeddings = torch.mean(outputs.last_hidden_state, dim=1).numpy()

# 4. Pass the deep features into your custom diagnostic ML model
# (Assumes you have previously trained an SVM/XGBoost model on these embeddings)
classifier = joblib.load("parkinsons_svm_classifier.pkl")
diagnosis = classifier.predict(audio_embeddings)

print(f"Prediction (0 = Healthy, 1 = Parkinson's): {diagnosis[0]}")