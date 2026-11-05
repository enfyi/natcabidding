import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../bidding.js',import.meta.url),'utf8');
const fn=name=>{
  const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start>=0,name);
  return source.slice(start,source.indexOf('\n}',start)+2);
};
const inputs={
  '[data-leave-over-accrual-enabled]':{},
  '[data-leave-over-accrual-round]':{},
  '[data-save-leave-over-accrual]':{},
};
let admin=true, fail=false, call, message;
const context=vm.createContext({
  Number, Object, BID_YEAR:2027, calendarRenderRevision:0,
  hasSystemAdminAccess:()=>admin, supabaseState:{connected:true},
  normalizeBidWindowTestRound:value=>value,
  document:{querySelector:selector=>inputs[selector]},
  supabaseClient:()=>({rpc:async(name,params)=>{call={name,params};return {error:fail?new Error('Save failed'):null};}}),
  renderApp(){}, setText:(_,text)=>{message=text;},
});
vm.runInContext(`let leaveOverAccrualFromRound=null, leaveOverAccrualSettingsAvailable=false;
let calendarDisplaySettingsAvailable=false, tmuOneSlotOutlineEnabled=true, enforceBidWindows=true,
bidWindowTestRound=null, bidWindowSettingsFallbackMessage='';\n`+
  ['leaveOverAccrualAllowed','applyBidYearSettings','syncLeaveOverAccrualControls','saveLeaveOverAccrualSettings'].map(fn).join('\n'),context);
context.applyBidYearSettings({leave_over_accrual_from_round:4});
context.syncLeaveOverAccrualControls();
assert.equal(inputs['[data-leave-over-accrual-enabled]'].checked,true);
assert.equal(inputs['[data-leave-over-accrual-round]'].value,'4');
assert.equal(context.leaveOverAccrualAllowed(3),false);
assert.equal(context.leaveOverAccrualAllowed(4),true);
assert.equal(context.leaveOverAccrualAllowed(6),true);
inputs['[data-leave-over-accrual-round]'].value='5';
await context.saveLeaveOverAccrualSettings();
assert.equal(call.name,'set_leave_over_accrual');
assert.equal(call.params.requested_bid_year,2027);
assert.equal(call.params.starting_round,5);
assert.equal(context.leaveOverAccrualAllowed(4),false);
assert.equal(context.leaveOverAccrualAllowed(5),true);
inputs['[data-leave-over-accrual-enabled]'].checked=false;
await context.saveLeaveOverAccrualSettings();
assert.equal(call.params.starting_round,null);
assert.equal(context.leaveOverAccrualAllowed(6),false);
fail=true;
inputs['[data-leave-over-accrual-enabled]'].checked=true;
await context.saveLeaveOverAccrualSettings();
assert.equal(context.leaveOverAccrualAllowed(6),false,'Failed save preserves the saved policy');
assert.equal(message,'Save failed');
admin=false;
context.syncLeaveOverAccrualControls();
assert.equal(inputs['[data-save-leave-over-accrual]'].disabled,true);
context.applyBidYearSettings({});
admin=true;
context.syncLeaveOverAccrualControls();
assert.equal(inputs['[data-save-leave-over-accrual]'].disabled,true,'Missing database support disables editing');
console.log('PASS allowance policy loading, threshold, save, disable, failed save, admin access, and missing support');
