-- Staging table for seniority roster imports.
-- This table accepts cleaned Excel data before it is promoted into bidders.

create table if not exists staging_seniority_roster (
  id uuid primary key default gen_random_uuid(),
  import_name text not null,
  source_sheet text not null,
  area_label text not null,
  area_code text,
  area_seniority_rank integer not null,
  last_name text,
  first_name text,
  status text,
  member text,
  seniority_date date,
  email text,
  initials text,
  needs_initials boolean not null default true,
  imported_at timestamptz not null default now(),
  unique (import_name, source_sheet, area_seniority_rank)
);

create index if not exists staging_seniority_roster_area_idx
  on staging_seniority_roster(import_name, area_label, area_seniority_rank);
