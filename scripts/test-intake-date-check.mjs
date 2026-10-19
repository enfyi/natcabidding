import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync('bidding.js', 'utf8');
const fn = name => { const start = source.indexOf(`function ${name}(`); assert.ok(start >= 0); return source.slice(start, source.indexOf('\n}', start) + 2); };
let mapReads = 0;
const slots = {
  '2027-01-15': {cpc:['CE'], dev:[], cpcCapacity:3, devCapacity:1, cpcOpen:2, devOpen:1},
  '2027-01-16': {cpc:['CE','CP','TY'], dev:['BS'], cpcCapacity:3, devCapacity:1, cpcOpen:0, devOpen:0},
};
const context = vm.createContext({
  currentUser:{area:'Area A'}, intakeDateChecksOpen:new Set(),
  escapeHtml: value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  leaveSlotMap: area => { assert.equal(area,'Area C'); mapReads++; return slots; },
  leaveApprovalDates: item => item.dates,
  intakeReviewConflicts: (item, check) => (item.members || [item]).flatMap(check),
  leaveApprovalConflicts: item => item.dates.filter(date => date === '2027-01-16'),
  leaveRdoConflicts: () => [], isGlLeaveItem: item => item.bidAs === 'GL',
  leaveApprovalBucket: item => item.bidAs === 'DEV' ? 'dev' : 'cpc',
  intakeItemRound: () => 1, intakeLeaveRoundIsOpen: () => true,
  dateFromKey: key => new Date(`${key}T12:00:00`),
  leaveSlotsForDateFromMap: (key, area, map) => map[key] || {},
});
vm.runInContext(['leaveSlotDataIsLoaded','leaveSlotCapacityForDetails','leaveSlotOpenCountForDetails','renderIntakeDateCheck','renderIntakeDateCheckControl'].map(fn).join('\n'), context);
const item = {id:'preview', type:'Leave', area:'Area C', bidAs:'CPC', initials:'AB', dates:['2027-01-15','2027-01-16','2027-01-17']};
assert.match(context.renderIntakeDateCheckControl(item), /aria-expanded="false"/);
assert.equal(mapReads,0,'Collapsed cards must not compute date availability');
let html = context.renderIntakeDateCheck(item);
assert.equal(mapReads,1,'One area slot map read per panel');
assert.match(html,/Slot available/); assert.match(html,/Full · override required/); assert.match(html,/Availability unavailable/);
assert.match(html,/CE \(CPC\)/); assert.match(html,/CPC: 2 \/ 3 open/);
assert.doesNotMatch(context.renderIntakeDateCheck({...item, bidAs:'GL'}), /Full · override required/);
assert.match(context.renderIntakeDateCheck({...item, members:[{dates:['2027-01-15']},{dates:['2027-01-15','2027-01-16']}]}), /Jan 16/);
const clickStart = source.indexOf('  const intakeCheckDates = event.target.closest(');
const clickCode = source.slice(clickStart, source.indexOf('  const intakeManageLeave',clickStart));
assert.doesNotMatch(clickCode,/await |fetch\(|renderIntakeQueue\(|supabase/,'Opening must stay local and avoid redrawing the queue');
const start = performance.now(); for(let i=0;i<1000;i++) context.renderIntakeDateCheck(item);
console.log(`PASS lazy rendering, correct area, capacity, missing data, exempt bids and grouped dates. Fixture render average: ${((performance.now()-start)/1000).toFixed(2)} ms.`);
if(process.argv.includes('--preview')) {
  context.intakeDateChecksOpen.add(item.id);
  const control = context.renderIntakeDateCheckControl(item);
  writeFileSync('outputs/intake-date-check/preview.html', `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Intake date checker preview</title><style>${readFileSync('bidding.css','utf8')}body{background:#eef2f7;padding:32px;font-family:Arial,sans-serif}main{max-width:900px;margin:auto}.preview-label{color:#51667d;font-size:13px}.intake-card{background:white;color:#182d44;display:block;padding:24px;border-radius:16px}.intake-card h3{margin:8px 0}main h1,main h3{color:#182d44}main button.secondary-action{color:#182d44;background:white;border-color:#ccd8e4}main button.primary-action{background:#183b60;color:white}.preview-actions{display:flex;gap:8px;margin-top:18px}</style></head><body><main><p class="preview-label">INTAKE QUEUE · Example data for preview</p><h1>Review requested leave</h1><article class="intake-card"><span class="intake-type">Leave · Round 1</span><h3>Example Bidder · AB</h3><p>Jan 15–17, 2027 · 3 requested dates</p><div class="intake-meta"><span>Area C</span><span>Bid as CPC</span><span class="status pending">Pending</span></div>${control}<div class="preview-actions"><button class="primary-action small">Approve week</button><button class="secondary-action small danger">Deny week</button><button class="secondary-action small">Edit / Override</button></div></article></main><script>document.querySelector('[data-intake-check-dates]').onclick=function(){const c=this.nextElementSibling;c.hidden=!c.hidden;this.setAttribute('aria-expanded',String(!c.hidden));this.textContent=c.hidden?'Check dates':'Hide date check'}</script></body></html>`);
}
