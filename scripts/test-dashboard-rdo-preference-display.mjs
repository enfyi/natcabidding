import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../bidding.js", import.meta.url), "utf8");
const attributes = { innerHTML: "" };
const status = { innerHTML: "", classList: { toggle: () => {} } };
const context = vm.createContext({
  FATIGUE_GROUPS: ["A", "B", "C"],
  currentUser: { initials: "OC" },
  currentUserRdoRequest: () => null,
  document: {
    getElementById: () => null,
    querySelectorAll: (selector) => {
      if (selector.includes("data-selected-attributes")) return [attributes];
      if (selector.includes("data-selected-status")) return [status];
      return [];
    },
  },
  groupClass: (value) => String(value).toLowerCase(),
  renderLatestRdoDenialReason: () => {},
});

for (const name of ["rdoBidPreferenceLabel", "rdoAssignmentValue", "savedRdoPreferencesMarkup", "renderDashboardSelectedLineCard"]) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} should exist`);
  vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), context);
}

context.renderDashboardSelectedLineCard({
  request: { flex: false, aws: "true", mid: "BID" },
  line: { line: "30", status: "Taken", group: "B", flex: true, aws: false, mid: "No" },
});

assert.match(attributes.innerHTML, /<em>Flex<\/em><b>No<\/b>/);
assert.match(attributes.innerHTML, /<em>AWS<\/em><b>Yes<\/b>/);
assert.match(attributes.innerHTML, /<em>Mid<\/em><b>Bid Line<\/b>/);
assert.doesNotMatch(attributes.innerHTML, /<b>(?:true|false|BID)<\/b>/);
assert.match(attributes.innerHTML, /class="fatigue-summary-card"/);
assert.match(attributes.innerHTML, /aria-label="Fatigue Group B selected"/);
assert.match(attributes.innerHTML, /fatigue-summary-segment b active[^>]*>B<\/strong>/);
assert.match(attributes.innerHTML, /class="rdo-preference-card"><em>Flex<\/em><b>No<\/b>/);

const assigned = context.savedRdoPreferencesMarkup({
  line: { group: "C", flex: true, aws: false, mid: "No" },
});
assert.match(assigned, /aria-label="Fatigue Group C selected"/);
assert.match(assigned, /<em>Flex<\/em><b>Yes<\/b>/);
assert.match(assigned, /<em>AWS<\/em><b>No<\/b>/);
assert.match(assigned, /<em>Mid<\/em><b>No<\/b>/);
assert.doesNotMatch(assigned, /data-(?:fatigue-group|flex-choice|aws-choice|mid-choice)/,
  "Saved preferences are a static summary and cannot change the bid");
const noPreference = context.savedRdoPreferencesMarkup({ request: { fatigueGroup: "", flex: false, aws: false, mid: "BID" } });
assert.match(noPreference, /<em>Fatigue Group<\/em><b>No preference<\/b>/);

const capacity = context.savedRdoPreferencesMarkup({
  request: { fatigueGroup: "B", flex: false, aws: true, mid: "BID" },
}, [
  { group: "A", areaUsed: 3, areaMax: 10, crewUsed: 1, crewMax: 4 },
  { group: "B", areaUsed: 5, areaMax: 10, crewUsed: 2, crewMax: 4 },
  { group: "C", areaUsed: 4, areaMax: 10, crewUsed: 1, crewMax: 4 },
]);
assert.match(capacity, /fatigue-option b active[^>]*disabled aria-pressed="true"/);
assert.match(capacity, /Area 5\/10 · RDO 2\/4/);
assert.match(capacity, /Area 3\/10 · RDO 1\/4/);
assert.match(capacity, /Area 4\/10 · RDO 1\/4/);
assert.match(capacity, /<em>Flex<\/em><b>No<\/b>/);
assert.doesNotMatch(capacity, /data-fatigue-group/, "Closed-window capacity cards do not enable bid changes");

console.log("PASS dashboard RDO preferences display as Yes, No, or Bid Line");
