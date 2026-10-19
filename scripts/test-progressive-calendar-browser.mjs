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
    const initial = await page.evaluate(() => {
      // Keep idle work deterministic; real IntersectionObserver still handles fast scrolling.
      window.__idleTasks = new Map(); let id = 0;
      window.requestIdleCallback = callback => { window.__idleTasks.set(++id, callback); return id; };
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
      document.documentElement.classList.add('member-boot-pending');
      const started = performance.now(); withLeaveReadCache(() => makeCalendar('leave-calendar'));
      document.documentElement.classList.remove('member-boot-pending');
      window.__januaryButton = document.querySelector('#leave-calendar [data-calendar-date="2027-01-10"]');
      return { ms: performance.now() - started, buttons: document.querySelectorAll('#leave-calendar [data-calendar-date]').length,
        pending: document.querySelectorAll('#leave-calendar [data-calendar-pending]').length };
    });
    assert.equal(initial.buttons, 31); assert.equal(initial.pending, 12);
    const selector = page.locator('#leave-calendar [data-month-jump-select]');
    const month = (number, year = 2027) => page.locator(`#leave-calendar [data-calendar-month="${number}"][data-calendar-year="${year}"]`);
    await selector.selectOption('10');
    await page.locator('#leave-calendar [data-month-jump=\"next\"]').click();
    assert.equal(await month(11).locator('[data-calendar-date]').count(), 31);
    await page.locator('#leave-calendar [data-month-jump=\"previous\"]').click();
    assert.equal(await month(10).getAttribute('data-calendar-pending'), null);
    assert.equal(await month(10).locator('[data-calendar-date]').count(), 30);
    await page.locator('#leave-calendar [data-calendar-date="2027-11-03"]').click();
    assert.equal(await page.evaluate(() => selectedLeaveDates.has('2027-11-03')), true);
    await page.locator('#leave-calendar [data-calendar-date="2027-11-03"]').click();
    assert.equal(await page.evaluate(() => selectedLeaveDates.has('2027-11-03')), false);
    await selector.selectOption('0');
    assert.equal(await page.evaluate(() => window.__januaryButton === document.querySelector('#leave-calendar [data-calendar-date="2027-01-10"]')), true);
    await selector.selectOption('12');
    assert.equal(await month(0, 2028).locator('[data-calendar-date]').count(), 31);
    await selector.selectOption('0');
    if (mobile) {
      await page.locator('#leave-calendar [data-navigation-annual]').click();
      assert.equal(await page.locator('#leave-calendar').evaluate(el => el.classList.contains('mobile-single-month')), false);
    }
    // Skip directly to a still-deferred month using the scrollbar, not navigation.
    await page.evaluate(() => {
      const card = document.querySelector('#leave-calendar [data-calendar-month="8"]');
      window.scrollTo(0, window.scrollY + card.getBoundingClientRect().top - 240);
    });
    await page.waitForFunction(() => !document.querySelector('#leave-calendar [data-calendar-month="8"]').hasAttribute('data-calendar-pending'));
    assert.equal(await month(8).locator('[data-calendar-date]').count(), 30);
    assert.equal(await month(8).evaluate(el => {const r=el.getBoundingClientRect();return r.top < innerHeight && r.bottom > 0;}), true, 'Fast-scroll destination stays in the viewport');
    // An admin/RDO change must also affect months rendered later, not just today's DOM.
    await page.evaluate(() => {
      rdoLines.push({ line: 'FIXTURE', area: 'Area A', status: 'Taken', cpc: 'ME', week: ['D', 'D', 'D', 'RDO', 'D', 'D', 'D'] });
      refreshMemberCalendarRdoPattern(new Set());
    });
    await selector.selectOption('11');
    assert.equal(await page.locator('#leave-calendar [data-calendar-date="2027-12-01"]').evaluate(el => el.classList.contains('rdo-day')), true);
    await page.locator('#leave-calendar [data-calendar-date="2027-12-01"]').click();
    assert.equal(await page.evaluate(() => selectedLeaveDates.has('2027-12-01')), false);
    await selector.selectOption('10');
    assert.equal(await page.locator('#leave-calendar [data-calendar-date="2027-11-03"]').evaluate(el => el.classList.contains('rdo-day')), true);
    await page.locator('#leave-calendar [data-calendar-date="2027-11-04"]').click();
    // Cache revisits cannot restore old RDO weekdays.
    await page.evaluate(() => {
      calendarLayouts.leave = 'minimal'; withLeaveReadCache(() => makeCalendar('leave-calendar', { reuseCurrent: true }));
      calendarLayouts.leave = 'full'; withLeaveReadCache(() => makeCalendar('leave-calendar', { reuseCurrent: true }));
    });
    assert.equal(await page.locator('#leave-calendar [data-calendar-date="2027-11-03"]').evaluate(el => el.classList.contains('rdo-day')), true);
    assert.equal(await page.locator('#leave-calendar [data-calendar-date="2027-11-04"]').evaluate(el => el.classList.contains('builder-range-day')), true, 'Selected leave date survives layout changes');
    const stale = await page.evaluate(() => {
      const target = document.getElementById('leave-calendar');
      const old = [...window.__idleTasks.values()];
      displayedCalendarYear = 2028;
      withLeaveReadCache(() => makeCalendar('leave-calendar', { reuseCurrent: true }));
      old.forEach(callback => callback({ didTimeout: true, timeRemaining: () => 50 }));
      return [...target.querySelectorAll('[data-calendar-month]')].every(card => card.dataset.calendarYear === '2028');
    });
    assert.equal(stale, true, 'Old queued work cannot populate a new year');
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    assert.equal(await page.locator('#leave-calendar [data-calendar-pending]').count(), 0);
    assert.equal(await page.locator('#leave-calendar [data-calendar-date]').count(), 366);
    await page.evaluate(() => {
      document.querySelector('.app-shell').hidden = true;
      document.querySelector('.login-screen').hidden = false;
      document.querySelector('.public-calendar-panel').classList.remove('table-view');
      currentUser = null; displayedCalendarYear = 2027;
      publicState.area = 'Area A'; publicState.section = 'Calendar'; calendarLayouts.public = 'full';
      calendarNavigationMonths.set('public-calendar', 0);
      withLeaveReadCache(() => makeCalendar('public-calendar'));
      // Slot updates must rebuild partial public views rather than patch a stale index.
      extraLeaveSlotData['2027-11-03'].cpc = ['NEW'];
      calendarRenderRevision++;
      window.__publicPatch = refreshPublicCalendarSlots({});
      withLeaveReadCache(() => makeCalendar('public-calendar', { reuseCurrent: true }));
    });
    assert.equal(await page.evaluate(() => window.__publicPatch), false);
    await page.locator('#public-calendar [data-month-jump-select]').selectOption('10');
    assert.match(await page.locator('#public-calendar [data-calendar-date="2027-11-03"]').textContent(), /NEW/);
    assert.equal(await page.locator('#public-calendar [data-calendar-date="2027-11-03"]').getAttribute('data-leave-date'), null);
    // Allow idle preparation to run deterministically and verify completion is bounded.
    await page.evaluate(() => {
      const target = document.getElementById('public-calendar');
      annualMobileCalendars.add('public-calendar'); syncMobileCalendarMonths(target);
      for (let i = 0; i < 20 && window.__idleTasks.size; i++) {
        const tasks = [...window.__idleTasks.entries()];
        tasks.forEach(([id, callback]) => { window.__idleTasks.delete(id); callback({ didTimeout: false, timeRemaining: () => 50 }); });
      }
    });
    assert.equal(await page.locator('#public-calendar [data-calendar-pending]').count(), 0);
    if (mobile) {
      await page.evaluate(() => { window.requestIdleCallback = undefined; displayedCalendarYear = 2029; withLeaveReadCache(() => makeCalendar('public-calendar')); });
      await page.waitForFunction(() => !document.querySelector('#public-calendar [data-calendar-pending]'), { timeout: 5000 });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${mobile ? 'mobile' : 'desktop'}: initial ${initial.buttons} dates / 12 deferred months (${initial.ms.toFixed(0)}ms); dropdown, arrows/year continuation, date toggles, viewport jump, return reuse, fresh RDO, stale-job cancellation and print`);
    await page.close();
  }
} finally { await browser.close(); }
