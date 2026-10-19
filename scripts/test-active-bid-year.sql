-- Run against the database with an administrative connection. All changes roll back.
begin;
create temporary table bid_year_guard_probe(bid_year_id uuid);
create trigger test_guard before insert or update or delete on bid_year_guard_probe
for each row execute function public.enforce_active_bid_year();
do $$
declare
  historical_id uuid := gen_random_uuid();
  active_id uuid;
  actor public.bidders%rowtype;
  blocked boolean;
begin
  select active_bid_year_id into strict active_id from public.bidding_site_settings where singleton;
  if not exists(select 1 from public.read_bid_year_settings(2027)) then raise exception 'Read API missing'; end if;
  if has_table_privilege('authenticated', 'public.bidding_site_settings', 'UPDATE') then raise exception 'Direct update exposed'; end if;
  if has_function_privilege('anon', 'public.set_active_bid_year(integer)', 'EXECUTE') then raise exception 'Anonymous setter exposed'; end if;
  insert into public.bid_years(id,bid_year,status) values(historical_id,2098,'closed');
  select * into strict actor from public.bidders where active and auth_user_id is not null and role not in ('admin','intake') limit 1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_user_id,'email',actor.email,'role','authenticated')::text,true);
  insert into bid_year_guard_probe values(active_id);
  blocked := false;
  begin insert into bid_year_guard_probe values(historical_id); exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'Historical insert was allowed'; end if;
  blocked := false;
  begin update bid_year_guard_probe set bid_year_id = historical_id; exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'Historical update was allowed'; end if;
  blocked := false;
  begin perform public.set_active_bid_year(2027); exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'Bidder changed the active year'; end if;
  -- Simulate an admin changing years while the bidder still views the old one.
  update public.bidding_site_settings set active_bid_year_id = historical_id where singleton;
  blocked := false;
  begin delete from bid_year_guard_probe; exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'Stale bidder session edited inactive year'; end if;
  select * into strict actor from public.bidders where active and auth_user_id is not null and role = 'admin' limit 1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.auth_user_id,'email',actor.email,'role','authenticated')::text,true);
  perform public.set_active_bid_year(2027);
  if (select active_bid_year_id from public.bidding_site_settings where singleton) <> active_id then raise exception 'Admin setter failed'; end if;
end
$$;
rollback;
