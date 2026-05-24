// Recompute every existing risk_scores row using current fusion logic.
// Usage:
//   cd Frontend && npx tsx scripts/recompute-risk-scores.ts
//
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
// For each session w/ a risk_scores row, re-fetches biomarkers + conversation,
// recomputes, UPDATEs in place (keeps id + computed_at).

import { createClient } from '@supabase/supabase-js';
import { computeRiskScore } from '../lib/biomarkers/fusion';
import type { Biomarker, CognitiveFlags } from '../lib/types';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supa = createClient(url, key);

async function main() {
  const { data: rows, error } = await supa
    .from('risk_scores')
    .select('id, session_id, parkinsons_score, dementia_score');
  if (error) throw error;
  console.log(`found ${rows?.length ?? 0} risk_scores rows`);

  let changed = 0;
  for (const row of rows ?? []) {
    const [bioRes, convRes] = await Promise.all([
      supa
        .from('biomarkers')
        .select('category, metric_name, value, unit, raw_blob')
        .eq('session_id', row.session_id),
      supa
        .from('conversations')
        .select('cognitive_flags')
        .eq('session_id', row.session_id)
        .maybeSingle(),
    ]);
    const biomarkers = (bioRes.data ?? []) as Biomarker[];
    const cognitive = (convRes.data?.cognitive_flags ?? null) as CognitiveFlags | null;
    if (biomarkers.length === 0 && !cognitive) {
      console.log(`  ${row.session_id}: no data — skip`);
      continue;
    }
    const score = computeRiskScore({ biomarkers, cognitive });
    const pdDelta = Math.abs(score.parkinsons_score - row.parkinsons_score);
    const demDelta = Math.abs(score.dementia_score - row.dementia_score);
    if (pdDelta < 0.001 && demDelta < 0.001) continue;
    const { error: updErr } = await supa
      .from('risk_scores')
      .update({
        parkinsons_score: score.parkinsons_score,
        dementia_score: score.dementia_score,
        contributing_factors: score.contributing_factors,
      })
      .eq('id', row.id);
    if (updErr) {
      console.warn(`  ${row.session_id}: update failed ${updErr.message}`);
      continue;
    }
    changed += 1;
    console.log(
      `  ${row.session_id}: pd ${row.parkinsons_score.toFixed(3)}→${score.parkinsons_score.toFixed(3)} ` +
        `dem ${row.dementia_score.toFixed(3)}→${score.dementia_score.toFixed(3)} ` +
        `(biomarkers=${biomarkers.length} cog=${cognitive ? 'y' : 'n'})`,
    );
  }
  console.log(`updated ${changed} rows`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
