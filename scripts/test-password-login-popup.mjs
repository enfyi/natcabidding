import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const code = slice('function setAuthStatus(', 'const supportedEmailTokenTypes')
  + slice('function friendlyAuthFailure(', 'function requestedLandingPage(')
  + slice('async function loginWithSupabasePassword(', 'function setProfileFormStatus(');
let memberVisible = false;
let mode = 'wrong-password';
const status = { dataset: {} };
const menu = { hidden: true };
const toggle = { setAttribute(name, value) { this[name] = value; } };
const client = { auth: {
  async signOut() { menu.hidden = true; },
  async signInWithPassword() {
    if (mode === 'network') throw new Error('Failed to fetch');
    return mode === 'wrong-password'
      ? { error: { code: 'invalid_credentials', message: 'Invalid login credentials' } }
      : { error: null };
  },
} };
const context = vm.createContext({
  supabaseState: {},
  syncPublicLoginIndicator() {},
  async restoreSupabaseSession() { context.showLoggedInApp(); context.setAuthStatus("Signed in.", "success"); },
  document: { querySelector: selector => ({
    '[data-auth-status]': status,
    '[data-public-login-menu]': menu,
    '[data-public-login-toggle]': toggle,
  })[selector] },
  isMemberAppVisible: () => memberVisible,
  supabaseClient: () => client,
  clearSupabaseAccountState() {},
  async refreshSupabaseAccountState() {},
  async claimSupabaseProfile() { return { area: 'Area A' }; },
  async loadSupabaseReferenceData() {},
  requestedLandingPage: () => 'dashboard',
  showLoggedInApp() { memberVisible = true; menu.hidden = true; },
});
vm.runInContext(code, context);
for (mode of ['wrong-password', 'network']) {
  menu.hidden = true;
  await context.loginWithSupabasePassword('test@example.com', 'incorrect');
  assert.equal(menu.hidden, false);
  assert.equal(toggle['aria-expanded'], 'true');
  assert.equal(status.dataset.status, 'error');
  assert.match(status.textContent, mode === 'network' ? /connection/i : /email or password is incorrect/i);
}
mode = 'success';
await context.loginWithSupabasePassword('test@example.com', 'correct');
assert.equal(memberVisible, true);
assert.equal(menu.hidden, true);
assert.equal(status.dataset.status, 'success');
context.setAuthStatus('Other auth error', 'error');
assert.equal(menu.hidden, true, 'Member dashboard must not open the public login popup');
console.log('Password login popup checks passed: incorrect credentials, network failure, successful sign-in, and member visibility.');
