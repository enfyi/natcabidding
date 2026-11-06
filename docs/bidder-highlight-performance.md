# Bidder leave-date highlight performance

Local headless Chrome comparison, November 6, 2026. Original source is the checkout's HEAD version before the date-selection changes; optimized source includes all changes in this worktree.

## Changes

- One synchronous read cache across validation, input counts and selection updates.
- Submitted-date and round-usage checks share a bidder history scan within that operation. Each later operation reads fresh data.
- Only the active member calendar's selected, staged and previously highlighted dates receive class updates. Hidden calendars are invalidated for their next visit, including progressive tablet calendars.
- Date-picker selection updates retain existing buttons and keyboard focus. Month navigation and normal data refresh still rebuild the picker.
- Removed duplicate input-count work in the calendar click handler.

## Results

| Viewport / control | Median handler before | After | Median next-paint upper bound before | After | p95 next-paint upper bound before | After |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 768px calendar | 31.5 ms | 3.8 ms | 49.0 ms | 33.3 ms | 83.4 ms | 33.8 ms |
| 768px picker | 27.5 ms | 2.1 ms | 48.8 ms | 33.4 ms | 66.5 ms | 34.3 ms |
| 1440px calendar | 32.9 ms | 3.6 ms | 50.0 ms | 33.2 ms | 84.1 ms | 34.5 ms |
| 1440px picker | 29.6 ms | 3.5 ms | 48.7 ms | 33.2 ms | 84.3 ms | 34.4 ms |

The fixture uses production functions, event handlers and CSS with 400 synthetic roster entries, 1,200 synthetic leave records, and three populated 13-month calendars. Roster conversion and RDO weekdays are simplified fixture adapters; submitted-line lookups, holiday calculations, availability checks, round validation and selection rendering run production code. Authentication/startup/network activity is excluded. Dates are visible in the viewport; the test invokes DOM clicks and verifies selection classes synchronously. Each control has 20 samples, with the first two excluded from timing statistics.

The next-paint metric waits through two animation frames after dispatching the click, allowing a rendering opportunity between them. It is a conservative rendering checkpoint, not a direct measurement of display pixels. Its roughly 33 ms floor reflects frame scheduling in this environment. These are local synthetic results, not live-site or physical-tablet measurements.

## Verification and reproduction

Run `node scripts/test-bidder-highlight-browser.mjs` with Playwright and Next's bundled Acorn available. Optional environment variables:

- `PLAYWRIGHT_MODULE`: installed Playwright module path (CommonJS entry/package directory).
- `CALENDAR_ACORN_MODULE`: installed Acorn module path.
- `CHROME_EXECUTABLE`: Chrome executable path.
- `HIGHLIGHT_SOURCE`: alternate bidding.js source for comparison.
- `HIGHLIGHT_BASELINE=1`: allow original behavior that rebuilds picker buttons and updates hidden calendars.

The browser test also verifies selection/deselection, rapid clicks, retained picker focus, hidden calendar invalidation, month navigation, and adding the selected dates to the local preview batch. It never submits a bid to a backend.

Targeted regressions passed: leave rendering/read-cache lifetime, individual selection, Round 1 week buckets, previously submitted dates, ghost/regular slot availability and capacity, leave-hours accounting, draft order, calendar refresh position, and tablet taps at 768/1024/1366px. The old Round 1 test's static expectation was updated from four rounds to the existing six-round behavior.
