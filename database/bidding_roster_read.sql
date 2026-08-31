-- Supabase-backed roster read model for the bidding UI.
-- Anonymous visitors can load names, initials, bid roles, and area order.
-- Signed-in users can see contact fields for their own area; admins can see all rows.

alter table bidders
  add column if not exists leave_slot_allowance integer not null default 4 check (leave_slot_allowance >= 0);

create or replace function public.read_bidding_roster(include_inactive boolean default false)
returns table (
  profile_id uuid,
  first_name text,
  last_name text,
  initials text,
  initials_verified boolean,
  email text,
  phone text,
  role text,
  bid_role text,
  seniority_rank integer,
  area_id uuid,
  area_name text,
  leave_slot_allowance integer,
  active boolean,
  bidder_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with access_context as (
    select
      auth.uid() is not null as signed_in,
      public.current_bidder_area_id() as current_area_id,
      public.is_current_admin() as is_admin
  ),
  visible_bidders as (
    select b.*
    from bidders b
    cross join access_context ac
    where (b.active or (include_inactive and ac.is_admin))
      and (
        ac.is_admin
        or auth.uid() is null
        or b.area_id = ac.current_area_id
      )
  ),
  ranked_bidders as (
    select
      b.id,
      row_number() over (
        partition by b.area_id
        order by b.seniority_rank nulls last, b.last_name, b.first_name, b.id
      )::integer as area_seniority_rank,
      count(*) over (partition by b.area_id) as area_bidder_count
    from bidders b
    where b.active
  )
  select
    b.id as profile_id,
    b.first_name,
    b.last_name,
    b.initials,
    b.initials_verified,
    case when ac.signed_in then b.email else null end as email,
    case when ac.signed_in then b.phone else null end as phone,
    b.role,
    b.bid_role,
    rb.area_seniority_rank as seniority_rank,
    b.area_id,
    a.name as area_name,
    b.leave_slot_allowance,
    b.active,
    rb.area_bidder_count as bidder_count
  from visible_bidders b
  cross join access_context ac
  join areas a on a.id = b.area_id
  left join ranked_bidders rb on rb.id = b.id
  order by a.display_order, rb.area_seniority_rank nulls last, b.last_name, b.first_name, b.id;
$$;

grant execute on function public.read_bidding_roster(boolean) to anon, authenticated;
