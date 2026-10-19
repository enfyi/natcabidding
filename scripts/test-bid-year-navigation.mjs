import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const start = source.indexOf('function syncNavigationUrl(');
const fn = source.slice(start, source.indexOf('\n}', start) + 2);
let frameUrl = 'https://example.test/bidding.html?page=leave&bidYear=2027';
let parentUrl = 'https://example.test/dashboard?page=leave&bidYear=2027';
let message;
const parent = {
  location: { get href() { return parentUrl; } },
  history: { state: {}, replaceState(_state, _title, next) { parentUrl = next; } },
  postMessage(value) { message = value; },
};
const context = vm.createContext({ URL, window: {
  parent, location: { origin: 'https://example.test' },
  history: { state: {}, replaceState(_state, _title, next) { frameUrl = next; } },
} });
const historyHelper = source.slice(source.indexOf('function replaceBrowserHistory('), source.indexOf('function adoptParentSupabaseAuthHash('))
vm.runInContext(historyHelper + fn, context);
context.syncNavigationUrl(new URL('https://example.test/bidding.html?page=rdos&bidYear=2026'));
assert.equal(new URL(frameUrl).searchParams.get('bidYear'), '2026');
assert.equal(new URL(parentUrl).searchParams.get('bidYear'), '2026');
assert.equal(new URL(parentUrl).searchParams.get('page'), 'rdos');
assert.equal(new URLSearchParams(message.search).get('bidYear'), '2026');

// Exercise the actual server component: a full dashboard refresh must pass its
// selected year back to the embedded bidding page for every supported entry.
const page = readFileSync(new URL('../app/dashboard/page.tsx', import.meta.url), 'utf8');
const body = page.slice(page.indexOf('  const { page,'), page.indexOf('  return ('));
const srcExpression = page.match(/<DashboardFrame src=\{(.+)\} \/>/)?.[1];
assert.ok(srcExpression, 'Dashboard passes an explicit source to its frame');
const componentContext = vm.createContext({ URLSearchParams,
  isBiddingLandingPage: (name) => ['rdos','leave','admin-tools'].includes(name),
});
vm.runInContext(`async function renderSrc(searchParams) { ${body} return ${srcExpression}; }`, componentContext);
for (const values of [{page:'rdos'}, {page:'leave'}, {page:'admin-tools'}, {page:'public', area:'Area A', section:'leave'}, {}]) {
  const src = await componentContext.renderSrc(Promise.resolve({ ...values, bidYear: '2026' }));
  assert.equal(new URL(src, 'https://example.test').searchParams.get('bidYear'), '2026');
}
const invalid = await componentContext.renderSrc(Promise.resolve({ page:'leave', bidYear: 'bad' }));
assert.equal(new URL(invalid, 'https://example.test').searchParams.has('bidYear'), false);
console.log('PASS selected year survives dashboard URL synchronization and full-page refresh');
