import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const acorn = require(process.env.CALENDAR_ACORN_MODULE || 'next/dist/compiled/acorn/acorn.js');
const source = readFileSync(process.env.HIGHLIGHT_SOURCE || new URL('../bidding.js', import.meta.url), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
const code = ast.body.filter(n => n.type === 'FunctionDeclaration' || n.type === 'VariableDeclaration'
  || (n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression'
    && n.expression.callee.type === 'MemberExpression'
    && ['document', 'window'].includes(n.expression.callee.object.name)
    && n.expression.callee.property.name === 'addEventListener'))
  .map(n => source.slice(n.start, n.end)).join('\n');
const html = readFileSync(new URL('../bidding.html', import.meta.url), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
try {
 for (const width of [768, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 1024 }, hasTouch: width === 768 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => route.abort());
  await page.setContent(html); await page.addStyleTag({ content: readFileSync(new URL('../bidding.css', import.meta.url), 'utf8') });
  await page.addScriptTag({ content: code });
  await page.evaluate(() => {
    currentUser = {initials:'ME',area:'Area A',bidAs:'CPC',leaveSlotAllowance:288};
    senioritySource.splice(0, senioritySource.length, ...Array.from({length:400}, (_,i)=>({initials:`B${i}`,rank:i+1,area:'Area A',bidAs:'CPC',active:true})));
    intakeQueue.splice(0,intakeQueue.length,...Array.from({length:1200},(_,i)=>({id:`bid${i}`,type:'Leave',initials:`B${i%400}`,area:'Area A',range:'Jun 7, 2027',round:1,status:'Approved',dateKeys:['2027-06-07']})));
    leaveBids.length = 0; leaveDraftQueue.length = 0; selectedLeaveDates.clear();
    currentRoundNumber = () => 4; leaveBidWindowErrorMessage = () => '';
    // Known submitted weekdays; keep real roster, holiday, charge and slot checks.
    rdoLines.splice(0,rdoLines.length,{line:'1',cpc:'ME',status:'Taken',area:'Area A',fourTen:'No',week:['RDO','700','700','700','700','700','RDO']});
    rdoWeekdaysForLine = () => new Set([0,6]);
    rosterEntryToPerson = entry => ({...entry}); seniorityEntryActive = () => true;
    holidayOverrides.clear();
    Object.keys(extraLeaveSlotData).forEach(key=>delete extraLeaveSlotData[key]);
    for(let day=1;day<=30;day++) {
      const key=dateKey(2027,6,day);
      extraLeaveSlotData[key]={date:key,area:'Area A',cpc:[],dev:[],cpcCapacity:5,devCapacity:5,cpcOpen:5,devOpen:5};
    }
    document.querySelector('.login-screen').hidden=true;
    document.querySelector('.app-shell').hidden=false;
    document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.dataset.pagePanel==='leave'));
    // Three populated year calendars reproduce the previous all-calendar scan.
    for (const id of ['dashboard-calendar','leave-calendar','full-calendar']) {
      const calendar=document.getElementById(id);
      calendar.innerHTML=Array.from({length:13},(_,index)=>{
        const month=index%12, year=2027+Math.floor(index/12);
        const cells=Array.from({length:new Date(year,month+1,0).getDate()},(_,i)=>{
          const key=dateKey(year,month+1,i+1);
          return `<button class="leave-day" type="button" data-calendar-date="${key}" data-leave-date="${key}"><span class="date-number">${i+1}</span></button>`;
        }).join('');
        return `<article class="month-card" data-calendar-month="${month}" data-calendar-year="${year}"><h3>${monthNames[month]}</h3><div class="month-grid">${cells}</div></article>`;
      }).join('');
    }
    leavePickerOpen=true; leavePickerYear=2027; leavePickerMonthIndex=5;
    withLeaveReadCache(()=>renderLeaveDatePicker());
  });
  const results = await page.evaluate(async () => {
    const samples=[];
    const calendar=document.getElementById('leave-calendar');
    const hidden=document.getElementById('dashboard-calendar');
    const hiddenBefore=hidden.innerHTML;
    const picker=document.querySelector('[data-leave-date-picker]');
    let pickerPreserved=true;
    for(const mode of ['calendar','picker']) {
    if(mode==='picker') { leavePickerOpen=true; leavePickerYear=2027; leavePickerMonthIndex=5; withLeaveReadCache(()=>renderLeaveDatePicker()); }
    const original=picker.querySelector('[data-leave-picker-date="2027-06-08"]');
    const visibleTarget=mode==='picker'?original:calendar.querySelector('[data-leave-date="2027-06-08"]');
    visibleTarget.scrollIntoView({block:'center'});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    for(let i=0;i<20;i++) {
      const key=i%2?'2027-06-09':'2027-06-08';
      const button=mode==='calendar'?calendar.querySelector(`[data-leave-date="${key}"]`):picker.querySelector(`[data-leave-picker-date="${key}"]`);
      const rect=button.getBoundingClientRect();
      if(rect.width===0 || rect.height===0 || rect.bottom<0 || rect.top>innerHeight) throw Error('Timing target is not visible');
      const selected=selectedLeaveDates.has(key);
      const start=performance.now(); button.click(); const handler=performance.now()-start;
      if(selectedLeaveDates.has(key)===selected) throw Error('Selection did not toggle');
      if(calendar.querySelector(`[data-calendar-date="${key}"]`).classList.contains('builder-range-day')===selected) throw Error('Calendar highlight incorrect');
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      samples.push({mode,handler,paint:performance.now()-start});
    }
    if(mode==='picker') pickerPreserved=original===picker.querySelector('[data-leave-picker-date="2027-06-08"]');
    }
    return {samples,pickerPreserved,hiddenPreserved:hiddenBefore===hidden.innerHTML};
  });
  if(!process.env.HIGHLIGHT_BASELINE) await page.evaluate(() => {
    const hidden=document.getElementById('dashboard-calendar');
    const state={revision:calendarRenderRevision,months:new Map()};
    progressiveCalendars.set(hidden,state);
    hidden.dataset.calendarRevision=String(calendarRenderRevision);
    withLeaveReadCache(()=>syncMemberCalendarSelection());
    if(state.revision!==-1 || !memberPageCalendarNeedsRender('dashboard')) throw Error('Hidden calendar was not invalidated');
    const picker=document.querySelector('[data-leave-date-picker]');
    const retained=picker.querySelector('[data-leave-picker-date="2027-06-08"]');
    retained.focus();
    retained.click();
    if(document.activeElement!==retained) throw Error('Date selection lost keyboard focus');
    // Rapid clicks must preserve exact toggles without queuing a network save.
    const before=selectedLeaveDates.has('2027-06-08');
    for(let i=0;i<10;i++) retained.click();
    if(selectedLeaveDates.has('2027-06-08')!==before) throw Error('Rapid date toggles lost updates');
    const oldMonth=picker.dataset.selectionMonth;
    leavePickerMonthIndex=6;
    syncLeaveDatePickerSelection();
    if(picker.dataset.selectionMonth===oldMonth || picker.contains(retained)) throw Error('Month change failed to rebuild picker');
    const selected=[...selectedLeaveDates].sort();
    withLeaveReadCache(()=>addOrUpdateLeaveSubmission());
    if(JSON.stringify(leaveDraftQueue.flatMap(item=>item.dateKeys).sort())!==JSON.stringify(selected) || !selected.length) throw Error('Selected dates did not reach batch: '+document.querySelector('[data-leave-builder-status]').textContent);
    if(selectedLeaveDates.size) throw Error('Builder selection was not cleared after staging');
  });
  assert.deepEqual(errors,[]);
  if(!process.env.HIGHLIGHT_BASELINE) { assert.equal(results.pickerPreserved,true); assert.equal(results.hiddenPreserved,true); }
  for(const mode of ['calendar','picker']) {
    const rows=results.samples.filter(s=>s.mode===mode).slice(2);
    const percentile=(field,p)=>rows.map(s=>s[field]).sort((a,b)=>a-b)[Math.floor((rows.length-1)*p)].toFixed(1);
    console.log(`${width}px ${mode}: handler median ${percentile('handler',.5)}ms / p95 ${percentile('handler',.95)}ms; next-paint upper bound median ${percentile('paint',.5)}ms / p95 ${percentile('paint',.95)}ms`);
  }
  console.log(`PASS selection/deselection; picker DOM retained=${results.pickerPreserved}; hidden calendar untouched=${results.hiddenPreserved}`);
  if(!process.env.HIGHLIGHT_BASELINE) console.log('PASS rapid toggles, keyboard focus, hidden-calendar invalidation, month navigation and selected dates added to batch');
  await page.close();
 }
} finally { await browser.close(); }
