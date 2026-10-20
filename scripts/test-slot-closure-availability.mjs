import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
let details;
const c = vm.createContext({
  currentUser: {area: 'Area B', initials: 'XY'}, currentUserBidAs: () => 'CPC', leaveSlotBucketForBidAs: () => 'cpc', displayedCalendarYear: 2027, calendarMode: 'vacation',
  BID_LEAVE_YEAR_START_KEY: '2027-01-10', BID_LEAVE_YEAR_END_KEY: '2028-01-08',
  selectedLeaveDateKey: '', fullLeaveDates: new Set(),
  monthNames: ['January','February','March','April','May','June','July','August','September','October','November','December'],
  dateKey: (y,m,d) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`,
  groupClass: () => '', nextFatigueGroupAfter: () => '',
  selectedRdoWeekdays: () => new Set(), calendarHolidayKind: () => null,
  leaveSlotsForDate: () => details, visibleLeaveSlotDetails: () => details,
  isLeavePreviewRangeDate: () => false,
});
vm.runInContext(['leaveSlotDataIsLoaded','leaveSlotCapacityForDetails','leaveSlotOpenCountForDetails','isLeaveSlotsFull','renderCalendarDay','slotRows'].map(fn).join('\n'),c);
const render = (area, bucket) => c.renderCalendarDay(5,10,false,2027,{area,slotBucket:bucket,showRdo:false,showPersonalLeave:false,deferSlotTooltip:true});
for (const area of ['Area B', 'TMU']) {
  // The schedule loaded after applying a closure has two CPC slots, both occupied.
  details = { cpc: ['AB','CD'], dev: [], cpcCapacity: 2, devCapacity: 4, cpcOpen: 0, devOpen: 4 };
  assert.equal(c.isLeaveSlotsFull('2027-06-10',area,'cpc'),true);
  assert.match(render(area,'cpc'), /class="[^"]*closed-day/);
  assert.match(render(area,'cpc'), /CPC leave slots filled/);
  assert.doesNotMatch(render(area,'dev'), /closed-day/);
  assert.match(render(area,'dev'), /DEV leave slots available/);
  assert.equal((c.slotRows('Slot', details.cpc, c.leaveSlotCapacityForDetails(details,'cpc')).match(/slot-row /g)||[]).length,2);
  // Restoring a previously closed slot clears the full color and restores
  // the visible slot count without changing the two existing occupants.
  details.cpcCapacity = 3; details.cpcOpen = 1;
  assert.doesNotMatch(render(area,'cpc'), /closed-day/);
  assert.equal((c.slotRows('Slot', details.cpc, c.leaveSlotCapacityForDetails(details,'cpc')).match(/slot-row /g)||[]).length,3);
  assert.equal(details.cpc.join(','),'AB,CD');
  details.cpcCapacity = 2;
  // One occupied slot leaves availability; TMU retains its one-slot-left cue.
  details.cpc = ['AB']; details.cpcOpen = 1;
  assert.equal(c.isLeaveSlotsFull('2027-06-10',area,'cpc'),false);
  assert.doesNotMatch(render(area,'cpc'), /closed-day/);
  if (area === 'TMU') assert.match(render(area,'cpc'), /tmu-one-slot-left/);
  // Existing three-slot awards remain full at three; they must not be reduced.
  details.cpc = ['AB','CD','EF']; details.cpcCapacity = 3; details.cpcOpen = 0;
  assert.match(render(area,'cpc'), /closed-day/);
  // Exempt four-slot holiday dates retain availability until all four are used.
  details.cpcCapacity = 4; details.cpcOpen = 1;
  assert.doesNotMatch(render(area,'cpc'), /closed-day/);
  details.cpc.push('GH'); details.cpcOpen = 0;
  assert.match(render(area,'cpc'), /closed-day/);
  // Independently reducing DEV must also update its own full state.
  details.dev = ['IJ','KL']; details.devCapacity = 2; details.devOpen = 0;
  assert.match(render(area,'dev'), /closed-day/);
  assert.match(render(area,'dev'), /DEV leave slots filled/);
}
const css = readFileSync(new URL('../bidding.css', import.meta.url), 'utf8');
assert.match(css, /\.app-main \.month-grid \.closed-day\s*\{[^}]*repeating-linear-gradient/);
console.log('Reduced-capacity full checks, calendar classes/colors, slot counts, TMU cues, holiday capacity, and CPC/DEV isolation passed.');
