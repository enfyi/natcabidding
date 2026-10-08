import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../bidding.js',import.meta.url),'utf8');
const extract=name=>{const start=source.indexOf(`function ${name}(`);return source.slice(start,source.indexOf('\n}',start)+2);};
const calls=[];
const context={currentUser:{area:'F',supabaseProfileId:'own-profile'},document:{querySelector:()=>null,documentElement:{classList:{add(){},remove(name){if(name === 'member-boot-pending') calls.push('ready');}}}},intendedLandingPage:p=>p,setPage:(p,options)=>calls.push(['page',p,options.render]),renderApp:()=>calls.push('render'),startLiveAlertUpdates:()=>calls.push('live')};
vm.runInNewContext(extract('showLoggedInApp'),context);
context.showLoggedInApp('leave');
assert.deepEqual(calls,[['page','leave',false],'render','live','ready']);
assert.match(extract('renderAppWithCache'),/renderCalendars\(\{ includePublic: false, reuseCurrent: true \}\)/);
const profileTest=readFileSync(new URL('test-profile-navigation.mjs',import.meta.url),'utf8');
// Run the existing direct-navigation behavior checks, independently of its stale click-handler fixture.
vm.runInNewContext(profileTest.slice(profileTest.indexOf('const source='),profileTest.indexOf('// Profile navigation is handled')).replace("new URL('../bidding.js', import.meta.url)","'bidding.js'"),{assert,fs:{readFileSync:()=>source},vm,URL,console});
console.log('PASS startup selects destination before one render; direct page navigation still renders.');

// A missing or unfinished profile must never expose the member shell.
for (const user of [null, {area: 'F'}]) {
  calls.length = 0;
  context.currentUser = user;
  context.showPublicHome = () => calls.push('public');
  context.showLoggedInApp('admin');
  assert.deepEqual(calls, ['public']);
}
assert.match(source, /let currentUser = null;/);
assert.doesNotMatch(source, /testAccounts/);
console.log('PASS signed-out and unfinished profiles cannot open the dashboard.');

// A render exception must hide the shell before removing the rendering guard.
const failedRenderCalls = [];
context.currentUser = {area: 'F', supabaseProfileId: 'own-profile'};
context.document = {
  querySelector: selector => ({
    setAttribute: name => failedRenderCalls.push(`${selector}:${name}`),
    removeAttribute: () => {},
  }),
  documentElement: {classList: {
    add: name => failedRenderCalls.push(`add:${name}`),
    remove: name => failedRenderCalls.push(`remove:${name}`),
  }},
};
context.renderApp = () => { throw new Error('Render failed'); };
assert.throws(() => context.showLoggedInApp('dashboard'), /Render failed/);
assert.equal(context.currentUser, null);
assert.equal(failedRenderCalls[0], 'add:member-render-pending');
assert.deepEqual(failedRenderCalls.slice(-2), ['.app-shell:hidden', 'remove:member-render-pending']);
const html = readFileSync(new URL('../bidding.html', import.meta.url), 'utf8');
assert.match(html, /\[hidden\] \{ display: none !important; \}/);
assert.match(html, /class="app-shell" hidden/);
assert.doesNotMatch(html, /Michael Schoelen|m\.schoelen@yahoo\.com/);
console.log('PASS render failure keeps the shell hidden; initial HTML contains no Mike identity.');
