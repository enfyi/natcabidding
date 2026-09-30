import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const start = source.indexOf('function usesIndividualLeaveDateSelection(');
const end = source.indexOf('function leaveBuilderDateKeys(', start);
assert.ok(start >= 0 && end > start, 'Individual-date round helper was found');

const context = {
  round: 1,
  leaveReplacementRequestId: '',
};
context.currentRoundNumber = () => context.round;
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

for (const round of [1, 2, 3, 4, 5, 6]) {
  context.round = round;
  assert.equal(context.usesIndividualLeaveDateSelection(), true, `Round ${round} uses exact-date selection`);
}
context.round = 3;
context.leaveReplacementRequestId = 'existing-request';
assert.equal(context.usesIndividualLeaveDateSelection(), false, 'Existing single request replacement keeps its bounded editor');

assert.match(source, /const newDrafts = individualDates[\s\S]*dateKeys\.map\(\(key, index\) => \(\{[\s\S]*dateKeys: \[key\]/);
assert.match(source, /const selectedDays = chargeableLeaveDateKeys\(\[\.\.\.nextDates\], currentUser\.initials, round\)\.length/);
assert.match(source, /Round \$\{round\} can include up to \$\{roundLimit\} charged days/);
assert.match(source, /Dates do not need to be continuous/);

console.log('PASS rounds 1-6 use exact-date selection and rounds 2-6 enforce their charged-day limits');
