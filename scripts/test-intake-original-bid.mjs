import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
const source = await readFile(new URL('../bidding.js', import.meta.url), 'utf8')
const extract = (name) => source.slice(source.indexOf(`function ${name}(`), source.indexOf('\nfunction ', source.indexOf(`function ${name}(`) + 1))
const context = vm.createContext({
  intakeItemRound: (item) => item.round || 1,
  fatigueGroupPreferenceLabel: (value) => value ? `Group ${value}` : 'No preference',
  rdoBidPreferenceLabel: (value) => value === true || value === 'Yes' ? 'Yes' : value === false || value === 'No' ? 'No' : 'Not selected',
  escapeHtml: (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
})
vm.runInContext(['rdoBidSnapshotFromIntakeItem', 'rdoBidSnapshotSummary', 'rdoBidValuesChanged', 'inferRdoBidChanges', 'rdoBidChangeDifferences', 'renderIntakeChangeHistory'].map(extract).join('\n'), context)
const original = {type:'RDO Line',supabaseSubmissionId:'old',bidderId:'a',initials:'AB',area:'Area A',status:'Expired',line:'24',fatigueGroup:'A',flex:true,aws:true,mid:'No',submittedAt:'2026-10-01'}
const requested = {...original,supabaseSubmissionId:'new',status:'Pending',isChange:true,originalSubmissionId:'old',originalBid:null,flex:false,submittedAt:'2026-10-05',summary:'stale summary'}
context.items=[requested,original]
vm.runInContext('inferRdoBidChanges(items)',context)
assert.equal(requested.originalBid.line,'24')
assert.equal(requested.originalBid.flex,true)
context.item=requested
const markup=vm.runInContext('renderIntakeChangeHistory(item)',context)
assert.match(markup, /Original:<\/b> Line 24 · Group A · Flex Yes/)
assert.match(markup, /Requested:<\/b> Line 24 · Group A · Flex No/)
assert.match(markup, /Flex: Yes → No/)
assert.doesNotMatch(markup, /Original bid unavailable|stale summary|AWS: Yes → Yes/)
const snapshot=requested.originalBid
context.items=[requested,{...original,flex:false}]
vm.runInContext('inferRdoBidChanges(items)',context)
assert.equal(requested.originalBid,snapshot,'Never replace the saved snapshot')
const wrongOwner={...requested,originalBid:null,bidderId:'b'}
context.items=[wrongOwner,original]
vm.runInContext('inferRdoBidChanges(items)',context)
assert.equal(wrongOwner.originalBid,null,'Do not recover another bidder\'s history')
const inferred={...requested,originalBid:null,originalSubmissionId:'',isChange:false}
context.items=[inferred,{...original,status:'Approved'}]
vm.runInContext('inferRdoBidChanges(items)',context)
assert.equal(inferred.originalBid.flex,true)
console.log('PASS original approved bids are recovered safely and compared against current requested values')

if (process.env.PGLITE_MODULE) {
 const {PGlite}=await import(process.env.PGLITE_MODULE)
 const db=new PGlite()
 await db.exec(`create table intake_submissions (bidder_id text, payload jsonb, is_change boolean, original_bid jsonb, supersedes_submission_id text, change_source text);
 create function public.read_bidding_state(requested_bid_year integer) returns jsonb language sql stable as $$select jsonb_build_object('payload', s.payload) from intake_submissions s where s.bidder_id = 'authorized-bidder'$$;
 insert into intake_submissions values ('authorized-bidder','{}',true,'{"line":"24","flex":true}','old','bidder');`)
 const migration=await readFile(new URL('../database/expose_original_approved_bid_to_intake.sql',import.meta.url),'utf8')
 await db.exec(migration)
 await db.exec(migration)
 const {rows}=await db.query('select public.read_bidding_state(2027) as bid')
 assert.equal(rows[0].bid.originalBid.line,'24')
 assert.equal(rows[0].bid.originalBid.flex,true)
 assert.equal(rows[0].bid.supersedesSubmissionId,'old')
 assert.equal(rows[0].bid.bidderId,'authorized-bidder')
 const definition=(await db.query("select pg_get_functiondef('public.read_bidding_state(integer)'::regprocedure) as definition")).rows[0].definition
 assert.match(definition,/s.bidder_id = 'authorized-bidder'/)
 await db.close()
 console.log('PASS reader migration returns saved snapshots, preserves authorization, and is idempotent')
}
