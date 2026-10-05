import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../bidding.js", import.meta.url), "utf8");
const functionStart = source.indexOf("function allAreaRoundWindows");
const functionEnd = source.indexOf("\nfunction downloadBidWindowsIcs", functionStart);
assert.notEqual(functionStart, -1, "all-area round helpers must exist");
assert.notEqual(functionEnd, -1, "all-area round helpers must have a stable extraction boundary");

const at = (value) => new Date(value);
const windows = new Map([
  ["Area A|1", [
    { start: at("2026-10-01T14:00:00Z"), end: at("2026-10-01T16:00:00Z") },
    { start: at("2026-10-01T16:00:00Z"), end: at("2026-10-01T18:00:00Z") },
  ]],
  ["Area F|1", [
    { start: at("2026-10-01T13:00:00Z"), end: at("2026-10-01T15:00:00Z") },
    { start: at("2026-10-02T14:00:00Z"), end: at("2026-10-02T16:00:00Z") },
  ]],
  ["Area A|2", [
    { start: at("2026-10-05T14:00:00Z"), end: at("2026-10-05T16:00:00Z") },
  ]],
  ["Area F|2", [
    { start: at("2026-10-05T14:00:00Z"), end: at("2026-10-05T16:00:00Z") },
  ]],
]);

const context = {
  ZLA_AREAS: ["Area A", "Area F"],
  ROUND_VALIDATION_DURATION_MS: 60 * 60 * 1000,
  currentViewArea: () => "Area A",
  roundDateBlocksForArea: () => [["Round 1", "Round 2"]],
  roundWindows: (round, area) => (windows.get(`${area}|${round}`) || [])
    .map((window, index) => ({ ...window, rank: index + 1 })),
  cachedLeaveRead: (_key, read) => read(),
};
vm.createContext(context);
vm.runInContext(
  `${source.slice(functionStart, functionEnd)}\nthis.openAreaBidRound = openAreaBidRound; this.areaBidRoundState = areaBidRoundState;`,
  context
);

assert.equal(context.openAreaBidRound(at("2026-10-01T13:30:00Z"), "Area A"), 1, "Round 1 opens with the first BUE window in any area");
assert.equal(context.openAreaBidRound(at("2026-10-01T20:00:00Z"), "Area A"), 1, "Round 1 remains open between all-area personal windows");
assert.equal(context.openAreaBidRound(at("2026-10-02T15:00:00Z"), "Area A"), 1, "Area F's later final window keeps Round 1 open for Area A");
assert.equal(context.areaBidRoundState(at("2026-10-02T15:00:00Z"), "Area A").activeRank, null, "A shorter area has no false active bidder while the global round remains open");
assert.equal(context.areaBidRoundState(at("2026-10-02T15:00:00Z"), "Area A").endsAt.toISOString(), "2026-10-02T16:00:00.000Z", "The global round closes at the last BUE window");
assert.equal(context.openAreaBidRound(at("2026-10-02T16:00:00Z"), "Area A"), null, "Round 1 closes with its final window");
assert.equal(context.openAreaBidRound(at("2026-10-05T15:00:00Z"), "Area A"), 2, "Only Round 2 is accepted after the schedule advances");

// Actual 2027 Round 1 span: first starts October 5 at 7 AM Pacific,
// final Area C bidder ends October 14 at 7 PM Pacific.
windows.clear();
for (let round = 1; round <= 4; round += 1) {
  const offset = (round - 1) * 20 * 24 * 60 * 60 * 1000;
  const start = new Date(at("2026-10-05T14:00:00Z").getTime() + offset);
  const end = new Date(at("2026-10-15T02:00:00Z").getTime() + offset);
  windows.set(`Area A|${round}`, [{ start, end: new Date(start.getTime() + 7200000) }]);
  windows.set(`Area F|${round}`, [{ start: new Date(end.getTime() - 7200000), end }]);
}
context.roundDateBlocksForArea = () => [[1, 2, 3, 4]];
for (let round = 1; round <= 4; round += 1) {
  const first = windows.get(`Area A|${round}`)[0];
  const last = windows.get(`Area F|${round}`)[0];
  assert.equal(context.openAreaBidRound(new Date(first.start.getTime() - 1)), null, `Round ${round} closed before its first window`);
  assert.equal(context.areaBidRoundState(first.start).round, round, `Round ${round} opens at its first window`);
  const gap = new Date(first.end.getTime() + 3600000);
  assert.equal(context.areaBidRoundState(gap).phase, "open", `Round ${round} stays open between windows`);
  assert.equal(context.openAreaBidRound(new Date(last.end.getTime() - 1)), round, `Round ${round} stays open through its final window`);
  assert.equal(context.openAreaBidRound(last.end), null, `Round ${round} closes exactly at its final window end`);
  assert.equal(context.areaBidRoundState(last.end).phase, "validation");
}
assert.equal(context.areaBidRoundState(at("2026-10-05T15:38:46Z")).phase, "open", "Screenshot time must show Round 1 open");
assert.equal(context.areaBidRoundState(at("2026-10-12T19:00:00Z")).phase, "open", "Office blackout dates do not close an ongoing round");
const finalEnd = windows.get("Area F|1")[0].end;
windows.set("Area A|2", [{ start: finalEnd, end: new Date(finalEnd.getTime() + 7200000) }]);
windows.delete("Area F|2");
assert.equal(context.areaBidRoundState(finalEnd).round, 2, "A newly opened round takes precedence over previous validation");
assert.equal(context.areaBidRoundState(finalEnd).phase, "open");
assert.match(source, /const currentRound = testRound \|\| latestAreaRound\(now, roundState\)/, "Header round follows the facility rather than the next personal window");
assert.match(source, /const personalRound = testRound \|\| personalBidWindow\?\.round \|\| currentRound/, "Personal countdown retains its own round");

const requiredSqlFiles = [
  "../database/transactional_bidding.sql",
  "../database/high_priority_bidding_fixes.sql",
  "../database/leave_submission_preflight.sql",
];
for (const relativePath of requiredSqlFiles) {
  const sql = await readFile(new URL(relativePath, import.meta.url), "utf8");
  assert.match(sql, /is_area_bid_round_open\(year_row\.id, target\.area_id, (?:resolved_round|batch_round)\)/, `${relativePath} must enforce the all-area active round`);
  assert.match(sql, /if enforce_bid_windows\s+and not public\.is_area_bid_round_open/, `${relativePath} must preserve the authorized pilot bypass`);
}

const preflightSql = await readFile(new URL("../database/leave_submission_preflight.sql", import.meta.url), "utf8");
assert.match(preflightSql, /if not manual_entry and enforce_bid_windows then\s+select bw\.id/, "Production BUE leave submissions must require the personal window");

const globalRoundSql = await readFile(new URL("../supabase/migrations/20261002180000_global_bid_round_windows.sql", import.meta.url), "utf8");
assert.doesNotMatch(globalRoundSql, /scheduled_bidder\.area_id\s*=\s*requested_area_id/, "Global round bounds must not be limited to one area");
assert.match(globalRoundSql, /checked_at\s*>=\s*min\(bid_window\.opens_at\)\s*and checked_at\s*<\s*max\(bid_window\.closes_at\)/, "Global rounds must span the first through final BUE window");
assert.match(globalRoundSql, /scheduled_bidder\.bid_role not in \('ADM', 'NB'\)/, "Only active bidding employees contribute to round bounds");

const memberManagementSql = await readFile(new URL("../database/member_leave_request_management.sql", import.meta.url), "utf8");
assert.match(memberManagementSql, /if not exists \(\s+select 1\s+from public\.bid_windows/, "BUE leave changes must always require the personal window");

const testingAdminSql = await readFile(new URL("../database/bid_window_testing_admin.sql", import.meta.url), "utf8");
assert.match(testingAdminSql, /Assigned bid windows are required and cannot be bypassed/, "admin settings must reject personal-window bypasses");

console.log("PASS open-round submission enforcement");
