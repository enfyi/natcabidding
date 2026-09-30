import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../bidding.js", import.meta.url), "utf8");
const constantStart = source.indexOf("const LATE_BID_MESSAGE");
const constantEnd = source.indexOf("\n", constantStart);
const functionStart = source.indexOf("function bidWindowErrorMessage");
const functionEnd = source.indexOf("function leaveBidWindowErrorMessage", functionStart);
const contactHelperStart = source.indexOf("function shouldShowLateBidContact");
const contactHelperEnd = source.indexOf("function openLateBidDialog", contactHelperStart);

assert.notEqual(constantStart, -1, "late-bid message must exist");
assert.notEqual(functionStart, -1, "bid-window error helper must exist");
assert.notEqual(functionEnd, -1, "bid-window error helper must have a stable extraction boundary");
assert.notEqual(contactHelperStart, -1, "late-bid contact guard must exist");

const now = new Date("2026-10-01T12:00:00Z");
const closedWindow = { round: 1, start: new Date("2026-10-01T08:00:00Z"), end: new Date("2026-10-01T10:00:00Z") };
const upcomingWindow = { round: 2, start: new Date("2026-10-02T08:00:00Z"), end: new Date("2026-10-02T10:00:00Z") };
const windows = new Map([[1, closedWindow], [2, upcomingWindow]]);
const context = vm.createContext({
  Date,
  currentUser: { area: "Area A" },
  pilotState: { database: false },
  pilotSubmissionErrorMessage: () => "",
  currentUserBidWindowStatus: () => ({ window: upcomingWindow, isOpen: false }),
  isViewingHomeArea: () => true,
  currentUserSeniorityRank: () => 1,
  areaBidRoundState: () => ({ round: 1 }),
  bidWindowForRankRound: (_rank, round) => windows.get(round) || null,
  roundDateBlocksForArea: () => [["Round 1", "Round 2"]],
  formatDateTime: (date) => date.toISOString(),
});

vm.runInContext(
  `${source.slice(constantStart, constantEnd)}\n${source.slice(functionStart, functionEnd)}\nthis.bidWindowErrorMessage = bidWindowErrorMessage; this.LATE_BID_MESSAGE = LATE_BID_MESSAGE;`,
  context
);

assert.equal(
  context.bidWindowErrorMessage("Bids", now),
  "Your scheduled bid window has closed. You must call or text the Bidding Office at 661-434-1004 to complete your bid."
);

context.areaBidRoundState = () => ({ round: 2 });
assert.match(context.bidWindowErrorMessage("Bids", now), /Round 2 window opens/);

context.currentUserBidWindowStatus = () => ({ window: null, isOpen: false });
context.areaBidRoundState = () => null;
windows.delete(2);
assert.equal(context.bidWindowErrorMessage("Bids", now), context.LATE_BID_MESSAGE);

context.hasSubmittedRdoBid = () => false;
vm.runInContext(
  `${source.slice(contactHelperStart, contactHelperEnd)}\nthis.shouldShowLateBidContact = shouldShowLateBidContact;`,
  context
);
assert.equal(context.shouldShowLateBidContact(now), true, "a late bidder without a bid receives the contact action");
context.hasSubmittedRdoBid = () => true;
assert.equal(context.shouldShowLateBidContact(now), false, "a returning bidder with a bid does not receive the contact action");

console.log("PASS late bid-window attempts receive the bidding office phone message");
