-- Admin-controlled manual leave entry for rounds 5 and 6, scoped to a bid year.
begin;
alter table public.bid_year_settings
  add column if not exists late_round_entry_enabled boolean not null default false,
  add column if not exists late_round_intake_enabled boolean not null default false;

create or replace function private.late_round_leave_allowed(year_id uuid, requested_manual boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(requested_manual, false) and exists (
    select 1 from public.bid_year_settings settings
    join public.bidders actor on actor.auth_user_id = auth.uid() and actor.active
      and lower(actor.email) = lower(auth.jwt() ->> 'email')
    where settings.bid_year_id = year_id and settings.late_round_entry_enabled
      and (actor.role = 'admin' or (settings.late_round_intake_enabled and actor.role = 'intake'))
  )
$$;
revoke all on function private.late_round_leave_allowed(uuid,boolean) from public, anon, authenticated;

create or replace function private.set_late_round_entry(requested_bid_year integer, enabled boolean, intake_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare target_year uuid;
begin
  if auth.uid() is null or not public.is_current_admin() then
    raise exception 'Only system admins can change round entry settings.' using errcode = '42501';
  end if;
  if enabled is null or intake_enabled is null then raise exception 'Both settings are required.'; end if;
  select id into strict target_year from public.bid_years where bid_year = requested_bid_year;
  insert into public.bid_year_settings(bid_year_id, late_round_entry_enabled, late_round_intake_enabled, updated_by)
  values(target_year, enabled, intake_enabled, public.current_bidder_id())
  on conflict (bid_year_id) do update set late_round_entry_enabled = excluded.late_round_entry_enabled,
    late_round_intake_enabled = excluded.late_round_intake_enabled,
    updated_by = excluded.updated_by, updated_at = now();
end
$$;
revoke all on function private.set_late_round_entry(integer,boolean,boolean) from public, anon, authenticated;
grant execute on function private.set_late_round_entry(integer,boolean,boolean) to authenticated;
create or replace function public.set_late_round_entry(requested_bid_year integer, enabled boolean, intake_enabled boolean)
returns void language sql security invoker set search_path = '' as $$
  select private.set_late_round_entry(requested_bid_year, enabled, intake_enabled)
$$;
revoke all on function public.set_late_round_entry(integer,boolean,boolean) from public, anon, authenticated;
grant execute on function public.set_late_round_entry(integer,boolean,boolean) to authenticated;

-- Extend the existing privileged settings reader, preserving its other fields.
do $reader$
declare definition text;
begin
  definition := pg_get_functiondef('public.read_calendar_year_settings(integer)'::regprocedure);
  if position('late_round_entry_enabled' in definition) = 0 then
    if position('''tmu_one_slot_outline'',' in definition) = 0 then
      raise exception 'Calendar settings reader must be installed first.';
    end if;
    definition := replace(definition, '''tmu_one_slot_outline'',',
      '''late_round_entry_enabled'', coalesce(display.late_round_entry_enabled, false), ''late_round_intake_enabled'', coalesce(display.late_round_intake_enabled, false), ''tmu_one_slot_outline'',');
    execute definition;
  end if;
end
$reader$;

alter table public.leave_requests drop constraint if exists leave_requests_round_number_check;
alter table public.leave_requests add constraint leave_requests_round_number_check check (round_number between 1 and 6);
alter table public.intake_submissions drop constraint if exists intake_submissions_round_number_check;
alter table public.intake_submissions add constraint intake_submissions_round_number_check check (round_number between 1 and 6);

-- Keep the installed capacity, allowance, audit, and review logic intact.
do $upgrade$
declare signature text; definition text; original text;
begin
  foreach signature in array array[
    'public.submit_leave_bid_batch(integer,jsonb,text,text,boolean)',
    'private.submit_leave_bid_batch_unchecked(integer,jsonb,text,text,boolean)'
  ] loop
    original := pg_get_functiondef(signature::regprocedure);
    definition := replace(original, 'round_no not between 1 and 4', 'round_no not between 1 and 6');
    definition := replace(definition, 'Round must be between 1 and 4.', 'Round must be between 1 and 6.');
    if position('Late-round leave entry requires' in definition) = 0 then
      if position('    if batch_round is null then' in definition) = 0 then
        raise exception 'Expected batch guard missing in %', signature;
      end if;
      definition := replace(definition, '    if batch_round is null then', E'    if round_no in (5, 6) and not private.late_round_leave_allowed(year_row.id, manual_entry) then\n      raise exception ''Late-round leave entry requires the admin toggle and an authorized admin or intaker.'' using errcode = ''42501'';\n    end if;\n    if batch_round is null then');
    end if;
    if signature like 'public.%' and position('if not (batch_round in (5, 6)' in definition) = 0 then
      definition := replace(definition, E'if enforce_bid_windows\n     and not public.is_area_bid_round_open',
        E'if not (batch_round in (5, 6) and private.late_round_leave_allowed(year_row.id, manual_entry))\n     and enforce_bid_windows\n     and not public.is_area_bid_round_open');
    end if;
    if position('private.late_round_leave_allowed(year_row.id, manual_entry)' in definition) = 0 then
      raise exception 'Late-round authorization guard missing in %', signature;
    end if;
    execute definition;
  end loop;
end
$upgrade$;
notify pgrst, 'reload schema';
commit;
