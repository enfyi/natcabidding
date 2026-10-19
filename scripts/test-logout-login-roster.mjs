import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function extract(name, async = false) {
  const start = source.indexOf(`${async ? 'async ' : ''}function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const first = { initials: 'AA', firstName: 'Alex', lastName: 'Adams', area: 'Area A', rank: 1 };
const second = { initials: 'BB', firstName: 'Blair', lastName: 'Brown', area: 'Area B', rank: 2 };
const profile = { ...second, seniorityRank: 2, supabaseProfileId: 'second-profile' };
let signedIn = false;
let publicRenders = 0;
const context = vm.createContext({
  currentUser: { ...first, seniorityRank: 1 },
  senioritySource: [first, second],
  seniorityEntryActive: () => true,
  rosterEntryToPerson: entry => ({ ...entry }),
  currentUserBidAs: () => 'CPC',
  normalizeLeaveSlotAllowance: value => value ?? 0,
  supabaseState: {},
  syncPublicLoginIndicator() {},
  requestedLandingPage: () => 'dashboard',
  clearSupabaseAccountState() { context.currentUser = null; },
  setAuthStatus(message, status) { assert.notEqual(status, 'error', message); },
  friendlyAuthFailure: error => error.message,
  supabaseClient: () => ({ auth: {
    async signOut() {
      context.clearSupabaseAccountState();
      // SIGNED_OUT renders the public calendar before the next sign-in.
      assert.equal(context.bueRosterUncached().length, 2);
      publicRenders += 1;
    },
    async signInWithPassword() { signedIn = true; return { error: null }; },
  } }),
  async restoreSupabaseSession() {
    assert.ok(signedIn);
    context.currentUser = profile;
    const roster = context.bueRosterUncached();
    assert.equal(roster.find(person => person.initials === 'BB').profileId, 'second-profile');
    assert.equal(roster.find(person => person.initials === 'AA').profileId, undefined);
  },
});
vm.runInContext(extract('bueRosterUncached') + '\n' + extract('loginWithSupabasePassword', true), context);
// Repeat logout/login without recreating the JavaScript context or refreshing.
for (let attempt = 0; attempt < 2; attempt += 1) {
  context.currentUser = null;
  assert.equal(context.bueRosterUncached().length, 2);
  await context.loginWithSupabasePassword('blair@example.com', 'password');
  assert.equal(context.currentUser, profile);
  assert.equal(context.supabaseState.passwordSignInPending, false);
}
assert.equal(publicRenders, 2);
context.currentUser = null;
context.senioritySource = [];
assert.equal(context.bueRosterUncached().length, 0);
console.log('PASS signed-out roster, empty roster, and repeated logout/login without refresh.');
