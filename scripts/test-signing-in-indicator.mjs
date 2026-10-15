import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const start = source.indexOf('function syncPublicLoginIndicator(');
const button = { classList: { toggle(key, value) { this[key] = value; } }, setAttribute(key, value) { this[key] = value; } };
const status = {};
const context = vm.createContext({
  document: { querySelector: selector => selector.includes('session-status') ? status : button },
  supabaseState: { authUserId: '', passwordSignInPending: false, sessionRestorePending: false },
  currentUser: null,
});
vm.runInContext(source.slice(start, source.indexOf('\nfunction showLoggedInApp', start)), context);
context.syncPublicLoginIndicator();
assert.equal(button.textContent, 'Dashboard');
assert.equal(button.disabled, false);
for (const pendingState of ['passwordSignInPending', 'sessionRestorePending']) {
  context.supabaseState[pendingState] = true;
  context.syncPublicLoginIndicator();
  assert.equal(button.textContent, 'Signing you in…');
  assert.equal(button.disabled, true);
  assert.equal(button['aria-busy'], 'true');
  assert.equal(status.hidden, true);
  context.supabaseState[pendingState] = false;
}
context.supabaseState.authUserId = 'member';
context.currentUser = { supabaseProfileId: 'profile', firstName: 'Jane', lastName: 'Doe' };
context.supabaseState.sessionRestorePending = true;
context.syncPublicLoginIndicator();
assert.equal(status.hidden, true, 'Wait for reference data before showing success');
context.supabaseState.sessionRestorePending = false;
context.syncPublicLoginIndicator();
assert.equal(button.textContent, 'Dashboard');
assert.equal(button.disabled, false);
assert.equal(button['aria-busy'], 'false');
assert.equal(status.textContent, 'Signed in · Jane Doe');
context.currentUser = null;
context.syncPublicLoginIndicator();
assert.equal(status.hidden, true);
assert.equal(button.disabled, false);
console.log('PASS signing-in indicator: password login, restoration, loading profile, success, and cleared profile.');
