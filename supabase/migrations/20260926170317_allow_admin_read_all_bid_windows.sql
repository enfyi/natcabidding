-- Bid-window imports are administered across areas. Preserve the own-area read
-- boundary for controllers while allowing system admins to verify every area.
drop policy if exists "users can read bid windows in own area" on public.bid_windows;
drop policy if exists "users can read own-area bid windows and admins can read all" on public.bid_windows;

create policy "users can read own-area bid windows and admins can read all"
on public.bid_windows for select
to authenticated
using (
  (select public.is_current_admin())
  or public.is_bidder_in_current_area(bidder_id)
);
