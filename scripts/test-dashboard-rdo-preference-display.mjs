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

console.log("PASS dashboard RDO preferences display as Yes, No, or Bid Line");
