import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../bidding.js', import.meta.url),'utf8');
const fn=source.slice(source.indexOf('function setPage('),source.indexOf('function updateSelectedBidYear('));
const menu={hidden:false,setAttribute(name){if(name==='hidden')this.hidden=true;}};
const toggle={expanded:'true',setAttribute(name,value){if(name==='aria-expanded')this.expanded=value;}};
const pages=['dashboard','profile'].map(name=>({dataset:{pagePanel:name},active:name==='dashboard',classList:{toggle(_,value){pages.find(p=>p.dataset.pagePanel===name).active=value;}}}));
const title={textContent:''};
const context={document:{querySelector(selector){return selector==='[data-account-menu]'?menu:selector==='[data-account-toggle]'?toggle:selector==='.page.active'?pages.find(p=>p.active):null;},querySelectorAll(selector){return selector==='.page'?pages:[];},getElementById(){return title;}},window:{scrollTo(){},requestAnimationFrame(fn){fn();}},syncMemberPageUrl(){},syncViewModeSwitcher(){},isMemberAppVisible:()=>true,renderMemberPageContent(){}};
vm.runInNewContext(fn+';setPage("profile");',context);
assert.equal(pages[1].active,true);
assert.equal(title.textContent,'My Profile');
assert.equal(menu.hidden,true,'Profile opens but Account Settings still covers it');
assert.equal(toggle.expanded,'false');
console.log('Profile navigation reveals the page and dismisses Account Settings.');

// Profile navigation is handled before any bidding-data-dependent click work.
const clickStart = source.indexOf('document.addEventListener("click", async (event) => {');
const navigationEnd = source.indexOf('  const intakeBidderDetailOpen', clickStart);
let handler;
let openedPage;
vm.runInNewContext(source.slice(clickStart, navigationEnd) + '});', {
  document: { addEventListener(_type, callback) { handler = callback; } },
  setPage(page) { openedPage = page; },
});
await handler({ target: { closest() { return {
  dataset: { page: 'profile' },
  matches(selector) { return selector === 'button'; },
  closest() { return null; },
}; } } });
assert.equal(openedPage, 'profile');
console.log('Profile click navigation works independently of bidding data.');
