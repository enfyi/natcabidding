import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function currentUserBidWindowForRound('), source.indexOf('function roundWindows('));
const start = new Date('2026-10-08T09:00:00-07:00');
const end = new Date('2026-10-08T11:00:00-07:00');
const ownWindow = { round: 2, start, end };
const windows = new Map([['employee|2', ownWindow]]);
const context = vm.createContext({
  currentUser: { area: 'Area A', supabaseProfileId: 'employee', seniorityRank: 9 },
  databaseBidWindows: windows,
  databaseBidWindowKey: (id, round) => `${id}|${round}`,
  roundDateBlocksForArea: () => [['', '', '', '']],
  currentUserSeniorityRank: () => 9,
  bidWindowForRankRound: () => { throw new Error('Member must not use a roster position for saved assignments'); },
});
vm.runInContext(helpers, context);
assert.equal(context.currentUserBidWindow(start), ownWindow);
assert.equal(context.currentUserBidWindow(new Date(end.getTime() - 1)), ownWindow);
assert.equal(context.currentUserBidWindow(end), null);
assert.equal(context.currentUserBidWindowForRound(1), null, 'Missing assignment must not borrow another bidder window');
windows.set('employee|6', { round: 6, start, end });
windows.delete('employee|2');
assert.equal(context.currentUserBidWindow(start).round, 6, 'Saved rounds beyond the fallback schedule are recognized');
windows.set('employee|1', { round: 1, start: new Date(end.getTime() + 1), end: new Date(end.getTime() + 7200000) });
assert.equal(context.currentUserBidWindow(start).round, 6, 'An open window takes priority over a future round');
console.log('Member bid windows pass identity, missing assignment, extra round, overlap, and closing boundary checks.');
