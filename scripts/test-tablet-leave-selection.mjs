import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../bidding.css', import.meta.url), 'utf8');
const start = source.indexOf('function selectLeaveBuilderDate(key) {');
const selection = source.slice(start, source.indexOf('\n}', start) + 2);
const branchStart = source.indexOf('  const leaveDateButton = event.target.closest("[data-leave-date]");');
const branch = source.slice(branchStart, source.indexOf('  const calendarModeButton', branchStart));
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
try {
  for (const width of [768, 1024, 1366]) {
    const page = await browser.newPage({ viewport: { width, height: 1024 }, hasTouch: true, isMobile: true });
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><div class="app-shell"><div class="month-grid"><button data-leave-date="2027-06-08"><span>8</span><span class="leave-date-tooltip">Open slots</span></button></div></div>`);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: `
      var currentUser = {initials: 'IM', area: 'Area A'}, selectedLeaveDates = new Set();
      var leaveRangeStartKey, leaveRangeEndKey, leaveRangeSelectionComplete, leaveRangePreviewActive = false, selectedLeaveDateKey;
      function previouslyBidLeaveDateKeys() { return new Set(); }
      function isRdoDateForInitials() { return false; }
      function bidderLeaveAvailabilityMessage() { return ''; }
      function currentUserBidAs() { return 'CPC'; }
      function usesIndividualLeaveDateSelection() { return true; }
      function currentRoundNumber() { return 1; }
      function roundOneProjectedWeekCount() { return 1; }
      function roundOneWeekLimit() { return 2; }
      function syncLeaveBuilderInputs() {}
      function syncLeavePickerMonthToRange() {}
      function setLeaveBuilderStatus() {}
      function syncMemberCalendarSelection() {}
      function renderLeaveDatePicker() {}
      ${selection}
      document.addEventListener('click', (event) => { ${branch} });
    ` });
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
    const date = page.locator('[data-leave-date]');
    await date.tap();
    assert.deepEqual(await page.evaluate(() => [...selectedLeaveDates]), ['2027-06-08'], 'One tap selects');
    assert.equal(await date.locator('.leave-date-tooltip').evaluate(el => getComputedStyle(el).display), 'none', 'Touch tooltip stays hidden');
    await date.tap();
    assert.deepEqual(await page.evaluate(() => [...selectedLeaveDates]), [], 'Second tap deselects');
    console.log(`PASS tablet touch selection and tooltip suppression at ${width}px`);
    await page.close();
  }
} finally { await browser.close(); }
