import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const fn = name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
const patched = [], focused = [], options = [];
const buttons = Object.fromEntries(['2027-01-10','2027-01-11','2027-01-12'].map(key => [key, {
  set outerHTML(value) { patched.push(key); },
  focus(opts) { focused.push(key); assert.equal(opts.preventScroll, true); },
}]));
const calendar = {
  childElementCount: 12, dataset: { calendarRevision:'4', calendarRenderKey:'2027|combined|Area A' },
  childNodes: [{ cloneNode: () => ({ cloned:true }) }],
  querySelector(selector) { return buttons[selector.match(/"(.*?)"/)[1]]; },
};
const cache = new Map([['stale area', []]]);
const before = {
  a: { date:'2027-01-10', area:'Area A', cpc:['AB'] },
  b: { date:'2027-01-11', area:'Area A', cpc:['CD'] },
  c: { date:'2027-01-12', area:'Area A', cpc:[] },
  d: { date:'2027-01-12', area:'Area B', cpc:[] },
};
const after = {
  a: { date:'2027-01-10', area:'Area A', cpc:['EF'] },
  c: before.c,
  d: { date:'2027-01-12', area:'Area B', cpc:['GH'] },
};
const context = vm.createContext({
  document: { getElementById: () => calendar, activeElement: buttons['2027-01-10'] },
  calendarRenderRevision:5, publicCalendarCacheRevision:4,
  publicCalendarCache:cache, publicState:{area:'Area A'}, calendarLayouts:{public:'minimal'},
  extraLeaveSlotData:after, calendarWorkforceForScope: () => 'dev',
  slotMatchesArea: (entry, area) => entry.area === area,
  makeCalendarRenderContext: opts => { options.push(opts); return opts; },
  dateFromKey: key => new Date(`${key}T12:00:00`),
  renderCalendarDay: (month, day, includeMonth, year, opts) => { options.push(opts); return '<button/>'; },
});
vm.runInContext(fn('refreshPublicCalendarSlots'), context);
assert.equal(context.refreshPublicCalendarSlots(before), true);
assert.deepEqual(patched, ['2027-01-10','2027-01-11'], 'Includes removal; ignores unchanged dates and other areas');
assert.deepEqual(focused, ['2027-01-10']);
assert.ok(options.every(opts => opts.publicReadOnly && !opts.showRdo && !opts.showPersonalLeave));
assert.ok(options.every(opts => opts.deferSlotTooltip));
assert.equal(calendar.dataset.calendarRevision, '5');
assert.equal(cache.has('stale area'), false);
assert.ok(cache.has(calendar.dataset.calendarRenderKey));
calendar.dataset.calendarRevision = '2';
assert.equal(context.refreshPublicCalendarSlots(before), false, 'Stale view requires full render');
calendar.dataset.calendarRevision = '4';
context.calendarLayouts.public = 'full';
options.length = 0;
context.refreshPublicCalendarSlots(before);
assert.ok(options.every(opts => !opts.deferSlotTooltip), 'Full layout retains inline details');
let patches = 0, full = 0, canPatch = true;
const routing = vm.createContext({
  withLeaveReadCache: action => action(), calendarRenderRevision:0,
  publicState:{area:'Area A',section:'Calendar'},
  refreshPublicCalendarSlots: () => { patches++; return canPatch; },
  renderPublicPage: () => full++,
});
vm.runInContext(fn('renderLiveDataSections'), routing);
routing.renderLiveDataSections(new Set(['slots']), false, before);
assert.equal(patches, 1); assert.equal(full, 0);
routing.renderLiveDataSections(new Set(['slots','bidding','windows']), false, before);
assert.equal(patches, 2, 'Bid-triggered slot changes use targeted calendar updates');
assert.equal(full, 0);
canPatch = false;
routing.renderLiveDataSections(new Set(['slots']), false, before);
assert.equal(full, 1);
routing.renderLiveDataSections(new Set(['slots','rules']), false, before);
assert.equal(full, 2, 'Rule changes always render fully');
routing.renderLiveDataSections(new Set(['bidding']), false, before);
assert.equal(full, 3, 'Broader bid/RDO changes retain full refresh');
console.log('PASS public live dates: changed/removed dates, area filtering, focus, fresh cache, full/minimal layouts, broad/stale fallbacks');
