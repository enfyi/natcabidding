create table if not exists public.intake_shift_presets (
  id uuid primary key default gen_random_uuid(),
  start_time time not null unique,
  duration_hours numeric(5,2) not null check (duration_hours >= 0.25 and duration_hours <= 24 and duration_hours * 4 = trunc(duration_hours * 4)),
  created_at timestamptz not null default now()
);

alter table public.intake_shift_presets enable row level security;
revoke all on public.intake_shift_presets from public, anon, authenticated;

insert into public.intake_shift_presets (id, start_time, duration_hours)
values
  ('00000000-0000-4000-8000-000000000645', '06:45', 8),
  ('00000000-0000-4000-8000-000000001115', '11:15', 8)
on conflict (start_time) do nothing;

create or replace function public.read_intake_shift_presets()
returns table (id uuid, start_time time, duration_hours numeric)
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_current_intake_or_admin() then
    raise exception 'Intake or admin access is required.';
  end if;
  return query
    select p.id, p.start_time, p.duration_hours
    from public.intake_shift_presets p
    order by p.start_time;
end;
$$;

create or replace function public.save_intake_shift_preset(
  requested_id uuid,
  requested_start_time time,
  requested_duration_hours numeric
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare saved_id uuid;
begin
  if auth.uid() is null or not public.is_current_admin() then
    raise exception 'Only system admins can manage base shifts.';
  end if;
  if requested_start_time is null or requested_duration_hours is null
    or requested_duration_hours < 0.25 or requested_duration_hours > 24
    or requested_duration_hours * 4 <> trunc(requested_duration_hours * 4) then
    raise exception 'Enter a valid start time and shift length.';
  end if;
  if requested_id is null then
    insert into public.intake_shift_presets (start_time, duration_hours)
    values (requested_start_time, requested_duration_hours)
    returning id into saved_id;
  else
    update public.intake_shift_presets
    set start_time = requested_start_time, duration_hours = requested_duration_hours
    where id = requested_id
    returning id into saved_id;
    if saved_id is null then raise exception 'Base shift not found.'; end if;
  end if;
  return saved_id;
end;
$$;

create or replace function public.delete_intake_shift_preset(requested_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_current_admin() then
    raise exception 'Only system admins can manage base shifts.';
  end if;
  delete from public.intake_shift_presets where id = requested_id;
  if not found then raise exception 'Base shift not found.'; end if;
end;
$$;

revoke all on function public.read_intake_shift_presets() from public, anon, authenticated;
revoke all on function public.save_intake_shift_preset(uuid, time, numeric) from public, anon, authenticated;
revoke all on function public.delete_intake_shift_preset(uuid) from public, anon, authenticated;
grant execute on function public.read_intake_shift_presets() to authenticated;
grant execute on function public.save_intake_shift_preset(uuid, time, numeric) to authenticated;
grant execute on function public.delete_intake_shift_preset(uuid) to authenticated;
