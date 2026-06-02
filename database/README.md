# Database Starter

This folder is the first pass at moving the bidding site from test data in `bidding.js` into a real database.

## Recommended Setup

Use Supabase/Postgres first. It gives us a real database, login support, permissions, and an admin panel without building all of that from scratch.

1. Create a Supabase project.
2. Open the SQL editor.
3. Run `database/schema.sql`.
4. Run `database/seed.sql` for starter 2027 Area A data.
5. Add these environment variables later when the website starts reading live data:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` for server-only admin actions

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

## Round 1 Rule

Round 1 is stored with `leave_request_week_buckets`.

A bucket is a consecutive period of up to 7 calendar days. Any number of selected leave dates inside that bucket counts as 1 bid week, but only the charged dates spend leave. RDOs, holidays, and holiday in-lieu days can be stored on `leave_request_dates` without charging leave.

That lets the app support cases like:

- June 1 alone counts as 1 bid week and 1 charged leave day.
- June 9 through June 16 spans more than 7 calendar days, so it needs 2 Round 1 buckets.
- A BUE can use up to 2 Round 1 buckets, even if those buckets only spend a few charged leave days.

## Next Build Step

The website now has a browser-side Supabase adapter:

1. `supabase-config.js` stores the public project URL and publishable browser key.
2. `bidding.html` loads Supabase JS before `bidding.js`.
3. `bidding.js` reads bid year, areas, holidays, RDO lines, RDO line days, and leave slots from Supabase.
4. If Supabase is unavailable, the page keeps using the built-in prototype data.

The next practical step is write support:

1. Add real Supabase login.
2. Link each logged-in Supabase auth user to a row in `bidders.auth_user_id`.
3. Save preview/add-to-batch/submit actions into `leave_requests`, `leave_request_dates`, and `leave_request_week_buckets`.
4. Save intake approvals/denials back to Supabase and write `audit_events`.

## Seniority Imports

Seniority spreadsheets should land in `staging_seniority_roster` first.

The current seniority workbook does not include reliable BUE initials. The cleaned import file keeps an empty `initials` column and marks `needs_initials = Yes`. Initials should be filled manually or collected from each user's profile before promoting the staging rows into the live `bidders` table.

The live `bidders.initials` field can start blank. The app should let a BUE update it in their profile and mark `initials_verified` once it has been reviewed.

## Email Login

Supabase Auth should use email sign-in links. The roster import should include an `email` column, and each `bidders.email` value should match the email the BUE will use to log in.

When a BUE logs in, `claim_current_bidder_profile()` links the Supabase auth user to the matching `bidders` row by email. After that, the site can load the user's area, seniority, bid role, initials, and contact profile.

If initials are missing, the profile page can collect them from the BUE and save them with `update_current_bidder_profile()`. They remain unverified until reviewed.
