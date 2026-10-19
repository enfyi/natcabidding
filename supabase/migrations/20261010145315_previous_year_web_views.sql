-- Import-time conversion keeps spreadsheet parsing out of public page requests.
alter table public.previous_year_documents
  add column rendered_workbook jsonb;

alter table public.previous_year_documents
  add constraint previous_year_web_view_valid check (
    rendered_workbook is null or (
      jsonb_typeof(rendered_workbook) = 'object'
      and coalesce(rendered_workbook ->> 'version', '') = '1'
      and coalesce(jsonb_typeof(rendered_workbook -> 'sheets'), '') = 'array'
      and jsonb_array_length(rendered_workbook -> 'sheets') between 1 and 30
      and octet_length(rendered_workbook::text) <= 2000000
    )
  );

comment on column public.previous_year_documents.rendered_workbook is
  'Versioned read-only worksheet text, formatting, merges and month ranges, generated once during admin import. Existing row RLS controls draft/public access.';
