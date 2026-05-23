# Vision Inference API

## Endpoint: `POST /api/biomarkers/camera`

**Expected Payload:**
```json
{
  "duration_sec": 20.0,
  "fps": 28.5,
  "frames": [
    {
      "timestamp_ms": 0,
      "jaw_displacement": 1.2, 
      "forehead_green": 145.2
    }
  ]
}