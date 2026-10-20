import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8');
const panel = source.slice(source.indexOf('// Rules are persisted per bid year, area, and workforce;'));
const fields = new Map();
for (const name of ['area', 'group', 'round', 'count', 'summary', 'status', 'reopen-start', 'reopen-end']) fields.set(`[data-slot-closure-${name}]`, {value: ''});
for (const action of ['save', 'apply', 'reopen']) fields.set(`[data-${action}-slot-closure]`, {disabled: false});
const field = (name) => fields.get(`[data-slot-closure-${name}]`);
field('area').value = 'TMU'; field('group').value = 'cpc';
const calls = [];
const context = vm.createContext({
  document: {querySelector: (s) => fields.get(s), querySelectorAll: () => [], addEventListener() {}},
  setText: (s, text) => { fields.get(s).textContent = text; },
  isMissingSupabaseRoutine: () => false, hasSystemAdminAccess: () => true, ZLA_AREAS: ['TMU'], BID_YEAR: 2027, BID_LEAVE_YEAR_START_KEY:'2027-01-10', BID_LEAVE_YEAR_END_KEY:'2028-01-08',
  supabaseClient: () => ({rpc: async (name, params) => { calls.push({name, params}); return {data: null, error: {message: 'Test response'}}; }}),
});
vm.runInContext(panel, context);
vm.runInContext('slotClosureRulesReady = true; syncSlotClosureForm()', context);
assert.equal(field('round').value, '3'); assert.equal(field('count').value, '1');
assert.equal(fields.get('[data-apply-slot-closure]').disabled, true);
vm.runInContext("slotClosureRules = [{area_name:'TMU',slot_group:'cpc',after_round:2,close_count:1,applied_at:null}]; syncSlotClosureForm()", context);
assert.equal(field('round').value, '2');
field('group').value = 'dev'; vm.runInContext('syncSlotClosureForm()', context);
assert.equal(field('round').value, '3');
assert.equal(fields.get('[data-apply-slot-closure]').disabled, true);
await vm.runInContext('saveOrApplySlotClosure(false)', context);
assert.equal(calls[0].params.requested_slot_group, 'dev');
assert.equal(calls[0].params.requested_after_round, 3);
field('count').value = '1.5'; await vm.runInContext('saveOrApplySlotClosure(false)', context);
assert.equal(calls.length, 1, 'Fractional counts must not reach the database');
field('group').value = 'cpc';
vm.runInContext("slotClosureRules[0].applied_at = '2026-10-20'; syncSlotClosureForm()", context);
assert.equal(fields.get('[data-save-slot-closure]').disabled, false);
assert.equal(fields.get('[data-save-slot-closure]').textContent, 'Save changes');
assert.equal(fields.get('[data-apply-slot-closure]').disabled, true);
console.log('Slot closure defaults, workforce isolation, validation, and applied-state checks passed.');

vm.runInContext('slotClosureRules[0].closed_slots = 2; syncSlotClosureForm()',context);
assert.equal(fields.get('[data-reopen-slot-closure]').disabled,false);
field('reopen-start').value='2027-06-10';
await vm.runInContext('reopenSlotClosure()',context);
assert.equal(calls.length,1,'Incomplete reopening ranges must not reach the database');
field('reopen-end').value='2027-06-09';
await vm.runInContext('reopenSlotClosure()',context);
assert.equal(calls.length,1,'Reversed reopening ranges must not reach the database');
field('reopen-end').value='2027-06-10';
await vm.runInContext('reopenSlotClosure()',context);
assert.equal(calls[1].name,'reopen_slot_closure_rule');
assert.equal(calls[1].params.requested_slot_group,'cpc');
assert.equal(calls[1].params.requested_start_date,'2027-06-10');
field('reopen-start').value=''; field('reopen-end').value='';
await vm.runInContext('reopenSlotClosure()',context);
assert.equal(calls[2].params.requested_start_date,null);
assert.equal(calls[2].params.requested_end_date,null);
vm.runInContext('slotClosureRules[0].closed_slots = 0; syncSlotClosureForm()',context);
assert.equal(fields.get('[data-reopen-slot-closure]').disabled,true);
assert.equal(fields.get('[data-apply-slot-closure]').disabled,true,'Partial closures stay locked until the database clears applied_at');
vm.runInContext('slotClosureRules[0].applied_at = null; syncSlotClosureForm()',context);
assert.equal(fields.get('[data-apply-slot-closure]').disabled,false,'Fully reopening makes the saved rule ready again');
assert.equal(fields.get('[data-save-slot-closure]').disabled,false);
field('round').value='4'; field('count').value='2';
await vm.runInContext('saveOrApplySlotClosure(false)',context);
assert.equal(calls[3].params.requested_after_round,4);
assert.equal(calls[3].params.requested_close_count,2);
console.log('PASS reopening controls: area/group, optional date range, validation, no remaining slots, and no repeated closure');
