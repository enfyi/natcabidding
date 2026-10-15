-- Existing records remain the desktop version. Each version retains draft/public RLS.
alter table public.previous_year_documents
  add column layout text not null default 'desktop'
  check (layout in ('desktop', 'mobile'));

do $$
declare destination_constraint text;
begin
  select conname into destination_constraint from pg_constraint
  where conrelid = 'public.previous_year_documents'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) = 'UNIQUE (archive_year, area_id, document_kind)';
  if destination_constraint is null then
    raise exception 'Previous Years destination constraint was not found';
  end if;
  execute format('alter table public.previous_year_documents drop constraint %I', destination_constraint);
end $$;

alter table public.previous_year_documents
  add constraint previous_year_documents_destination_key
  unique (archive_year, area_id, document_kind, layout);

comment on column public.previous_year_documents.layout is
  'Desktop or mobile Excel layout. Publish each variant independently; public pages choose one saved representation per request.';
