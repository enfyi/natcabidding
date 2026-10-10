-- Historical workbook archive, separate from active bid years and bidding data.
-- Requires the existing FAQ/admin helpers (private.current_admin_profile_id,
-- public.is_current_admin). Only published records and their files are public.

create table public.previous_year_documents (
  id uuid primary key default gen_random_uuid(),
  archive_year integer not null check (archive_year between 2000 and 2100),
  area_id uuid not null references public.areas(id),
  document_kind text not null check (document_kind in ('rdo', 'leave', 'bid_times')),
  file_path text not null unique,
  file_name text not null check (length(file_name) between 1 and 240 and file_name ~* '\.xlsx$'),
  file_size integer not null check (file_size between 1 and 4194304),
  sheet_names text[] not null check (cardinality(sheet_names) between 1 and 30),
  published boolean not null default false,
  created_by uuid references public.bidders(id) on delete set null,
  updated_by uuid references public.bidders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (archive_year, area_id, document_kind),
  check (file_path ~ ('^' || archive_year::text || '/' || area_id::text || '/' || document_kind || '/[a-f0-9-]{36}\.xlsx$'))
);

alter table public.previous_year_documents enable row level security;
revoke all on public.previous_year_documents from anon, authenticated;
grant select on public.previous_year_documents to anon, authenticated;
grant insert, update on public.previous_year_documents to authenticated;

create policy "published archive records are readable"
on public.previous_year_documents for select to anon, authenticated
using (published);

create policy "admins can read archive drafts"
on public.previous_year_documents for select to authenticated
using (public.is_current_admin());

create policy "admins can add archive records"
on public.previous_year_documents for insert to authenticated
with check (public.is_current_admin());

create policy "admins can update archive records"
on public.previous_year_documents for update to authenticated
using (public.is_current_admin()) with check (public.is_current_admin());

create index previous_year_documents_area_idx on public.previous_year_documents(area_id);
create index previous_year_documents_created_by_idx on public.previous_year_documents(created_by);
create index previous_year_documents_updated_by_idx on public.previous_year_documents(updated_by);

create function private.set_previous_year_audit_fields()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare actor_id uuid;
begin
  actor_id := private.current_admin_profile_id();
  if actor_id is null then
    raise exception 'System administrator access is required.' using errcode = '42501';
  end if;
  new.updated_by := actor_id;
  new.updated_at := clock_timestamp();
  if tg_op = 'INSERT' then
    new.created_by := actor_id;
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
revoke all on function private.set_previous_year_audit_fields() from public, anon;
grant execute on function private.set_previous_year_audit_fields() to authenticated;

create trigger set_previous_year_audit_fields before insert or update
on public.previous_year_documents for each row
execute function private.set_previous_year_audit_fields();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('previous-year-documents', 'previous-year-documents', false, 4194304,
  array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);

create policy "published archive files are readable"
on storage.objects for select to anon, authenticated
using (bucket_id = 'previous-year-documents' and exists (
  select 1 from public.previous_year_documents d where d.file_path = name and d.published
));

create policy "admins can read archive files"
on storage.objects for select to authenticated
using (bucket_id = 'previous-year-documents' and public.is_current_admin());

create policy "admins can upload archive files"
on storage.objects for insert to authenticated
with check (bucket_id = 'previous-year-documents' and public.is_current_admin());

-- Files are immutable. Replacements use a new path and update the archive record.
-- Only unreferenced files can be cleaned up, preserving every committed workbook.
create policy "admins can clean up unused archive files"
on storage.objects for delete to authenticated
using (bucket_id = 'previous-year-documents' and public.is_current_admin() and not exists (
  select 1 from public.previous_year_documents d where d.file_path = name
));
