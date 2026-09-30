import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../bidding.js", import.meta.url), "utf8");
const start = source.indexOf("function roundDateBlocksForArea");
const end = source.indexOf("function bidWindowLabel", start);

assert.notEqual(start, -1, "roundDateBlocksForArea must exist");
assert.notEqual(end, -1, "bid-window fallback helpers must exist");

const context = vm.createContext({ Date, Math });
const setup = `
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const BID_YEAR = 2027;
  const roundDateBlocks = Array.from({ length: 8 }, () => Array(4).fill(""));
  const bidStartTimes = ["0700", "0900", "1100", "1300", "1500", "1700"];
  const BID_OFFICE_CLOSED_DATE_KEYS = new Set(["2026-10-12", "2026-11-11"]);
  const activeRosterEntries = () => Array.from({ length: 90 });
  const currentViewArea = () => "Area D";
  const dateKey = (year, month, day) => [year, month, day]
    .map((value, index) => index ? String(value).padStart(2, "0") : value)
    .join("-");
`;

vm.runInContext(`${setup}\n${source.slice(start, end)}\nthis.results = ["Area A", "Area B", "Area C", "Area D", "Area E", "Area F", "TMU"].map((area) => ({ area, blocks: roundDateBlocksForArea(area) }));`, context);

context.results.forEach(({ area, blocks }) => {
  assert.equal(blocks.length, 15, `${area} must support 90 bidders across 15 bidding days`);
  assert.equal(blocks[14].length, 4, `${area} must include all four rounds on the final bidding day`);
  assert.match(blocks[14][3], /^\w{3}, \d{2}\/\d{2}$/, `${area} must populate the final Round 4 date`);
});

console.log(`Public bid-window fallback passed for every area: 90 bidders across 15 days, final Round 4 ${context.results[0].blocks[14][3]}.`);
