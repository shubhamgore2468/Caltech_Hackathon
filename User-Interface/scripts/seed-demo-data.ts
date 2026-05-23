/**
 * CRITICAL: Run before every demo rehearsal.
 * Generates 6 weeks × ~3 sessions/week of synthetic data for demo-001
 * with monotonic degradation on jitter, tremor_score, gait_variance.
 *
 * Usage: npm run seed
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { fuseRiskScores } from '../lib/biomarkers/fusion';

config({ path: '.env.local' });

const PATIENT_ID = process.env.DEMO_PATIENT_ID ?? 'demo-001';
const WEEKS = 6;
const SESSIONS_PER_WEEK = 3;

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function noise(scale: number): number {
  return (Math.random() - 0.5) * 2 * scale;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error('Missing Supabase env vars. Copy .env.local.example → .env.local');
    process.exit(1);
  }

  const supabase = createClient(url, key);

  // Ensure demo patient exists
  await supabase.from('patients').upsert({
    id: PATIENT_ID,
    full_name: 'Robert Halloway',
    date_of_birth: '1953-04-12',
    sex: 'M',
    diagnosis: 'PD - Hoehn-Yahr Stage 2',
  });

  // Clear existing demo data
  const { data: oldSessions } = await supabase
    .from('sessions')
    .select('id')
    .eq('patient_id', PATIENT_ID);

  if (oldSessions?.length) {
    const ids = oldSessions.map((s) => s.id);
    await supabase.from('alerts').delete().eq('patient_id', PATIENT_ID);
    await supabase.from('conversations').delete().in('session_id', ids);
    await supabase.from('risk_scores').delete().eq('patient_id', PATIENT_ID);
    await supabase.from('biomarkers').delete().eq('patient_id', PATIENT_ID);
    await supabase.from('sessions').delete().eq('patient_id', PATIENT_ID);
  }

  const totalSessions = WEEKS * SESSIONS_PER_WEEK;
  const now = Date.now();
  let sessionCount = 0;

  console.log(`Seeding ${totalSessions} sessions for ${PATIENT_ID}...`);

  for (let i = 0; i < totalSessions; i++) {
    const t = i / (totalSessions - 1);
    const daysAgo = Math.round((WEEKS * 7 * (totalSessions - 1 - i)) / totalSessions);
    const recordedAt = new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString();

    const sessionTypes = ['checkin', 'checkin', 'checkin'] as const;
    const sessionType = sessionTypes[i % 3];

    const jitter = lerp(1.2, 2.8, t) + noise(0.15);
    const tremorScore = lerp(0.08, 0.35, t) + noise(0.03);
    const gaitVariance = lerp(0.025, 0.08, t) + noise(0.005);
    const shimmer = lerp(5.5, 8.5, t * 0.5) + noise(0.4);
    const blinkRate = lerp(14, 10, t * 0.3) + noise(0.8);
    const sleepQuality = lerp(72, 58, t * 0.4) + noise(3);
    const wordRecall = lerp(7.5, 6.0, t * 0.6) + noise(0.3);

    const biomarkers = [
      { category: 'voice' as const, metric_name: 'jitter_pct', value: jitter, unit: '%' },
      { category: 'voice' as const, metric_name: 'shimmer_pct', value: shimmer, unit: '%' },
      { category: 'voice' as const, metric_name: 'hnr_db', value: 18 - t * 4 + noise(0.5), unit: 'dB' },
      { category: 'voice' as const, metric_name: 'speech_rate_wpm', value: 130 - t * 20 + noise(5), unit: 'wpm' },
      { category: 'camera' as const, metric_name: 'blink_rate_per_min', value: blinkRate, unit: '/min' },
      { category: 'camera' as const, metric_name: 'facial_affect_displacement', value: 0.65 - t * 0.15 + noise(0.03), unit: 'norm' },
      { category: 'motion' as const, metric_name: 'tremor_score', value: tremorScore, unit: 'ratio' },
      { category: 'motion' as const, metric_name: 'hand_tremor_hz', value: tremorScore > 0.15 ? 5 + noise(0.3) : noise(0.5), unit: 'Hz' },
      { category: 'motion' as const, metric_name: 'dominant_freq_hz', value: tremorScore > 0.15 ? 5 + noise(0.5) : noise(0.2), unit: 'Hz' },
      { category: 'motion' as const, metric_name: 'rms_acceleration', value: 9.8 + noise(0.5), unit: 'm/s²' },
      { category: 'motion' as const, metric_name: 'gait_variance', value: gaitVariance, unit: 'var' },
      { category: 'cognitive' as const, metric_name: 'word_recall_score', value: wordRecall, unit: 'score' },
      { category: 'wearable' as const, metric_name: 'sleep_quality', value: sleepQuality, unit: 'score' },
      { category: 'wearable' as const, metric_name: 'hrv_rmssd', value: 38 - t * 10 + noise(3), unit: 'ms' },
      { category: 'wearable' as const, metric_name: 'steps', value: 5000 + noise(800), unit: 'count' },
      { category: 'wearable' as const, metric_name: 'resting_hr', value: 72 - t * 6 + noise(2), unit: 'bpm' },
    ];

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        patient_id: PATIENT_ID,
        session_type: sessionType,
        recorded_at: recordedAt,
        duration_seconds: 300,
      })
      .select()
      .single();

    if (sessionError || !session) {
      console.error('Session insert failed:', sessionError?.message);
      continue;
    }

    const rows = biomarkers.map((b) => ({
      session_id: session.id,
      patient_id: PATIENT_ID,
      category: b.category,
      metric_name: b.metric_name,
      value: b.value,
      unit: b.unit,
      recorded_at: recordedAt,
    }));

    await supabase.from('biomarkers').insert(rows);

    const fusion = fuseRiskScores(biomarkers);
    await supabase.from('risk_scores').insert({
      session_id: session.id,
      patient_id: PATIENT_ID,
      parkinsons_score: fusion.parkinsons_score,
      dementia_score: fusion.dementia_score,
      contributing_factors: fusion.contributing_factors,
      recorded_at: recordedAt,
    });

    await supabase.from('conversations').insert({
      session_id: session.id,
      patient_id: PATIENT_ID,
      transcript: [
        {
          role: 'assistant',
          content: 'How have you been feeling this week?',
          timestamp: recordedAt,
        },
        {
          role: 'user',
          content:
            t > 0.5
              ? 'More stiffness in my right hand lately, but no falls.'
              : 'Feeling fairly steady this week.',
          timestamp: recordedAt,
        },
      ],
      cognitive_flags: {
        word_recall: t > 0.6 ? 'mild_delay' : 'normal',
        mood: t > 0.7 ? 'concerned' : 'neutral',
      },
    });

    // Alert on last few sessions where jitter crosses 2σ
    if (t > 0.75 && jitter > 2.2) {
      await supabase.from('alerts').insert({
        patient_id: PATIENT_ID,
        session_id: session.id,
        metric_name: 'jitter_pct',
        severity: t > 0.9 ? 'critical' : 'warn',
        message: `jitter_pct is ${((jitter - 1.2) / 0.3).toFixed(1)}σ above early baseline`,
        baseline_value: 1.2,
        current_value: jitter,
        std_deviations: (jitter - 1.2) / 0.3,
      });
    }

    sessionCount++;
  }

  console.log(`✓ Seeded ${sessionCount} sessions for ${PATIENT_ID}`);
  console.log(`  View timeline: /doctor/patient/${PATIENT_ID}`);
}

main().catch(console.error);
