# Tremelo

Parkinson's & dementia longitudinal monitoring platform — Caltech Longevity Hackathon.

## Quick start

```bash
npm install
cp .env.local.example .env.local   # add Supabase credentials
# Run migration in Supabase SQL editor: supabase/migrations/0001_init.sql
npm run seed
npm run dev
```

Phone testing requires HTTPS for DeviceMotion:

```bash
npm run dev:https
# or tunnel via ngrok / cloudflared
```

## Stream ownership

| Stream | Owner | Routes / files |
|--------|-------|----------------|
| A | Tech lead | `/api/*`, biomarkers, `MotionCapture`, schema |
| B | Teammate 2 | `/patient/*`, Claude conversation |
| C1 | Teammate 3 | `/doctor/*` charts + alerts UI |
| C2 | Teammate 4 | seed script, wearable, CSV export |

## API contracts

### Create session with biomarkers

```bash
curl -X POST http://localhost:3000/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "patient_id": "demo-001",
    "session_type": "checkin",
    "duration_seconds": 120,
    "biomarkers": [
      {"category": "voice", "metric_name": "jitter_pct", "value": 1.8, "unit": "%"}
    ]
  }'
```

### Append biomarkers to existing session

```bash
curl -X POST http://localhost:3000/api/biomarkers \
  -H 'Content-Type: application/json' \
  -d '{
    "session_id": "<uuid>",
    "patient_id": "demo-001",
    "biomarkers": [
      {"category": "camera", "metric_name": "blink_rate_per_min", "value": 14, "unit": "/min"}
    ]
  }'
```

### Compute risk score

```bash
curl -X POST http://localhost:3000/api/risk-score/compute \
  -H 'Content-Type: application/json' \
  -d '{"session_id": "<uuid>", "patient_id": "demo-001"}'
```

### Patient timeline

```bash
curl http://localhost:3000/api/patients/demo-001/timeline
```

### CSV export

```bash
curl "http://localhost:3000/api/export/csv?patient_id=demo-001" -o export.csv
```

## Integration points

All mock modules are marked `// INTEGRATION POINT:` for post-hackathon replacement:
- `lib/biomarkers/voice.ts` — real WebAudio DSP
- `lib/biomarkers/camera.ts` — MediaPipe landmarks
- `lib/wearable/terra.ts` — Terra OAuth
- `lib/biomarkers/fusion.ts` — trained ML model
- Auth / RLS — post-hackathon

## Demo verification

1. `npm run dev` — `/patient` and `/doctor` load without console errors
2. `npm run seed` — `/doctor/patient/demo-001` shows 6-week jitter trend
3. Weekly check-in — `/patient/checkin` → voice/camera mocks + tremor & walk capture in one session
4. Check-in — `/patient/checkin` → voice/camera mocks POSTed every turn
