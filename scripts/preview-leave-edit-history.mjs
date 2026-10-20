// Render the real intake queue with fictional data; no database calls or writes.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../bidding.js',import.meta.url),'utf8');
const css=await readFile(new URL('../bidding.css',import.meta.url),'utf8');
const extract=name=>source.slice(source.indexOf(`function ${name}(`),source.indexOf('\nfunction ',source.indexOf(`function ${name}(`)+1));
const target={innerHTML:''};
const edited={id:'example-round2',type:'Leave',round:2,status:'Approved',name:'Sample Controller',initials:'SC',area:'Area A',seniority:12,bidAs:'CPC',range:'Jun 14 - 16, 2027',days:3,summary:'Round 2 · Jun 14 - 16, 2027 · 3 days',approvedBy:'JT',approvedAt:'Oct 20, 2026, 12:30 PM',submittedAt:'Oct 19, 2026, 9:00 AM',leaveEditHistory:[{id:'example-edit',before:{start_date:'2027-06-07',end_date:'2027-06-09'},after:{start_date:'2027-06-14',end_date:'2027-06-16'},editedBy:'JT',editedAt:'2026-10-20T19:30:00Z'}]};
const older={...edited,id:'example-round1',round:1,range:'May 3 - 7, 2027',summary:'Round 1 · May 3 - 7, 2027 · 5 days',leaveEditHistory:[]};
const context=vm.createContext({
  document:{getElementById:id=>id==='intake-queue'?target:null,querySelector:()=>null},
  currentUser:{role:'intake',initials:'JT',area:'Area A'},pilotState:{database:true,enabled:true},pilotOpenRounds:[2],
  activeIntakeDetailId:null,activeOverrideId:null,activeDenialId:null,intakeLeaveRemovalPendingId:null,intakeQueue:[edited,older],
  syncIntakeSearchControls(){},hasIntakeAccess:()=>true,groupedLeaveIntakeItems:()=>[edited,older],intakeItemMatchesFilters:()=>true,
  compareIntakeActionItems:()=>0,renderIntakeDetailPanel(){},bidTypeLabel:item=>`Round ${item.round} · Leave`,
  intakeBidSummary:item=>item.summary,renderIntakeGroupDates:()=>'',renderIntakeDateCheckControl:()=>'',intakeReviewConflicts:()=>[],
  isGlLeaveItem:()=>false,intakeSubmissionLabel:item=>`Submitted ${item.submittedAt}`,intakeReviewerLabel:value=>value,
  intakeCancellationNote:()=>'',intakeReviewItemById:()=>null,
  escapeHtml:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
  dateKey:(year,month,day)=>`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,
});
vm.runInContext(['dateFromKey','dateKeyFromDate','datesBetweenKeys','formatLeaveRangeFromKeys','formatDateTime','intakeItemRound','intakeLeaveRoundIsOpen','intakeDisplayStatus','renderIntakeLeaveEditHistory','renderIntakeChangeHistory','renderIntakeQueueWithCache'].map(extract).join('\n'),context);
vm.runInContext('renderIntakeQueueWithCache()',context);
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Intaker preview · saved date edit</title><style>${css}
body{background:#eef3f8}.preview-shell{max-width:1120px;margin:0 auto;min-height:100vh;padding:36px 30px}.preview-nav{display:flex;justify-content:space-between;align-items:center;padding-bottom:22px;border-bottom:1px solid #dbe4ef;color:#172033}.preview-nav b{font-size:20px}.preview-nav span{color:#64748b;font-size:13px}.preview-heading{display:flex;justify-content:space-between;align-items:center;margin:30px 0 20px}.preview-heading h1{margin:0;font-size:28px}.preview-heading p{color:#64748b;margin:7px 0}.preview-badge{border:1px solid #cbd5e1;border-radius:20px;padding:8px 14px;font-size:12px;color:#475569;background:white}.preview-success{padding:14px 18px;border:1px solid #9bd9b6;color:#166534;background:#edf9f1;border-radius:8px;margin-bottom:20px;font-weight:700}.preview-queue{display:grid;gap:16px}.preview-note{color:#64748b;font-size:12px;margin-top:20px}.app-main.preview-shell{grid-column:auto}.preview-heading+.preview-success{font-size:14px}.intake-card.approved{opacity:1}@media(max-width:600px){.preview-shell{padding:20px 14px}.preview-heading{align-items:start;gap:12px}.preview-nav{gap:15px}.preview-badge{white-space:nowrap}.intake-card{grid-template-columns:1fr}.preview-heading h1{font-size:23px}}
</style><body><main class="app-main preview-shell"><nav class="preview-nav"><b>ZLA Bidding</b><span>Intake · JT · All Areas</span></nav><header class="preview-heading"><div><h1>Intake Queue</h1><p>Requested leave dates · Bid year 2027</p></div><span class="preview-badge">Current round: 2</span></header><div role="status" class="preview-success">✓ Bid changes saved.</div><div class="preview-queue">${target.innerHTML}</div><p class="preview-note">Preview with fictional names and dates. Queue cards and change history use the application's actual renderer. Earlier rounds are locked for intake; admins can edit across rounds.</p></main></body></html>`;
const directory=new URL('../outputs/leave-edit-preview/',import.meta.url);
await mkdir(directory,{recursive:true});await writeFile(new URL('index.html',directory),html);
console.log(new URL('index.html',directory).pathname);
