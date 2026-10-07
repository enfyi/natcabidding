import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function bidTimeOpenRound('), source.indexOf('function renderPublicBidTimeTable('));
const dots = ['Area A', 'Area B'].flatMap(area => [1, 2].map(rank => ({
  dataset: { bidderArea: area, bidderRank: String(rank), bidderRoundCount: '4' },
  parentElement: { classList: { toggle(name, active) { this.active = active; } } },
  hidden: true,
  label: '',
  getAttribute() { return this.label; },
  setAttribute(name, value) { this.label = value; },
})));
const start = Date.parse('2026-10-07T07:00:00-07:00');
const end = start + 2 * 60 * 60 * 1000;
const context = vm.createContext({
  escapeHtml: value => value,
  document: { querySelectorAll: () => dots },
  Date: class extends Date { constructor(...args) { super(...(args.length ? args : [start])); } },
  bidWindowForRankRound(rank, round, area) {
    if (area === 'Area B' || round !== 2) return null;
    return { start: new Date(start + (rank - 1) * (end - start)), end: new Date(start + rank * (end - start)) };
  },
});
vm.runInContext(helpers, context);
assert.match(context.bidTimeCurrentBidderDot({ rank: 1, area: 'Area A', rounds: ['', '', '', ''] }), /role="img" aria-label="Round 2 bid window open"/);
assert.doesNotMatch(context.bidTimeCurrentBidderDot({ rank: 1, area: 'Area A', rounds: ['', '', '', ''] }), / hidden/);
assert.match(context.bidTimeCurrentBidderDot({ rank: 2, area: 'Area A', rounds: ['', '', '', ''] }), / hidden/);
for (const [time, expected] of [[start - 1, []], [start, [0]], [end - 1, [0]], [end, [1]], [end + 2 * 60 * 60 * 1000, []]]) {
  context.syncBidTimeCurrentBidderDots(new Date(time));
  assert.deepEqual(dots.flatMap((dot, index) => dot.hidden ? [] : [index]), expected);
  assert.deepEqual(dots.flatMap((dot, index) => dot.parentElement.classList.active ? [index] : []), expected);
}
for (const name of ['renderPublicBidTimeTable', 'seniorityCardMarkup', 'seniorityTableMarkup']) {
  const beginning = source.indexOf(`function ${name}(`);
  const body = source.slice(beginning, source.indexOf('\nfunction ', beginning + 1));
  assert.match(body, /bidTimeCurrentBidderDot\(person\)/, `${name} includes the shared indicator`);
}
assert.match(source, /syncBidTimeCurrentBidderDots\(now\)/);
console.log('Current bidder dots pass visibility, boundary handoff, area isolation, and view coverage checks.');
