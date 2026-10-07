import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function bidTimeCurrentBidderDot('), source.indexOf('function renderPublicBidTimeTable('));
const dots = ['Area A', 'Area B'].flatMap(area => [1, 2].map(rank => ({
  dataset: { bidderArea: area, bidderRank: String(rank) },
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
  areaBidRoundState(date, area) {
    if (area === 'Area B' || date.getTime() < start || date.getTime() >= end + 2 * 60 * 60 * 1000) return { phase: 'closed' };
    return { phase: 'open', activeRank: date.getTime() < end ? 1 : 2, round: 1 };
  },
});
vm.runInContext(helpers, context);
assert.match(context.bidTimeCurrentBidderDot({ rank: 1, area: 'Area A', openRound: 1 }), /role="img" aria-label="Round 1 bid window open"/);
assert.doesNotMatch(context.bidTimeCurrentBidderDot({ rank: 1, area: 'Area A', openRound: 1 }), / hidden/);
assert.match(context.bidTimeCurrentBidderDot({ rank: 2, area: 'Area A' }), / hidden/);
for (const [time, expected] of [[start - 1, []], [start, [0]], [end - 1, [0]], [end, [1]], [end + 2 * 60 * 60 * 1000, []]]) {
  context.syncBidTimeCurrentBidderDots(new Date(time));
  assert.deepEqual(dots.flatMap((dot, index) => dot.hidden ? [] : [index]), expected);
}
for (const name of ['renderPublicBidTimeTable', 'seniorityCardMarkup', 'seniorityTableMarkup']) {
  const beginning = source.indexOf(`function ${name}(`);
  const body = source.slice(beginning, source.indexOf('\nfunction ', beginning + 1));
  assert.match(body, /bidTimeCurrentBidderDot\(person\)/, `${name} includes the shared indicator`);
}
assert.match(source, /syncBidTimeCurrentBidderDots\(now\)/);
console.log('Current bidder dots pass visibility, boundary handoff, area isolation, and view coverage checks.');
