import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  let index = source.indexOf('{', start), depth = 1, end = index + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  return source.slice(start, end);
}
const context = vm.createContext({
  pilotState: { database: true, enabled: true, allowed: true },
  pilotOpenRounds: [], selectedPilotRound: null,
  isViewingHomeArea: () => true,
  currentUserBidWindow: () => ({ round: 1, start: new Date(0), end: new Date('2099-01-01') }),
});
vm.runInContext(['isAuthorizedPilotBidder', 'activeTestBidRound', 'bidWindowLockIsBypassed', 'currentUserBidWindowStatus', 'editableLeaveRound'].map(extract).join('\n'), context);
assert.equal(context.currentUserBidWindowStatus().isOpen, false, 'A scheduled window cannot open a closed pilot round');
for (const round of [1, 2, 3, 4]) {
  context.pilotOpenRounds = [round];
  assert.equal(context.editableLeaveRound(), round, 'Enabled pilot round must control the submitted round');
  assert.equal(context.currentUserBidWindowStatus(new Date('2100-01-01')).isOpen, true, 'Pilot accepts bids after scheduled hours');
}
context.pilotOpenRounds = [1, 3];
context.selectedPilotRound = 3;
assert.equal(context.editableLeaveRound(), 3);
context.pilotOpenRounds = [1];
assert.equal(context.editableLeaveRound(), 1, 'Closing the chosen round selects another enabled round');
context.pilotState.enabled = false;
assert.equal(context.currentUserBidWindowStatus().isOpen, false);
context.pilotState.enabled = true;
context.pilotState.allowed = false;
assert.equal(context.currentUserBidWindowStatus().isOpen, false);
context.pilotState.database = false;
assert.equal(context.currentUserBidWindowStatus().isOpen, true, 'Production still uses the scheduled window');
console.log('PASS pilot round selection, time bypass, closure, authorization, and production windows');
