import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const extract = name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
let scans = 0;
const roster = Array.from({ length: 100 }, (_, i) => ['Last', 'First', 'CPC', `P${i}`]);
const context = vm.createContext({
  leaveReadCache: null, seniority: [], publicState: { area: 'FAQ', section: 'Calendar' },
  ZLA_AREAS: ['Area A'],
  activeRosterEntriesUncached: () => { scans++; return roster; },
  currentViewArea: () => 'Area A',
  areaBidRoundState: () => null,
  roundDateBlocksForArea: () => [[1, 2, 3, 4]],
  normalizeBidRoleForArea: role => role,
  seniorityEntryEmail: () => '', seniorityEntryPhone: () => '',
  seniorityEntryLeaveSlotAllowance: () => 288,
  seniorityEntryProfileId: entry => entry?.[3],
  databaseBidWindows: new Map(), bidWindowScheduleLabel: () => '',
  renderRoundAnnouncements() {}, syncPilotControls() {}, syncPublicLoginIndicator() {},
  updatePublicView() {}, updateCalendarViewControls() {}, updateCalendarYearLabels() {},
  renderCalendars() {}, syncPublicPageUrl() {}, publicRosterArea: area => area,
});
for (const name of ['withLeaveReadCache', 'cachedLeaveRead', 'activeRosterEntries',
  'databaseBidWindowKey', 'databaseBidWindowForRankRound', 'bidWindowForRankRound',
  'buildSeniority', 'renderPublicPage', 'renderPublicPageWithCache']) {
  vm.runInContext(extract(name), context);
}
context.renderPublicPage();
context.renderPublicPage('Previous Years');
assert.equal(scans, 0, 'FAQ and archives must not calculate bid schedules');
context.renderPublicPage('Area A');
assert.equal(context.seniority.length, 100);
assert.equal(scans, 1, 'All 400 window lookups must share one roster scan');
assert.equal(context.leaveReadCache, null, 'Release derived data after rendering');
roster.pop();
context.renderPublicPage('Area A');
assert.equal(context.seniority.length, 99, 'Next render must see roster changes');
assert.equal(scans, 2);
context.updatePublicView = () => { throw new Error('render failed'); };
assert.throws(() => context.renderPublicPage('Area A'), /render failed/);
assert.equal(context.leaveReadCache, null, 'Release cached reads after failures');
assert.match(source, /let seniority = \[\];/);
console.log('PASS public startup skips unused schedules, shares roster reads, and keeps refreshes fresh.');
