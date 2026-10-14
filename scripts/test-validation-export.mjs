import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const context = { document: { addEventListener() {} }, Blob, TextEncoder, Date };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const VALIDATION_EXPORT_AREAS'), source.indexOf('function biddingExportActionBy')), context);
vm.runInContext(source.slice(source.indexOf('function escapeXml('), source.indexOf('function downloadBlob(')), context);

const record = (area, initials, fourTen = false) => ({
  person: { area, first_name: 'Test', last_name: 'Bidder', initials, bid_role: 'CPC', seniority_rank: 1, leave_slot_allowance: 208 },
  snapshot: { assignment: { line_code: '1', four_ten: fourTen, week: ['RDO', 'D', 'D', 'D', 'D', 'D', 'RDO'] }, leave: [
    { id: `${initials}-r1`, round_number: 1, priority: 1, status: 'approved', charged_days: 11, dates: Array.from({ length: 12 }, (_, i) => ({ leave_date: `2027-06-${String(i + 1).padStart(2, '0')}`, charged: i !== 0, is_holiday: i === 0 })) },
    { id: `${initials}-r2`, round_number: 2, priority: 1, status: 'pending', dates: [{ leave_date: '2027-08-01', charged: true }] },
    { id: `${initials}-cancelled`, round_number: 1, status: 'cancelled', dates: [{ leave_date: '2027-09-01', charged: true }] },
  ] },
});
const a = record('Area A', 'AA');
const b = record('Area B', 'BB', true);
const sheets = context.validationExportSheets([a, b], ['Area A', 'Area B'], 2027, '2027-01-10', '2028-01-08', 'test');
assert.equal(sheets.length, 10);
const a1 = sheets[0];
assert.equal(a1.name, 'A Round 1');
assert.equal(a1.rows[1][8], 'R1 01');
assert.equal(a1.rows[1][19], 'R1 12', 'Overflow dates must be retained');
assert.equal(a1.rows[2][19].date, '2027-06-12');
assert.equal(a1.rows[2][21], 8);
assert.equal(a1.rows[2][22], 88, 'Website charged hours exclude the uncharged holiday');
assert.equal(sheets[4].rows[2][21], 10);
assert.equal(sheets[1].rows[2][9], '', 'Pending dates are excluded from approved round sheets');
assert.equal(sheets[1].rows[2][1].formula, "'A Round 1'!B3");
assert.equal(sheets[8].rows.length, 30, 'Date detail includes approved, pending and cancelled dates from both areas');
assert.equal(sheets[8].rows[2][10], 'Yes');
assert.ok(sheets[8].rows.some(row => row[7] === 'cancelled'));
assert.ok(!sheets[0].rows.flat().includes('BB'), 'Areas must not mix');

const missing = record('Area A', 'XX');
missing.snapshot.assignment = null;
missing.snapshot.leave[0].dates = [{ leave_date: '2026-12-01' }, { leave_date: '2026-12-01' }];
const checks = context.validationExportSheets([missing], ['Area A'], 2027, '2027-01-10', '2028-01-08', 'test')[0];
assert.equal(checks.rows[2][19], '', 'Unknown schedules must not silently assume eight hours');
assert.match(checks.rows[2].at(-1), /Missing approved line; Duplicate dates; Date outside bidding year/);

const files = context.validationWorkbookFiles(sheets);
assert.equal(files.length, 15);
assert.match(files.find(f => f.name === 'xl/workbook.xml').content, /fullCalcOnLoad="1"/);
assert.match(files.find(f => f.name === 'xl/worksheets/sheet1.xml').content, /s="2"><v>46539<\/v>/, 'Excel dates must be numeric');
assert.match(files.find(f => f.name === 'xl/worksheets/sheet1.xml').content, /<f>COUNTIFS/);
let downloaded = '';
let reads = 0;
const status = { textContent: '' };
const form = { querySelector: () => status, elements: { 'validation-area': { value: 'all' } } };
Object.assign(context, {
  BID_YEAR: 2027, BID_LEAVE_YEAR_START_KEY: '2027-01-10', BID_LEAVE_YEAR_END_KEY: '2028-01-08',
  supabaseState: { connected: true, authUserId: 'admin' }, hasIntakeAccess: () => true,
  showActionFeedback() {}, downloadBlob(filename) { downloaded = filename; },
  supabaseClient: () => ({ async rpc(name, args) {
    if (name === 'read_bidding_roster') return { data: [{ profile_id: 'a', area_name: 'Area A' }, { profile_id: 'b', area_name: 'Area B' }] };
    reads++;
    return { data: args.target_bidder_id === 'a' ? a : b };
  } }),
});
await context.downloadValidationXlsx(form);
assert.equal(downloaded, 'zla-validation-all-areas-2027.xlsx');
assert.equal(reads, 2);
form.elements['validation-area'].value = 'Area A';
reads = 0;
await context.downloadValidationXlsx(form);
assert.equal(downloaded, 'zla-validation-area-a-2027.xlsx');
assert.equal(reads, 1, 'Single-area export reads only that area');
context.supabaseState.connected = false;
downloaded = '';
await context.downloadValidationXlsx(form);
assert.equal(downloaded, '', 'No successful download when offline');
assert.match(status.textContent, /Sign in/);
if (process.env.VALIDATION_TEST_XLSX) {
  fs.writeFileSync(process.env.VALIDATION_TEST_XLSX, Buffer.from(await context.createZip(files).arrayBuffer()));
}
console.log('PASS validation export: area isolation, all areas, overflow, status filters, holidays, hours, formulas, exact dates and missing data');
