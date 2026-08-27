import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../bidding.js", import.meta.url), "utf8");
const emptyClassList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
const documentStub = {
  body: { dataset: {}, classList: emptyClassList },
  documentElement: { dataset: {}, classList: emptyClassList },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  getElementById() { return null; },
  addEventListener() {},
  createElement() {
    return {
      classList: emptyClassList,
      dataset: {},
      append() {},
      appendChild() {},
      click() {},
      remove() {},
      setAttribute() {},
      style: {},
    };
  },
};
const locationStub = {
  hash: "",
  href: "http://localhost/bidding.html",
  origin: "http://localhost",
  pathname: "/bidding.html",
  search: "",
};
const windowStub = {
  document: documentStub,
  location: locationStub,
  addEventListener() {},
  confirm() { return true; },
  history: { replaceState() {} },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
  open() {},
};
const context = {
  alert() {},
  Blob,
  clearInterval() {},
  console,
  crypto,
  document: documentStub,
  fetch: async () => ({ ok: false, json: async () => ({}) }),
  Intl,
  location: locationStub,
  navigator: {},
  setInterval() { return 0; },
  setTimeout,
  URL,
  URLSearchParams,
  window: windowStub,
};
windowStub.window = windowStub;

vm.createContext(context);
vm.runInContext(`${source}\n;globalThis.__algorithmTest = {
  datesInLeaveRange,
  biddingSubmissionFromSupabase,
  currentUserRdoRequest,
  fatigueCapacityForLine,
  leaveDateKeysWithinBidYear,
  leavePriorityFromSubmission,
  leaveSubmissionsForReload,
  leaveRangesOverlap,
  leaveSlotCapacity,
  rdoLineEligibleForBidAs,
  renderCalendarDay,
  selectedLineRequest,
  replaceIntakeQueue(rows) { intakeQueue = rows; },
  replaceLeaveBids(rows) { leaveBids.splice(0, leaveBids.length, ...rows); },
  replaceRdoLines(rows) { rdoLines.splice(0, rdoLines.length, ...rows); },
};`, context);

const algorithm = context.__algorithmTest;

test("cross-year leave ranges parse with explicit or inferred start years", () => {
  const expected = ["2027-12-30", "2027-12-31", "2028-01-01", "2028-01-02"];
  assert.deepEqual([...algorithm.datesInLeaveRange("Dec 30, 2027 - Jan 2, 2028")], expected);
  assert.deepEqual([...algorithm.datesInLeaveRange("Dec 30 - Jan 2, 2028")], expected);
  assert.deepEqual([...algorithm.datesInLeaveRange("Feb 30, 2027")], []);
});

test("leave ranges are bounded and overlap inclusively", () => {
  assert.equal(algorithm.leaveDateKeysWithinBidYear(["2027-01-10", "2028-01-08"]), true);
  assert.equal(algorithm.leaveDateKeysWithinBidYear(["2027-01-09"]), false);
  assert.equal(algorithm.leaveDateKeysWithinBidYear(["2028-01-09"]), false);
  assert.equal(algorithm.leaveRangesOverlap("Jun 1 - Jun 4, 2027", "Jun 4 - Jun 8, 2027"), true);
  assert.equal(algorithm.leaveRangesOverlap("Jun 1 - Jun 3, 2027", "Jun 4 - Jun 8, 2027"), false);
});

test("RDO request state is isolated to the requested round", () => {
  algorithm.replaceIntakeQueue([
    { id: "round-1", type: "RDO Line", initials: "OC", line: "15", round: 1, status: "Approved" },
    { id: "round-2", type: "RDO Line", initials: "OC", line: "16", round: 2, status: "Pending" },
  ]);
  assert.equal(algorithm.currentUserRdoRequest(1)?.id, "round-1");
  assert.equal(algorithm.currentUserRdoRequest(2)?.id, "round-2");
  assert.equal(algorithm.selectedLineRequest({ line: "15" }, 2), undefined);
  assert.equal(algorithm.selectedLineRequest({ line: "16" }, 2)?.id, "round-2");
});

test("Supabase leave state preserves the authoritative priority", () => {
  const submission = algorithm.biddingSubmissionFromSupabase({
    id: "leave-1",
    type: "Leave",
    initials: "OC",
    status: "Pending",
    round: 2,
    priority: 7,
    days: 5,
    payload: {},
  });
  assert.equal(submission.priority, 7);
  assert.equal(algorithm.leavePriorityFromSubmission(submission, 0), 7);
  assert.equal(algorithm.leavePriorityFromSubmission({ priority: null }, 2), 3);
  const reloaded = algorithm.leaveSubmissionsForReload([
    { type: "Leave", initials: "OC", round: 2, priority: 2, range: "Jun 8, 2027", payload: {} },
    { type: "Leave", initials: "OC", round: 2, priority: 1, range: "Jun 1, 2027", payload: {} },
  ], "OC");
  assert.deepEqual(reloaded.map((item) => item.priority), [1, 2]);
});

test("the continuation calendar shows personal leave through January 8", () => {
  algorithm.replaceIntakeQueue([]);
  algorithm.replaceLeaveBids([{
    range: "Jan 1 - Jan 8, 2028",
    status: "Approved",
    initials: "OC",
    area: "Area A",
  }]);
  const januaryDay = algorithm.renderCalendarDay(0, 1, false, 2028, {
    showRdo: false,
    showPersonalLeave: true,
    mode: "vacation",
  });
  assert.match(januaryDay, /class="[^"]*leave-day/);
  assert.match(januaryDay, /data-leave-date="2028-01-01"/);
});

test("browser leave capacity matches the authoritative daily database seed", () => {
  assert.deepEqual({ ...algorithm.leaveSlotCapacity }, { cpc: 3, dev: 1 });
});

test("RDO role eligibility separates CPC, R-DEV, D-DEV, and TMU lines", () => {
  const cpc = { area: "Area A", lineType: "CPC", pattern: "M/T" };
  const rdev = { area: "Area A", lineType: "DEV", pattern: "R-DEV" };
  const ddev = { area: "Area A", lineType: "DEV", pattern: "D-DEV" };
  const tmu = { area: "TMU", lineType: "CPC", pattern: "S/M" };
  assert.equal(algorithm.rdoLineEligibleForBidAs(cpc, "CPC", "Area A"), true);
  assert.equal(algorithm.rdoLineEligibleForBidAs(rdev, "CPC", "Area A"), false);
  assert.equal(algorithm.rdoLineEligibleForBidAs(rdev, "R-DEV", "Area A"), true);
  assert.equal(algorithm.rdoLineEligibleForBidAs(ddev, "R-DEV", "Area A"), false);
  assert.equal(algorithm.rdoLineEligibleForBidAs(ddev, "D-DEV", "Area A"), true);
  assert.equal(algorithm.rdoLineEligibleForBidAs(tmu, "DEV", "TMU"), true);
});

test("fatigue crew capacity derives from actual CPC pattern size", () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({
    area: "Area A",
    line: String(index + 1),
    lineType: "CPC",
    pattern: "M/T",
    status: "Open",
    group: "A",
  }));
  algorithm.replaceRdoLines(rows);
  const capacity = algorithm.fatigueCapacityForLine(rows[0], "CPC");
  assert.equal(capacity[0].crewMax, 1);
  assert.equal(capacity[0].areaMax, 1);
  assert.equal(capacity[0].enforced, true);
});
