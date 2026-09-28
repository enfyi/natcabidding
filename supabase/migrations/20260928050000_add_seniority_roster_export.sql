-- Admin-only export source for round-tripping one area's active seniority roster
-- through the same workbook used by the seniority import workflow.

create or replace function public.export_seniority_roster(requested_area text)
returns table (
  profile_id uuid,
  area_code text,
  seniority_rank integer,
  first_name text,
  last_name text,
  initials text,
  email text,
  phone text,
  bid_role text,
  seniority_date date,
  active boolean,
  leave_slot_allowance integer
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor_profile_id uuid;
  normalized_area text := upper(trim(coalesce(requested_area, '')));
begin
  select b.id into actor_profile_id
  from public.bidders b
  where b.auth_user_id = auth.uid() and b.active and b.role = 'admin'
  limit 1;

  if actor_profile_id is null then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if normalized_area not in ('A', 'B', 'C', 'D', 'E', 'F', 'TMU') then
    raise exception 'Area must be A through F or TMU.';
  end if;

  return query
  select
    b.id,
    normalized_area,
    row_number() over (order by b.seniority_rank nulls last, b.last_name, b.first_name, b.id)::integer,
    b.first_name,
    b.last_name,
    b.initials,
    b.email,
    b.phone,
    b.bid_role,
    b.seniority_date,
    b.active,
    b.leave_slot_allowance
  from public.bidders b
  join public.areas a on a.id = b.area_id
  where b.active
    and b.bid_role not in ('ADM', 'NB')
    and upper(pg_catalog.regexp_replace(a.code, '^area[-_[:space:]]*', '', 'i')) = normalized_area
  order by b.seniority_rank nulls last, b.last_name, b.first_name, b.id;
end;
$function$;

revoke execute on function public.export_seniority_roster(text) from public, anon;
grant execute on function public.export_seniority_roster(text) to authenticated;

comment on function public.export_seniority_roster(text) is
  'Returns one area roster in seniority-import column order for system administrators.';
