-- Public FAQ and MOU document management for system administrators.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.current_admin_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
  from public.bidders b
  where b.auth_user_id = auth.uid()
    and b.active
    and b.role = 'admin'
  limit 1;
$$;

revoke execute on function private.current_admin_profile_id() from public, anon;
grant execute on function private.current_admin_profile_id() to authenticated;

create or replace function private.is_current_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_admin_profile_id() is not null;
$$;

revoke execute on function private.is_current_admin() from public, anon;
grant execute on function private.is_current_admin() to authenticated;

create or replace function public.is_current_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_current_admin();
$$;

revoke execute on function public.is_current_admin() from public, anon;
grant execute on function public.is_current_admin() to authenticated;

create table if not exists public.faq_entries (
  id uuid primary key default gen_random_uuid(),
  question text not null check (length(trim(question)) between 1 and 240),
  answer text not null check (length(trim(answer)) between 1 and 12000),
  display_order integer not null default 0,
  published boolean not null default true,
  created_by uuid references public.bidders(id) on delete set null,
  updated_by uuid references public.bidders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists faq_entries_public_order_idx
  on public.faq_entries(display_order, created_at)
  where published;

create table if not exists public.mou_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 240),
  description text,
  file_path text not null unique,
  file_url text,
  display_order integer not null default 0,
  published boolean not null default true,
  created_by uuid references public.bidders(id) on delete set null,
  updated_by uuid references public.bidders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mou_documents_public_order_idx
  on public.mou_documents(display_order, created_at)
  where published;

create or replace function private.set_faq_content_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
begin
  actor_id := private.current_admin_profile_id();
  new.updated_at := now();
  new.updated_by := actor_id;
  if tg_op = 'INSERT' then
    new.created_by := actor_id;
  end if;
  return new;
end;
$$;

drop trigger if exists set_faq_entries_audit_fields on public.faq_entries;
create trigger set_faq_entries_audit_fields
before insert or update on public.faq_entries
for each row execute function private.set_faq_content_audit_fields();

drop trigger if exists set_mou_documents_audit_fields on public.mou_documents;
create trigger set_mou_documents_audit_fields
before insert or update on public.mou_documents
for each row execute function private.set_faq_content_audit_fields();

alter table public.faq_entries enable row level security;
alter table public.mou_documents enable row level security;

drop policy if exists "public can read published FAQ entries" on public.faq_entries;
create policy "public can read published FAQ entries"
on public.faq_entries for select
to anon, authenticated
using (published);

drop policy if exists "admins can manage FAQ entries" on public.faq_entries;
create policy "admins can manage FAQ entries"
on public.faq_entries for all
to authenticated
using (public.is_current_admin())
with check (public.is_current_admin());

drop policy if exists "public can read published MOU documents" on public.mou_documents;
create policy "public can read published MOU documents"
on public.mou_documents for select
to anon, authenticated
using (published);

drop policy if exists "admins can manage MOU documents" on public.mou_documents;
create policy "admins can manage MOU documents"
on public.mou_documents for all
to authenticated
using (public.is_current_admin())
with check (public.is_current_admin());

grant select on public.faq_entries to anon, authenticated;
grant select on public.mou_documents to anon, authenticated;
grant insert, update, delete on public.faq_entries to authenticated;
grant insert, update, delete on public.mou_documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mou-documents',
  'mou-documents',
  true,
  52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public can read MOU files" on storage.objects;
create policy "public can read MOU files"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'mou-documents');

drop policy if exists "admins can upload MOU files" on storage.objects;
create policy "admins can upload MOU files"
on storage.objects for insert
to authenticated
with check (bucket_id = 'mou-documents' and public.is_current_admin());

drop policy if exists "admins can update MOU files" on storage.objects;
create policy "admins can update MOU files"
on storage.objects for update
to authenticated
using (bucket_id = 'mou-documents' and public.is_current_admin())
with check (bucket_id = 'mou-documents' and public.is_current_admin());

drop policy if exists "admins can delete MOU files" on storage.objects;
create policy "admins can delete MOU files"
on storage.objects for delete
to authenticated
using (bucket_id = 'mou-documents' and public.is_current_admin());
