import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const start = source.indexOf('async function resetPilotBidderRound(');
const end = source.indexOf('\nasync function ', start + 1);
const handler = source.slice(start, end);

function scenario(overrides = {}) {
  const calls = [], messages = [], confirmations = [];
  const context = vm.createContext({
    showActionFeedback() {},
    pilotState: { database: true, memberIds: ['allowed'] }, pilotBidderResetPending: false,
    senioritySource: [['Bidder', 'Test', 'CPC', 'TB', 'Area A', 'allowed']], BID_YEAR: 2027,
    supabaseState: { placeholdersCleared: true },
    hasSystemAdminAccess: () => true, seniorityEntryProfileId: (entry) => entry[5],
    document: { querySelector: (selector) => ({ value: selector.includes('bidder') ? 'allowed' : '2' }) },
    window: { confirm: (message) => { confirmations.push(message); return true; } },
    supabaseClient: () => ({ rpc: async (name, params) => { calls.push([name, params]); return { error: null }; } }),
    syncPilotControls: () => {}, setText: (_, message) => messages.push(message),
    loadSupabaseReferenceData: async () => calls.push('reload'), renderApp: () => calls.push('render'),
    ...overrides,
  });
  vm.runInContext(handler, context);
  return { context, calls, messages, confirmations };
}

for (const round of [1, 2, 3, 4, 5, 6]) {
  const test = scenario({ document: { querySelector: (selector) => ({ value: selector.includes('bidder') ? 'allowed' : String(round) }) } });
  await test.context.resetPilotBidderRound();
  assert.equal(test.calls[0][0], 'reset_pilot_bidder_round');
  assert.equal(test.calls[0][1].requested_round, round);
  assert.equal(test.calls[0][1].requested_bidder_id, 'allowed');
  assert.deepEqual(test.calls.slice(1), ['reload', 'render']);
  assert.match(test.confirmations[0], round === 1 ? /ALL leave rounds/ : new RegExp(`Round ${round} only`));
  assert.equal(test.context.pilotBidderResetPending, false);
}
for (const overrides of [
  { hasSystemAdminAccess: () => false },
  { pilotState: { database: false, memberIds: ['allowed'] } },
  { pilotState: { database: true, memberIds: [] } },
  { pilotBidderResetPending: true },
  { window: { confirm: () => false } },
]) {
  const test = scenario(overrides);
  await test.context.resetPilotBidderRound();
  assert.equal(test.calls.length, 0);
}
const failure = scenario({ supabaseClient: () => ({ rpc: async () => ({ error: { message: 'Reset refused' } }) }) });
await failure.context.resetPilotBidderRound();
assert.equal(failure.messages.at(-1), 'Reset refused');
assert.equal(failure.context.pilotBidderResetPending, false);
const refreshFailure = scenario({ loadSupabaseReferenceData: async () => { throw new Error('offline'); } });
await refreshFailure.context.resetPilotBidderRound();
assert.match(refreshFailure.messages.at(-1), /Reset saved/);
console.log('PASS pilot bidder reset: round selection, scope confirmation, access guards, cancellation, errors, and refresh');
