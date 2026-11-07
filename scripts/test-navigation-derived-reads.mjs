import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const extract = name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
let lineReads = 0, dateReads = 0;
const context = vm.createContext({
  leaveReadCache: null, currentUser: { initials: 'AB', area: 'Area A' },
  leaveBids: [], intakeQueue: Array.from({ length: 3900 }, (_, i) => ({
    id: String(i), type: 'Leave', initials: `P${i % 300}`, area: 'Area A', round: 2,
    status: 'Approved', dateKeys: ['2027-01-04'],
  })),
  leaveRoundForItem: item => item.round, leaveItemArea: item => item.area,
  leaveDateKeysForItem: item => { dateReads++; return item.dateKeys; },
  submittedRdoLineForInitials: () => { lineReads++; return null; },
  rdoLineForInitials: () => { lineReads++; return { week: ['RDO', '', '', '', '', '', 'RDO'] }; },
  dateFromKey: key => new Date(`${key}T12:00:00`),
});
vm.runInContext(['withLeaveReadCache', 'cachedLeaveRead', 'areaCommittedLeaveItems',
  'rdoWeekdaysForLine', 'isRdoDateForInitials'].map(extract).join('\n'), context);
const started = performance.now();
context.withLeaveReadCache(() => {
  const first = context.areaCommittedLeaveItems();
  for (let i = 0; i < 4; i++) assert.equal(context.areaCommittedLeaveItems(), first);
  for (let i = 0; i < 3900; i++) {
    assert.equal(context.isRdoDateForInitials('2027-01-04', `P${i % 300}`), false);
    assert.equal(context.isRdoDateForInitials('2027-01-03', `P${i % 300}`), true);
  }
});
assert.equal(dateReads, 3900, 'Committed requests are indexed once per render');
assert.equal(lineReads, 600, 'Two line lookups per bidder, regardless of date count');
assert.equal(context.leaveReadCache, null);
context.intakeQueue[0].status = 'Cancelled';
context.rdoLineForInitials = () => ({ week: ['', 'RDO', '', '', '', '', ''] });
context.withLeaveReadCache(() => {
  assert.equal(context.areaCommittedLeaveItems().length, 3899);
  assert.equal(context.isRdoDateForInitials('2027-01-04', 'P0'), true);
});
assert.throws(() => context.withLeaveReadCache(() => { throw Error('test'); }));
assert.equal(context.leaveReadCache, null, 'Failed renders also discard cached decisions');
console.log(`PASS 3,900 requests: five balance reads use one index; 7,800 date checks use 600 line lookups (${(performance.now() - started).toFixed(1)}ms); cancellations and RDO edits refresh on next operation.`);
