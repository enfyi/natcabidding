-- Shared, bid-year-specific round rule wording managed by system administrators.

alter table public.bid_year_settings
  add column if not exists round_rules jsonb not null default '{}'::jsonb;

alter table public.bid_year_settings
  add column if not exists approval_rules jsonb;

alter table public.bid_year_settings enable row level security;

drop policy if exists "public can read bid year settings" on public.bid_year_settings;
create policy "public can read bid year settings"
on public.bid_year_settings for select
to anon
using (true);

drop policy if exists "users can read bid year settings" on public.bid_year_settings;
create policy "users can read bid year settings"
on public.bid_year_settings for select
to authenticated
using (true);

grant select (bid_year_id, round_rules) on public.bid_year_settings to anon, authenticated;

grant select (approval_rules) on public.bid_year_settings to anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bid_year_settings_round_rules_object_check'
      and conrelid = 'public.bid_year_settings'::regclass
  ) then
    alter table public.bid_year_settings
      add constraint bid_year_settings_round_rules_object_check
      check (jsonb_typeof(round_rules) = 'object');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bid_year_settings_approval_rules_array_check'
      and conrelid = 'public.bid_year_settings'::regclass
  ) then
    alter table public.bid_year_settings
      add constraint bid_year_settings_approval_rules_array_check
      check (approval_rules is null or jsonb_typeof(approval_rules) = 'array');
  end if;
end
$$;

create or replace function public.read_round_rules(requested_bid_year integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(settings.round_rules, '{}'::jsonb)
  from public.bid_years byear
  left join public.bid_year_settings settings on settings.bid_year_id = byear.id
  where byear.bid_year = requested_bid_year;
$$;

revoke all on function public.read_round_rules(integer) from public, anon, authenticated;
grant execute on function public.read_round_rules(integer) to anon, authenticated;

create or replace function public.set_round_rule(
  requested_bid_year integer,
  requested_round integer,
  rule_label text,
  rule_detail text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.current_bidder_id();
  target_bid_year_id uuid;
  saved_rules jsonb;
begin
  if not public.is_current_admin() then
    raise exception 'Only system admins can change round rules.';
  end if;

  if requested_round is null or requested_round not between 1 and 6 then
    raise exception 'Round must be between 1 and 6.';
  end if;

  rule_label := trim(coalesce(rule_label, ''));
  rule_detail := trim(coalesce(rule_detail, ''));

  if length(rule_label) not between 1 and 120 then
    raise exception 'The round limit must be between 1 and 120 characters.';
  end if;

  if length(rule_detail) not between 1 and 2000 then
    raise exception 'The round rule must be between 1 and 2000 characters.';
  end if;

  select byear.id
  into target_bid_year_id
  from public.bid_years byear
  where byear.bid_year = requested_bid_year;

  if target_bid_year_id is null then
    raise exception 'Bid year % was not found.', requested_bid_year;
  end if;

  insert into public.bid_year_settings (
    bid_year_id,
    round_rules,
    updated_by,
    updated_at
  ) values (
    target_bid_year_id,
    jsonb_build_object(
      requested_round::text,
      jsonb_build_object('label', rule_label, 'detail', rule_detail)
    ),
    actor_id,
    now()
  )
  on conflict (bid_year_id) do update
  set round_rules = jsonb_set(
        coalesce(public.bid_year_settings.round_rules, '{}'::jsonb),
        array[requested_round::text],
        jsonb_build_object('label', rule_label, 'detail', rule_detail),
        true
      ),
      updated_by = actor_id,
      updated_at = now()
  returning round_rules into saved_rules;

  insert into public.audit_events (
    bid_year_id,
    actor_id,
    event_type,
    entity_table,
    entity_id,
    details
  ) values (
    target_bid_year_id,
    actor_id,
    'round_rule_updated',
    'bid_year_settings',
    target_bid_year_id,
    jsonb_build_object(
      'round', requested_round,
      'label', rule_label,
      'detail', rule_detail
    )
  );

  return saved_rules;
end;
$$;

revoke all on function public.set_round_rule(integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.set_round_rule(integer, integer, text, text) to authenticated;

create or replace function public.read_approval_rules(requested_bid_year integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select settings.approval_rules
  from public.bid_years byear
  left join public.bid_year_settings settings on settings.bid_year_id = byear.id
  where byear.bid_year = requested_bid_year;
$$;

revoke all on function public.read_approval_rules(integer) from public, anon, authenticated;
grant execute on function public.read_approval_rules(integer) to anon, authenticated;

create or replace function public.set_approval_rules(
  requested_bid_year integer,
  requested_rules jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := public.current_bidder_id();
  target_bid_year_id uuid;
  normalized_rules jsonb;
begin
  if not public.is_current_admin() then
    raise exception 'Only system admins can change approval rules.';
  end if;

  if requested_rules is null or jsonb_typeof(requested_rules) <> 'array' then
    raise exception 'Approval rules must be an array.';
  end if;

  if jsonb_array_length(requested_rules) > 50 then
    raise exception 'Approval rules are limited to 50 entries.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(requested_rules) rule
    where jsonb_typeof(rule) <> 'string'
       or length(trim(rule #>> '{}')) not between 1 and 500
  ) then
    raise exception 'Each approval rule must contain between 1 and 500 characters.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(trim(rule.value)) order by rule.ordinality), '[]'::jsonb)
  into normalized_rules
  from jsonb_array_elements_text(requested_rules) with ordinality as rule(value, ordinality);

  select byear.id
  into target_bid_year_id
  from public.bid_years byear
  where byear.bid_year = requested_bid_year;

  if target_bid_year_id is null then
    raise exception 'Bid year % was not found.', requested_bid_year;
  end if;

  insert into public.bid_year_settings (
    bid_year_id,
    approval_rules,
    updated_by,
    updated_at
  ) values (
    target_bid_year_id,
    normalized_rules,
    actor_id,
    now()
  )
  on conflict (bid_year_id) do update
  set approval_rules = excluded.approval_rules,
      updated_by = actor_id,
      updated_at = now();

  insert into public.audit_events (
    bid_year_id,
    actor_id,
    event_type,
    entity_table,
    entity_id,
    details
  ) values (
    target_bid_year_id,
    actor_id,
    'approval_rules_updated',
    'bid_year_settings',
    target_bid_year_id,
    jsonb_build_object('rule_count', jsonb_array_length(normalized_rules))
  );

  return normalized_rules;
end;
$$;

revoke all on function public.set_approval_rules(integer, jsonb) from public, anon, authenticated;
grant execute on function public.set_approval_rules(integer, jsonb) to authenticated;
