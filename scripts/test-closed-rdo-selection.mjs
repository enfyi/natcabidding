import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../bidding.js", import.meta.url), "utf8");
const savedLine = { line: "27", status: "Taken" };
const context = vm.createContext({
  Date,
  currentUser: { initials: "ME" },
  selectedLineId: "1",
  selectedFatigueGroup: "A",
  isViewingHomeArea: () => true,
  submittedRdoLineForInitials: () => savedLine,
  submittedRdoLineAfterWindow: () => savedLine,
  rdoChangeWindowErrorMessage: () => "RDO changes closed",
  bidWindowErrorMessage: () => "",
});
for (const name of ["lockedSubmittedRdoLine", "syncLockedRdoSelection"]) {
  const start = source.indexOf(`function ${name}(`);
  vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), context);
}
assert.equal(context.syncLockedRdoSelection(), savedLine);
assert.equal(context.selectedLineId, "27", "Closed RDO window restores the submitted line even during a later leave window");
assert.equal(context.selectedFatigueGroup, "", "Discard an unrelated preview fatigue group");
context.submittedRdoLineAfterWindow = () => null;
context.selectedLineId = "8";
assert.equal(context.syncLockedRdoSelection(), null);
assert.equal(context.selectedLineId, "8", "Active RDO window preserves the bidder's preview");
context.submittedRdoLineAfterWindow = () => savedLine;
assert.equal(context.syncLockedRdoSelection(), savedLine, "Submitted bids remain selected outside the bid window");
context.isViewingHomeArea = () => false;
assert.equal(context.lockedSubmittedRdoLine(), null, "Other areas retain browsing behavior");
context.isViewingHomeArea = () => true;
context.submittedRdoLineForInitials = () => null;
context.submittedRdoLineAfterWindow = () => null;
assert.equal(context.lockedSubmittedRdoLine(), null, "Bidders without a saved bid retain existing selection behavior");
console.log("PASS closed RDO selection, active window previews, later rounds, other areas, and no saved bid");

const start = source.indexOf("function submittedRdoLineAfterWindow(");
vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), context);
context.submittedRdoLineForInitials = () => savedLine;
context.isViewingHomeArea = () => false;
context.pilotState = { database: false };
context.currentUserBidWindowForRound = () => ({
  start: new Date("2027-01-01T10:00:00Z"),
  end: new Date("2027-01-01T13:00:00Z"),
});
for (const time of ["09:59:59", "10:00:00", "11:59:59"]) {
  assert.equal(context.submittedRdoLineAfterWindow(new Date(`2027-01-01T${time}Z`)), null,
    "Browsing another area before or during the RDO window preserves preview behavior");
  context.isViewingHomeArea = () => true;
  assert.equal(context.lockedSubmittedRdoLine(new Date(`2027-01-01T${time}Z`)), null,
    "Home-area selection also remains unchanged before and during the window");
  context.isViewingHomeArea = () => false;
}
for (const time of ["12:00:00", "13:00:00"]) {
  assert.equal(context.submittedRdoLineAfterWindow(new Date(`2027-01-01T${time}Z`)), savedLine,
    "Browsing another area after the RDO window keeps the saved home-area line");
}
context.currentUserBidWindowForRound = () => null;
assert.equal(context.submittedRdoLineAfterWindow(), null);
context.pilotState.database = true;
context.activeTestBidRound = () => 1;
assert.equal(context.submittedRdoLineAfterWindow(), null);
context.activeTestBidRound = () => 2;
assert.equal(context.submittedRdoLineAfterWindow(), savedLine);
context.submittedRdoLineForInitials = () => null;
assert.equal(context.submittedRdoLineAfterWindow(), null);
console.log("PASS saved selection across areas after window closure, pre-window and active previews, pilot rounds, and no bid");

context.pilotState.database = false;
context.isViewingHomeArea = () => true;
context.submittedRdoLineForInitials = () => savedLine;
context.currentUserRdoRequest = () => ({ status: "Approved", line: "27" });
context.selectedBidYearErrorMessage = () => "";
context.pendingCurrentUserRdoRequest = () => null;
context.bidWindowErrorMessage = () => "";
context.currentUserBidWindowForRound = () => ({
  start: new Date("2027-01-01T10:00:00Z"),
  end: new Date("2027-01-01T12:00:00Z"),
});
for (const name of ["rdoChangeWindowErrorMessage", "rdoBidWindowErrorMessage"]) {
  const functionStart = source.indexOf(`function ${name}(`);
  vm.runInContext(source.slice(functionStart, source.indexOf("\n}", functionStart) + 2), context);
}
for (const time of ["10:00:00", "10:30:00", "11:59:59"]) {
  const date = new Date(`2027-01-01T${time}Z`);
  assert.equal(context.lockedSubmittedRdoLine(date), null, "An approved bid does not lock line selection during the RDO window");
  assert.equal(context.rdoBidWindowErrorMessage(date), "", "An approved bidder can submit a changed bid for approval during the RDO window");
}
assert.equal(context.lockedSubmittedRdoLine(new Date("2027-01-01T12:00:00Z")), savedLine);
assert.match(context.rdoBidWindowErrorMessage(new Date("2027-01-01T12:00:00Z")), /Changes are closed/);
context.pendingCurrentUserRdoRequest = () => ({ status: "Pending" });
assert.match(context.rdoBidWindowErrorMessage(new Date("2027-01-01T10:30:00Z")), /awaiting an intake decision/);
console.log("PASS approved bidders can change and resubmit during their window; closure and existing pending-review rules remain enforced");
