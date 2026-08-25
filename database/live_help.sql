-- Live Help persistence and access helpers for Supabase.
-- Apply after schema.sql and rls_area_policies.sql.

alter table help_threads
  add column if not exists area_id uuid references areas(id) on delete set null,
  add column if not exists requester_name text,
  add column if not exists requester_initials text,
  add column if not exists requester_email text,
  add column if not exists requester_auth_user_id uuid,
  add column if not exists anonymous_session_id text,
  add column if not exists requester_verified boolean not null default false,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references bidders(id) on delete set null;

alter table help_messages
  add column if not exists sender_role text not null default 'bue',
  add column if not exists sender_display_name text,
  add column if not exists sender_verified boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'help_messages_sender_role_check'
  ) then
    alter table help_messages
      add constraint help_messages_sender_role_check
      check (sender_role in ('bue', 'visitor', 'intake', 'admin', 'system'));
  end if;
end $$;

create index if not exists help_threads_bidder_idx
  on help_threads(bid_year_id, bidder_id, updated_at desc)
  where bidder_id is not null;

create index if not exists help_threads_anonymous_session_idx
  on help_threads(bid_year_id, anonymous_session_id, updated_at desc)
  where anonymous_session_id is not null;

create index if not exists help_messages_thread_created_idx
  on help_messages(thread_id, created_at);

create or replace function public.is_current_intake_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from bidders b
    where b.auth_user_id = auth.uid()
      and lower(b.email) = lower(auth.jwt() ->> 'email')
      and b.role in ('intake', 'admin')
      and b.active
  )
$$;

create or replace function public.live_help_session_is_valid(help_session_id text)
returns boolean
language sql
immutable
as $$
  select length(coalesce(trim(help_session_id), '')) between 16 and 128
$$;

create or replace function public.live_help_threads(
  help_bid_year integer default null,
  help_session_id text default null
)
returns table (
  id uuid,
  bidder_id uuid,
  anonymous_session_id text,
  requester_name text,
  requester_initials text,
  requester_verified boolean,
  area_name text,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  messages jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_bidder_id uuid := public.current_bidder_id();
  actor_is_staff boolean := public.is_current_intake_or_admin();
  target_bid_year_id uuid;
begin
  if help_bid_year is not null then
    select bys.id into target_bid_year_id
    from bid_years bys
    where bys.bid_year = help_bid_year
    limit 1;
  end if;

  return query
  select
    ht.id,
    ht.bidder_id,
    ht.anonymous_session_id,
    coalesce(ht.requester_name, trim(coalesce(b.first_name, '') || ' ' || coalesce(b.last_name, '')), 'Unverified visitor') as requester_name,
    coalesce(ht.requester_initials, b.initials, 'Guest') as requester_initials,
    coalesce(ht.requester_verified, ht.bidder_id is not null) as requester_verified,
    coalesce(a.name, ba.name, 'Area A') as area_name,
    ht.status,
    ht.created_at,
    ht.updated_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', hm.id,
          'sender_id', hm.sender_id,
          'sender_role', hm.sender_role,
          'sender_display_name', coalesce(hm.sender_display_name, sb.initials, 'Guest'),
          'sender_verified', hm.sender_verified,
          'message', hm.message,
          'created_at', hm.created_at
        )
        order by hm.created_at
      ) filter (where hm.id is not null),
      '[]'::jsonb
    ) as messages
  from help_threads ht
  left join bidders b on b.id = ht.bidder_id
  left join areas a on a.id = ht.area_id
  left join areas ba on ba.id = b.area_id
  left join help_messages hm on hm.thread_id = ht.id
  left join bidders sb on sb.id = hm.sender_id
  where (target_bid_year_id is null or ht.bid_year_id = target_bid_year_id)
    and (
      actor_is_staff
      or (actor_bidder_id is not null and ht.bidder_id = actor_bidder_id)
      or (
        actor_bidder_id is null
        and public.live_help_session_is_valid(help_session_id)
        and ht.anonymous_session_id = help_session_id
      )
    )
  group by ht.id, b.id, a.name, ba.name
  order by ht.updated_at desc;
end;
$$;

create or replace function public.live_help_send_message(
  help_thread_id uuid default null,
  help_bid_year integer default null,
  help_session_id text default null,
  help_area text default null,
  help_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_bidder_id uuid := public.current_bidder_id();
  actor_role text;
  actor_initials text;
  actor_name text;
  actor_area_id uuid;
  target_bid_year_id uuid;
  target_thread_id uuid := help_thread_id;
  normalized_message text := nullif(trim(help_message), '');
begin
  if normalized_message is null then
    raise exception 'A help message is required.';
  end if;

  if length(normalized_message) > 4000 then
    raise exception 'Help messages must be 4000 characters or fewer.';
  end if;

  if help_bid_year is not null then
    select bys.id into target_bid_year_id
    from bid_years bys
    where bys.bid_year = help_bid_year
    limit 1;
  end if;

  if actor_bidder_id is not null then
    select b.role, b.initials, trim(b.first_name || ' ' || b.last_name), b.area_id
      into actor_role, actor_initials, actor_name, actor_area_id
    from bidders b
    where b.id = actor_bidder_id;
  end if;

  if target_thread_id is null then
    if actor_bidder_id is not null then
      select ht.id into target_thread_id
      from help_threads ht
      where ht.bidder_id = actor_bidder_id
        and (target_bid_year_id is null or ht.bid_year_id = target_bid_year_id)
        and ht.status = 'open'
      order by ht.updated_at desc
      limit 1;

      if target_thread_id is null then
        insert into help_threads (
          bid_year_id,
          bidder_id,
          area_id,
          requester_name,
          requester_initials,
          requester_auth_user_id,
          requester_verified,
          subject,
          status
        )
        values (
          target_bid_year_id,
          actor_bidder_id,
          actor_area_id,
          actor_name,
          actor_initials,
          auth.uid(),
          true,
          'Live Help',
          'open'
        )
        returning id into target_thread_id;
      end if;
    else
      if not public.live_help_session_is_valid(help_session_id) then
        raise exception 'A valid help session is required.';
      end if;

      select ht.id into target_thread_id
      from help_threads ht
      where ht.anonymous_session_id = help_session_id
        and (target_bid_year_id is null or ht.bid_year_id = target_bid_year_id)
        and ht.status = 'open'
      order by ht.updated_at desc
      limit 1;

      if target_thread_id is null then
        insert into help_threads (
          bid_year_id,
          area_id,
          requester_name,
          requester_initials,
          anonymous_session_id,
          requester_verified,
          subject,
          status
        )
        values (
          target_bid_year_id,
          (select a.id from areas a where a.name = help_area limit 1),
          'Unverified visitor',
          'Guest',
          help_session_id,
          false,
          'Live Help',
          'open'
        )
        returning id into target_thread_id;
      end if;
    end if;
  end if;

  if not exists (
    select 1
    from help_threads ht
    where ht.id = target_thread_id
      and (
        public.is_current_intake_or_admin()
        or (actor_bidder_id is not null and ht.bidder_id = actor_bidder_id)
        or (
          actor_bidder_id is null
          and public.live_help_session_is_valid(help_session_id)
          and ht.anonymous_session_id = help_session_id
        )
      )
  ) then
    raise exception 'You do not have access to that help thread.';
  end if;

  insert into help_messages (
    thread_id,
    sender_id,
    sender_role,
    sender_display_name,
    sender_verified,
    message
  )
  values (
    target_thread_id,
    actor_bidder_id,
    case
      when actor_role = 'admin' then 'admin'
      when actor_role = 'intake' then 'intake'
      when actor_bidder_id is not null then 'bue'
      else 'visitor'
    end,
    coalesce(actor_initials, 'Guest'),
    actor_bidder_id is not null,
    normalized_message
  );

  update help_threads
  set status = 'open',
      updated_at = now()
  where id = target_thread_id;

  return target_thread_id;
end;
$$;

create or replace function public.live_help_resolve_thread(help_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_bidder_id uuid := public.current_bidder_id();
begin
  if not public.is_current_intake_or_admin() then
    raise exception 'Only intake or admin users can resolve help threads.';
  end if;

  update help_threads
  set status = 'closed',
      closed_at = now(),
      closed_by = actor_bidder_id,
      updated_at = now()
  where id = help_thread_id;
end;
$$;

grant execute on function public.live_help_threads(integer, text) to anon, authenticated;
grant execute on function public.live_help_send_message(uuid, integer, text, text, text) to anon, authenticated;
grant execute on function public.live_help_resolve_thread(uuid) to authenticated;

alter table help_threads enable row level security;
alter table help_messages enable row level security;

drop policy if exists "users can read help threads in own area" on help_threads;
create policy "confirmed users can read assigned help threads"
on help_threads for select
to authenticated
using (
  public.is_current_intake_or_admin()
  or bidder_id = public.current_bidder_id()
);

drop policy if exists "users can read help messages in own area" on help_messages;
create policy "confirmed users can read assigned help messages"
on help_messages for select
to authenticated
using (
  exists (
    select 1
    from help_threads ht
    where ht.id = help_messages.thread_id
      and (
        public.is_current_intake_or_admin()
        or ht.bidder_id = public.current_bidder_id()
      )
  )
);
