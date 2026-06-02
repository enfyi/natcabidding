# Prototype Data Map

This maps the current front-end test data to the database tables.

| Current data in `bidding.js` | Database table |
| --- | --- |
| `BID_YEAR`, `ANNUAL_LEAVE_ALLOWANCE_DAYS` | `bid_years` |
| `testAccounts`, `currentUser` | `bidders` |
| `senioritySource` | `bidders` |
| Uploaded seniority spreadsheets | `staging_seniority_roster` first, then `bidders` after initials are filled |
| `rdoLines` | `rdo_lines`, `rdo_line_days` |
| `selectedWeek` | `rdo_line_days` for the current bidder's selected line |
| `roundDateBlocks`, `bidStartTimes`, `userBidWindow` | `bid_rounds`, `bid_windows` |
| Holiday rules from `holidays.pdf` | `holidays`, `holiday_in_lieu_days` |
| `leaveSlotCapacity`, `leaveSlotWeeks`, `extraLeaveSlotData` | `leave_slots` |
| `leaveBids` | `leave_requests`, `leave_request_dates`, `leave_request_week_buckets` |
| `leaveDraftQueue` | `leave_requests` with `draft` or `preview` status |
| `intakeSchedules` | `intake_schedules` |
| RDO/leave intake forms | `intake_submissions` |
| `history` | `audit_events` |
| Help/admin messages | `help_threads`, `help_messages` |

## First Live Connection Target

Start with read-only data:

1. Load `bid_years`.
2. Load the logged-in `bidders` row.
3. Load that bidder's RDO line.
4. Load `holidays` and `holiday_in_lieu_days`.
5. Load `leave_slots` for the calendar.

After the calendar looks right with live data, wire up writes:

1. Save preview dates as `leave_requests.status = 'preview'`.
2. Save batch items as `leave_requests.status = 'draft'`.
3. Submit the batch by changing them to `pending`.
4. Approve/deny from intake by changing status and writing `audit_events`.
