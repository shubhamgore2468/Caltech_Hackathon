# Parivo Health

**Longitudinal Parkinson's & dementia monitoring from a 20-second weekly check-in.**

Built for the Caltech Longevity Hackathon.

Parivo Health turns a laptop or phone into a clinical-grade tracker for the people living with Parkinson's disease — measuring kinematic tremor, vocal biomarkers, facial bradykinesia, and cognitive signals during a short guided conversation with an AI care assistant. Every metric is computed on-device or in a private backend; raw video and audio never leave the user's device for storage, only numerical biomarkers reach the care team.

---

## What it does

A patient opens the app once a week and goes through a 2-step guided check-in:

1. **Resting tremor capture** — phone-on-lap IMU recording (15 s) processed by a sliding-window STFT to estimate PD-band (3–6 Hz) and ET-band (4–12 Hz) power ratios with 95 % confidence intervals.
2. **Conversational session** — a Claude-powered assistant runs a brief check-in (mood, sleep, meds, plus a cognitive probe) while:
   - The microphone captures sustained speech → Praat (jitter, shimmer, HNR, pitch) + a trained GradientBoosting PD classifier (UCI Parkinson Speech Dataset, 26 acoustic features) returns a PD vocal-risk probability per turn.
   - The camera runs MediaPipe FaceLandmarker in-browser to compute EAR-based blink rate and mouth-area expressivity (hypomimia proxy).
   - The IMU keeps recording in the background; a 15-second slice is analyzed per conversational turn for postural tremor.
   - Per-turn cognitive flags from Claude (word-finding trouble, repetition), response latency, and content-word fluency feed a dementia composite.

All biomarkers flow into a risk-fusion layer that produces calibrated Parkinson's and dementia scores per session. Over multiple weeks, a Theil-Sen regression + Stouffer's combined Z-test surfaces statistically significant progression to the clinician dashboard.

## Admin Login
username - doctor
password - 123@321

---

## Architecture

```
┌──────────────────────────┐         ┌────────────────────────┐
│  Next.js 15 frontend     │         │  FastAPI sidecar       │
│  (App Router, RSC)       │◀────────│  (Python 3.11)         │
│                          │  HTTPS  │                        │
│  • Patient check-in UI   │         │  • Praat / parselmouth │
│  • Doctor dashboard      │         │  • GradientBoosting    │
│  • MediaPipe in-browser  │         │    PD classifier       │
│  • DeviceMotion capture  │         │  • Deepgram STT/TTS    │
│  • Claude conversation   │         │  • Anthropic Claude    │
│  • Risk fusion (TS)      │         │  • IMU STFT analysis   │
└──────────┬───────────────┘         │  • Wav2Vec2 (optional) │
           │                         └────────────────────────┘
           │
           ▼
┌──────────────────────────┐
│  Supabase (Postgres)     │
│                          │
│  patients · sessions     │
│  biomarkers · alerts     │
│  conversations           │
│  risk_scores             │
└──────────────────────────┘
```

### Frontend (`Frontend/`)

- **Next.js 15** (App Router, React 19, TypeScript)
- **Clerk** for patient auth
- **Tailwind v4** + shadcn/ui for styling
- **MediaPipe Tasks Vision** for in-browser face landmarking (468-point mesh, GPU delegate w/ CPU fallback)
- **DeviceMotion API** for IMU capture with custom hook (`useMotionCapture`) running at 60 Hz
- **Recharts** for clinician timeline visualization
- **Framer Motion** for landing page

Key routes:
- `/patient/checkin_v2` — production weekly check-in flow (upfront-permission gate, hidden video element for MediaPipe, push-to-talk mic)
- `/doctor/patient/[id]` — per-patient detail view with check-in picker, progression analysis, AI-generated summary
- `/patient/progress-reports` — patient-facing weekly trend recap

### Backend (`Backend/`)

- **FastAPI** + Uvicorn
- **parselmouth** (Praat bindings) for the 26 acoustic features
- **scikit-learn GradientBoostingClassifier** trained on the UCI Parkinson Speech Dataset (1040 samples, 70 % 10-fold CV accuracy, 61 % sensitivity on held-out test set)
- **scipy.signal** for IMU spectrogram + sliding-window confidence intervals
- **Deepgram** Nova-3 (STT) + Aura (TTS)
- **Anthropic Claude** for the conversational agent + scribe summaries
- **librosa + transformers** for optional Wav2Vec2 embeddings

Endpoints:
- `POST /analyze` — IMU session → PD/ET band-power ratios + 95 % CI
- `POST /voice/turn` — full conversational turn (STT → Claude → TTS) with optional inline biomarker extraction
- `POST /voice/biomarkers` — standalone voice biomarker extraction (3–5 s sustained vowel)
- `POST /api/biomarkers/clinical/face` — EAR blink rate + mouth-area expressivity from frame-level landmark data

### Data layer

Supabase Postgres with five tables: `patients`, `sessions`, `biomarkers`, `conversations`, `risk_scores`, `alerts`. Service-role key used server-side only.

### Risk fusion

Per-session weighted-z-score model (`Frontend/lib/biomarkers/fusion.ts`):
- **Parkinson's:** voice 40 % · motion 30 % · camera 20 % · wearable 10 %
- **Dementia:** conversation 40 % · voice 20 % · camera 20 % · wearable 15 % · motion 5 %

Reference means/stds derived from Max Little et al. (2009) and mPower priors. Sigmoid-squashed to [0, 1].

### Longitudinal progression

`Frontend/lib/clinical/progression.ts` implements Theil-Sen median-slope regression + 95 % prediction intervals on the last N sessions, then aggregates per-metric Z-scores with Stouffer's method. Requires ≥4 sessions; flags worsening at |Z| > 1.96.

---

## Setup

### Prerequisites

- **Node.js** ≥ 20 and **pnpm** (or npm)
- **Python** ≥ 3.11
- **ffmpeg** + **libsndfile** (for audio decoding)
- A **Supabase** project (free tier is fine)
- API keys: **Anthropic**, **Deepgram**, **Clerk**

### 1. Clone and install

```bash
git clone <repo-url> Parivo Health
cd Parivo Health
```

### 2. Backend

```bash
cd Backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Create `Backend/.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
DEEPGRAM_API_KEY=...
CLAUDE_MODEL=claude-sonnet-4-6
DEEPGRAM_TTS_MODEL=aura-asteria-en
DEEPGRAM_STT_MODEL=nova-3
```

Train the PD voice classifier (downloads the UCI dataset, produces `Backend/models/*.pkl`):

```bash
python scripts/train_parkinson_classifier.py
```

Start the API:

```bash
uvicorn main:app --reload --port 8000
```

Sanity-check the voice pipeline without a frontend:

```bash
python scripts/test_direct.py --duration 4
```

### 3. Frontend

```bash
cd ../Frontend
pnpm install                       # or: npm install
```

Create `Frontend/.env.local`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Anthropic (for /api/conversation/* server routes)
ANTHROPIC_API_KEY=sk-ant-...

# Clerk auth
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Backend sidecar
VOICE_SVC_URL=http://127.0.0.1:8000
MOTION_SVC_URL=http://127.0.0.1:8000
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000

# Demo mode (skip Supabase, use synthetic patient data)
NEXT_PUBLIC_USE_MOCK_DATA=false
```

Apply the Supabase schema (SQL migrations live in `Frontend/supabase/migrations/` if present; otherwise create the five tables `patients`, `sessions`, `biomarkers`, `conversations`, `risk_scores`, `alerts` matching the row shapes in `Frontend/lib/types.ts`).

Download the MediaPipe face model to `Frontend/public/models/face_landmarker.task`:

```bash
mkdir -p public/models
curl -L -o public/models/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
```

Start the dev server:

```bash
pnpm dev                           # or: npm run dev
```

App is at `http://localhost:3000`. Sign in, hit **Start Weekly Check-in** on the patient page.

### 4. Demo mode (no backend, no Supabase)

For a quick frontend-only walkthrough — landing page, doctor dashboard with synthetic data, mock weekly reports:

```bash
NEXT_PUBLIC_USE_MOCK_DATA=true pnpm dev
```

`MockDataBootstrap` seeds localStorage with 6 weeks of synthetic check-ins so the calendar and progress-reports view render fully.

---

## Repository layout

```
Parivo Health/
├─ Backend/
│  ├─ main.py                    FastAPI app, all endpoints
│  ├─ analysis.py                IMU STFT + 95 % CI math
│  ├─ voice.py                   Deepgram + Claude conversation loop
│  ├─ voice_biomarkers.py        Praat + classifier + Wav2Vec2 pipeline
│  ├─ parkinson_features.py      26-feature Praat extraction (UCI column order)
│  ├─ models/                    Trained .pkl artifacts (gitignored)
│  └─ scripts/
│     ├─ train_parkinson_classifier.py
│     ├─ test_direct.py          local-only test (no server)
│     └─ record_and_test.py      mic → /voice/biomarkers
│
├─ Frontend/
│  ├─ app/
│  │  ├─ api/                    Next.js route handlers (proxy to FastAPI + Supabase)
│  │  ├─ patient/checkin_v2/     production weekly check-in flow
│  │  ├─ doctor/patient/[id]/    clinician detail view
│  │  └─ page.tsx                landing page
│  ├─ components/
│  │  ├─ sensors/                MotionCapture + useMotionCapture
│  │  ├─ patient/                CheckinVideoSession, WeeklyCheckinCalendar
│  │  └─ doctor/                 ClinicalMetricCards, WeeklyProgressExplorer
│  └─ lib/
│     ├─ biomarkers/             motion, voice, camera, fusion
│     ├─ clinical/               progression, metric definitions
│     ├─ supabase/               server + client wrappers
│     └─ mock/                   synthetic data generator
│
└─ README.md
```

---

## Privacy

- Camera frames are processed in-browser by MediaPipe. Only numeric landmark-derived features (EAR per frame, mouth area) leave the device — never pixels.
- Audio is sent to Deepgram for transcription and to the FastAPI sidecar for biomarker extraction, but is never persisted server-side.
- All biomarkers stored in Postgres are numerical — no transcripts of audio, no images.
- The Claude conversation transcript is stored to enable the clinician scribe summary; it can be deleted per-session.

---

## Built at the Caltech Longevity Hackathon

Parivo Health was built end-to-end during the Caltech Longevity Hackathon. The goal: make passive, longitudinal neurodegenerative-disease monitoring accessible without specialized hardware, so that subtle progression — the kind that's invisible at quarterly clinic visits — gets caught in weeks, not years.