-- Tremelo — clerk user → patient mapping
-- Maps Clerk auth user IDs to patient rows so check-ins are saved under the
-- real logged-in user rather than the hardcoded demo patient.
-- Also adds diagnosis + created_at columns that the /api/patients list already
-- selects (they returned null because the columns didn't exist).
-- Idempotent (all add column if not exists / create index if not exists).

alter table patients
  add column if not exists clerk_user_id text unique,
  add column if not exists diagnosis text default 'Parkinson''s Disease',
  add column if not exists created_at timestamptz default now();

create index if not exists patients_clerk_user_idx on patients(clerk_user_id)
  where clerk_user_id is not null;
