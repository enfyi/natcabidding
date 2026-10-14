-- Preserve installed business rules; add guards without replacing live bodies.
create or replace function private.assert_manual_bid_access(requested_manual boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if requested_manual and not exists (
    select 1 from public.bidders b
    where b.auth_user_id = auth.uid() and b.active
      and lower(b.email) = lower(auth.jwt() ->> 'email')
      and b.role in ('admin', 'intake')
  ) then
    raise exception 'Manual entry requires bidding reviewer access.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.assert_manual_bid_access(boolean) from public, anon, authenticated;

create or replace function public.is_area_bid_round_open(
  requested_bid_year_id uuid, requested_area_id uuid, requested_round integer,
  checked_at timestamptz default now()
) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(checked_at >= min(w.opens_at) and checked_at < max(w.closes_at), false)
  from public.bid_windows w join public.bidders b on b.id = w.bidder_id
  where w.bid_year_id = requested_bid_year_id and w.round_number = requested_round
    and b.active and b.bid_role not in ('ADM', 'NB');
$$;
revoke all on function public.is_area_bid_round_open(uuid, uuid, integer, timestamptz) from public, anon;
grant execute on function public.is_area_bid_round_open(uuid, uuid, integer, timestamptz) to authenticated;

do $upgrade$
declare
  entry record;
  definition text;
  anchor text;
  round_variable text;
begin
  for entry in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('submit_rdo_bid', 'submit_leave_bid_batch')
  loop
    definition := pg_get_functiondef(entry.oid);
    if position('private.assert_manual_bid_access(manual_entry)' in definition) = 0 then
      definition := regexp_replace(definition, E'\\mbegin\\M', E'begin\n  manual_entry := coalesce(manual_entry, false);\n  perform private.assert_manual_bid_access(manual_entry);', 'i');
    end if;
    if position('public.is_area_bid_round_open' in definition) > 0 then
      definition := replace(definition, E'if enforce_bid_windows\n     and not public.is_area_bid_round_open', E'if not manual_entry and enforce_bid_windows\n     and not public.is_area_bid_round_open');
    else
      if entry.proname='submit_rdo_bid' then
        anchor := '  -- RDO changes require';
        round_variable := 'resolved_round';
      else
        anchor := E'  if not manual_entry\n     and not enforce_bid_windows';
        round_variable := 'batch_round';
      end if;
      if position(anchor in definition)=0 then
        raise exception 'Cannot locate guard insertion point for %', entry.proname;
      end if;
      definition := replace(definition, anchor,
        format(E'  if not manual_entry and enforce_bid_windows\n     and not public.is_area_bid_round_open(year_row.id, target.area_id, %s) then\n    raise exception ''The requested bidding round is not open.'';\n  end if;\n\n', round_variable) || anchor);
    end if;
    execute definition;
  end loop;
end;
$upgrade$;
