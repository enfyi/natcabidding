# Database Starter

This folder is the first pass at moving the bidding site from test data in `bidding.js` into a real database.

## Recommended Setup

Use Supabase/Postgres first. It gives us a real database, login support, permissions, and an admin panel without building all of that from scratch.

1. Create a Supabase project.
2. Open the SQL editor.
3. Run `database/schema.sql`.
4. Run `database/seed.sql` for the base 2027 data.
5. Run `database/imports/rdo_lines_2027_seed.sql` for all seven areas.
6. Run `database/transactional_bidding.sql` for authoritative windows and write operations.
7. Run `database/rls_area_policies.sql`.
8. Run `database/reviewer_direct_table_access.sql` to grant direct bidding-table access to active admin/intake reviewers only.
9. Run `database/reviewer_direct_table_access_policy_cleanup.sql` to consolidate reviewer reads into the existing RLS policies.
10. Configure the public client variables used by the Next.js app:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

If a future server-only admin workflow requires a Supabase secret key, keep it in
a non-`NEXT_PUBLIC_` variable and never expose it to browser code.

## What This Covers

- Bid years and areas
- Seven operating areas: Area A, Area B, Area C, Area D, Area E, Area F, and TMU
- BUE/controller accounts and seniority
- RDO lines and daily shift/RDO patterns
- Bid rounds and bid windows
- Holidays and holiday in-lieu days
- Daily leave slots for CPC and DEV
- Leave requests, request dates, and Round 1 week buckets
- Holiday credit tracking for later rounds
- Intake submissions, intake schedules, help messages, and audit history
- Area isolation rules so logged-in users only see their own area

## Area Privacy

Run `database/rls_area_policies.sql` after `database/schema.sql`.

Regular logged-in users default to their own area, but can view public/reference bidding data for other areas: area names, RDO lines, RDO line days, holidays, and daily leave-slot availability.

Private data stays protected by Supabase Row Level Security. Leave requests, intake submissions, help threads, bid windows, holiday in-lieu records, credit events, and audit history remain limited to the user's own area or their own account.

Server-side admin actions using the Supabase service role can still manage all areas. The service role key must never be exposed in browser code.

Active `admin` and `intake` roster users also receive direct Data API access to
the operational bidding tables through reviewer-only RLS policies. Regular
bidders retain reference reads and must use the transactional RPC functions for
writes. Audit and leave-credit event tables are append-only for reviewers.

## Round 1 Rule

Round 1 is stored with `leave_request_week_buckets`.

A bucket is a consecutive period of up to 7 calendar days. Any number of selected leave dates inside that bucket counts as 1 bid week, but only the charged dates spend leave. RDOs, holidays, and holiday in-lieu days can be stored on `leave_request_dates` without charging leave.

That lets the app support cases like:

- June 1 alone counts as 1 bid week and 1 charged leave day.
- June 9 through June 16 spans more than 7 calendar days, so it needs 2 Round 1 buckets.
- A BUE can use up to 2 Round 1 buckets, even if those buckets only spend a few charged leave days.

## Transactional Write Path

The website uses Supabase for both reference reads and bidding writes:

1. `supabase-config.js` stores the public project URL and publishable browser key.
2. `bidding.html` loads Supabase JS before `bidding.js`.
3. `bidding.js` reads bid year, areas, holidays, RDO lines, RDO line days, leave slots, and authenticated bidding state from Supabase.
4. RDO and leave submissions call security-definer RPC functions that validate the authenticated bidder's exclusive bid window inside the transaction.
5. Intake approval locks the target RDO line or leave-slot rows before applying a decision, so concurrent approvals cannot overwrite each other.
6. `rebuild_bid_schedule(2027)` creates four rounds with six two-hour windows per day and a full 60-hour validation interval between rounds.
7. Browser prototype data remains a read-only fallback; configured Supabase writes require an authenticated email session.

## Seniority Imports

Seniority spreadsheets should land in `staging_seniority_roster` first.

The current seniority workbook does not include reliable BUE initials. The cleaned import file keeps an empty `initials` column and marks `needs_initials = Yes`. Initials should be filled manually or collected from each user's profile before promoting the staging rows into the live `bidders` table.

The live `bidders.initials` field can start blank. The app should let a BUE update it in their profile and mark `initials_verified` once it has been reviewed.

## Email Login

The current Next.js application uses Supabase email/password authentication. The
roster import should include an `email` column, and each `bidders.email` value
should match the email the BUE will use to log in.

When a BUE logs in, `claim_current_bidder_profile()` links the Supabase auth user to the matching `bidders` row by email. After that, the site can load the user's area, seniority, bid role, initials, and contact profile.

If initials are missing, the profile page can collect them from the BUE and save them with `update_current_bidder_profile()`. They remain unverified until reviewed.
