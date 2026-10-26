import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(source.lastIndexOf('async ', start) === start - 6 ? start - 6 : start, source.indexOf('\n}', start) + 2);
}
let failure = false;
let admin = true;
let status = '';
const input = { checked: true, disabled: false };
const context = vm.createContext({
  tmuOneSlotOutlineEnabled: true, calendarDisplaySettingsAvailable: true,
  calendarRenderRevision: 0, BID_YEAR: 2027,
  enforceBidWindows: true, bidWindowTestRound: null, bidWindowSettingsFallbackMessage: '',
  normalizeBidWindowTestRound: x => x,
  hasSystemAdminAccess: () => admin, supabaseState: { connected: true },
  document: { querySelectorAll: () => [input] },
  setText: (_, text) => { status = text; }, renderApp: () => {},
  supabaseClient: () => ({ rpc: async (name, args) => {
    assert.equal(name, 'set_tmu_one_slot_outline');
    assert.equal(args.requested_bid_year, 2027);
    return { error: failure ? { message: 'Save failed' } : null };
  } }),
});
vm.runInContext(['applyBidYearSettings', 'saveTmuOneSlotOutline', 'syncCalendarDisplayControls'].map(fn).join('\n'), context);
input.checked = false;
await context.saveTmuOneSlotOutline(input);
assert.equal(context.tmuOneSlotOutlineEnabled, false);
assert.equal(input.disabled, false);
assert.match(status, /off/);
failure = true;
input.checked = true;
await context.saveTmuOneSlotOutline(input);
assert.equal(input.checked, false, 'Failed saves restore the persisted switch');
assert.equal(status, 'Save failed');
context.applyBidYearSettings({ tmu_one_slot_outline: true });
assert.equal(context.tmuOneSlotOutlineEnabled, true);
context.applyBidYearSettings({});
context.syncCalendarDisplayControls();
assert.equal(input.checked, true);
assert.equal(input.disabled, true, 'Missing database installation disables saving');
admin = false;
context.calendarDisplaySettingsAvailable = true;
context.syncCalendarDisplayControls();
assert.equal(input.disabled, true);
console.log('PASS TMU setting persistence, failed-save restoration, default-on compatibility, and admin controls');
