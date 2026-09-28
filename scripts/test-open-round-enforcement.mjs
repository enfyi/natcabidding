import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../bidding.js", import.meta.url), "utf8");
const functionStart = source.indexOf("function openAreaBidRound");
const functionEnd = source.indexOf("\nfunction downloadBidWindowsIcs", functionStart);
assert.notEqual(functionStart, -1, "openAreaBidRound must exist");
assert.notEqual(functionEnd, -1, "openAreaBidRound must have a stable extraction boundary");

const at = (value) => new Date(value);
const windows = new Map([
  [1, [
    { start: at("2026-10-01T14:00:00Z"), end: at("2026-10-01T16:00:00Z") },
    { start: at("2026-10-02T14:00:00Z"), end: at("2026-10-02T16:00:00Z") },
  ]],
  [2, [
    { start: at("2026-10-05T14:00:00Z"), end: at("2026-10-05T16:00:00Z") },
  ]],
]);

const context = {
  currentViewArea: () => "Area A",
  roundDateBlocksForArea: () => [["Round 1", "Round 2"]],
  roundWindows: (round) => windows.get(round) || [],
};
vm.createContext(context);
vm.runInContext(`${source.slice(functionStart, functionEnd)}\nthis.openAreaBidRound = openAreaBidRound;`, context);

assert.equal(context.openAreaBidRound(at("2026-10-01T15:00:00Z"), "Area A"), 1, "Round 1 opens with its first window");
assert.equal(context.openAreaBidRound(at("2026-10-01T20:00:00Z"), "Area A"), 1, "Round 1 remains open between personal windows");
assert.equal(context.openAreaBidRound(at("2026-10-02T16:00:00Z"), "Area A"), null, "Round 1 closes with its final window");
assert.equal(context.openAreaBidRound(at("2026-10-05T15:00:00Z"), "Area A"), 2, "Only Round 2 is accepted after the schedule advances");

const requiredSqlFiles = [
  "../database/transactional_bidding.sql",
  "../database/high_priority_bidding_fixes.sql",
  "../database/leave_submission_preflight.sql",
];
for (const relativePath of requiredSqlFiles) {
  const sql = await readFile(new URL(relativePath, import.meta.url), "utf8");
  assert.match(sql, /is_area_bid_round_open\(year_row\.id, target\.area_id, (?:resolved_round|batch_round)\)/, `${relativePath} must enforce the area's active round`);
}

console.log("PASS open-round submission enforcement");
