import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { webkit, chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { default: acorn } = await import(process.env.CALENDAR_ACORN_MODULE || 'next/dist/compiled/acorn/acorn.js');
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
// Register production controls without running authentication, timers or network startup.
const code = ast.body.filter(n => n.type === 'FunctionDeclaration' || n.type === 'VariableDeclaration'
  || (n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression'
    && n.expression.callee.type === 'MemberExpression'
    && ['document', 'window'].includes(n.expression.callee.object.name)
    && n.expression.callee.property.name === 'addEventListener'))
  .map(n => source.slice(n.start, n.end)).join('\n');
const html = readFileSync(new URL('../bidding.html', import.meta.url), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');


for(const engine of [chromium,webkit]) {
 const browser=await engine.launch(engine===chromium?{headless:true,...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {})}:{headless:true});
 try {for(const width of [390,1440]) {
 const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());await page.setContent(html);await page.addStyleTag({content:readFileSync(new URL('../bidding.css', import.meta.url),'utf8')});await page.addScriptTag({content:code});
 await page.evaluate(()=>{
 currentUser={initials:'ME',area:'Area A',bidAs:'CPC'};hasIntakeAccess=()=>true;hasSystemAdminAccess=()=>true;
 document.querySelector('.login-screen').hidden=true;document.querySelector('.app-shell').hidden=false;document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.dataset.pagePanel==='intake'));
 const panel=document.querySelector('.manual-leave-request-card');window.fixturePanel=panel;
 panel.querySelector('[data-manual-bid-controller]').innerHTML='<option value="ME">ME</option>';panel.querySelector('[data-manual-bid-area]').innerHTML='<option>Area A</option>';panel.querySelector('[data-manual-leave-round]').innerHTML='<option>2</option>';
 manualBidPerson=()=>({initials:'ME',bidAs:'CPC',area:'Area A',leaveSlotAllowance:240});
 manualLeaveDateChecks=(_p,_a,keys)=>new Map(keys.map(k=>[k,{rdo:false,full:false}]));renderManualLeavePreflight=()=>{};chargeableLeaveDateKeys=keys=>keys;
 prepareManualLeaveEntries=()=>({});chargeableLeaveDatesForInitials=range=>datesInLeaveRange(range);
 });
 const panel=page.locator('.manual-leave-request-card');await panel.locator('[data-manual-date-mode="multiple"]').click();
 const dialog=panel.locator('dialog');assert.equal(await dialog.evaluate(el=>el.open),true);assert.equal(await dialog.locator('.manual-picker-month').count(),13);
 for(const date of ['2027-06-07','2027-12-30','2028-01-08']) {const button=dialog.locator('[data-manual-pick-date="'+date+'"]').first();await button.click();assert.equal(await button.getAttribute('aria-pressed'),'true');}
 await dialog.locator('[data-manual-pick-date="2027-06-07"]').first().click();assert.equal(await page.evaluate(()=>fixturePanel.manualDatePicker.dates.size),2);
 assert.equal(await dialog.locator('[data-manual-pick-date="2028-01-09"]').isDisabled(),true);
 assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'No horizontal overflow');
 await dialog.locator('[data-manual-leave-add]').click();assert.deepEqual(await page.evaluate(()=>manualLeaveBatch.entries.flatMap(e=>datesInLeaveRange(e.range))),['2027-12-30','2028-01-08']);
 assert.equal(await page.evaluate(()=>fixturePanel.manualDatePicker.dates.size),0);
 await dialog.locator('[data-manual-picker-close]').click();assert.equal(await dialog.evaluate(el=>el.open),false);
 await panel.locator('[data-manual-date-mode="multiple"]').click();await page.keyboard.press('Escape');assert.equal(await dialog.evaluate(el=>el.open),false);
 assert.deepEqual(errors,[]);console.log('PASS',engine.name(),width,'full calendar, cross-month toggles, leave-year boundary, batch, Done and Escape');await page.close();
 }}finally{await browser.close();}
}