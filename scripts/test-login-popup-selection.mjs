import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const start = source.indexOf('function dismissPublicLoginOnOutsidePress(');
const end = source.indexOf('document.addEventListener("click", async (event) => {', start);
assert.ok(start >= 0 && end > start);
const listeners = new Map();
const menu = { hidden: false };
const toggle = { setAttribute(name, value) { this[name] = value; } };
const context = vm.createContext({ document: {
  querySelector: selector => selector === '[data-public-login-menu]' ? menu : toggle,
  addEventListener: (type, handler) => listeners.set(type, handler),
} });
vm.runInContext(source.slice(start, end), context);
const inside = { closest: selector => selector === '.public-login' ? {} : null };
const outside = { closest: () => null };
for (const field of ['email', 'password']) {
  menu.hidden = false;
  toggle['aria-expanded'] = 'true';
  listeners.get('pointerdown')({ target: inside });
  // Text selection may release outside and dispatch a click on a common ancestor.
  listeners.get('click')?.({ target: outside });
  assert.equal(menu.hidden, false, `${field}: selection must keep the popup open`);
  assert.equal(toggle['aria-expanded'], 'true');
}
listeners.get('pointerdown')({ target: outside });
assert.equal(menu.hidden, true, 'A new press outside dismisses the popup');
assert.equal(toggle['aria-expanded'], 'false');
assert.ok(!source.includes('publicLoginMenu && !publicLoginMenu.hidden && !event.target.closest(".public-login")'),
  'The document click handler must not dismiss text-selection gestures');
console.log('PASS login text selection stays open and outside presses dismiss the popup.');
