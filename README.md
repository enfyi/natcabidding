# ZLA Bidding Website

Next.js App Router authentication backed by Supabase Auth.

## Project status

The active application is the Next.js app in `app/`. The HTML, CSS, and JavaScript
files at the repository root are the earlier static prototype and are reference
material while its bidding workflows are migrated into Next.js.

The current Next.js application provides:

- email/password signup and sign-in through Supabase Auth
- self-service password recovery and password updates
- confirmation and PKCE callback routes
- server-validated sessions and a protected dashboard
- a deployment-safe environment-variable setup

The database starter files are in `database/`. Treat bidding and admin write
workflows as unfinished until their database permissions have been reviewed and
the repository has a migration workflow that matches the connected Supabase
project.

## Local development

Requirements: Node.js 20.9 or newer and pnpm 11.19.

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Copy `.env.example` to `.env.local` and replace the placeholder values.
3. Run `pnpm dev`.
4. Open `http://localhost:3000`.

Before committing, run `pnpm check`. It performs both the TypeScript check and a
production build.

For the `natcazla.com/bidding` self-hosted deployment path, see
`SELF_HOSTING.md`.

The local Supabase project URL and publishable key are stored in the gitignored
`.env.local`. Copy `.env.example` when configuring another environment. Never put
a Supabase secret or service-role key in a `NEXT_PUBLIC_` variable.

## Auth configuration

In Supabase Authentication → URL Configuration, add these redirect URLs:

- `http://localhost:3000/auth/callback`
- `http://localhost:3000/auth/callback?next=/update-password`
- `https://your-production-domain/auth/callback`
- `https://your-production-domain/auth/callback?next=/update-password`

Set `NEXT_PUBLIC_SITE_URL` to the matching deployed origin in production. The app
uses Vercel's deployment URL automatically for Preview deployments and also
supports the token-hash email template route at `/auth/confirm`.

In Supabase Authentication → URL Configuration, use the exact production callback
and add these Additional Redirect URLs for development and Vercel previews:

- `http://localhost:3000/**`
- `https://*-michael-schoelen-s-projects.vercel.app/**`

If the Vercel team slug changes, update the preview wildcard to match it. When a
custom confirmation email template uses `token_hash`, send it directly to the
selected redirect so the deployment origin is preserved:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">
  Confirm email address
</a>
```

The public bidding page recognizes this token-hash URL and presents a separate
`Confirm email and sign in` button before calling `verifyOtp`. The extra user
gesture prevents Microsoft Safe Links and similar email scanners from consuming
the one-time token merely by previewing the link.

## Vercel environment variables

Define `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in Production, Preview, and Development.
Define `NEXT_PUBLIC_SITE_URL` only for Production (and locally in `.env.local`).
The build intentionally fails if the Supabase URL or publishable key is missing.

The browser configuration at `/supabase-config.js` is generated from these
environment variables at request time. Set `NEXT_PUBLIC_APP_ENVIRONMENT=pilot`
on an isolated pilot deployment to show the permanent practice-data banner.
Never point a pilot deployment at the production Supabase project.

## Active and selected bidding years

Apply `database/active_bid_year.sql` after the existing schema and authorization
helpers. It restores `read_bid_year_settings`, provides the year catalog and an
admin-only active-year setter, and makes inactive RDO and leave records view-only
for bidders. The installer selects the existing year only when there is exactly
one; installations with multiple years require an explicit initial admin choice.
The public read functions intentionally expose only year metadata and the
existing window settings. The settings table itself is inaccessible to clients.

In **Bidding Setup → Active Bid Year**, a system administrator can activate an
existing open year. The member **Bid Year** dropdown independently chooses which
year to view. Changing that view reloads the page and clears unsent selections;
it never changes the administrator's active year. Reads and submissions use the
selected year explicitly. New bids require the active year and the existing bid
window rules. Administrators can maintain archived records, but cannot insert
new RDO or leave bids into an inactive year. No roster or schedule is copied.

Run `node scripts/test-active-bid-year.mjs` for client checks and
`scripts/test-active-bid-year.sql` through an administrative database connection
for permission and stale-session checks. The SQL test rolls back all test data.
Install this upgrade independently in production and in the separate pilot
database. Each environment keeps its own active-year setting and bidding rules.

## Isolated bidding pilot

Use a separate Supabase project and a separate Vercel deployment for a
participant pilot. Apply the normal database scripts, then apply
`database/pilot_auth_profile.sql`, `database/pilot_mode.sql`,
`database/pilot_seed.sql`, and `database/pilot_login_only.sql` only in that
disposable database. The Admin page can then select BUEs by initials, turn
practice bidding on or off, and reset the year's practice data. Reset keeps the
roster, login links, schedules, bid windows, holidays, leave capacity, and pilot
participant list.

Apply `database/pilot_round_controls.sql` after `pilot_mode.sql`, then apply
`database/pilot_submission_window_fix.sql` to upgrade legacy RDO and leave
submission functions. `scripts/test-pilot-submission-windows.sql` verifies both
public submission RPCs in a transaction that rolls back all test data. In Pilot Access
and Rounds, administrators can turn each of rounds 1–4 on or off independently.
Authorized pilot participants choose an enabled round in the test-site banner
and submit without scheduled hours. Both pilot access and the chosen round must
be on. All rounds start off. Controls refresh every ten seconds; the database
checks the round at submission time. The selected participant list still controls
who can submit, and normal leave limits and review rules still apply.

The database refuses pilot activation and reset unless `pilot_seed.sql` marked
it as isolated. A reset also turns the pilot off, so the administrator must
review the clean state and turn it back on for the next run.

Apply `database/pilot_bidder_round_reset.sql` to add the individual reset in
Pilot Access and Rounds. Choose a saved allowed bidder and a round: Round 1
clears their RDO assignment and all leave rounds; Rounds 2–6 clear only the chosen
round's bids, decisions, slots, and credits. Individual resets preserve pilot
access, enabled rounds, other bidders, and audit history, and record the reset.

## Bid notification email

Bid submission, approval, and denial notifications are sent through a Google
account using Gmail SMTP. Turn on two-step verification for the Google account,
create a Google App Password for the website, and add these server-only variables
to Vercel Production, Preview, and Development:

- `GMAIL_USER` — the complete Gmail or Google Workspace email address.
- `GMAIL_APP_PASSWORD` — the Google-generated 16-character App Password, not the
  account's normal password.
- `BID_NOTIFICATION_FROM_NAME` — the display name recipients see; defaults to
  `ZLA Bidding`.

Apply `database/bid_email_notifications.sql` to Supabase before enabling email.
It installs a narrowly scoped authenticated recipient lookup, so the notification
route does not need a Supabase service-role key in Vercel.

The bidding page must be signed in through Supabase before it will send email.
Prototype/test-account sessions continue to record the notification in the Email
Log, but cannot call the protected email endpoint.

### Scheduled bid-window reminders

`database/bid_window_email_reminders.sql` installs two reminders based on the
live `bid_windows` rows:

- 15 minutes before a bidder's window opens.
- 30 minutes before a bidder's window closes, unless they already have approved
  leave for that bid year and round (also checked for queued retries).

For existing installations, apply `database/skip_approved_leave_reminders.sql`
to update this rule.

Supabase Cron invokes `/api/cron/bid-window-reminders` once per minute. Store the
same random value (at least 32 characters) as `BID_REMINDER_CRON_SECRET` in Vercel
and as `bid_reminder_cron_secret` in Supabase Vault. Store the full production
endpoint URL as `bid_reminder_endpoint` in Vault. Delivery attempts are recorded
in the private `bid_window_email_reminders` outbox so each window receives each
reminder only once after successful delivery.

## Protected routes

`/dashboard` is guarded in `proxy.ts` with `auth.getClaims()`, and the page repeats
the verified claim check before rendering. Add another private route by including
it in the protected-route predicate in `lib/supabase/proxy.ts` and validating the
user again in server-side data access or Server Actions.

## Reference loading diagnostics

FAQ and MOU reads run independently of the bid-year lookup. RDO and calendar
reads require a verified year and area mapping, but do not wait for the roster
or optional intake data. Bid times require both roster and window reads.
Temporary network errors, timeouts, HTTP 408/429/5xx responses, and PostgreSQL
statement timeouts receive up to three attempts, with staggered backoff. Each
attempt has a 15-second limit. Permission and schema errors are not retried.
This policy applies only to reference reads, never bid submissions or mutations.

Browser console warnings identify the failed section, HTTP status, error code,
attempt, duration, and time. The latest 50 failures are also available through
`window.NATCA_REFERENCE_LOAD_DIAGNOSTICS`. These records exclude response bodies,
credentials, URLs, and bidder details; they remain in memory in that browser tab
and are not sent to a central logging service.

Run `pnpm test:reference-loading` to verify retry limits, timeout recovery,
permission failures, section independence, and 100 simulated concurrent readers.
The simulated concurrency check does not measure production server capacity;
a separate approved staging load test is needed for that.
