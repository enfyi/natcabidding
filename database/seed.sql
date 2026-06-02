-- Starter seed data matching the current prototype.
-- Run this after schema.sql in a fresh development database.

create extension if not exists pgcrypto with schema extensions;

insert into bid_years (bid_year, status, annual_leave_allowance_days)
values (2027, 'open', 36)
on conflict (bid_year) do update
set status = excluded.status,
    annual_leave_allowance_days = excluded.annual_leave_allowance_days;

insert into areas (code, name, display_order)
values
  ('area-a', 'Area A', 1),
  ('area-b', 'Area B', 2),
  ('area-c', 'Area C', 3),
  ('area-d', 'Area D', 4),
  ('area-e', 'Area E', 5),
  ('area-f', 'Area F', 6),
  ('tmu', 'TMU', 7)
on conflict (code) do update
set name = excluded.name,
    display_order = excluded.display_order;

insert into bidders (area_id, first_name, last_name, initials, email, phone, role, bid_role, seniority_rank)
select a.id, 'Michael', 'Schoelen', 'OC', 'm.schoelen@yahoo.com', '(555) 555-0147', 'admin', 'GL', 5
from areas a
where a.code = 'area-a'
on conflict do nothing;

insert into bidders (area_id, first_name, last_name, initials, email, phone, role, bid_role, seniority_rank)
select a.id, 'Sarah', 'Harris', 'SH', 'sh@natcazla.com', '(555) 555-0111', 'admin', 'CPC', 11
from areas a
where a.code = 'area-a'
on conflict do nothing;

insert into bidders (area_id, first_name, last_name, initials, email, role, bid_role, seniority_rank, initials_verified)
select a.id, 'Main', 'Admin', 'ADM', 'admin@natcazla.local', 'admin', 'CPC', null, true
from areas a
where a.code = 'area-a'
on conflict do nothing;

insert into app_login_accounts (username, password_hash, bidder_id)
select 'admin', extensions.crypt('admin1', extensions.gen_salt('bf')), b.id
from bidders b
where b.email = 'admin@natcazla.local'
on conflict (username) do update
set password_hash = excluded.password_hash,
    bidder_id = excluded.bidder_id,
    active = true,
    updated_at = now();

insert into holidays (bid_year_id, holiday_date, name, is_observed)
select bys.id, holiday_date, name, false
from bid_years bys
cross join (values
  ('2027-01-01'::date, 'New Year''s Day'),
  ('2027-01-18'::date, 'Martin Luther King Jr. Day'),
  ('2027-02-15'::date, 'Washington''s Birthday'),
  ('2027-05-31'::date, 'Memorial Day'),
  ('2027-06-19'::date, 'Juneteenth'),
  ('2027-07-04'::date, 'Independence Day'),
  ('2027-09-06'::date, 'Labor Day'),
  ('2027-10-11'::date, 'Columbus Day'),
  ('2027-11-11'::date, 'Veterans Day'),
  ('2027-11-25'::date, 'Thanksgiving Day'),
  ('2027-12-25'::date, 'Christmas Day')
) as h(holiday_date, name)
where bys.bid_year = 2027
on conflict (bid_year_id, holiday_date, name) do nothing;

insert into rdo_lines (
  bid_year_id,
  area_id,
  line_code,
  line_type,
  pattern,
  fatigue_group,
  mid,
  aws,
  four_ten,
  flex,
  status
)
select bys.id, a.id, '15', 'CPC', 'T/W', 'C', 'No', false, false, true, 'open'
from bid_years bys
cross join areas a
where bys.bid_year = 2027
  and a.code = 'area-a'
on conflict (bid_year_id, area_id, line_code) do nothing;

insert into rdo_line_days (rdo_line_id, weekday, shift_code)
select rl.id, d.weekday, d.shift_code
from rdo_lines rl
join bid_years bys on bys.id = rl.bid_year_id
join areas a on a.id = rl.area_id
cross join (values
  (0, '630'),
  (1, '600'),
  (2, 'RDO'),
  (3, 'RDO'),
  (4, '1430'),
  (5, '1300'),
  (6, '700')
) as d(weekday, shift_code)
where bys.bid_year = 2027
  and a.code = 'area-a'
  and rl.line_code = '15'
on conflict (rdo_line_id, weekday) do update
set shift_code = excluded.shift_code;

insert into bid_rounds (bid_year_id, round_number, label, status)
select id, 1, 'Round 1', 'open'
from bid_years
where bid_year = 2027
on conflict (bid_year_id, round_number) do update
set label = excluded.label,
    status = excluded.status;

insert into leave_slots (bid_year_id, area_id, slot_date, slot_group, slot_code, status, bidder_id, slot_initials)
select bys.id, a.id, s.slot_date, s.slot_group, s.slot_code, s.status, b.id, coalesce(b.initials, s.initials)
from bid_years bys
join areas a on a.code = 'area-a'
cross join (values
  ('2027-07-04'::date, 'cpc', 'C1', 'approved', 'OC'),
  ('2027-01-18'::date, 'cpc', 'C1', 'approved', 'CZ'),
  ('2027-01-18'::date, 'cpc', 'C2', 'approved', 'AG'),
  ('2027-01-18'::date, 'cpc', 'C3', 'approved', 'SS')
) as s(slot_date, slot_group, slot_code, status, initials)
left join bidders b on b.area_id = a.id and b.initials = s.initials
where bys.bid_year = 2027
on conflict (bid_year_id, area_id, slot_date, slot_group, slot_code) do update
set status = excluded.status,
    bidder_id = excluded.bidder_id,
    slot_initials = excluded.slot_initials;
