import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../bidding.js', import.meta.url), 'utf8');
const format = JSON.parse(fs.readFileSync(new URL('../public/templates/zla-validation-format.json', import.meta.url), 'utf8'));
const context = { document: { addEventListener() {} }, Blob, TextEncoder, Date, URL, window: { location: { href: 'https://example.test/dashboard' } }, fetch: async () => ({ok:true,json:async()=>format}) };
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
assert.equal(sheets.length, 11);
assert.equal(sheets[0].name, 'Area A Slots');
assert.equal(sheets[1].name, 'Area B Slots');
const findSheet = name => sheets.find(sheet => sheet.name === name);
const a1 = findSheet('A Round 1');
assert.equal(a1.name, 'A Round 1');
assert.equal(a1.rows[1][8], 'R1 01');
assert.equal(a1.rows[1][19], 'R1 12', 'Overflow dates must be retained');
assert.equal(a1.rows[2][19].date, '2027-06-12');
assert.equal(a1.rows[2][21], 8);
assert.equal(a1.rows[2][22], 'CPC');
assert.ok(!a1.rows[1].includes('Website Charged Hrs'));
assert.ok(!a1.rows[1].includes('Ghost Bid'));
assert.ok(!a1.rows[1].includes('Verified'));
assert.equal(findSheet('Date Detail').hidden, true);
assert.equal(findSheet('Date Detail').rows[1].length, 13);
assert.ok(!findSheet('Export Notes'));
assert.equal(findSheet('B Round 1').rows[2][21], 10);
assert.equal(findSheet('A Round 2').rows[2][9], '', 'Pending dates are excluded from approved round sheets');
assert.equal(findSheet('A Round 2').rows[2][1].formula, "'A Round 1'!B3");
assert.equal(findSheet('Date Detail').rows.length, 30, 'Date detail includes approved, pending and cancelled dates from both areas');
assert.equal(findSheet('Date Detail').rows[2][10], 'Yes');
assert.ok(findSheet('Date Detail').rows.some(row => row[7] === 'cancelled'));
assert.ok(!a1.rows.flat().includes('BB'), 'Areas must not mix');
assert.match(sheets[0].rows[5][1].formula, /MATCH\(H6,'A Round 1'/);
assert.match(sheets[0].rows[5][10].formula, /ROUNDUP/);
assert.match(sheets[1].rows[5][11].formula, /'B Round 1'!\$B/);
assert.equal(sheets[0].headerRow, 5);
const developer = record('Area A', 'DV');
developer.person.bid_role = 'R-DEV';
const ghost = record('Area A', 'GH');
ghost.snapshot.is_ghost_bidder = true;
const grouped = context.validationExportSheets([a, developer, ghost], ['Area A'], 2027, '2027-01-10', '2028-01-08', 'test')[0];
assert.equal(grouped.rows[5][16], 'AA');
assert.equal(grouped.rows[5][24], 'DV');
assert.ok(grouped.rows.some(row => row[18] === 'Ghost Bids (excluded from slot totals)'));
assert.ok(grouped.rows.some(row => row[24] === 'GH'));
assert.ok(!grouped.rows.some(row => row[16] === 'GH'));

const missing = record('Area A', 'XX');
missing.snapshot.assignment = null;
missing.snapshot.leave[0].dates = [{ leave_date: '2026-12-01' }, { leave_date: '2026-12-01' }];
const checks = context.validationExportSheets([missing], ['Area A'], 2027, '2027-01-10', '2028-01-08', 'test').find(sheet => sheet.name === 'A Round 1');
assert.equal(checks.rows[2][19], '', 'Unknown schedules must not silently assume eight hours');
assert.equal(checks.rows[2].at(-1), 'CPC');
const roleSheet = context.validationExportSheets([a, developer, ghost], ['Area A'], 2027, '2027-01-10', '2028-01-08', 'test').find(s => s.kind === 'round');
assert.equal(context.validationCellStyle(roleSheet,3,roleSheet.rows[1].length-1,'R-DEV'),22);
assert.equal(context.validationCellStyle(roleSheet,3,3,'Test'),4,'Developmental rows highlight only Bid As');
assert.equal(context.validationCellStyle(roleSheet,4,0,208),28,'Ghost row highlight includes numeric columns');

const files = context.validationWorkbookFiles(sheets, format);
assert.equal(files.filter(f=>f.name.startsWith('xl/tables/')).length,16);
assert.match(files.find(f=>f.name==='xl/workbook.xml').content, /name="Date Detail"[^>]*state="hidden"/);
assert.match(files.find(f=>f.name==='xl/worksheets/sheet1.xml').content, /conditionalFormatting sqref="K6"/);
assert.match(files.find(f=>f.name==='xl/worksheets/sheet1.xml').content, /MOD\(/);
assert.match(files.find(f => f.name === 'xl/workbook.xml').content, /fullCalcOnLoad="1"/);
assert.match(files.find(f => f.name === 'xl/worksheets/sheet3.xml').content, /s="2"><v>46539<\/v>/, 'Excel dates must be numeric');
assert.match(files.find(f => f.name === 'xl/worksheets/sheet3.xml').content, /<f>COUNTIFS/);
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
