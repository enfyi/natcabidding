import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../bidding.js", import.meta.url), "utf8");
const start = source.indexOf("async function removeApprovedLeaveBid(");
const code = source.slice(start, source.indexOf("\nasync function ", start + 1));
const date = { id: "date-1", type: "Leave", status: "Approved", initials: "AB", area: "A", range: "Jun 7", dateKeys: ["2027-06-07"], supabaseRequestId: "request-1" };
let selected = date;
let allowed = true;
let open = true;
let confirmed = false;
let prompt = "";
const calls = [];
const context = {
  intakeReviewItemById: () => selected,
  hasIntakeAccess: () => allowed,
  intakeLeaveRoundIsOpen: () => open,
  intakeItemRound: () => 1,
  leaveDateKeysForItem: (item) => item.dateKeys,
  formatCalendarDate: (key) => key,
  window: { confirm: (message) => { prompt = message; return confirmed; } },
  supabaseClient: () => ({ rpc: async (name, params) => { calls.push({ name, params }); return {}; } }),
  supabaseState: { connected: true }, currentUser: { initials: "IT" },
  intakeGroupReviewState: new Map(), intakeLeaveRemovalPendingId: null,
  activeOverrideId: "date-1", activeDenialId: null,
  renderIntakeQueue() {}, showActionFeedback() {}, logHistory() {},
  refreshBiddingAfterIntakeDecision: async () => {}, renderApp() {}, setPage() {},
};
vm.createContext(context);
vm.runInContext(code, context);
await context.removeApprovedLeaveBid(date.id, { singleDate: true });
assert.equal(calls.length, 0, "Cancelling confirmation must not mutate the bid");
assert.match(prompt, /2027-06-07.*AB/);
assert.match(prompt, /Other dates on the bid will remain/);
confirmed = true;
await context.removeApprovedLeaveBid(date.id, { singleDate: true });
assert.equal(calls.length, 1);
assert.equal(calls[0].name, "admin_cancel_leave_requests");
assert.deepEqual([...calls[0].params.requested_leave_request_ids], ["request-1"]);
assert.equal(context.activeOverrideId, null);
for (const invalid of [{ ...date, members: [date] }, { ...date, dateKeys: ["2027-06-07", "2027-06-08"] }, { ...date, status: "Pending" }]) {
  selected = invalid;
  await context.removeApprovedLeaveBid(date.id, { singleDate: true });
}
selected = date;
allowed = false;
await context.removeApprovedLeaveBid(date.id, { singleDate: true });
allowed = true;
open = false;
await context.removeApprovedLeaveBid(date.id, { singleDate: true });
assert.equal(calls.length, 1, "Groups, ranges, pending requests, unauthorized users and closed rounds cannot use date deletion");
assert.match(source, /class="secondary-action danger"[^>]*data-intake-delete-date/);
console.log("PASS single-date deletion, confirmation cancellation, exact request scope, and access/round guards");
