// Loaded on demand; shares existing authentication and bidding state.
(() => {
// Validation uses saved exact dates, never reconstructed date ranges.
const VALIDATION_EXPORT_AREAS = ["Area A", "Area B", "Area C", "Area D", "Area E", "Area F", "TMU"];

function validationAreaSlotsSheet(area, people, rounds, detailRowCount, year) {
  const formula = text => ({ formula: text });
  const rows = Array.from({ length: 5 }, () => Array(25).fill(""));
  rows[0][0] = `${area} ${year}`;

  rows[3][10] = "CPC Slots";
  rows[3][18] = "Developmental Slots";
  const hoursHeader = ["Hrs", "R1", "R2", "R3", "R4", "Hrs Left", "Initial", "Holidays"];
  const slotsHeader = ["Slots", "R1", "R2", "R3", "R4", "Slot Left", "Initial"];
  rows[4].splice(0, 9, "#", ...hoursHeader);
  rows[4].splice(10, 7, ...slotsHeader);
  rows[4].splice(18, 7, ...slotsHeader);
  const put = (r, c, value) => {
    while (rows.length < r) rows.push(Array(25).fill(""));
    rows[r - 1][c] = value;
  };
  const ghost = record => record.snapshot.is_ghost_bidder || record.person.bid_role === "GL";
  const regular = people.filter(record => !ghost(record));
  const cpc = regular.filter(record => ["CPC", "TMC"].includes(record.person.bid_role));
  const dev = regular.filter(record => ["DEV", "R-DEV", "D-DEV"].includes(record.person.bid_role));
  // Match by initials within this area, so summary rows need not share round-sheet order.
  const lookup = (round, label, key) => {
    const sheet = rounds[round - 1];
    const initialColumn = spreadsheetColumnName(sheet.rows[1].indexOf("Ini"));
    const valueColumn = spreadsheetColumnName(sheet.rows[1].indexOf(label));
    const end = Math.max(4, sheet.rows.length);
    const value = `INDEX('${sheet.name}'!$${valueColumn}$3:$${valueColumn}$${end},MATCH(${key},'${sheet.name}'!$${initialColumn}$3:$${initialColumn}$${end},0),1)`;
    return `IF(COUNT(${value})=0,"",${value})`;
  };
  const total = (column, start, count) => count
    ? formula(`IF(COUNT(${column}${start}:${column}${start + count - 1})<${count},"n.a.",SUM(${column}${start}:${column}${start + count - 1}))`)
    : 0;
  const fillHours = (group, start, column) => {
    const initialColumn = spreadsheetColumnName(column + 6);
    group.forEach((record, index) => {
      const r = start + index;
      const key = `${initialColumn}${r}`;
      put(r, column + 6, record.person.initials);
      put(r, column, formula(lookup(1, `${year} Hrs`, key)));
      for (let round = 1; round <= 4; round++) put(r, column + round, formula(lookup(round, "Hrs", key)));
      const range = `${spreadsheetColumnName(column)}${r}:${spreadsheetColumnName(column + 4)}${r}`;
      put(r, column + 5, formula(`IF(COUNT(${range})<5,"",${spreadsheetColumnName(column)}${r}-SUM(${spreadsheetColumnName(column + 1)}${r}:${spreadsheetColumnName(column + 4)}${r}))`));
    });
    const end = start + group.length;
    for (let c = 0; c < 6; c++) put(end, column + c, total(spreadsheetColumnName(column + c), start, group.length));
    put(end, column + 6, "Total");
  };
  fillHours(regular, 6, 1);
  regular.forEach((record, index) => {
    const r = index + 6;
    put(r, 0, index + 1);
    const end = Math.max(3, detailRowCount);
    const base = `'Date Detail'!$A$3:$A$${end},"${area}",'Date Detail'!$D$3:$D$${end},H${r},'Date Detail'!$H$3:$H$${end},"approved",'Date Detail'!$J$3:$J$${end},"No"`;
    put(r, 8, formula(`COUNTIFS(${base},'Date Detail'!$K$3:$K$${end},"Yes")+COUNTIFS(${base},'Date Detail'!$K$3:$K$${end},"No",'Date Detail'!$L$3:$L$${end},"Yes")`));
  });
  put(regular.length + 6, 8, total("I", 6, regular.length));
  const fillSlots = (group, column) => {
    group.forEach((record, index) => {
      const r = index + 6;
      const key = `${spreadsheetColumnName(column + 6)}${r}`;
      put(r, column + 6, record.person.initials);
      put(r, column, formula(`IF(COUNT(${lookup(1, `${year} Hrs`, key)})=0,"",ROUNDUP((${lookup(1, `${year} Hrs`, key)})/8,0))`));
      // Round counts are the same as round hours / the saved schedule, without assuming a missing schedule.
      for (let round = 1; round <= 4; round++) put(r, column + round, formula(lookup(round, `R${round}`, key)));
      const range = `${spreadsheetColumnName(column)}${r}:${spreadsheetColumnName(column + 4)}${r}`;
      put(r, column + 5, formula(`IF(COUNT(${range})<5,"",${spreadsheetColumnName(column)}${r}-SUM(${spreadsheetColumnName(column + 1)}${r}:${spreadsheetColumnName(column + 4)}${r}))`));
    });
    for (let c = 0; c < 6; c++) put(group.length + 6, column + c, total(spreadsheetColumnName(column + c), 6, group.length));
    put(group.length + 6, column + 6, "Total");
  };
  fillSlots(cpc, 10);
  fillSlots(dev, 18);
  rows[2][10] = "CPC Total Slots:";
  rows[2][12] = formula(`K${cpc.length + 6}`);
  rows[2][14] = "Slots Left:";
  rows[2][16] = formula(`P${cpc.length + 6}`);
  rows[2][18] = "DEV Total Slots:";
  rows[2][20] = formula(`S${dev.length + 6}`);
  rows[2][22] = "Slots Left:";
  rows[2][24] = formula(`X${dev.length + 6}`);
  const ghosts = people.filter(ghost);
  const ghostTitle = dev.length + 9;
  put(ghostTitle, 18, "Ghost Bids (excluded from slot totals)");
  hoursHeader.slice(0, 7).forEach((header, index) => put(ghostTitle + 1, 18 + index, header));
  fillHours(ghosts, ghostTitle + 2, 18);
  return { name: `${area} Slots`, kind: "slots", rows, freezeColumns: 0, headerRow: 5, noFilter: true,
    counts: { regular: regular.length, cpc: cpc.length, dev: dev.length, ghosts: ghosts.length }, ghostTitle,
    extraHeaderRows: [ghostTitle + 1], mergeRanges: ["A1:Y1", "K3:L3", "O3:P3", "S3:T3", "W3:X3", "K4:Q4", "S4:Y4", `S${ghostTitle}:Y${ghostTitle}`],
    tables: [
      { ref: `A5:I${regular.length + 6}`, style: "TableStyleLight1" },
      { ref: `K5:Q${cpc.length + 6}`, style: "TableStyleMedium2" },
      { ref: `S5:Y${dev.length + 6}`, style: "TableStyleMedium2" },
      { ref: `S${ghostTitle + 1}:Y${ghostTitle + 2 + ghosts.length}`, style: "TableStyleLight1" },
    ] };
}

function validationExportSheets(records, areas, year, startKey, endKey, exportedAt) {
  const sheets = [];
  const detail = [["Area", "First", "Last", "Ini", "Round", "Priority", "Date", "Status", "Charged", "RDO", "Holiday", "In lieu", "Ghost Bid"]];
  const sorted = [...records].sort((a, b) => (a.person.seniority_rank ?? Infinity) - (b.person.seniority_rank ?? Infinity)
    || `${a.person.last_name} ${a.person.first_name}`.localeCompare(`${b.person.last_name} ${b.person.first_name}`));
  const formula = (text) => ({ formula: text });
  const excelDate = (key) => ({ date: key });
  for (const area of areas) {
    const people = sorted.filter(record => record.person.area === area);
    const prefix = area.replace("Area ", "");
    const roundDates = people.map(record => [1, 2, 3, 4].map(round => record.snapshot.leave
      .filter(row => row.round_number === round && row.status === "approved")
      .flatMap(row => (row.dates || []).filter(day => !day.is_rdo).map(day => day.leave_date)).sort()));
    for (let round = 1; round <= 4; round += 1) {
      const dateCount = Math.max(10, ...roundDates.map(dates => dates[round - 1].length));
      const dateStart = round + 7;
      const hourColumn = dateStart + dateCount;
      const scheduleColumn = hourColumn + 1;
      const header = [`${year} Hrs`, ...Array.from({ length: round }, (_, i) => `R${i + 1}`), "Hrs Left", "First", "Last", "Ini", "RDOs", "Line",
        ...Array.from({ length: dateCount }, (_, i) => `R${round} ${String((round - 1) * 10 + i + 1).padStart(2, "0")}`), "Hrs", "CWS?", "Bid As"];
      const rows = [[`${area.toUpperCase()} ROUND ${round} · ${year} · Approved dates`], header];
      people.forEach((record, index) => {
        const person = record.person;
        const snapshot = record.snapshot;
        const assignment = snapshot.assignment;
        // Ghost lines do not consume inventory, so use their approved saved selection.
        const ghostLine = snapshot.rdo?.status === "approved"
          ? record.lines?.find(line => line.id === snapshot.rdo.rdo_line_id) : null;
        const line = assignment || ghostLine;
        const hours = line ? (line.four_ten ? 10 : 8) : "";
        const dates = roundDates[index][round - 1];
        const rowNumber = index + 3;
        const dateRange = `${spreadsheetColumnName(dateStart)}${rowNumber}:${spreadsheetColumnName(hourColumn - 1)}${rowNumber}`;
        const scheduleRef = `${spreadsheetColumnName(scheduleColumn)}${rowNumber}`;
        const counts = Array.from({ length: round }, (_, i) => i + 1 === round
          ? formula(`COUNTIFS(${dateRange},">="&DATE(${startKey.split("-").map(Number).join(",")}),${dateRange},"<="&DATE(${endKey.split("-").map(Number).join(",")}))`)
          : formula(`'${prefix} Round ${i + 1}'!${spreadsheetColumnName(i + 1)}${rowNumber}`));
        const rdos = Array.isArray(line?.week) ? line.week.map((shift, day) => shift === "RDO" ? ["Su", "M", "Tu", "W", "Th", "F", "Sa"][day] : null).filter(Boolean).join("/") : line?.pattern || "";
        rows.push([person.leave_slot_allowance ?? "", ...counts,
          formula(`IF(OR(${scheduleRef}="",A${rowNumber}=""),"",A${rowNumber}-SUM(B${rowNumber}:${spreadsheetColumnName(round)}${rowNumber})*${scheduleRef})`),
          person.first_name, person.last_name, person.initials, rdos, line?.line_code || "",
          ...Array.from({ length: dateCount }, (_, i) => dates[i] ? excelDate(dates[i]) : ""),
          formula(`IF(${scheduleRef}="","",${spreadsheetColumnName(round)}${rowNumber}*${scheduleRef})`), hours,
          person.bid_role]);
      });
      sheets.push({ name: `${prefix} Round ${round}`, kind: "round", round, rows, people, freezeColumns: dateStart,
        mergeRanges: [`A1:${spreadsheetColumnName(dateStart - 1)}1`],
        tables: [{ ref: `A2:${spreadsheetColumnName(header.length - 1)}${Math.max(3, rows.length)}`, style: "TableStyleLight1" }] });
    }
    for (const record of people) {
      for (const request of record.snapshot.leave.filter(row => row.round_number >= 1 && row.round_number <= 4)) {
        const dates = request.dates || [];
        if (!dates.length) detail.push([area, record.person.first_name, record.person.last_name, record.person.initials, request.round_number, request.priority, "", request.status, "", "", "", "", request.is_ghost_bid ? "Yes" : "No"]);
        for (const day of dates) detail.push([area, record.person.first_name, record.person.last_name, record.person.initials, request.round_number, request.priority, excelDate(day.leave_date), request.status,
          day.charged ? "Yes" : "No", day.is_rdo ? "Yes" : "No", day.is_holiday ? "Yes" : "No", day.is_holiday_in_lieu ? "Yes" : "No", request.is_ghost_bid ? "Yes" : "No"]);
      }
    }
  }
  sheets.push({ name: "Date Detail", kind: "detail", hidden: true, rows: [[`Saved dates · ${year} · ${exportedAt}`], ...detail], freezeColumns: 4 });
  const slotSheets = areas.map(area => validationAreaSlotsSheet(area,
    sorted.filter(record => record.person.area === area),
    sheets.filter(sheet => sheet.name.startsWith(`${area.replace("Area ", "")} Round `)), detail.length + 1, year));
  return [...slotSheets, ...sheets];
}

function validationCellStyle(sheet, r, c, value) {
  if (sheet.kind === "detail") return r === 1 ? 14 : value?.date ? 13 : 12;
  if (sheet.kind === "round") {
    if (r === 0) return 15;
    if (r === 1) return sheet.round === 1 && c < 3 ? 26 : 1;
    const record = sheet.people[r - 2];
    const ghost = record?.snapshot.is_ghost_bidder || record?.person.bid_role === "GL";
    const role = record?.person.bid_role;
    const header = sheet.rows[1][c];
    if (ghost) return value?.date ? 18 : c <= sheet.round + 1 && sheet.round === 1 ? 28 : ["First", "Last", "Ini", "RDOs", "Line", "Hrs", "CWS?"].includes(header) ? 25 : 17;
    if (header === "Bid As") return role === "R-DEV" ? 22 : role === "D-DEV" ? 23 : 0;
    if (value?.date) return 2;
    if (["First", "Last", "Ini", "RDOs", "Line", "Hrs", "CWS?"].includes(header)) return 4;
    return sheet.round === 1 && c < 3 ? 27 : 0;
  }
  const row = r + 1;
  if (row === 1) return 21;
  if (row === 3) {
    if ([10, 18].includes(c)) return 29;
    if ([12, 20].includes(c)) return 8;
    if ([14, 22].includes(c)) return 30;
    if ([16, 24].includes(c)) return 9;
  }
  if (row === 4 && [10, 18].includes(c)) return 15;
  if (row === sheet.ghostTitle && c >= 18) return 19;
  if (row === 5 || row === sheet.ghostTitle + 1 && c >= 18) return [9, 17].includes(c) ? 3 : c >= 10 && c <= 16 ? 33 : 1;
  const blocks = [{ start: 6, count: sheet.counts.regular, first: 1, last: 8 },
    { start: 6, count: sheet.counts.cpc, first: 10, last: 16 },
    { start: 6, count: sheet.counts.dev, first: 18, last: 24 },
    { start: sheet.ghostTitle + 2, count: sheet.counts.ghosts, first: 18, last: 24 }];
  const block = blocks.find(b => row >= b.start && row <= b.start + b.count && c >= b.first && c <= b.last);
  if (!block) return 0;
  const total = row === block.start + block.count;
  const initials = c === (block.first === 1 ? 7 : block.last);
  const balance = c === block.first + 5;
  if (block.first === 10) return total ? initials ? 32 : 24 : initials ? 31 : balance ? 10 : 16;
  return total ? initials ? 6 : balance ? 11 : 7 : initials ? 4 : balance ? 10 : 0;
}

function validationWorksheetXml(sheet, format, tables) {
  const ns = "http://schemas.openxmlformats.org";
  const columns = Math.max(...sheet.rows.map(row => row.length));
  const headerRow = sheet.headerRow || 2;
  const widths = sheet.kind === "slots" ? format.slotsWidths : sheet.kind === "round" ? format.roundWidths[sheet.round - 1] : {};
  const width = c => {
    if (sheet.kind === "round") {
      const dateStart = sheet.round + 7;
      const extra = columns - (sheet.round + 20);
      if (c >= dateStart && c < columns - 3) return widths[dateStart];
      if (c >= columns - 3) return widths[c - extra] || 16;
    }
    return widths[c] || 16;
  };
  const rows = sheet.rows.map((row, r) => `<row r="${r + 1}" ht="${sheet.kind === "slots" && r < 3 ? [25, 25, 23][r] : r + 1 === headerRow && sheet.kind !== "slots" ? 32 : 22}" customHeight="1">${row.map((value, c) => {
    const ref = `${spreadsheetColumnName(c)}${r + 1}`;
    const style = validationCellStyle(sheet, r, c, value);
    if (value?.formula) return `<c r="${ref}" s="${style}"><f>${escapeXml(value.formula)}</f></c>`;
    if (value?.date) return `<c r="${ref}" s="${style}"><v>${(Date.parse(`${value.date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000}</v></c>`;
    if (typeof value === "number") return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
    if (value === "" || value == null) return `<c r="${ref}" s="${style}"/>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const rounded = sheet.kind === "slots" ? [10, 18].flatMap(column => {
    const count = column === 10 ? sheet.counts.cpc : sheet.counts.dev;
    return Array.from({ length: count }, (_, i) => {
      const r = i + 6;
      const cell = sheet.rows[r - 1][column];
      // Reuse the source lookup from the allocation formula, so highlights react to edits.
      const raw = cell.formula.slice(cell.formula.indexOf("ROUNDUP(") + 8, -4);
      return `<conditionalFormatting sqref="${spreadsheetColumnName(column)}${r}"><cfRule type="expression" dxfId="${format.roundedDxf}" priority="${i + (column === 18 ? sheet.counts.cpc : 0) + 1}"><formula>${escapeXml(`AND(ISNUMBER(${spreadsheetColumnName(column)}${r}),MOD(${raw},1)<>0)`)}</formula></cfRule></conditionalFormatting>`;
    });
  }).join("") : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0">${sheet.kind === "slots" ? "" : `<pane xSplit="${sheet.freezeColumns}" ySplit="${headerRow}" topLeftCell="${spreadsheetColumnName(sheet.freezeColumns)}${headerRow + 1}" activePane="bottomRight" state="frozen"/>`}</sheetView></sheetViews><cols>${Array.from({ length: columns }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${width(i)}" customWidth="1"/>`).join("")}</cols><sheetData>${rows}</sheetData>${sheet.kind === "detail" ? `<autoFilter ref="A2:M${sheet.rows.length}"/>` : ""}${sheet.mergeRanges?.length ? `<mergeCells count="${sheet.mergeRanges.length}">${sheet.mergeRanges.map(ref => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : ""}${rounded}${tables.length ? `<tableParts count="${tables.length}">${tables.map(t => `<tablePart r:id="table${t.id}"/>`).join("")}</tableParts>` : ""}</worksheet>`;
}

function validationWorkbookFiles(sheets, format) {
  if (format?.version !== 1) throw new Error("The validation workbook formatting template could not be loaded.");
  const ns = "http://schemas.openxmlformats.org";
  let id = 0;
  const tableGroups = sheets.map(sheet => (sheet.tables || []).map(table => ({ ...table, id: ++id })));
  const tableFiles = [];
  tableGroups.forEach((tables, index) => tables.forEach(table => {
    const [first, last] = table.ref.split(":");
    const colIndex = key => [...key.match(/[A-Z]+/)[0]].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) - 1;
    const headers = sheets[index].rows[Number(first.match(/\d+/)[0]) - 1].slice(colIndex(first), colIndex(last) + 1);
    tableFiles.push({ name: `xl/tables/table${table.id}.xml`, content: `<table xmlns="${ns}/spreadsheetml/2006/main" id="${table.id}" name="ValidationTable${table.id}" displayName="ValidationTable${table.id}" ref="${table.ref}" totalsRowShown="0"><autoFilter ref="${table.ref}"/><tableColumns count="${headers.length}">${headers.map((header, i) => `<tableColumn id="${i + 1}" name="${escapeXml(header)}"/>`).join("")}</tableColumns><tableStyleInfo name="${table.style}" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>` });
  }));
  return [
    { name: "[Content_Types].xml", content: `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}${tableFiles.map(t => `<Override PartName="/${t.name}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", content: `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"${sheet.hidden ? ' state="hidden"' : ''}/>`).join("")}</sheets><calcPr calcId="0" fullCalcOnLoad="1"/></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<Relationships xmlns="${ns}/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="styles" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="theme" Type="${ns}/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: format.styles }, { name: "xl/theme/theme1.xml", content: format.theme },
    ...sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: validationWorksheetXml(sheet, format, tableGroups[i]) })),
    ...tableGroups.flatMap((tables, i) => tables.length ? [{ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, content: `<Relationships xmlns="${ns}/package/2006/relationships">${tables.map(t => `<Relationship Id="table${t.id}" Type="${ns}/officeDocument/2006/relationships/table" Target="../tables/table${t.id}.xml"/>`).join("")}</Relationships>` }] : []),
    ...tableFiles,
  ];
}

async function downloadValidationXlsx(form) {
  const status = form.querySelector("[data-validation-export-status]");
  try {
    const client = supabaseClient();
    if (!client || !supabaseState.connected || !hasIntakeAccess()) throw new Error("Sign in with intake or administrator access before exporting validation data.");
    const selected = form.elements["validation-area"].value;
    const areas = selected === "all" ? VALIDATION_EXPORT_AREAS : VALIDATION_EXPORT_AREAS.filter(area => area === selected);
    if (!areas.length) throw new Error("Choose a valid area.");
    const year = BID_YEAR;
    const userId = supabaseState.authUserId;
    const start = BID_LEAVE_YEAR_START_KEY;
    const end = BID_LEAVE_YEAR_END_KEY;
    const formattingResponse = await fetch(new URL("./templates/zla-validation-format.json", window.location.href));
    if (!formattingResponse.ok) throw new Error("The validation formatting template could not be loaded. Refresh and try again.");
    const format = await formattingResponse.json();
    const { data: roster, error } = await client.rpc("read_bidding_roster");
    if (error) throw error;
    const people = (roster || []).filter(person => person.active !== false && person.bid_role !== "ADM" && areas.includes(person.area_name));
    if (!people.length) throw new Error("No active bidders are available in the selected area(s).");
    const records = [];
    for (let i = 0; i < people.length; i += 5) {
      status.textContent = `Reading saved bids: ${i} of ${people.length} bidders…`;
      const results = await Promise.all(people.slice(i, i + 5).map(async person => {
        const { data, error: readError } = await client.rpc("read_admin_bidder_editor", { requested_bid_year: year, target_bidder_id: person.profile_id });
        if (readError) throw readError;
        if (!data?.person || !Array.isArray(data.snapshot?.leave)) throw new Error("Saved bidding details are incomplete. Try refreshing and exporting again.");
        if (data.snapshot.leave.some(row => row.status === "approved" && row.round_number >= 1 && row.round_number <= 4 && !row.dates?.length)) throw new Error(`${person.initials}: an approved bid has no saved exact dates. Correct the bid before exporting.`);
        return data;
      }));
      records.push(...results);
    }
    // GL and ghost bids have no inventory assignment. Their editor line summaries
    // contain only the pattern, which can omit the third CWS RDO.
    const unassigned = records.filter(record => !record.snapshot.assignment && record.snapshot.rdo?.status === "approved");
    const lineIds = [...new Set(unassigned.map(record => record.snapshot.rdo.rdo_line_id).filter(Boolean))];
    if (lineIds.length) {
      const { data: schedules, error: scheduleError } = await client.from("rdo_lines")
        .select("id,rdo_line_days(weekday,shift_code)").in("id", lineIds);
      if (scheduleError) throw scheduleError;
      const weeks = new Map((schedules || []).map(line => [line.id, line.rdo_line_days || []]));
      for (const record of unassigned) {
        const line = record.lines?.find(line => line.id === record.snapshot.rdo.rdo_line_id);
        const days = weeks.get(record.snapshot.rdo.rdo_line_id);
        if (!line || days?.length !== 7 || new Set(days.map(day => day.weekday)).size !== 7
          || days.some(day => !Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6)) {
          throw new Error(`${record.person.initials}: the selected RDO schedule is incomplete. Refresh and export again.`);
        }
        line.week = Array.from({ length: 7 }, (_, weekday) => days.find(day => day.weekday === weekday).shift_code);
      }
    }
    if (BID_YEAR !== year || userId !== supabaseState.authUserId || !hasIntakeAccess()) throw new Error("Your bidding year or session changed. Export again.");
    const sheets = validationExportSheets(records, areas, year, start, end, new Date().toISOString());
    downloadBlob(`zla-validation-${selected === "all" ? "all-areas" : selected.toLowerCase().replace(/ /g, "-")}-${year}.xlsx`, createZip(validationWorkbookFiles(sheets, format)));
    status.textContent = `Exported ${people.length} bidders for ${year}. Rounded slot allocations are highlighted. Date Detail is included as a hidden sheet.`;
  } catch (error) {
    status.textContent = error.message || "Validation data could not be exported.";
    showActionFeedback(status.textContent, "error");
  }
}



function biddingExportActionBy(item) {
  if (item.status === "Approved") return item.approvedBy || "";
  if (item.status === "Denied") return item.deniedBy || "";
  return item.submittedBy || item.enteredBy || "";
}

function biddingExportRows() {
  const rows = [
    ["Dataset", "Area", "Name", "Initials", "Bid As", "Status", "Detail", "Action by", "Timestamp"],
  ];

  intakeQueue.forEach((item) => {
    rows.push([
      bidTypeLabel(item),
      item.area,
      item.name,
      item.initials,
      item.bidAs,
      item.status,
      intakeBidSummary(item),
      biddingExportActionBy(item),
      item.approvedAt || item.deniedAt || item.submittedAt || "",
    ]);
  });

  rdoLines.forEach((line) => {
    rows.push([
      "RDO Line",
      "Area A",
      "",
      line.cpc || "",
      "",
      line.status,
      `Line ${line.line} · ${line.pattern} · ${line.week.join(" / ")} · Group ${line.group || "Unselected"} · Flex ${line.flex || "—"} · AWS ${line.aws || "—"} · Mid ${line.mid || "—"}`,
      "",
      "",
    ]);
  });

  leaveBids.forEach((bid) => {
    rows.push([
      bid.ghostBid ? "Ghost Leave" : isGlLeaveItem(bid) ? "GL Bid" : "Leave Queue",
      currentUser.area,
      userFullName(),
      currentUser.initials,
      currentUserBidAs(),
      bid.status,
      `${bid.ghostBid ? "Ghost Leave · " : isGlLeaveItem(bid) ? "GL Bid · " : ""}Priority ${bid.priority} · ${bid.range} · ${bid.days} ${bid.days === 1 ? "day" : "days"}`,
      biddingExportActionBy(bid),
      bid.approvedAt || bid.deniedAt || bid.submittedAt || "",
    ]);
  });

  seniority.forEach((person) => {
    rows.push([
      "Bid Times",
      person.area || currentViewArea(),
      `${person.firstName} ${person.lastName}`,
      person.initials,
      person.bidAs,
      personMatchesCurrentUser(person) ? "Current User" : "",
      `Seniority #${person.rank} · R1 ${person.rounds[0]} · R2 ${person.rounds[1]} · R3 ${person.rounds[2]} · R4 ${person.rounds[3]}`,
      "",
      "",
    ]);
  });

  intakeSchedules.forEach((schedule) => {
    rows.push([
      "Intake Schedule",
      schedule.area,
      schedule.name,
      schedule.initials,
      "",
      "Scheduled",
      formatDateRange(schedule.start, schedule.end),
      "",
      formatDateTime(schedule.start),
    ]);
  });

  helpThreads.forEach((thread) => {
    thread.messages.forEach((message) => {
      rows.push([
        "Help Message",
        thread.area,
        thread.requester,
        thread.initials,
        "",
        thread.status,
        `${message.role}: ${message.body}`,
        message.author,
        message.time,
      ]);
    });
  });

  history.forEach((item) => {
    rows.push([
      "History",
      item.area,
      "",
      item.actor,
      "",
      item.title,
      item.detail,
      item.actor,
      item.time,
    ]);
  });

  prototypeEmails.forEach((email) => {
    rows.push([
      "Email",
      "",
      email.to,
      "",
      "",
      email.subject,
      email.body,
      currentUser.initials,
      email.time,
    ]);
  });

  return rows;
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

function downloadTextFile(filename, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadBiddingCsv() {
  downloadTextFile(`natca-zla-bidding-${BID_YEAR}.csv`, "text/csv;charset=utf-8", rowsToCsv(biddingExportRows()));
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function spreadsheetColumnName(index) {
  let name = "";
  let cursor = index + 1;
  while (cursor > 0) {
    const remainder = (cursor - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    cursor = Math.floor((cursor - 1) / 26);
  }
  return name;
}

function worksheetXml(rows) {
  const rowXml = rows.map((row, rowIndex) => `
    <row r="${rowIndex + 1}">
      ${row.map((cell, columnIndex) => {
        const ref = `${spreadsheetColumnName(columnIndex)}${rowIndex + 1}`;
        return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
      }).join("")}
    </row>
  `).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <sheetData>${rowXml}</sheetData>
  </worksheet>`;
}

function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ -1) >>> 0;
}

function dosTimestamp(date = new Date()) {
  const time = (
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2)
  );
  const day = (
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate()
  );
  return { time, day };
}

function pushUint16(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushUint32(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, day } = dosTimestamp();

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    const checksum = crc32(dataBytes);
    const local = [];

    pushUint32(local, 0x04034b50);
    pushUint16(local, 20);
    pushUint16(local, 0);
    pushUint16(local, 0);
    pushUint16(local, time);
    pushUint16(local, day);
    pushUint32(local, checksum);
    pushUint32(local, dataBytes.length);
    pushUint32(local, dataBytes.length);
    pushUint16(local, nameBytes.length);
    pushUint16(local, 0);
    localParts.push(new Uint8Array(local), nameBytes, dataBytes);

    const central = [];
    pushUint32(central, 0x02014b50);
    pushUint16(central, 20);
    pushUint16(central, 20);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, time);
    pushUint16(central, day);
    pushUint32(central, checksum);
    pushUint32(central, dataBytes.length);
    pushUint32(central, dataBytes.length);
    pushUint16(central, nameBytes.length);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint16(central, 0);
    pushUint32(central, 0);
    pushUint32(central, offset);
    centralParts.push(new Uint8Array(central), nameBytes);

    offset += local.length + nameBytes.length + dataBytes.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = [];
  pushUint32(end, 0x06054b50);
  pushUint16(end, 0);
  pushUint16(end, 0);
  pushUint16(end, files.length);
  pushUint16(end, files.length);
  pushUint32(end, centralSize);
  pushUint32(end, offset);
  pushUint16(end, 0);

  return new Blob([...localParts, ...centralParts, new Uint8Array(end)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadBiddingXlsx() {
  const rows = biddingExportRows();
  const files = [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      </Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets>
          <sheet name="Bidding Data" sheetId="1" r:id="rId1"/>
        </sheets>
      </workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      </Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: worksheetXml(rows),
    },
  ];

  downloadBlob(`natca-zla-bidding-${BID_YEAR}.xlsx`, createZip(files));
}


async function exportSeniorityRoster() {
  if (!hasSystemAdminAccess()) return;
  const button = document.querySelector("[data-export-seniority-roster]");
  const area = selectedRosterArea();
  if (button) button.disabled = true;
  setRosterStatus(`Preparing the ${area} seniority roster…`);

  try {
    const client = supabaseClient();
    if (!client) throw new Error("Supabase is not configured on this page.");
    const { data, error } = await client.auth.getSession();
    if (error || !data.session?.access_token) throw new Error("Sign in with a Supabase admin account before exporting.");

    const response = await fetch(`/api/admin/roster/export?area=${encodeURIComponent(area)}`, {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "The seniority roster could not be exported.");
    }

    const disposition = response.headers.get("content-disposition") || "";
    const filename = disposition.match(/filename="([^"]+)"/i)?.[1] || `zla-seniority-roster-${area.toLowerCase().replace(/\s+/g, "-")}.xlsx`;
    downloadBlob(filename, await response.blob());
    setRosterStatus(`${area} exported in the seniority import template.`, "success");
  } catch (error) {
    setRosterStatus(error.message || "The seniority roster could not be exported.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function exportBidTimes(form) {
  if (!hasSystemAdminAccess()) return;
  const button = form.querySelector("[data-export-bid-times]");
  const status = form.querySelector("[data-bid-time-export-status]");
  const areas = Array.from(form.querySelectorAll('[name="export-area"]:checked'), input => input.value);
  if (!areas.length) {
    status.textContent = "Choose at least one area to export.";
    showActionFeedback(status.textContent, "error");
    return;
  }
  button.disabled = true;
  status.textContent = `Preparing ${BID_YEAR} bid times…`;
  showActionFeedback(status.textContent, "info");
  try {
    const client = supabaseClient();
    if (!client) throw new Error("Supabase is not configured on this page.");
    const { data, error } = await client.auth.getSession();
    if (error || !data.session?.access_token) throw new Error("Sign in with an admin account before exporting.");
    const params = new URLSearchParams({ year: String(BID_YEAR) });
    // Keep the selection in one value: URL intermediaries can collapse repeated keys.
    params.set("area", areas.join(","));
    const response = await fetch(`/api/admin/bid-times/export?${params}`, {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "The bid times could not be exported.");
    }
    downloadBlob(`zla-bid-times-${BID_YEAR}.xlsx`, await response.blob());
    status.textContent = `Exported ${BID_YEAR} bid times for ${areas.join(", ")}.`;
    showActionFeedback(status.textContent, "success");
  } catch (error) {
    status.textContent = error.message || "The bid times could not be exported.";
    showActionFeedback(status.textContent, "error");
  } finally {
    button.disabled = false;
  }
}

window.NATCA_BIDDING_EXPORTS = { downloadValidationXlsx, downloadBiddingXlsx, downloadBiddingCsv, exportSeniorityRoster, exportBidTimes };
})();
