import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const snapshot = { rdo: { id: 'submission', status: 'approved' }, leave: [
  { id: 'leave', requested_start_date: '2027-06-01', requested_end_date: '2027-06-02' },
] };
const item = { id: 'queue', bidderId: 'bidder', supabaseSubmissionId: 'submission', type: 'RDO Line', status: 'Approved', line: '1', summary: 'Old bid', fatigueGroup: 'A', flex: 'No', aws: 'No', mid: 'No', bidAs: 'CPC' };
let calls = [], persisted, refreshes = 0, failure = false, lookupMatches = [{ id: 'bidder', initials: 'BT', area: 'Area A' }];
const context = vm.createContext({
  intakeQueue: [item], activeOverrideId: 'queue', activeDenialId: null,
  supabaseState: { connected: true }, BID_YEAR: 2027,
  supabaseClient: () => ({ rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === 'read_admin_bidder_editor' && args.search_text) return { data: { bidders: lookupMatches } };
    if (name === 'read_admin_bidder_editor') return { data: { snapshot, lines: [{ id: 'new-line', line_code: '2' }] } };
    if (failure) return { error: new Error('Line is unavailable') };
    persisted = args.changes;
    return { data: { valid: true, saved: true } };
  } }),
  document: { querySelector: () => null },
  captureIntakeOverrideFields: row => Object.assign(row, { line: '2', summary: 'New bid', fatigueGroup: 'B', flex: 'Yes' }),
  loadSupabaseReferenceData: async () => { refreshes++; item.line = persisted.rdo.line_id === 'new-line' ? '2' : '1'; },
  renderApp: () => {}, setPage: () => {},
});
vm.runInContext(source.slice(source.indexOf('async function saveSupabaseApprovedRdoEdit('), source.indexOf('function selectedRdoWeekdays(')), context);
await context.saveIntakeOverride('queue');
assert.deepEqual(calls.map(c => c.name), ['read_admin_bidder_editor', 'edit_admin_bidder']);
assert.equal(calls[1].args.validate_only, false);
assert.equal(calls[1].args.expected_snapshot, snapshot);
assert.equal(persisted.rdo.line_id, 'new-line');
assert.equal(persisted.rdo.flex, true);
assert.deepEqual(JSON.parse(JSON.stringify(persisted.leave)), [{ id: 'leave', start_date: '2027-06-01', end_date: '2027-06-02' }]);
assert.equal(refreshes, 1);
assert.equal(item.line, '2');
// Exercise the deployed RPC shape: submission ID, initials and area, no bidder ID.
delete item.bidderId; item.initials = 'BT'; item.area = 'Area A'; calls = [];
await context.saveIntakeOverride('queue');
assert.equal(calls[0].args.search_text, 'BT');
assert.equal(calls[1].args.target_bidder_id, 'bidder');
assert.equal(calls[2].args.target_bidder_id, 'bidder');
assert.equal(refreshes, 2);
lookupMatches = [{ id: 'other', initials: 'BT', area: 'Area B' }]; calls = [];
await context.saveIntakeOverride('queue');
assert.equal(calls.length, 1);
assert.match(item.reviewNote, /could not be uniquely identified/);
lookupMatches = [{ id: 'bidder', initials: 'BT', area: 'Area A' }];
snapshot.rdo.id = 'other-submission'; calls = [];
await context.saveIntakeOverride('queue');
assert.equal(calls.length, 2);
assert.match(item.reviewNote, /bid has changed/);
snapshot.rdo.id = 'submission';
failure = true; item.line = '1'; item.summary = 'Old bid';
await context.saveIntakeOverride('queue');
assert.equal(item.line, '1');
assert.equal(item.summary, 'Old bid');
assert.equal(item.reviewNote, 'Line is unavailable');
assert.equal(refreshes, 2);
context.supabaseState.connected = false;
calls = [];
await context.saveIntakeOverride('queue');
assert.equal(calls.length, 0);
assert.match(item.reviewNote, /could not reach the database/);
assert.equal(item.line, '1');
console.log('PASS approved RDO admin edit persists before refresh and reports failed/offline saves');
