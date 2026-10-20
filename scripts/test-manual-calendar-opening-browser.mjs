import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const extract = name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
const handlerStart = source.indexOf('  const pickerAction = event.target.closest(');
const handler = source.slice(handlerStart, source.indexOf('\n  const manualBidSubmit =', handlerStart));
const html = readFileSync(new URL('../bidding.html', import.meta.url), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/*', route => route.abort());
  await page.setContent(html);
  await page.addStyleTag({ content: readFileSync(new URL('../bidding.css', import.meta.url), 'utf8') });
  // Exercise the production renderer and click handler with fixed bidder data.
  await page.addScriptTag({ content: `
    const BID_YEAR = 2027, BID_LEAVE_YEAR_START_KEY = '2027-01-10', BID_LEAVE_YEAR_END_KEY = '2028-01-08';
    const currentUser = { initials: 'ADMIN' }, manualLeaveBatch = { key: '', entries: [] };
    const currentViewArea = () => 'Area A', currentRoundNumber = () => 1;
    const hasIntakeAccess = () => true, hasSystemAdminAccess = () => false;
    const manualBidPerson = () => ({ initials: 'DM', ghostBidder: false });
    const escapeHtml = value => value, withLeaveReadCache = fn => fn();
    const manualLeaveDateChecks = (_person, _area, keys) => new Map(keys.map(key => [key, { rdo: false, full: false }]));
    const chargeableLeaveDateKeys = keys => keys;
    const renderManualLeavePreflight = () => {};
    ${['manualLeaveBatchKey', 'manualDatePickerState', 'renderManualDatePicker', 'dateKeyFromDate', 'dateKey'].map(extract).join('\n')}
    document.addEventListener('click', event => { ${handler} });
    document.querySelector('.login-screen').hidden = true;
    document.querySelector('.app-shell').hidden = false;
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.dataset.pagePanel === 'intake'));
    document.querySelector('[data-manual-intake-content="leave"]').hidden = false;
  ` });
  const open = page.locator('[data-manual-date-mode="multiple"]');
  const calendar = page.locator('[data-manual-multi-picker]');
  const expectJanuaryAtTop = async () => {
    await page.waitForFunction(() => {
      const calendar = document.querySelector('[data-manual-multi-picker]');
      return !calendar.hidden && Math.abs(calendar.getBoundingClientRect().top) < 2;
    });
    assert.match(await calendar.locator('.manual-picker-month h3').first().textContent(), /January 2027/);
    const january = await calendar.locator('.manual-picker-month').first().boundingBox();
    assert.ok(january.y >= 0 && january.y < 300, `January must be at the viewport start: ${january.y}`);
  };
  await open.click();
  await expectJanuaryAtTop();
  assert.equal(await calendar.locator('.manual-picker-month').count(), 13);
  await calendar.locator('[data-manual-pick-date="2027-01-15"]').click();
  await calendar.locator('[data-manual-picker-view="month"]').click();
  await calendar.locator('[data-manual-picker-month="1"]').click();
  assert.match(await calendar.locator('.manual-picker-month h3').textContent(), /February 2027/);
  await page.locator('[data-manual-date-mode="range"]').click();
  await open.click();
  await expectJanuaryAtTop();
  assert.equal(await calendar.locator('[data-manual-pick-date="2027-01-15"]').first().getAttribute('aria-pressed'), 'true');
  console.log('PASS mobile calendar opens at January 2027 in full-year and month views; reopening preserves selected dates');
} finally {
  await browser.close();
}
