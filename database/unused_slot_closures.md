# Unused-slot closure deployment notes

The application changes and `unused_slot_closures.sql` belong together. This is
an opt-in, one-time admin action per bid year, area, and workforce. Saving a rule
does not automatically run it. Choose TMU / CPC / Round 2 / 1 and save; other
areas default to Round 3 / 1. DEV requires a separate rule.

Before deployment, verify the target database has the current capacity table,
`read_public_leave_slots(integer)`, submission preflight, member single/batch
replacement routines, and approved-date replacement routine. Their source files
are `leave_slot_capacity_admin.sql`, `public_leave_slots_read.sql`,
`leave_submission_preflight.sql`, `member_leave_request_replacement.sql`,
`../supabase/migrations/20260928021500_atomic_member_leave_batch_replacement.sql`,
and `admin_leave_request_edit.sql`. Do not blindly reinstall older routine files
over later migrations; inspect the installed definitions and migration history.
Install the new closure SQL, then deploy `bidding.html` and `bidding.js` together.
A missing closure API disables the panel and displays an installation message.

Closures preserve occupied inventory and unrepresented pending/approved requests.
They use submission's area/workforce/date advisory locks, change only the chosen
workforce, record per-date audit entries, and cannot run a second time for the
same rule. Capacity markers are excluded from the public reader's full-day
manual-unavailability flag. Holiday exemptions use four slots in the chosen
group and a holiday in the same Sunday–Saturday week, from `holidays` for that
year. Verify that those configured holiday weeks match the intended exceptions.
The round must be marked closed or have an elapsed `ends_at` before applying.

Capacity changes affect calendar fullness, bidder selection and submission,
member date changes, intake/admin approval and edits, and calculated area slot
budgets. Existing explicit intake/admin capacity overrides are still permitted.
Failed member/admin replacement transactions retain the original request and
inventory. Ordinary per-date capacity editing can reopen slots later; applying
an existing closure rule again is intentionally blocked. Rules do not continuously
close slots released by a later cancellation.

Realtime already covers `leave_slots` and `leave_slot_capacities`; its fallback
refresh repairs missed events. New submissions and replacements recheck in the
database even if a browser has an older snapshot. Bidding backups dynamically
capture public tables, including `slot_closure_rules`; take a snapshot before
applying real closures.

Local regression coverage: `test-unused-slot-closures.mjs`,
`test-reduced-capacity-date-edits.mjs`, `test-ghost-leave-availability.mjs`,
`test-slot-closure-availability.mjs`, and `test-slot-closure-panel.mjs`.
The first two accept `PGLITE_MODULE` for a temporary local PostgreSQL runtime.
These tests do not certify the schema or installed function versions of the
live Supabase project. No live data was changed during this review.
