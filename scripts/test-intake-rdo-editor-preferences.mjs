import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const context = vm.createContext({
  hasIntakeAccess: () => true,
  escapeHtml: value => String(value ?? ''),
  rdoLinesForBidder: () => [{ line: '2' }],
  isCpcLine: () => true,
  isDevelopmentalBidRole: role => role === 'DEV',
  rdoLineOptionLabel: line => line.line,
});
for (const name of ['rdoBidPreferenceLabel', 'renderOverrideEditor']) {
  const start = source.indexOf(`function ${name}(`);
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
}
for (const status of ['Approved', 'Pending']) {
  for (const [saved, expected] of [[true, 'Yes'], [false, 'No'], ['true', 'Yes'], ['false', 'No'], ['Yes', 'Yes'], ['No', 'No']]) {
    const item = { id: 'bid', type: 'RDO Line', status, bidAs: 'CPC', area: 'Area A', line: '2', aws: saved, flex: saved, mid: 'No' };
    const original = JSON.stringify(item);
    const markup = context.renderOverrideEditor(item);
    for (const field of ['aws', 'flex']) {
      const options = markup.match(new RegExp(`<select data-override-${field}[^>]*>([\\s\\S]*?)</select>`))[1];
      assert.match(options, new RegExp(`<option selected>${expected}</option>`), `${status} ${field} ${saved}`);
      assert.equal((options.match(/selected/g) || []).length, 1);
    }
    assert.equal(JSON.stringify(item), original, 'Opening the editor preserves the approved bid');
  }
}
const devMarkup = context.renderOverrideEditor({ type: 'RDO Line', status: 'Approved', bidAs: 'DEV', aws: false });
assert.match(devMarkup, /data-override-aws disabled/);
assert.match(devMarkup, /<option value="No">No — DEV does not work AWS<\/option>/);
console.log('PASS intake RDO editor restores saved AWS and Flex choices for approved and pending bids');
