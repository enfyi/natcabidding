import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../bidding.js',import.meta.url),'utf8');
const start=source.indexOf('function rdoChangeWindowErrorMessage(');
const context={currentUser:{initials:'ME',area:'Area A'},rdoLines:[],pilotState:{database:false},
 currentUserRdoRequest:()=>({status:'Approved'}),lineForArea:()=>true,currentUserSeniorityRank:()=>1,isViewingHomeArea:()=>true,
 bidWindowLockIsBypassed:()=>true,activeTestBidRound:()=>1,bidWindowForRankRound:()=>({start:new Date('2027-01-01T10:00:00Z'),end:new Date('2027-01-01T13:00:00Z')})};
vm.createContext(context);vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
for(const time of ['09:59:59','12:00:00','13:00:00'])assert.match(context.rdoChangeWindowErrorMessage(new Date(`2027-01-01T${time}Z`)),/two-hour Round 1/);
for(const time of ['10:00:00','11:59:59'])assert.equal(context.rdoChangeWindowErrorMessage(new Date(`2027-01-01T${time}Z`)),'');
context.pilotState.database=true;context.activeTestBidRound=()=>2;
assert.match(context.rdoChangeWindowErrorMessage(new Date('2027-01-01T10:30:00Z')),/pilot Round 1/);
context.activeTestBidRound=()=>1;
for(const time of ['09:59:59','10:30:00','12:30:00'])assert.equal(context.rdoChangeWindowErrorMessage(new Date(`2027-01-01T${time}Z`)),'','Open pilot Round 1 bypasses scheduled windows');
context.bidWindowForRankRound=()=>null;
assert.equal(context.rdoChangeWindowErrorMessage(new Date('2027-01-01T12:30:00Z')),'','Pilot does not require an imported window');
context.bidWindowLockIsBypassed=()=>false;
assert.match(context.rdoChangeWindowErrorMessage(new Date('2027-01-01T12:30:00Z')),/pilot Round 1/);
context.bidWindowLockIsBypassed=()=>true;context.isViewingHomeArea=()=>false;
assert.match(context.rdoChangeWindowErrorMessage(new Date('2027-01-01T12:30:00Z')),/home area/);
context.isViewingHomeArea=()=>true;context.pilotState.database=false;
context.currentUserRdoRequest=()=>null;assert.equal(context.rdoChangeWindowErrorMessage(new Date('2027-01-01T12:30:00Z')),'','Initial bids retain existing rules');
context.rdoLines=[{status:'Taken',cpc:'ME'}];assert.match(context.rdoChangeWindowErrorMessage(new Date('2027-01-01T12:30:00Z')),/two-hour Round 1/);
assert.match(source,/button.textContent = "RDO Changes Closed"/);
console.log('PASS personal Round 1 boundaries, two-hour cap, pilot Round 1 access, closed pilot access, home area, and initial bids');
