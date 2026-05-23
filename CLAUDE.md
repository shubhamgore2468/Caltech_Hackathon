# NeuroTrack — Project Handoff Notes

> Living doc. Update at every milestone so a fresh chat can resume without context bloat.
> Master plan: `/Users/shubhamgore/.claude/plans/help-build-a-plan-cozy-muffin.md`

## What this is
Caltech Longevity Hackathon, 24h, 4-person team. Research data-gathering platform for Parkinson's + dementia longitudinal tracking. Two portals: `/patient` (mobile, friendly) + `/doctor` (clinical). Demo arc: AI voice check-in + walk/tremor test → biomarkers → composite risk score → doctor sees longitudinal trends.

User = tech lead, Stream A owner.

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
| x | Hour 0–2: scaffold | Next 15, TS, Tailwind v4, shadcn (button/card/badge/progress/alert/tabs), deps installed |
| x | Supabase migration 0001 written | `supabase/migrations/0001_init.sql` — NOT yet applied to a live Supabase project. User must create project + run migration. Demo patient UUID `00000000-0000-0000-0000-000000000001` |
| x | `components/sensors/{MotionCapture.tsx,useMotionCapture.ts}` ported | Hook + UI w/ live canvas. iOS permission gate included. `onComplete(samples)` callback fires when capture stops |
| x | `lib/types.ts` + `lib/supabase/{client,server}.ts` | `DEMO_PATIENT_ID` exported from types |
| x | `.env.local.example` written | User must fill + copy to `.env.local` |
| ☐ | Repo pushed to remote (no remote configured yet) | Committed locally, push when ready |
| ☐ | Hour 8: contract check passes (B → A → C1 round trip) | |
| ☐ | `lib/biomarkers/motion.ts` real FFT | tremor/gait |
| ☐ | `lib/biomarkers/voice.ts` mocked | |
| ☐ | `lib/biomarkers/camera.ts` mocked | |
| ☐ | `lib/biomarkers/fusion.ts` + `/api/risk-score/compute` | |
| ☐ | All `/api/*` routes live | |
| ☐ | Stream B: `/patient/*` routes + Claude conversation | Web Speech text fallback day-one |
| ☐ | Stream C1: `/doctor/*` routes + Recharts + `lib/alerts.ts` | |
| ☐ | Stream C2: seed script (CRITICAL) + wearable mock + CSV export | |
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
