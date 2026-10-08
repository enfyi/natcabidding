import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const key = '2027-01-11';
const ghost = { initials: 'GH', area: 'Area A', type: 'Leave', status: 'Approved', ghostBid: true, range: key };
const board = { innerHTML: '' };
const details = { label: key, cpc: ['AA'], dev: [], cpcCapacity: 3, devCapacity: 4, cpcOpen: 2, devOpen: 4, glBids: [{ initials: 'GL', status: 'Approved' }] };
const context = vm.createContext({
  currentUser: { area: 'Area A', initials: 'GH' },
  leaveBids: [ghost],
  intakeQueue: [ghost, { ...ghost, status: 'Pending' }, { ...ghost, initials: 'PD', status: 'Pending' },
    { ...ghost, initials: 'OTHER', area: 'Area B' }, { ...ghost, initials: 'DENIED', status: 'Denied' },
    { ...ghost, initials: 'LATER', range: '2027-01-12' }, { ...ghost, initials: 'REAL', ghostBid: false },
    { ...ghost, initials: 'RDO', type: 'RDO Line' }],
  isGhostLeaveItem: item => item.ghostBid,
  leaveSlotDatesForInitials: range => [range],
  visibleLeaveSlotDetailsFromMap: () => details, leaveSlotMap: () => ({}),
  document: { getElementById: () => board },
  leaveSlotDataIsLoaded: () => true,
  leaveSlotCapacityForDetails: (data, bucket) => data[`${bucket}Capacity`],
  leaveSlotOpenCountForDetails: (data, bucket) => data[`${bucket}Open`],
  slotRows: (label, initials) => initials.join(','), escapeHtml: String,
});
vm.runInContext(fn('ghostLeaveBidsForDate') + '\n' + fn('renderLeaveSlotBoardWithCache'), context);
assert.deepEqual(JSON.parse(JSON.stringify(context.ghostLeaveBidsForDate(key, 'Area A'))), [
  { initials: 'GH', status: 'Approved' }, { initials: 'PD', status: 'Pending' },
]);
context.renderLeaveSlotBoardWithCache({ key, area: 'Area A', inspectOnly: true });
assert.match(board.innerHTML, /Ghost bids · no slots used/);
assert.match(board.innerHTML, />GH</);
assert.match(board.innerHTML, />PD</);
assert.match(board.innerHTML, /GL bids · no slots used/);
assert.match(board.innerHTML, />GL</);
assert.match(board.innerHTML, /1<\/b> \/ 3 CPC slots filled/);
assert.match(board.innerHTML, /CPC Open/);
assert.deepEqual(details.cpc, ['AA'], 'Ghosts never replace real occupants or consume capacity');
context.intakeQueue = [];
context.leaveBids = [];
context.renderLeaveSlotBoardWithCache({ key, area: 'Area A', inspectOnly: true });
assert.doesNotMatch(board.innerHTML, /Ghost bids/);
assert.match(board.innerHTML, />GL</, 'Published GL entries remain visible without any private leave or intake records');
assert.match(board.innerHTML, /GL bids · no slots used/);
console.log('PASS dashboard date popup shows approved/pending ghosts once, filters date/area/status, and preserves real slot availability');
