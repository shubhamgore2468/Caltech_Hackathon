-- NeuroTrack — checkin persistence (Path A)
-- Adds step + turn discriminators, patient_id back-refs, broader category enum,
-- session_type alongside legacy mode, conversation timestamps.
-- Safe to re-run (idempotent guards).

-- ── sessions ──────────────────────────────────────────────────────────────
alter table sessions
  add column if not exists session_type text,
  add column if not exists recorded_at timestamptz default now(),
  add column if not exists duration_seconds numeric,
  add column if not exists notes text;

-- Drop old mode check so we can write 'checkin' rows without breaking.
-- (mode column stays — legacy walk/tremor pages still use it.)
alter table sessions drop constraint if exists sessions_mode_check;
alter table sessions alter column mode drop not null;

-- New constraint: at least one of mode | session_type must be present.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sessions_kind_present'
  ) then
    alter table sessions
      add constraint sessions_kind_present
      check (mode is not null or session_type is not null);
  end if;
end$$;

create index if not exists sessions_type_idx on sessions(patient_id, session_type, recorded_at desc);

-- ── biomarkers ────────────────────────────────────────────────────────────
alter table biomarkers
  add column if not exists patient_id uuid references patients(id) on delete cascade,
  add column if not exists step text,
  add column if not exists turn_index int,
  add column if not exists recorded_at timestamptz default now();

-- Broaden category enum: add 'cognitive'.
alter table biomarkers drop constraint if exists biomarkers_category_check;
alter table biomarkers
  add constraint biomarkers_category_check
  check (category in ('voice', 'camera', 'motion', 'wearable', 'cognitive'));

-- Optional discriminator domain — keep open-ended for future steps.
-- ('imu_lap_rest', 'imu_hand_tremor', 'voice', 'video', 'wearable')

create index if not exists biomarkers_patient_idx on biomarkers(patient_id, recorded_at desc);
create index if not exists biomarkers_step_idx on biomarkers(session_id, step);

-- Back-fill patient_id from sessions for existing rows.
update biomarkers b
  set patient_id = s.patient_id
  from sessions s
  where b.session_id = s.id
    and b.patient_id is null;

-- ── conversations ─────────────────────────────────────────────────────────
alter table conversations
  add column if not exists patient_id uuid references patients(id) on delete cascade,
  add column if not exists created_at timestamptz default now();

create index if not exists conversations_session_idx on conversations(session_id);
create index if not exists conversations_patient_idx on conversations(patient_id, created_at desc);

update conversations c
  set patient_id = s.patient_id
  from sessions s
  where c.session_id = s.id
    and c.patient_id is null;

-- ── risk_scores ───────────────────────────────────────────────────────────
alter table risk_scores
  add column if not exists patient_id uuid references patients(id) on delete cascade,
  add column if not exists recorded_at timestamptz default now();

update risk_scores r
  set patient_id = s.patient_id
  from sessions s
  where r.session_id = s.id
    and r.patient_id is null;

-- ── alerts (referenced by lib/alerts.ts but never created) ────────────────
create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade not null,
  session_id uuid references sessions(id) on delete cascade,
  metric_name text not null,
  severity text check (severity in ('info', 'warn', 'critical')) not null,
  message text not null,
  baseline_value numeric,
  current_value numeric,
  std_deviations numeric,
  acknowledged boolean default false,
  created_at timestamptz default now()
);

create index if not exists alerts_patient_idx on alerts(patient_id, created_at desc);
