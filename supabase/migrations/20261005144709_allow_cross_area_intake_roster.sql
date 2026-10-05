-- Intake staff need the active roster across all areas for manual bid entry.
-- Preserve controller area scope, public contact masking, and admin-only inactive access.
CREATE OR REPLACE FUNCTION public.read_bidding_roster(include_inactive boolean DEFAULT false)
 RETURNS TABLE(profile_id uuid, first_name text, last_name text, initials text, initials_verified boolean, email text, phone text, role text, bid_role text, seniority_rank integer, area_id uuid, area_name text, leave_slot_allowance integer, active boolean, bidder_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with access_context as (
    select
      auth.uid() is not null as signed_in,
      public.current_bidder_area_id() as current_area_id,
      public.is_current_admin() as is_admin,
      public.is_current_intake_or_admin() as is_reviewer
  ),
  visible_bidders as (
    select b.*
    from bidders b
    cross join access_context ac
    where (b.active or (include_inactive and ac.is_admin))
      and (
        ac.is_admin
        or ac.is_reviewer
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
$function$;
