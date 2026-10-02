import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../bidding.js',import.meta.url),'utf8');
const context={groupClass:(g)=>`group-${g.toLowerCase()}`};vm.createContext(context);
for(const name of ['rdoLineDisplayFatigueGroup','rdoFatigueGroupBadge']){
 const start=source.indexOf(`function ${name}(`);assert.ok(start>=0);
 vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
}
for(const group of ['A','B','C']){
 const approved={status:'Taken',group};
 assert.equal(context.rdoLineDisplayFatigueGroup(approved),group,'Saved group survives reload');
 assert.equal(context.rdoLineDisplayFatigueGroup(approved,{previewGroup:'B',pendingGroup:'C'}),group,'Preview never replaces approved assignment');
 assert.match(context.rdoFatigueGroupBadge(group),new RegExp(`>${group}</span>`));
}
assert.equal(context.rdoLineDisplayFatigueGroup({status:'Open',group:'A'}),'','Open line has no assigned group');
assert.equal(context.rdoLineDisplayFatigueGroup({status:'Open'},{previewGroup:'C'}),'C');
assert.equal(context.rdoLineDisplayFatigueGroup({status:'Open'},{previewGroup:'A',pendingGroup:'B'}),'B');
assert.equal(context.rdoLineDisplayFatigueGroup({status:'Taken',group:''},{previewGroup:'A'}),'');
assert.match(source,/group: row\.fatigue_group \|\| ""/);
assert.match(source,/publicRdoRowsMarkup[\s\S]*?<td>\$\{rdoFatigueGroupBadge\(rdoLineDisplayFatigueGroup\(line\)\)\}/);
assert.match(source,/Fatigue group: \$\{rdoFatigueGroupBadge\(rdoLineDisplayFatigueGroup\(line\)\)/);
assert.match(source,/const groupValue = rdoFatigueGroupBadge\(rdoLineDisplayFatigueGroup\(line/);
console.log('PASS saved A/B/C assignments, pending/preview behavior, public tables, and mobile cards');
