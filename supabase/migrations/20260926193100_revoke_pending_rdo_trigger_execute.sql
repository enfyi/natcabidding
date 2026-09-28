-- The trigger function is invoked by Postgres, not through the Data API.
-- Remove the default execute grants that would otherwise expose it as an RPC.
revoke all on function public.enforce_pending_rdo_bidder_lock()
from public, anon, authenticated;
