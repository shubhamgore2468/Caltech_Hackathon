// Inspect why /doctor/patient/[id] shows empty cards.
// Lists latest 5 sessions for DEMO_PATIENT_ID + biomarker counts.

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supa = createClient(url, key);

const PATIENT = process.env.NEXT_PUBLIC_DEMO_PATIENT_ID ?? '00000000-0000-0000-0000-000000000001';

async function main() {
  const { data: sessions, error } = await supa
    .from('sessions')
    .select('id, started_at, ended_at, session_type, notes')
    .eq('patient_id', PATIENT)
    .order('started_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  console.log(`patient=${PATIENT} sessions=${sessions?.length ?? 0}`);

  for (const s of sessions ?? []) {
    const [{ count: bioCount }, { data: conv }, { data: rs }] = await Promise.all([
      supa.from('biomarkers').select('*', { count: 'exact', head: true }).eq('session_id', s.id),
      supa.from('conversations').select('id').eq('session_id', s.id).maybeSingle(),
      supa.from('risk_scores').select('parkinsons_score, dementia_score').eq('session_id', s.id).maybeSingle(),
    ]);
    console.log(
      `  ${s.id}  started=${s.started_at}  ended=${s.ended_at ?? '—'}  ` +
        `type=${s.session_type}  notes=${s.notes ?? ''}  ` +
        `biomarkers=${bioCount ?? 0}  conv=${conv ? 'y' : 'n'}  ` +
        `risk=${rs ? `pd=${rs.parkinsons_score.toFixed(2)} dem=${rs.dementia_score.toFixed(2)}` : '—'}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
