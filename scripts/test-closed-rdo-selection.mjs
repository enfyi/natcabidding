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
context.rdoChangeWindowErrorMessage = () => "";
context.selectedLineId = "8";
assert.equal(context.syncLockedRdoSelection(), null);
assert.equal(context.selectedLineId, "8", "Active RDO window preserves the bidder's preview");
context.bidWindowErrorMessage = () => "Window closed";
assert.equal(context.syncLockedRdoSelection(), savedLine, "Submitted bids remain selected outside the bid window");
context.isViewingHomeArea = () => false;
assert.equal(context.lockedSubmittedRdoLine(), null, "Other areas retain browsing behavior");
context.isViewingHomeArea = () => true;
context.submittedRdoLineForInitials = () => null;
assert.equal(context.lockedSubmittedRdoLine(), null, "Bidders without a saved bid retain existing selection behavior");
console.log("PASS closed RDO selection, active window previews, later rounds, other areas, and no saved bid");
