select
  count(*) as bidders_total,
  count(*) filter (where nullif(trim(email), '') is not null) as bidders_with_email,
  count(*) filter (where nullif(trim(email), '') is null) as bidders_missing_email
from public.bidders;

select
  count(*) as staging_total,
  count(*) filter (where nullif(trim(email), '') is not null) as staging_with_email,
  count(*) filter (where nullif(trim(email), '') is null) as staging_missing_email
from public.staging_seniority_roster;