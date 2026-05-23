-- NeuroTrack initial schema
-- INTEGRATION POINT: extend for auth + RLS post-hackathon

create extension if not exists "pgcrypto";

-- Patients
create table patients (
  id text primary key,
  full_name text not null,
  date_of_birth date,
  sex text check (sex in ('M', 'F', 'O')),
  diagnosis text,
  enrolled_at timestamptz default now()
);

-- Sessions (check-in, walk test, tremor test)
create table sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id text not null references patients(id) on delete cascade,
  session_type text not null check (session_type in ('checkin', 'walk_test', 'tremor_test', 'wearable_sync')),
  recorded_at timestamptz not null default now(),
  duration_seconds int,
  notes text,
  created_at timestamptz default now()
);

-- Biomarkers (long-format: one row per metric per session)
create table biomarkers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  patient_id text not null references patients(id) on delete cascade,
  category text not null check (category in ('voice', 'camera', 'motion', 'wearable', 'cognitive')),
  metric_name text not null,
  value double precision not null,
  unit text,
  recorded_at timestamptz not null default now()
);

-- Composite risk scores
create table risk_scores (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  patient_id text not null references patients(id) on delete cascade,
  parkinsons_score double precision not null check (parkinsons_score >= 0 and parkinsons_score <= 1),
  dementia_score double precision not null check (dementia_score >= 0 and dementia_score <= 1),
  contributing_factors jsonb not null default '{}',
  recorded_at timestamptz not null default now()
);

-- AI conversation transcripts
create table conversations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  patient_id text not null references patients(id) on delete cascade,
  transcript jsonb not null default '[]',
  cognitive_flags jsonb not null default '{}',
  created_at timestamptz default now()
);

-- Baseline deviation alerts
create table alerts (
  id uuid primary key default gen_random_uuid(),
  patient_id text not null references patients(id) on delete cascade,
  session_id uuid references sessions(id) on delete set null,
  metric_name text not null,
  severity text not null check (severity in ('info', 'warn', 'critical')),
  message text not null,
  baseline_value double precision,
  current_value double precision,
  std_deviations double precision,
  acknowledged boolean default false,
  created_at timestamptz default now()
);

-- Indexes
create index idx_biomarkers_patient_recorded on biomarkers (patient_id, recorded_at desc);
create index idx_biomarkers_patient_metric on biomarkers (patient_id, metric_name, recorded_at desc);
create index idx_sessions_patient_recorded on sessions (patient_id, recorded_at desc);
create index idx_risk_scores_patient on risk_scores (patient_id, recorded_at desc);
create index idx_alerts_patient on alerts (patient_id, acknowledged, created_at desc);

-- Seed demo patient
insert into patients (id, full_name, date_of_birth, sex, diagnosis)
values ('demo-001', 'Robert Halloway', '1953-04-12', 'M', 'PD - Hoehn-Yahr Stage 2');
