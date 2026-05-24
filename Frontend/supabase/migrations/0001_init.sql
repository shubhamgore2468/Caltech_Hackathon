-- Tremelo initial schema

create extension if not exists "pgcrypto";

create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date_of_birth date,
  enrolled_at timestamptz default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade not null,
  started_at timestamptz default now(),
  ended_at timestamptz,
  mode text check (mode in ('walk_test', 'hand_tremor', 'daily_checkin')) not null
);

create table if not exists biomarkers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade not null,
  category text check (category in ('voice', 'camera', 'motion', 'wearable')) not null,
  metric_name text not null,
  value numeric not null,
  unit text,
  raw_blob jsonb,
  computed_at timestamptz default now()
);

create table if not exists risk_scores (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade not null,
  parkinsons_score numeric not null,
  dementia_score numeric not null,
  contributing_factors jsonb not null,
  computed_at timestamptz default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade not null,
  transcript jsonb not null,
  mood_score numeric,
  cognitive_flags jsonb
);

create index if not exists biomarkers_session_idx on biomarkers(session_id);
create index if not exists biomarkers_category_metric_idx on biomarkers(category, metric_name);
create index if not exists sessions_patient_idx on sessions(patient_id, started_at desc);
create index if not exists risk_scores_session_idx on risk_scores(session_id);

-- Demo patient (idempotent)
insert into patients (id, name, date_of_birth)
values ('00000000-0000-0000-0000-000000000001'::uuid, 'Demo Patient', '1955-03-12')
on conflict (id) do nothing;
