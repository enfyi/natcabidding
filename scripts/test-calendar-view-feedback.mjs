import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const start = source.indexOf('  const calendarModeButton = event.target.closest("[data-calendar-mode]");');
const end = source.indexOf('  const calendarWorkforceButton', start);
const handler = `(async () => { ${source.slice(start, end)} })()`;
for (const scope of ['dashboard', 'leave', 'public']) {
  for (const [attribute, values] of [['calendarMode', ['vacation', 'fatigue', 'combined']], ['calendarLayout', ['minimal', 'full']]]) {
    for (const value of values) {
      let paintThenRender;
      let loadingLabel;
      let renders = 0;
      let result;
      const button = { dataset: { [attribute]: value, calendarScope: scope } };
      const context = vm.createContext({
        calendarMode: 'combined', calendarLayouts: { dashboard: 'minimal', leave: 'minimal', public: 'minimal' },
        event: { target: { closest: selector => selector === (attribute === 'calendarMode' ? '[data-calendar-mode]' : '[data-calendar-layout]') ? button : null } },
        runUiAction: (key, control, label, action) => {
          assert.equal(key, 'calendar-view');
          assert.equal(control, button);
          loadingLabel = label;
          return new Promise(resolve => { paintThenRender = () => { action(); resolve(); }; });
        },
        renderVisibleCalendars: () => { renders++; },
        showActionFeedback: (message, status) => { result = { message, status }; },
      });
      const pending = vm.runInContext(handler, context);
      assert.match(loadingLabel, /^Loading (Leave|Fatigue|Combined|Minimal|Full) view…$/);
      assert.equal(renders, 0, 'Loading feedback is shown before calendar rendering');
      paintThenRender();
      await pending;
      assert.equal(renders, 1);
      assert.equal(result.status, 'success');
      if (attribute === 'calendarMode') assert.equal(context.calendarMode, value);
      else assert.equal(context.calendarLayouts[scope], value);
    }
  }
}
console.log('PASS calendar mode and detail feedback across dashboard, leave, and public scopes');
