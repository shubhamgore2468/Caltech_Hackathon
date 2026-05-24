# NeuroTrack — Project Handoff Notes

> Living doc. Update at every milestone so a fresh chat can resume without context bloat.
> Master plan: `/Users/shubhamgore/.claude/plans/help-build-a-plan-cozy-muffin.md`

## What this is
Caltech Longevity Hackathon, 24h, 4-person team (1 tech lead + 3 builders). Research data-gathering platform for Parkinson's + dementia longitudinal tracking. Two portals: `/patient` (mobile, friendly) + `/doctor` (clinical). Demo arc: AI voice check-in + walk/tremor test → biomarkers → composite risk score → doctor sees longitudinal trends.

User = tech lead **+ Teammate 2 (Brain person)**. Owns backend, motion biomarkers, voice biomarkers (mocked), risk fusion, Claude conversation page, walk/tremor test pages. Plus glue + review + demo prep.

## Team split (3 builders)

### teammate 1 — "Screens person" (Frontend + Stream C)
Builds what stuff **looks like** + fake data layer.
- `/doctor/page.tsx` patient list w/ alert badges
- `/doctor/patient/[id]/page.tsx` risk gauge + Recharts trend lines + session history + transcript modal
- `/doctor/cohort/page.tsx` aggregate distributions (n≥5 guard)
- `/patient/page.tsx` home (3 buttons: check-in, walk, tremor) + `/patient/family/page.tsx` caregiver read-only view
- `lib/alerts.ts` 30-day rolling baseline + 2σ deviation
- `lib/wearable/terra.ts` mock fixture (steps/HRV/sleep) + `app/api/wearable/sync/route.ts`
- `app/api/export/csv/route.ts` long-format CSV
- **CRITICAL: `scripts/seed-demo-data.ts`** — 6 weeks fake sessions w/ monotonic degradation curve. Without this, demo charts empty.

### teammate 2 — "Brain person" (Backend + Stream A + Stream B minus camera)
Builds what stuff **does**.
- All core API routes: `app/api/{sessions,sessions/[id],biomarkers,risk-score/compute,patients/[id]/timeline,conversation/turn}/route.ts` w/ zod validation
- `lib/biomarkers/motion.ts` — REAL inline Cooley-Tukey FFT, tremor_score (4–6Hz band power), dominant_freq_hz, rms_acceleration, gait_variance, hand_tremor_hz
- `lib/biomarkers/voice.ts` — MOCKED seeded values now, `// INTEGRATION POINT: real DSP later` (Python sidecar w/ librosa+parselmouth+UCI Max Little ML)
- `lib/biomarkers/fusion.ts` + risk-score endpoint w/ documented weights
- `app/patient/checkin/page.tsx` — Claude conversation streaming via Web Speech STT + browser TTS, text-input fallback day-one. Embeds cognitive probes (3-word recall, animal fluency)
- `app/patient/test/page.tsx` — walk + tremor tests, drops in `MotionCapture` component (already built)
- `lib/voice/transcribe.ts` — Web Speech wrapper

### teammate 3 — "Camera person"
Builds face-watching pipeline.
- `lib/biomarkers/camera.ts` — facial_tremor (landmark displacement stddev around mouth/jaw), blink_rate (eye aspect ratio threshold), hypomimia proxy (landmark variance), rPPG heart rate (forehead green channel FFT 0.7–4Hz)
- `components/sensors/CameraCapture.tsx` + `useCameraCapture.ts` — MediaPipe Face Landmarker WASM, front cam stream, mirror MotionCapture API: `<CameraCapture durationSec onComplete={(frames) => ...} />`
- Plugs into Friend 2's `/patient/checkin/page.tsx` as child component. Friend 3 props locked at hour 4.

### Tech lead
- Code review, merge gating, resolve schema/contract conflicts
- Run hour 8 contract check (B → A → C round trip w/ fake biomarker batch)
- Run hour 14 vertical slice (real check-in lands in real chart)
- Seed sanity check, demo polish, hour 22 backup video, hour 23 slides + pitch

## Lock rule
Database tables + API URLs frozen at hour 2. After that NOBODY changes them. Schema drift mid-night = whole team breaks.

## Stack (locked)
Next.js 15 App Router · TypeScript · Tailwind · shadcn/ui · Supabase (Postgres + Auth + Storage) · Anthropic Claude API (`claude-sonnet-4-5` conversation, `claude-haiku-4-5` cheap ops) · Recharts · MediaPipe Face Landmarker · Web Speech API.

## Fidelity decisions (locked)
- **Motion**: REAL. FFT, tremor 4–6Hz band, gait variance. Port from `/Users/shubhamgore/Development/Caltech/IMU/index.html` (DeviceMotion @ 60Hz, `{t,x,y,z}` samples, 36k cap).
- **Voice + Camera**: MOCKED. Realistic seeded values. Same signatures as spec. `// INTEGRATION POINT:` comments.
- **Wearable**: MOCKED Terra fixture.
- **Seed data**: 6 weeks synthetic monotonic degradation + live demo session appended.
- **Auth**: NONE. `DEMO_PATIENT_ID=demo-001` env.

## Repo layout (target)
```
project/
├── app/
│   ├── api/{sessions,biomarkers,risk-score/compute,patients/[id]/timeline,conversation/turn,wearable/sync,export/csv}/route.ts
│   ├── patient/{page,checkin/page,test/page,family/page}.tsx
│   └── doctor/{page,patient/[id]/page,cohort/page}.tsx
├── components/sensors/MotionCapture.tsx
├── lib/
│   ├── biomarkers/{motion,voice,camera,fusion}.ts
│   ├── supabase/{client,server}.ts
│   ├── wearable/terra.ts
│   ├── alerts.ts
│   ├── voice/transcribe.ts
│   └── types.ts
├── scripts/seed-demo-data.ts
└── supabase/migrations/0001_init.sql
```

## Shared contracts (DO NOT CHANGE after hour 2)

### Supabase schema
`patients`, `sessions`, `biomarkers`, `risk_scores`, `conversations`. Full DDL in master plan file. Run as `supabase/migrations/0001_init.sql`.

### TS types — `lib/types.ts`
```ts
export type BiomarkerCategory = 'voice' | 'camera' | 'motion' | 'wearable';
export type SessionMode = 'walk_test' | 'hand_tremor' | 'daily_checkin';
export interface Biomarker { category: BiomarkerCategory; metric_name: string; value: number; unit?: string; raw_blob?: Record<string, unknown> }
export interface RiskScore { parkinsons_score: number; dementia_score: number; contributing_factors: Record<string, number> }
export interface Sample { t: number; x: number; y: number; z: number }
```

### API routes (single source of truth)
- `POST /api/sessions` → returns `session_id`
- `PATCH /api/sessions/:id` → mark `ended_at`
- `POST /api/biomarkers` → body `{session_id, biomarkers: Biomarker[]}`
- `POST /api/risk-score/compute` → body `{session_id}`, writes row, returns score
- `POST /api/conversation/turn` → streamed Claude
- `GET /api/patients/:id/timeline` → sessions + scores over time
- `POST /api/wearable/sync`
- `GET /api/export/csv?patient_id=...`

### Env (`.env.local.example`)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
DEMO_PATIENT_ID=demo-001
```

## Risk fusion weights (Stream A `lib/biomarkers/fusion.ts`)
- **Parkinson's**: 0.4·voice (jitter, shimmer, monotone) + 0.3·motion (tremor_score, hand_tremor_hz) + 0.2·camera (facial_tremor, blink_rate, hypomimia) + 0.1·wearable
- **Dementia**: 0.4·conversation (word_recall, response_latency) + 0.3·voice (speech_rate, pauses) + 0.2·wearable (sleep_quality, HRV) + 0.1·motion (gait_variance)
- Each input z-scored vs hardcoded ref mean/std (Max Little / mPower). `// INTEGRATION POINT: trained model`

## Progress log (UPDATE THIS AT EVERY MILESTONE)

| Status | Item | Notes |
|--------|------|-------|
| ✅ | Hour 0–2: scaffold | Next 15, TS, Tailwind v4, shadcn. Lives in `Frontend/` after restructure |
| ✅ | Supabase migration 0001 written | `Frontend/supabase/migrations/0001_init.sql` — **NOT yet applied** to a live Supabase project. Demo patient UUID `00000000-0000-0000-0000-000000000001` |
| ✅ | `components/sensors/{MotionCapture.tsx,useMotionCapture.ts}` | Hook + UI w/ live canvas, iOS permission gate, `onComplete(samples)` callback |
| ✅ | `lib/types.ts` + `lib/supabase/{client,server}.ts` | `DEMO_PATIENT_ID` exported from types |
| ✅ | `.env.local.example` + `.env` filled w/ ANTHROPIC_API_KEY | Supabase keys still missing |
| ✅ | Friend 2: `lib/biomarkers/motion.ts` REAL FFT | Cooley-Tukey + Hann window + band-power + peak-spacing gait variance. `generateMockSamples()` helper too |
| ✅ | Friend 2: `lib/biomarkers/voice.ts` mocked | Seeded plausible jitter/shimmer/HNR/etc. INTEGRATION POINT for Python sidecar |
| ✅ | Friend 2: `app/api/sessions/{route.ts,[id]/route.ts}` | POST create + PATCH end + GET single. zod via `z.treeifyError` |
| ✅ | Friend 2: `app/api/biomarkers/route.ts` | POST batch ≤500, GET by session_id |
| ✅ | Friend 2: `app/api/motion/analyze/route.ts` | **FastAPI sidecar w/ local TS fallback.** Set `MOTION_SVC_URL` env to forward to Python. Contract documented inline |
| ✅ | Friend 2: `app/api/conversation/turn/route.ts` | Streams `claude-sonnet-4-5`. System prompt warm assistant w/ cognitive probes |
| ✅ | Friend 2: `app/patient/motion/page.tsx` | **One-button patient workflow**: idle → recording (countdown + live graph) → analyzing → done. POSTs to `/api/motion/analyze` |
| ✅ | Friend 2: `app/patient/test/page.tsx` | Walk + tremor tabs, mock-samples toggle for laptop dev, persists to DB |
| ✅ | Friend 2: `app/patient/checkin/page.tsx` v1 | Claude streaming + Web Speech STT + browser TTS + text fallback. Auto-greet on mount. **No transcript save yet** (waiting on Supabase live) |
| ✅ | Friend 2: `lib/voice/transcribe.ts` | Web Speech wrapper + isSTTSupported gate |
| ☐ | Apply Supabase migration on live project | Blocks DB persistence end-to-end |
| ✅ | Friend 2: `lib/biomarkers/fusion.ts` + `/api/risk-score/compute` | Weighted z-score per CLAUDE.md weights, sigmoid squash to [0,1]. Reads biomarkers + conversations.cognitive_flags, writes `risk_scores` row. INTEGRATION POINT for trained model |
| ✅ | Friend 2: `/api/patients/[id]/timeline` | Returns `{sessions, risk_scores, biomarkers}` for patient. `?limit=N` (default 180). Doctor dashboard ready to consume |
| ☐ | Friend 2: checkin v2 — save transcript + voice biomarkers every 5s | Needs Supabase live |
| ☐ | Friend 3: `lib/biomarkers/camera.ts` + `CameraCapture` component | MediaPipe Face Landmarker |
| ☐ | Friend 1: `/doctor/*` routes + Recharts + `lib/alerts.ts` | Lives in `User-Interface/` per restructure |
| ☐ | Friend 1: `scripts/seed-demo-data.ts` (CRITICAL) + wearable mock + CSV export | Run before every demo rehearsal |
| ☐ | Friend 1: `/patient/page.tsx` home + `/patient/family/page.tsx` | UI shell only — sensor wiring is Friend 2 |
| ☐ | Friend 3 props lock at hour 4 (CameraCapture API) | Friend 2 can stub child early |
| ☐ | Hour 8: contract check (Friend 1 + 2 + 3 round trip w/ fake batch) | Tech lead runs |
| ☐ | Hour 14: full vertical slice green | |
| ☐ | Hour 18: feature freeze | |
| ☐ | Hour 20: 3× end-to-end demo run | |
| ☐ | Hour 22: backup video recorded | |
| ☐ | Hour 23: slides + pitch | |

## Open questions / blockers
_(none yet)_

## Decisions log
- 2026-05-23: IMU `/Users/.../IMU/index.html` confirmed NOT an HTTP server — it's phone DeviceMotion UI. Port logic into React component instead of fetching from URL.
- 2026-05-23: Locked hybrid fidelity (motion real, voice/camera mocked).
- 2026-05-23: Locked synthetic 6wk seed + live session appended.
- 2026-05-23: Post-hackathon voice upgrade path confirmed — Python FastAPI sidecar w/ librosa+parselmouth+sklearn against UCI Max Little dataset. Swap-in only touches `lib/biomarkers/voice.ts` body + new `VOICE_SVC_URL` env. Schema + API contracts + fusion logic stay. ML output written as additional `biomarkers` row(s), e.g. `parkinsons_voice_ml_score`.
- 2026-05-23: Voice AI chat agent path — start w/ Web Speech STT + Claude text + browser TTS; later swap to Deepgram/AssemblyAI STT + ElevenLabs/Cartesia TTS behind same `/api/conversation/turn`.
- 2026-05-23: Team re-split from 4 streams → 3 friends (Screens / Brain / Camera) + tech lead. Friend 2 absorbs old Stream A backend + Stream B patient flows minus camera. Friend 1 absorbs old Stream C entirely (charts + wearable + CSV + seed). Friend 3 isolated to camera pipeline only.
- 2026-05-23: **Project restructured** into 3 top-level dirs: `Backend/` (Python FastAPI sidecar, currently empty), `Frontend/` (Next.js — Friend 2 + sensors + APIs live here), `User-Interface/` (Friend 1's doctor + patient UI shell, separate Next.js app). Each Next.js subproject has its own `.gitignore`, `package.json`, `node_modules`. Root `.gitignore` covers `node_modules/`, `.next/`, `.env*` at any depth.
- 2026-05-23: `/api/motion/analyze` route designed w/ **dual backend**: if `MOTION_SVC_URL` env set → forwards POST `/analyze` to FastAPI sidecar; otherwise runs local `extractMotionBiomarkers` TS. Response shape unchanged. FastAPI contract documented inline in `Frontend/app/api/motion/analyze/route.ts`.
- 2026-05-23: FastAPI sidecar contract upgraded to spectral-subtraction tremor algo (scipy STFT, 2s window, 90% overlap, bundled `IMUTable.json` calibration for noise profile + 20%-margin absolute-power gate, 1.96-z 95% CI across windows). Returns `{duration_seconds, windows_analyzed, metrics_pd_ratio:{mean,ci_lower,ci_upper}, metrics_et_ratio:{...}}`. TS route translates → 6 motion `Biomarker[]` rows (`pd_ratio_mean/ci_lower/ci_upper`, `et_ratio_mean/ci_lower/ci_upper`). Fusion REF + PD_METRICS.motion extended w/ `pd_ratio_mean` (ref mean 0.15, std 0.1, dir +) + `et_ratio_mean`. Local TS fallback unchanged (legacy tremor_score etc.).
- 2026-05-23: `/patient/motion` page redesigned as patient-friendly one-button auto-flow: tap Start → countdown + live x/y/z graph → auto-stop at duration → "Analyzing…" → result card. No manual stop, no JSON download in this view. `window.__imuSamples` + `window.__imuResult` still bound for DevTools debugging.
- 2026-05-23: TypeScript IDE auto-rewrite broke imports during restructure (added bogus `@/Frontend/` prefix). Fixed via `sed -i '' 's|@/Frontend/|@/|g'` across `app/patient/{test,checkin}/page.tsx` + `components/sensors/MotionCapture.tsx`. Also dedup'd `useMotionCapture` import in `app/patient/motion/page.tsx`.

## Known gotchas
- **iOS Safari DeviceMotion**: requires user-gesture permission (`DeviceMotionEvent.requestPermission()`). Must be triggered from a click handler, not on mount. See IMU/index.html for working pattern.
- **HTTPS for phone testing**: DeviceMotion API needs secure context. Use `next dev --experimental-https` or `cloudflared tunnel`. Set up at hour 0.
- **Web Speech API on iOS**: spotty. Text input fallback ships day-one in Stream B.
- **Claude streaming**: don't await full body; stream tokens via SSE/`ReadableStream`.

## Resume protocol for new chat
1. Read this file end to end.
2. Read `/Users/shubhamgore/.claude/plans/help-build-a-plan-cozy-muffin.md` for full plan.
3. Check Progress log → first unchecked item is next task.
4. `git log -20` if repo initialized, to see what already shipped.
5. Update this file's Progress log + Decisions log as work completes.

## Quick commands (Friend 2 / Tech Lead)
```bash
cd /Users/shubhamgore/Development/Caltech/project/Frontend
npm run dev                       # boot Next.js
npx tsc --noEmit -p .             # typecheck
# For phone testing (DeviceMotion needs HTTPS):
cloudflared tunnel --url http://localhost:3000
```

## What's live RIGHT NOW (resume here)
- `/patient/motion` — one-button IMU capture → server `/api/motion/analyze` → biomarkers card. Works on phone w/ HTTPS. Falls back to local TS algorithm if `MOTION_SVC_URL` unset.
- `/patient/checkin` — Claude voice conversation, Web Speech STT + browser TTS, text fallback. Works on laptop Chrome NOW (needs `ANTHROPIC_API_KEY` only, no Supabase).
- `/patient/test` — older walk+tremor page w/ mock toggle + DB persist button. Needs Supabase live to actually save.
- `/api/sessions`, `/api/sessions/[id]`, `/api/biomarkers`, `/api/motion/analyze`, `/api/conversation/turn` — all up. DB writes need Supabase live.

## Next 3 tasks (in priority order)
1. Apply Supabase migration 0001 on a live project + fill `.env` w/ `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Without this, no persistence works.
2. Build `lib/biomarkers/fusion.ts` + `/api/risk-score/compute` per weights in CLAUDE.md.
3. Build `/api/patients/[id]/timeline` so Friend 1's doctor dashboard can render.

---

## For builders — Claude Code onboarding

Each friend: clone repo, `cd project`, run `claude` (Claude Code CLI). CLAUDE.md auto-loads. Paste your prompt below verbatim. Claude will read the team split section, locate your owned files, and start building.

### Teammate 1 (Screens person) — paste this:
> I am **Teammate 1, the Screens person**. Read CLAUDE.md. My job: doctor dashboard pages, patient home + family pages, alerts, wearable mock, CSV export, and the CRITICAL seed-demo-data script. Show me my checklist from the Progress log, then start with the seed-demo-data script (highest demo risk if late). Use only the files listed under my role. Do NOT touch backend API routes, sensor components, or biomarker logic — those are owned by Teammates 2 + 3. Confirm understanding, then begin.

### Teammate 2 (Brain person) — paste this:
> I am **Teammate 2, the Brain person**. Read CLAUDE.md. My job: all backend API routes, motion biomarkers (real FFT), voice biomarkers (mocked), risk fusion, Claude conversation page, walk + tremor test pages. The MotionCapture component already exists at `components/sensors/MotionCapture.tsx` — consume it via its `onComplete(samples)` callback, do not modify it. Show me my checklist from the Progress log, then start with the core API routes (sessions, biomarkers) since Teammate 1 + 3 are blocked until those exist. Do NOT touch doctor pages, alerts, seed script, or camera code. Confirm understanding, then begin.

### Teammate 3 (Camera person) — paste this:
> I am **Teammate 3, the Camera person**. Read CLAUDE.md. My job: `lib/biomarkers/camera.ts` + `components/sensors/CameraCapture.tsx` + `useCameraCapture.ts`. Mirror the API shape of the existing `MotionCapture` component — `<CameraCapture durationSec onComplete={(frames) => ...} />`. Use MediaPipe Face Landmarker (already installed: `@mediapipe/tasks-vision`). Extract: facial_tremor, blink_rate, hypomimia proxy, rPPG heart rate. Props must lock by hour 4 so Teammate 2 can stub me into the check-in page. Do NOT touch backend, doctor pages, or motion code. Confirm understanding, then begin.

### Tech lead (you) — paste this:
> I am the **tech lead**. Read CLAUDE.md. My job: code review, merge gating, hour 8 contract check, hour 14 vertical slice, hour 20 demo rehearsals, hour 22 backup video, hour 23 slides. Do NOT write feature code unless a teammate is blocked. Show me the Progress log, highlight rows that are at risk based on current state.

## Working agreements (for all builders)
- Update the Progress log row when you finish a task. Use `✅` and add a short note (paths, gotchas).
- If you hit a blocker, add it under "Open questions / blockers" w/ your name.
- If you change something that affects others (new env var, new shared util), add a Decisions log entry w/ date + reason.
- Do NOT modify the **Shared contracts** section after hour 2. If you think you need to, ping the tech lead first.
- Commit small + often. Conventional commits (`feat:`, `fix:`, `chore:`) so tech lead can review fast.
