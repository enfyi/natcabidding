import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../bidding.js", import.meta.url), "utf8");
const helperStart = source.indexOf("function lineFourTenValue");
const helperEnd = source.indexOf("function confirmFlexNo", helperStart);

assert.notEqual(helperStart, -1, "line schedule helpers must exist");
assert.notEqual(helperEnd, -1, "line schedule helpers must have a stable extraction boundary");

const context = vm.createContext({ selectedAwsPreference: "No" });
vm.runInContext(
  `${source.slice(helperStart, helperEnd)}\nthis.lineScheduleLabel = lineScheduleLabel; this.awsPreferenceForLine = awsPreferenceForLine;`,
  context
);

const fourTen = { fourTen: "Yes", week: ["RDO", "1000", "1000", "RDO", "1000", "1000", "RDO"] };
const fiveEight = { fourTen: "No", week: ["RDO", "1000", "1000", "1000", "1000", "1000", "RDO"] };

assert.equal(context.lineScheduleLabel(fourTen), "4-10");
assert.equal(context.awsPreferenceForLine(fourTen, ""), "Yes", "4-10 lines automatically include AWS");
assert.equal(context.lineScheduleLabel(fiveEight), "5-8");
assert.equal(context.awsPreferenceForLine(fiveEight, "No"), "No", "5-8 lines retain the bidder's AWS choice");
assert.equal(context.awsPreferenceForLine(fiveEight, ""), "", "5-8 lines still require an AWS choice");

assert.match(source, /line-mode-option locked \$\{isCurrentSchedule \? "active" : "schedule-unavailable"\}[\s\S]*?disabled aria-pressed/);
assert.match(source, /\$\{isFourTenLine \|\| bidderSelectionLocked \? "disabled" : ""\}/);

console.log("PASS 4-10 lines auto-include AWS and lock AWS controls while 5-8 lines keep the AWS choice available");
