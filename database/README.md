# Database Starter

This folder is the first pass at moving the bidding site from test data in `bidding.js` into a real database.

## Recommended Setup

Use Supabase/Postgres first. It gives us a real database, login support, permissions, and an admin panel without building all of that from scratch.

1. Create a Supabase project.
2. Open the SQL editor.
3. Run `database/schema.sql`.
4. Run `database/seed.sql` for starter 2027 Area A data.
5. Configure the public client variables used by the Next.js app:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Run `database/rdo_line_eligibility.sql` after `database/schema.sql` to install
the shared RDO-line eligibility rule used by member and admin bidding flows.
Admin-only login profiles can use `bid_role = 'ADM'`; those profiles still get
admin access from `role = 'admin'`, but are excluded from BUE roster, seniority,
bid-window, RDO eligibility, and leave-bidding mechanics.
Employees who remain on the roster but should not bid can use `bid_role = 'NB'`.
`NB` is selectable in roster editing and visible as an employee, but it is
excluded from seniority bid-window slots, RDO eligibility, and leave bidding.
Run `database/admin_profile_adm.sql` to mark the standalone Area A admin login
for `zla.bidding@gmail.com` as `ADM` and clear any bid windows attached to it.

For the admin daily CPC/DEV capacity control, also run
`database/leave_slot_capacity_admin.sql`. It creates the capacity overrides and
the admin-only database operation that safely resizes each day's slot inventory.

For public FAQ and MOU publishing, also run `database/faq_mous.sql`. It creates
admin-managed FAQ rows, a public MOU document list, and the public Supabase
storage bucket used by the `/admin/faq` editor.

For durable intake/admin replacement of dates on an approved leave request, also
run `database/admin_leave_request_edit.sql` after the leave submission preflight.
The operation releases the request's old slots, validates and reserves its new
dates, rebuilds Round 1 buckets and charged-date details, and writes an audit
event in one transaction.

For member self-service changes after submission, run
`database/member_leave_request_management.sql` after the leave submission
preflight. It lets the authenticated bidder remove their own pending or approved
request only while that request's round bid window is open, releases any assigned
slots, and records the change in the audit log. Re-run
`database/leave_submission_preflight.sql` as part of this update so added ranges
are checked against the member's allotted leave hours and current-round limits.
Run `database/member_leave_request_replacement.sql` after the holiday round
rules to enable Change Dates. It cancels the old request and submits the
replacement in one transaction, so validation counts only the surviving bids.
If the replacement is invalid, the old request and its assigned slots remain.
Run `database/reject_unchanged_leave_rebid.sql` after that migration to reject
an exact repeat of dates the bidder removed in the same round, whether through
Change Dates or a later new batch. The bidder must choose a different range.
Run `database/round_one_flexible_week_buckets.sql` after the leave submission
and admin editor SQL to make Round 1 buckets movable when dates are added,
removed, or replaced. It also rebuilds the saved bucket links for active bids.

For the shared admin bid-window testing switch, also run
`database/bid_window_testing_admin.sql`, then re-run
`database/leave_submission_preflight.sql`. The testing switch lets admins allow
all logged-in BUEs to submit outside their assigned bid windows while testing,
with an optional shared test round for checking Round 1-4 rules individually.

For databases that already have the transactional bidding, high-priority fixes,
and leave preflight functions installed, run
`database/resolve_bidding_sql_conflicts.sql` once in the SQL editor. It updates
the RDO submitter, private leave submitter, and public leave preflight together.
The per-bidder leave allowance is measured in hours; Round 1 RDO dates use the
pending or approved RDO request; and the shared testing setting applies to both
RDO and leave submissions. Existing bids and assignments are preserved. A local
regression test is available with `PGLITE_MODULE` set to an installed PGlite
module: `node scripts/test-bidding-sql-conflicts.mjs`.

Run `database/holiday_leave_round_rules.sql` after that upgrade to charge bid
holidays and holiday-in-lieu dates against the member's leave days and hours in
Rounds 1–3. They still do not reserve daily CPC/DEV leave slots. In Round 4,
each distinct holiday or in-lieu date actually charged in an active Round 1–3
request returns one day of leave allowance (8 or 10 hours for the selected
line). In-lieu dates are calculated from a pending RDO request so leave can be
submitted before intake approves that line. The normal five-day Round 4 bid
limit still applies. The migration
recalculates older saved holiday charges and updates the leave-summary views.

For an isolated participant pilot, run `database/pilot_mode.sql` in both schemas
so the application can read the pilot state. In the disposable pilot database
only, run `database/pilot_auth_profile.sql`, `database/pilot_seed.sql`, followed by
`database/pilot_login_only.sql`, to unlock the admin controls and require a
signed-in roster account for every database read or write. Admins can then
choose participants by initials, turn the pilot on or off, and reset submissions,
decisions, assignments, leave allocations, help threads, reminder deliveries,
credits, and audit events. Reset preserves authentication links, bidders, bid
lines, capacity, holidays, bid windows, schedules, and the participant list.

Do not run `pilot_seed.sql` against production. The reset function independently
checks the database marker and refuses to run without it.

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

Run `database/bid_line_import.sql` to enable the system-admin Excel/CSV bid-line importer. The import RPC validates every row, adds or updates `rdo_lines` and `rdo_line_days` atomically without deleting omitted lines, preserves existing assignments and status, and records an audit event. Fatigue group, AWS, and Flex are optional: blank values preserve existing lines and use C, No, and Yes for new lines.

Run `database/bid_time_import.sql` after `database/bid_line_import.sql` to enable the system-admin Excel/CSV bid-time importer. It matches active bidders by area and seniority rank, treats each populated round cell as a two-hour Pacific-time window, and preserves blank rounds, omitted bidders, and existing window status.

Run `database/seniority_roster_import.sql` to enable the system-admin seniority-roster importer. It matches existing bidders by profile ID or initials, applies all rows atomically, preserves linked accounts and bidding records, and leaves omitted bidders unchanged. Blank email, phone, and seniority-date cells preserve existing values.

Regular logged-in users default to their own area, but can view public/reference bidding data for other areas: area names, RDO lines, RDO line days, holidays, and daily leave-slot availability.

Private data stays protected by Supabase Row Level Security. Leave requests, intake submissions, help threads, bid windows, holiday in-lieu records, credit events, and audit history remain limited to the user's own area or their own account.

Server-side admin actions using the Supabase service role can still manage all areas. The service role key must never be exposed in browser code.

## Round 1 Rule

Round 1 is stored with `leave_request_week_buckets`.

A bid week is a span of 7 consecutive calendar dates containing the bidder's selected leave dates and one occurrence of each RDO weekday. A bidder may skip dates inside the span. The earliest selected date starts a bucket; another selected date more than 6 days later starts the next bucket. Adding or removing a bid may move the bucket start, so active Round 1 dates are regrouped before enforcing the two-week limit. Only charged dates spend leave. Round 1 RDO dates are uncharged; holidays and holiday-in-lieu dates count against the bidder's allowance in Round 1.

That lets the app support cases like:

- June 1 alone counts as 1 bid week and 1 charged leave day.
- June 9 through June 16 spans more than 7 calendar days, so it needs 2 Round 1 buckets.
- With Friday–Saturday RDOs, Monday, Tuesday, Thursday, and the immediately following Sunday fit within Monday–Sunday and count as 1 bid week; a Sunday one week later starts a second.
- With the same RDOs, Wednesday–Tuesday may also count as 1 bid week when all selected dates fit that seven-date span.
- A BUE can use up to 2 Round 1 buckets, even if those buckets only spend a few charged leave days.

## Browser Adapter

The website now has a browser-side Supabase adapter:

1. `supabase-config.js` stores the public project URL and publishable browser key.
2. `bidding.html` loads Supabase JS before `bidding.js`.
3. `bidding.js` reads bid year, areas, holidays, RDO lines, RDO line days, and leave slots from Supabase.
4. If Supabase is unavailable, the page keeps using the built-in prototype data.

The remaining write-support work includes:

1. Add real Supabase login.
2. Link each logged-in Supabase auth user to a row in `bidders.auth_user_id`.
3. Save preview/add-to-batch/submit actions into `leave_requests`, `leave_request_dates`, and `leave_request_week_buckets`.
4. Save intake approvals/denials back to Supabase. Approved leave date
   replacements are already persisted by `admin_leave_request_edit.sql`.

## Seniority Imports

Administrators can use `/admin/roster-import` to validate, preview, and apply a cleaned Excel or CSV roster. Raw source spreadsheets can still land in `staging_seniority_roster` first when initials or other identity fields need manual cleanup.

The current seniority workbook does not include reliable BUE initials. The cleaned import file keeps an empty `initials` column and marks `needs_initials = Yes`. Initials should be filled manually or collected from each user's profile before promoting the staging rows into the live `bidders` table.

The live `bidders.initials` field can start blank. The app should let a BUE update it in their profile and mark `initials_verified` once it has been reviewed.

Known name differences between source spreadsheets and Supabase profiles are tracked in `database/imports/bue_name_aliases.json`. Check that file before treating an unmatched BUE as missing.

## Email Login

The current Next.js application uses Supabase email/password authentication. The
roster import should include an `email` column, and each `bidders.email` value
should match the email the BUE will use to log in.

When a BUE logs in, `claim_current_bidder_profile()` links the Supabase auth user to the matching `bidders` row by email. After that, the site can load the user's area, seniority, bid role, initials, and contact profile.

If initials are missing, the profile page can collect them from the BUE and save them with `update_current_bidder_profile()`. They remain unverified until reviewed.

## Admin / intake bidder editor

`database/admin_bidder_editor.sql` adds the database endpoints for the **Edit bidder
information** panel at the top of Intake. Install it after
`database/rdo_line_eligibility.sql` and `leave_submission_preflight.sql`. The live
migration is pending approval.

Search uses bidder UUIDs and the signed-in account's permitted area. Administrators
can search all areas; intake users and currently scheduled intake representatives
can edit their own area. Private notes are excluded from editor responses.

The first button confirms the draft and checks it inside a rolled-back transaction.
The second button reruns the checks and atomically saves the complete record with
an audit event. Editing any field invalidates the previous validation. Snapshot
comparison rejects concurrent bidder edits and requires reloading. Pending bids
remain pending; approved bids retain their approved status. Dates are grouped by
round, and inactive requests retain their status when their dates are corrected.

Checks include line eligibility/availability, fatigue capacity, required Mid and
fatigue settings, date bounds, overlapping leave, RDO conflicts, round limits,
leave-hour allowance, and daily capacity. Administrative corrections can update
past rounds without an open bidding window, matching manual intake entry. Capacity
overrides are not accepted by this editor.

Local regression tests are in `scripts/test-bidder-editor.mjs`. They use synthetic
data in PGlite, with no live database connection. Set `PGLITE_MODULE` to an installed
`@electric-sql/pglite/dist/index.js` module and run `node scripts/test-bidder-editor.mjs`.
