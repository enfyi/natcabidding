import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const fn = name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
const key = '2027-06-10';
const day = (cpcOpen, devOpen) => ({ cpc: [], dev: [], cpcCapacity: 2, devCapacity: 1, cpcOpen, devOpen });
const slots = { 'Area A': { [key]: day(0, 1) }, 'Area B': { [key]: day(1, 0) } };
const c = vm.createContext({
  currentUser: { initials: 'GH', area: 'Area A', bidAs: 'CPC', ghostBidder: true },
  currentUserBidAs: () => c.currentUser.bidAs,
  selectedLeaveDates: new Set(), leaveDraftQueue: [], intakeQueue: [], rdoLines: [],
  fullLeaveDates: new Set(),
  leaveSlotMap: area => slots[area],
  leaveSlotsForDateFromMap: (key, _area, map) => map[key] || {},
  isRdoDateForInitials: () => false,
  formatLeaveConflictDates: keys => keys.join(', '),
  previouslyBidLeaveDateKeys: () => new Set(),
  usesIndividualLeaveDateSelection: () => true,
  currentRoundNumber: () => c.round,
  round: 2,
  leaveRoundUsageForInitials: () => [], leaveRoundForItem: item => item.round,
  leaveItemChargedDays: item => item.days, chargeableLeaveDateKeys: keys => keys,
  leaveDayLimitForRound: () => 10,
  roundOneProjectedWeekCount: () => 1, roundOneWeekLimit: () => 2,
  syncLeaveBuilderInputs() {}, syncLeavePickerMonthToRange() {},
  setLeaveBuilderStatus: message => { c.message = message; },
  leaveDateKeysForItem: item => item.dateKeys,
  activeLeaveItemsForInitials: () => [],
  fetch: () => { throw Error('Availability checks must use the loaded snapshot'); },
});
vm.runInContext(['leaveSlotBucketForBidAs', 'leaveSlotDataIsLoaded', 'leaveSlotOpenCountForDetails',
  'leaveSlotCapacityForDetails', 'manualLeaveDateChecks', 'bidderLeaveAvailabilityMessage',
  'selectLeaveBuilderDate', 'leaveDraftPreSubmissionMessageWithCache'].map(fn).join('\n'), c);

for (const round of [1, 2, 3, 4]) {
  c.round = round;
  c.currentUser.bidAs = 'CPC';
  c.selectedLeaveDates.clear();
  assert.equal(c.selectLeaveBuilderDate(key), false, `Round ${round}: full CPC slots block ghost selection`);
  assert.match(c.message, /No CPC leave slot is available in Area A/);
  for (const role of ['DEV', 'R-DEV', 'D-DEV']) {
    c.currentUser.bidAs = role;
    c.selectedLeaveDates.clear();
    assert.equal(c.selectLeaveBuilderDate(key), true, `Round ${round}: ${role} uses open DEV slots despite full CPC slots`);
    assert.ok(c.selectedLeaveDates.has(key));
    slots['Area A'][key].devOpen = 0;
    assert.equal(c.selectLeaveBuilderDate(key), true, 'A date that filled can still be deselected');
    assert.equal(c.selectLeaveBuilderDate(key), false, 'Filled DEV slots block new selections');
    assert.match(c.message, /No DEV leave slot is available in Area A/);
    slots['Area A'][key].devOpen = 1;
  }
}
c.currentUser.area = 'Area B';
c.currentUser.bidAs = 'DEV';
assert.equal(c.selectLeaveBuilderDate(key), false, 'Open DEV slots in another area cannot be used');
c.currentUser.bidAs = 'CPC';
assert.equal(c.selectLeaveBuilderDate(key), true, 'Open CPC slots are valid despite full DEV slots');
assert.equal(slots['Area B'][key].cpcOpen, 1, 'Selecting ghost leave does not reserve the available slot');

// Revalidate a staged batch after the final slot is taken by another bidder.
c.leaveDraftQueue = [{ dateKeys: [key], round: 2, days: 1 }];
assert.equal(c.leaveDraftPreSubmissionMessageWithCache(), '');
slots['Area B'][key].cpcOpen = 0;
assert.match(c.leaveDraftPreSubmissionMessageWithCache(), /No CPC leave slot/);
slots['Area B'][key].cpc = ['GH'];
assert.match(c.bidderLeaveAvailabilityMessage(c.currentUser, 'Area B', [key]), /No CPC leave slot/,
  'A ghost annotation is never treated as ownership of a real slot');

// Missing snapshots must not be interpreted as availability.
delete slots['Area B'][key];
assert.match(c.bidderLeaveAvailabilityMessage(c.currentUser, 'Area B', [key]), /not loaded/);
c.selectedLeaveDates.clear();
assert.equal(c.selectLeaveBuilderDate(key), false);

// Regular bidders also fail closed when the capacity snapshot is missing.
c.currentUser.ghostBidder = false;
assert.match(c.bidderLeaveAvailabilityMessage(c.currentUser, 'Area B', [key]), /not loaded/);

// Area A's explicit CPC closures do not close DEV availability.
c.currentUser = { ...c.currentUser, ghostBidder: true, area: 'Area A', bidAs: 'CPC' };
slots['Area A'][key] = day(1, 1);
c.fullLeaveDates.add(key);
assert.match(c.bidderLeaveAvailabilityMessage(c.currentUser, 'Area A', [key]), /No CPC/);
c.currentUser.bidAs = 'DEV';
assert.equal(c.bidderLeaveAvailabilityMessage(c.currentUser, 'Area A', [key]), '');
console.log('PASS ghost leave enforces CPC/DEV role and area availability in rounds 1–4, blocks unknown slots, rechecks staged dates, permits deselection, and never reserves slots');

// Render the actual calendar button with an intentionally different workforce view.
Object.assign(c, {
  calendarMode: 'vacation', BID_LEAVE_YEAR_START_KEY: '2027-01-10', BID_LEAVE_YEAR_END_KEY: '2028-01-08',
  monthNames: Array(12).fill('June'), selectedLeaveDateKey: '',
  groupClass: () => '', cachedPersonalLeaveDateStatus: () => '', cachedCalendarHolidayKind: () => null,
  cachedBaseLeaveSlotDetails: () => slots['Area A'][key],
  cachedVisibleLeaveSlotDetails: () => slots['Area A'][key],
});
vm.runInContext(fn('dateKey') + '\n' + fn('renderCalendarDay'), c);
const context = { area: 'Area A', slotBucket: 'cpc', rdoWeekdays: new Set(),
  previewDates: new Set(), draftDates: new Set(), builderDates: new Set() };
const render = options => c.renderCalendarDay(5, 10, false, 2027, { context, deferSlotTooltip: true, ...options });
c.fullLeaveDates.clear();
slots['Area A'][key] = day(1, 0);
assert.match(render(), /disabled aria-disabled="true"/, 'DEV ghost is blocked even while viewing open CPC slots');
c.currentUser.bidAs = 'CPC';
context.slotBucket = 'dev';
assert.doesNotMatch(render(), /disabled aria-disabled="true"/, 'CPC ghost may select open CPC slots while viewing full DEV slots');
c.currentUser.bidAs = 'DEV';
context.builderDates.add(key);
assert.doesNotMatch(render(), /disabled aria-disabled="true"/, 'A selected date remains enabled for removal after it fills');
context.builderDates.clear();
assert.doesNotMatch(render({ publicReadOnly: true }), /disabled aria-disabled="true"/, 'Public calendar remains available for inspection');
assert.doesNotMatch(render({ showPersonalLeave: false }), /disabled aria-disabled="true"/, 'Area inspection does not become disabled');
console.log('PASS calendar disables ghost selection by actual workforce, permits removal, and preserves read-only date inspection');

// The input field opens a separate month picker; full dates must be disabled there too.
const picker = { innerHTML: '' };
Object.assign(c, {
  document: { querySelector: () => picker }, leavePickerOpen: true, leavePickerYear: 2027, leavePickerMonthIndex: 5,
  dayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  leaveBuilderDateKeys: () => [...c.selectedLeaveDates],
  isLeaveBuilderRangeEdge: key => c.selectedLeaveDates.has(key), isBidLeaveYearDate: () => true,
  withLeaveReadCache: callback => callback(),
});
vm.runInContext(fn('renderLeaveDatePicker'), c);
const inputDay = () => {
  c.renderLeaveDatePicker();
  return picker.innerHTML.match(/<button[^>]*aria-label="June 10, 2027[^>]*>/)[0];
};
c.selectedLeaveDates.clear();
c.currentUser.bidAs = 'DEV';
assert.match(inputDay(), /disabled/, 'Leave input picker disables full DEV slots');
assert.match(inputDay(), /no DEV leave slot available in Area A/);
assert.doesNotMatch(inputDay(), /data-leave-picker-date/, 'Full dates do not expose the selection action');
c.currentUser.bidAs = 'CPC';
assert.match(inputDay(), /data-leave-picker-date="2027-06-10"/, 'Open CPC slots remain selectable');
assert.doesNotMatch(inputDay(), /disabled/);
c.currentUser.bidAs = 'DEV';
c.selectedLeaveDates.add(key);
assert.doesNotMatch(inputDay(), /disabled/, 'Selected dates can still be removed from the input picker');
c.selectedLeaveDates.clear();
delete slots['Area A'][key];
assert.match(inputDay(), /disabled/);
assert.match(inputDay(), /availability not loaded/);
console.log('PASS leave-selection input picker disables full/unknown dates for the actual CPC/DEV role before selection');

// Regular bidders need the same protections after scheduled capacity reductions.
c.currentUser.ghostBidder = false;
c.currentUser.bidAs = 'CPC';
c.currentUser.area = 'Area A';
slots['Area A'][key] = {cpc:['AB','CD'], dev:[], cpcCapacity:2, devCapacity:4, cpcOpen:0, devOpen:4};
c.selectedLeaveDates.clear();
assert.equal(c.selectLeaveBuilderDate(key),false, 'Regular CPC bidder cannot select a full reduced-capacity date');
assert.match(inputDay(),/disabled/);
c.leaveDraftQueue = [{dateKeys:[key],round:4,days:1}];
assert.match(c.leaveDraftPreSubmissionMessageWithCache(),/No CPC leave slot/, 'A staged regular bid is rejected if capacity fills before submission');
c.currentUser.bidAs = 'DEV';
assert.equal(c.selectLeaveBuilderDate(key),true, 'Regular DEV bidder can use unchanged DEV capacity');
assert.equal(c.leaveDraftPreSubmissionMessageWithCache(),'');
c.selectedLeaveDates.clear();
slots['Area A'][key].devOpen = 0;
assert.equal(c.selectLeaveBuilderDate(key),false);
assert.match(c.leaveDraftPreSubmissionMessageWithCache(),/No DEV leave slot/);
assert.match(render(), /disabled aria-disabled="true"/, 'Regular bidder calendar disables full dates for their actual workforce');
console.log('PASS regular CPC/DEV bidders cannot select or submit full reduced-capacity dates, including stale staged bids');

// Exercise actual intake review and approval guard against the same two-slot day.
Object.assign(c, {
  leaveSlotsForDate: (date,area) => slots[area][date],
  leaveApprovalDates: item => item.dateKeys,
  refreshLeaveItemCharge() {},
  currentUser: {initials:'ADMIN',area:'Area A'},
  activeOverrideId:'',
  intakeReviewConflicts: (item,check) => check(item),
  leaveRdoConflicts: () => [], isGlLeaveItem: () => false,
  intakeItemRound: item => item.round,
  escapeHtml: value => String(value),
  dateFromKey: value => new Date(`${value}T12:00:00`),
  intakeLeaveRoundIsOpen: () => true,
});
vm.runInContext(['leaveApprovalBucket','leaveApprovalConflicts','applyLeaveApproval','renderIntakeDateCheck'].map(fn).join('\n'),c);
for (const role of ['CPC','DEV']) {
  const item = {id:role,type:'Leave',initials:'XY',area:'Area A',bidAs:role,round:4,dateKeys:[key]};
  assert.equal(c.leaveApprovalConflicts(item).length,1);
  assert.equal(c.applyLeaveApproval(item),false,'Ordinary approval must stop on a full date');
  assert.match(item.reviewNote,/filled leave slots/);
  assert.equal(c.activeOverrideId,item.id);
  assert.match(c.renderIntakeDateCheck(item),/Full · override required/);
  assert.match(c.renderIntakeDateCheck(item),/needs-review/);
}
console.log('PASS intake/admin show Full · override required and stop ordinary approval for full CPC and DEV dates');

// The change-bid modal uses the same snapshot, while preserving existing dates.
Object.assign(c, {
  currentUser: {initials:'XY',area:'Area A',bidAs:'CPC',ghostBidder:false},
  bidChangeRound:4, bidChangeRows:[{oldKey:key}],
  isBidLeaveYearDate: () => true,
  leaveRoundUsageForInitials: () => [],
  submittedLeaveItemKey: item => item.id,
});
vm.runInContext(['bidChangeCapacityMessage','bidChangeRowValidationMessage'].map(fn).join('\n'),c);
assert.equal(c.bidChangeCapacityMessage([key]),'', 'Retaining a full original date is allowed');
c.bidChangeRows = [{oldKey:'2027-06-09'}];
assert.match(c.bidChangeCapacityMessage([key]),/No CPC leave slot/);
assert.match(c.bidChangeRowValidationMessage({oldKey:'2027-06-09',newKey:key},[{newKey:key}],new Set()),/No CPC leave slot/);
slots['Area A'][key].cpcOpen = 1;
assert.equal(c.bidChangeCapacityMessage([key]),'', 'An available replacement date is allowed');
slots['Area A'][key].cpcOpen = 0;
assert.match(c.bidChangeCapacityMessage([key]),/No CPC leave slot/, 'Changes recheck a date that filled while editing');
console.log('PASS bid changes reject full new dates, recheck current capacity, and permit retained original dates');

// Reopening uses the refreshed capacity snapshot for every bidder flow.
for (const group of ['cpc','dev']) {
 c.currentUser = {initials:'XY',area:'Area A',bidAs:group==='cpc'?'CPC':'DEV',ghostBidder:false};
 c.bidChangeRows = [{oldKey:'2027-06-09'}];
 c.selectedLeaveDates.clear();
 slots['Area A'][key][group+'Capacity'] = 3;
 slots['Area A'][key][group+'Open'] = 1;
 slots['Area A'][key][group] = ['AB','CD'];
 assert.equal(c.selectLeaveBuilderDate(key),true,'Reopened dates become selectable');
 assert.equal(c.leaveDraftPreSubmissionMessageWithCache(),'','Reopened dates pass draft capacity checks');
 assert.equal(c.bidChangeCapacityMessage([key]),'','Reopened dates pass member replacement checks');
 const item = {type:'Leave',initials:'XY',area:'Area A',bidAs:c.currentUser.bidAs,round:4,dateKeys:[key]};
 assert.equal(c.leaveApprovalConflicts(item).length,0);
 assert.match(c.renderIntakeDateCheck(item),/Slot available/);
 slots['Area A'][key][group+'Open'] = 0;
 c.selectedLeaveDates.clear();
 assert.equal(c.selectLeaveBuilderDate(key),false,'Once restored capacity fills, selection blocks again');
 assert.match(c.leaveDraftPreSubmissionMessageWithCache(),/No (CPC|DEV) leave slot/);
 assert.equal(c.leaveApprovalConflicts(item).length,1);
 assert.match(c.renderIntakeDateCheck(item),/Full · override required/);
}
console.log('PASS reopened CPC/DEV dates: selection, drafts, member edits, intake/admin availability, and full-again checks');
