import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
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
const browser = await chromium.launch({ headless: true });
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent(html);
    await page.addStyleTag({ content: readFileSync(new URL('../bidding.css', import.meta.url), 'utf8') });
    await page.addScriptTag({ content: code });
    for (const scope of ['public', 'dashboard', 'leave']) {
      const id = `${scope}-calendar`;
      await page.evaluate(({ scope, id }) => {
      // Keep idle work deterministic; real IntersectionObserver still handles fast scrolling.
      window.__idleTasks = new Map(); let idleId = 0;
      window.requestIdleCallback = callback => { window.__idleTasks.set(++idleId, callback); return idleId; };
      window.cancelIdleCallback = id => window.__idleTasks.delete(id);
      currentUser = { initials: 'ME', area: 'Area A', supabaseProfileId: 'fixture', bidAs: 'CPC', firstName: 'Test', lastName: 'Bidder' };
      document.querySelector('.login-screen').hidden = true;
      document.querySelector('.app-shell').hidden = false;
      document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.dataset.pagePanel === 'leave'));
      calendarLayouts.leave = 'full'; displayedCalendarYear = 2027; displayedCalendarMonth = 0;
      supabaseState.connected = true; supabaseState.leaveSlotsLoadState = 'loaded';
      currentRoundNumber = () => 2; // Fixed fixture round; exercise the real selection handlers.
      rdoLines.length = 0; selectedLeaveDates.clear(); leaveBids.length = 0; leaveDraftQueue.length = 0; intakeQueue.length = 0;
      Object.assign(extraLeaveSlotData, Object.fromEntries(Array.from({ length: 365 }, (_, i) => {
        const date = dateKeyFromDate(new Date(2027, 0, i + 1));
        return [date, { date, area: 'Area A', cpc: ['AB'], dev: ['CD'], cpcCapacity: 3, devCapacity: 4, cpcOpen: 2, devOpen: 3 }];
      })));

        document.querySelector('.login-screen').hidden = scope !== 'public';
        document.querySelector('.app-shell').hidden = scope === 'public';
        document.querySelector('.public-calendar-panel').classList.remove('table-view');
        document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.dataset.pagePanel === scope));
        publicState.area = 'Area A'; publicState.section = 'Calendar';
        calendarLayouts[scope] = 'full';
        annualMobileCalendars.add(id);
        withLeaveReadCache(() => makeCalendar(id));
        renderProgressiveCalendarMonths(document.getElementById(id), Array.from({ length: 13 }, (_, i) => i));
      }, { scope, id });
      // Read halfway through September, away from any month boundary.
      await page.locator(`#${id} [data-month-jump-select]`).selectOption('8');
      await page.evaluate(() => window.scrollBy(0, 420));
      await page.waitForTimeout(250);
      const position = () => page.evaluate(id => {
        const card = document.querySelector(`#${id} [data-calendar-month="8"]`);
        return { y: window.scrollY, top: card.getBoundingClientRect().top };
      }, id);
      const before = await position();
      for (const reuseCurrent of [false, true]) {
        await page.evaluate(({ id, reuseCurrent }) => {
          window.__monthShell = document.querySelector(`#${id} [data-calendar-month="8"]`);
          extraLeaveSlotData['2027-09-15'].cpc = ['NEW'];
          calendarRenderRevision++;
          withLeaveReadCache(() => makeCalendar(id, { reuseCurrent }));
        }, { id, reuseCurrent });
        await page.waitForTimeout(300);
        const after = await position();
        assert.ok(Math.abs(after.top - before.top) <= 2, `${scope}/${mobile ? 'mobile' : 'desktop'} refresh moved month: ${JSON.stringify({before, after})}`);
        assert.equal(await page.evaluate(id => window.__monthShell === document.querySelector(`#${id} [data-calendar-month="8"]`), id), true);
        assert.match(await page.locator(`#${id} [data-calendar-date="2027-09-15"]`).textContent(), /NEW/);
      }
      console.log(`PASS ${scope}/${mobile ? 'mobile' : 'desktop'}: forced and cached data refresh preserves September offset (${before.top.toFixed(0)}px) and renders updated slots`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); }
