import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../bidding.js',import.meta.url),'utf8');
const extract=name=>{const start=source.indexOf(`function ${name}(`);return source.slice(start,source.indexOf('\n}',start)+2);};
const calls=[];
const context={currentUser:{area:'F'},document:{querySelector:()=>null,documentElement:{classList:{remove(){calls.push('ready');}}}},intendedLandingPage:p=>p,setPage:(p,options)=>calls.push(['page',p,options.render]),renderApp:()=>calls.push('render'),startLiveAlertUpdates:()=>calls.push('live')};
vm.runInNewContext(extract('showLoggedInApp'),context);
context.showLoggedInApp('leave');
assert.deepEqual(calls,[['page','leave',false],'render','live','ready']);
assert.match(extract('renderAppWithCache'),/renderCalendars\(\{ includePublic: false, reuseCurrent: true \}\)/);
const profileTest=readFileSync(new URL('test-profile-navigation.mjs',import.meta.url),'utf8');
// Run the existing direct-navigation behavior checks, independently of its stale click-handler fixture.
vm.runInNewContext(profileTest.slice(profileTest.indexOf('const source='),profileTest.indexOf('// Profile navigation is handled')).replace("new URL('../bidding.js', import.meta.url)","'bidding.js'"),{assert,fs:{readFileSync:()=>source},vm,URL,console});
console.log('PASS startup selects destination before one render; direct page navigation still renders.');
