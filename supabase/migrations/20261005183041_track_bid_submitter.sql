-- Capture attribution from the authenticated profile, never browser-supplied fields.
-- The existing read_bidding_state API already returns submission payloads.
create or replace function public.capture_bid_submitter()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  actor public.bidders%rowtype;
  attribution jsonb;
begin
  if new.submission_type not in ('rdo', 'leave') then return new; end if;

  if tg_op = 'UPDATE' then
    if new.submitted_at is not distinct from old.submitted_at then
      new.payload := (new.payload - 'submittedBy' - 'submittedByRole' - 'submittedById')
        || jsonb_strip_nulls(jsonb_build_object(
          'submittedBy', old.payload->'submittedBy',
          'submittedByRole', old.payload->'submittedByRole',
          'submittedById', old.payload->'submittedById'
        ));
      return new;
    end if;
  end if;

  select * into actor from public.bidders
  where auth_user_id = auth.uid()
    and lower(email) = lower(auth.jwt()->>'email') and active;

  attribution := case when actor.id is null then '{}'::jsonb else
    jsonb_build_object(
      'submittedBy', actor.initials,
      'submittedById', actor.id,
      'submittedByRole', case actor.role
        when 'admin' then 'admin'
        when 'intake' then 'intake rep'
        else 'user' end
    ) end;
  new.payload := (new.payload - 'submittedBy' - 'submittedByRole' - 'submittedById') || attribution;
  return new;
end;
$function$;

revoke all on function public.capture_bid_submitter() from public, anon, authenticated;

drop trigger if exists capture_bid_submitter on public.intake_submissions;
create trigger capture_bid_submitter
before insert or update on public.intake_submissions
for each row execute function public.capture_bid_submitter();
