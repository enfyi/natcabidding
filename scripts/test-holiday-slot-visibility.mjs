import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../bidding.js',import.meta.url),'utf8');
const start=source.indexOf('function leaveSlotDateKeys(');
const context={currentUser:{initials:'TEST'},isRdoDateForInitials:(key)=>key==='2027-06-20'};
vm.createContext(context);vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
assert.deepEqual([...context.leaveSlotDateKeys(['2027-06-18','2027-06-19','2027-06-20'])],['2027-06-18','2027-06-19']);
console.log('PASS holiday and in-lieu dates occupy slots; RDO dates remain excluded');
