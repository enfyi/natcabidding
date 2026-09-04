const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BID_YEAR = 2027;
const ANNUAL_LEAVE_ALLOWANCE_DAYS = 36;
const LEAVE_SLOT_HOURS_PER_DAY = 8;
const CWS_LEAVE_HOURS_PER_DAY = 10;
const DEFAULT_BUE_LEAVE_SLOT_ALLOWANCE = ANNUAL_LEAVE_ALLOWANCE_DAYS * LEAVE_SLOT_HOURS_PER_DAY;
const FATIGUE_GROUP_ROTATION = ["C", "A", "B"];
const BID_LEAVE_YEAR_START_KEY = dateKey(BID_YEAR, 1, 10);
const FATIGUE_WEEK_ANCHOR_UTC = Date.UTC(BID_YEAR, 0, 10);
const WEEK_IN_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const ROUND_VALIDATION_DURATION_MS = 60 * 60 * 60 * 1000;
const BID_LEAVE_YEAR_END_KEY = dateKey(BID_YEAR + 1, 1, 8);
const DEFAULT_ROUND_RULES = {
  1: {
    label: "1 or 2 weeks",
    detail: "Leave may include up to 2 bid weeks.",
  },
  2: {
    label: "10 days",
    detail: "Leave may include up to 10 charged days.",
  },
  3: {
    label: "10 days",
    detail: "Leave may include up to 10 charged days.",
  },
  4: {
    label: "5 days",
    detail: "Leave may include up to 5 charged days.",
  },
  5: {
    label: "5 days",
    detail: "Leave may include up to 5 charged days.",
  },
  6: {
    label: "5 days",
    detail: "Leave may include up to 5 charged days.",
  },
};
const DEFAULT_APPROVAL_RULES = [
  "Approve applies the BUE initials automatically.",
  "Filled leave days require an explicit override before approval.",
  "Overrides require an intake user and are logged.",
  "GL bidders do not populate public floor templates.",
  "Developmentals bid against developmental slots.",
  "BUEs may not bid before the start of their Bid Window.",
  "BUEs may bid after their window has closed when bidding during Intake Hours: 7a-7p Monday-Sunday, excluding holidays.",
  "Once the round is closed, BUEs may not make bids or adjustments for that round.",
  "BUEs may not make changes once they have bid and their window is closed. Changes are only allowed during the change period.",
];
const APPROVAL_RULES_STORAGE_KEY = "natca-zla-approval-rules";
const ROUND_RULES_STORAGE_KEY = "natca-zla-round-rules";
const BID_WINDOW_LOCK_STORAGE_KEY = "natca-zla-enforce-bid-windows";
const BID_WINDOW_TEST_ROUND_STORAGE_KEY = "natca-zla-test-bid-round";
const LEAVE_SLOT_CAPACITY_STORAGE_KEY = "natca-zla-leave-slot-capacities";

function storedJsonValue(key, fallback) {
  try {
    const raw = window.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function storeJsonValue(key, value) {
  try {
    window.localStorage?.setItem(key, JSON.stringify(value));
  } catch (_error) {
    // Prototype-only persistence can safely no-op when storage is unavailable.
  }
}

const storedApprovalRules = storedJsonValue(APPROVAL_RULES_STORAGE_KEY, null);
const storedRoundRules = storedJsonValue(ROUND_RULES_STORAGE_KEY, null);
let roundRules = {
  ...DEFAULT_ROUND_RULES,
  ...(storedRoundRules && typeof storedRoundRules === "object" ? storedRoundRules : {}),
};
let approvalRules = Array.isArray(storedApprovalRules) ? storedApprovalRules : [...DEFAULT_APPROVAL_RULES];
let enforceBidWindows = storedJsonValue(BID_WINDOW_LOCK_STORAGE_KEY, true) !== false;
let bidWindowTestRound = normalizeBidWindowTestRound(storedJsonValue(BID_WINDOW_TEST_ROUND_STORAGE_KEY, null));
let bidWindowSettingsFallbackMessage = "";
const storedLeaveSlotCapacities = storedJsonValue(LEAVE_SLOT_CAPACITY_STORAGE_KEY, {});
let leaveSlotCapacityOverrides = storedLeaveSlotCapacities && typeof storedLeaveSlotCapacities === "object"
  ? storedLeaveSlotCapacities
  : {};
const now = Date.now();
const testAccounts = {
  bue: {
    firstName: "Michael",
    lastName: "Schoelen",
    initials: "OC",
    seniorityRank: 5,
    bidderCount: 45,
    area: "Area A",
    role: "controller",
    roleLabel: "BUE Controller",
    systemAdmin: true,
    phone: "(626) 392-1194",
    email: "m.schoelen@yahoo.com",
    leaveSlotAllowance: DEFAULT_BUE_LEAVE_SLOT_ALLOWANCE,
    adminGrant: {
      type: "Bidding Intake",
      scope: "All Areas",
      start: new Date(now - 60 * 60 * 1000),
      end: new Date(now + 4 * 60 * 60 * 1000),
      grantedBy: "NATCA ZLA Bidding Chair",
    },
  },
};

let currentUser = { ...testAccounts.bue };
let selectedViewArea = null;
let seniorityViewMode = "cards";
let alertAudioContext = null;
let lastAudibleAlertCount = null;
let leaveDraftQueue = [];
let leaveRangeStartKey = "2027-04-08";
let leaveRangeEndKey = "2027-04-09";
let leaveRangeSelectionComplete = true;
let leaveRangePreviewActive = false;
let leavePickerOpen = false;
let leavePickerYear = 2027;
let leavePickerMonthIndex = 3;
const prototypeEmails = [];
const INTAKE_SCHEDULE_AREA = "All Areas";
const intakeTeamInitials = new Set(["OC"]);

const intakeSchedules = [
  {
    id: "sched-oc-1",
    initials: "OC",
    name: "Michael Schoelen",
    area: INTAKE_SCHEDULE_AREA,
    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
    end: new Date(Date.now() + 26 * 60 * 60 * 1000),
  },
  {
    id: "sched-oc-2",
    initials: "OC",
    name: "Michael Schoelen",
    area: INTAKE_SCHEDULE_AREA,
    start: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000),
    end: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000),
  },
];

function activeBidderRank(date = new Date(), area = currentViewArea()) {
  const roundState = areaBidRoundState(date, area);
  if (roundState?.phase === "open") return roundState.activeRank;
  return null;
}

const holidayOverrides = new Set();

const fullLeaveDates = new Set([
  "2027-02-10",
  "2027-02-11",
  "2027-02-12",
  "2027-06-10",
  "2027-07-07",
  "2027-09-03",
  "2027-11-24",
  "2027-11-25",
  "2027-12-27",
]);

const leaveSlotCapacity = {
  cpc: 3,
  dev: 2,
};

const selectedWeek = [
  ["Sun", "630"],
  ["Mon", "600"],
  ["Tue", "RDO"],
  ["Wed", "RDO"],
  ["Thu", "1430"],
  ["Fri", "1300"],
  ["Sat", "700"],
];

const mockRdoWeekTemplates = {
  "S/S": [
    ["RDO", "M1300", "M1100", "RDO", "M2100", "M2100", "RDO"],
    ["RDO", "1500", "1330", "730", "630", "600", "RDO"],
    ["RDO", "1430", "1330", "1200", "700", "630", "RDO"],
    ["RDO", "1330", "730", "630", "630", "630", "RDO"],
  ],
  "S/M": [
    ["RDO", "RDO", "1500", "1330", "730", "630", "600"],
    ["RDO", "RDO", "1430", "1330", "1200", "700", "630"],
    ["RDO", "RDO", "1430", "M1300", "730", "S530", "2230"],
    ["RDO", "RDO", "M1100", "M1100", "RDO", "M2130", "M2130"],
  ],
  "M/T": [
    ["600", "RDO", "RDO", "1500", "1330", "730", "630"],
    ["630", "RDO", "RDO", "1430", "1330", "1200", "630"],
    ["M2130", "RDO", "RDO", "M1100", "M700", "RDO", "M2130"],
    ["700", "RDO", "RDO", "1500", "1330", "730", "630"],
  ],
  "T/W": [
    ["630", "600", "RDO", "RDO", "1500", "1330", "730"],
    ["700", "630", "RDO", "RDO", "1430", "1330", "730"],
    ["M2130", "M2130", "RDO", "RDO", "M1100", "M700", "RDO"],
    ["S530", "2230", "RDO", "RDO", "1430", "M1300", "730"],
  ],
  "W/T": [
    ["730", "630", "600", "RDO", "RDO", "1500", "1330"],
    ["700", "S530", "2230", "RDO", "RDO", "1430", "M1230"],
    ["M2130", "M2130", "RDO", "RDO", "M1100", "M1100", "RDO"],
    ["1500", "1330", "730", "RDO", "RDO", "1500", "1330"],
  ],
  "T/F": [
    ["1330", "730", "630", "600", "RDO", "RDO", "1430"],
    ["1330", "730", "630", "630", "RDO", "RDO", "1500"],
    ["M700", "RDO", "M2130", "M2130", "RDO", "RDO", "M1100"],
    ["M1200", "730", "S530", "2230", "RDO", "RDO", "1330"],
  ],
  "F/S": [
    ["1430", "1330", "730", "630", "600", "RDO", "RDO"],
    ["1500", "1330", "730", "700", "645", "RDO", "RDO"],
    ["M1100", "M1100", "RDO", "M2130", "M2130", "RDO", "RDO"],
    ["1330", "1330", "730", "630", "630", "RDO", "RDO"],
  ],
  "R-DEV": [
    ["RDO", "1500", "1330", "730", "630", "600", "RDO"],
    ["RDO", "RDO", "1500", "1330", "730", "630", "600"],
    ["600", "RDO", "RDO", "1500", "1330", "730", "630"],
    ["730", "630", "600", "RDO", "RDO", "1500", "1330"],
    ["1330", "730", "630", "600", "RDO", "RDO", "1500"],
    ["1500", "1330", "730", "630", "600", "RDO", "RDO"],
  ],
  "D-DEV": [
    ["RDO", "1330", "1330", "730", "630", "630", "RDO"],
    ["RDO", "RDO", "1330", "1330", "730", "630", "630"],
    ["630", "RDO", "RDO", "1330", "1330", "730", "630"],
    ["630", "630", "RDO", "RDO", "1330", "1330", "730"],
    ["1330", "730", "630", "630", "RDO", "RDO", "1330"],
    ["1330", "1330", "730", "630", "630", "RDO", "RDO"],
  ],
};

function mockRdoLine(area, row, templateIndex) {
  const [pattern, line, cpc, group, mid = "No", aws = "No", overrides = {}] = row;
  const templates = mockRdoWeekTemplates[pattern] || mockRdoWeekTemplates["S/S"];
  const week = overrides.week || templates[templateIndex % templates.length];
  const fourTen = overrides.fourTen || (week.filter((value) => value !== "RDO").length === 4 ? "Yes" : "No");

  return {
    area,
    pattern,
    line,
    ...(pattern.includes("DEV") ? { lineType: "DEV" } : {}),
    cpc,
    week: [...week],
    group,
    mid,
    aws,
    fourTen,
    flex: overrides.flex || aws,
    status: "Open",
  };
}

function mockRdoLines(area, rows) {
  const templateCounts = {};
  return rows.map((row) => {
    const pattern = row[0];
    const templateIndex = templateCounts[pattern] || 0;
    templateCounts[pattern] = templateIndex + 1;
    return mockRdoLine(area, row, templateIndex);
  });
}

const rdoLines = [
  { area: "Area A", pattern: "S/S", line: "1", cpc: "", week: ["RDO", "M1300", "M1100", "RDO", "M2100", "M2100", "RDO"], group: "A", mid: "", aws: "", fourTen: "Yes", flex: "", status: "Open" },
  { area: "Area A", pattern: "S/S", line: "2", cpc: "", week: ["RDO", "1330", "1300", "700", "630", "600", "RDO"], group: "C", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "S/S", line: "3", cpc: "", week: ["RDO", "1430", "1330", "730", "630", "600", "RDO"], group: "B", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "S/S", line: "G1", cpc: "", week: ["RDO", "1430", "1330", "730", "630", "600", "RDO"], group: "C only", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "S/S", line: "4", cpc: "", week: ["RDO", "1430", "1330", "730", "630", "600", "RDO"], group: "B", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "S/S", line: "5", cpc: "", week: ["RDO", "1500", "1330", "1200", "700", "600", "RDO"], group: "C", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "S/M", line: "6", cpc: "", week: ["RDO", "RDO", "M1300", "M1100", "RDO", "M2100", "M2100"], group: "B", mid: "", aws: "", fourTen: "Yes", flex: "", status: "Open" },
  { area: "Area A", pattern: "S/M", line: "7", cpc: "", week: ["RDO", "RDO", "1430", "1300", "700", "630", "600"], group: "C", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "S/M", line: "8", cpc: "", week: ["RDO", "RDO", "1500", "1330", "730", "630", "600"], group: "A", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "S/M", line: "9", cpc: "", week: ["RDO", "RDO", "1500", "1330", "1200", "630", "600"], group: "A", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "M/T", line: "10", cpc: "", week: ["600", "RDO", "RDO", "1430", "1300", "700", "630"], group: "A", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "M/T", line: "11", cpc: "", week: ["600", "RDO", "RDO", "1430", "1300", "700", "630"], group: "C", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "M/T", line: "12", cpc: "", week: ["600", "RDO", "RDO", "1500", "1330", "730", "630"], group: "B", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "M/T", line: "13", cpc: "", week: ["600", "RDO", "RDO", "1500", "1330", "1200", "700"], group: "A", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "T/W", line: "14", cpc: "", week: ["M2100", "M2100", "RDO", "RDO", "M1300", "M1100", "RDO"], group: "A", mid: "", aws: "", fourTen: "Yes", flex: "", status: "Open" },
  { area: "Area A", pattern: "T/W", line: "15", cpc: "", week: ["630", "600", "RDO", "RDO", "1430", "1300", "700"], group: "C", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "T/W", line: "16", cpc: "", week: ["630", "600", "RDO", "RDO", "1430", "1330", "730"], group: "C", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "T/W", line: "17", cpc: "", week: ["700", "600", "RDO", "RDO", "1500", "1330", "730"], group: "B", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "W/T", line: "18", cpc: "", week: ["700", "S530", "2230", "RDO", "RDO", "N1330", "1300"], group: "B", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "W/T", line: "19", cpc: "", week: ["700", "630", "600", "RDO", "RDO", "1430", "1300"], group: "A", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "W/T", line: "20", cpc: "", week: ["730", "630", "600", "RDO", "RDO", "1500", "1330"], group: "A", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "W/T", line: "21", cpc: "", week: ["1200", "630", "630", "RDO", "RDO", "1500", "1330"], group: "C", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "T/F", line: "22", cpc: "", week: ["1300", "700", "S530", "2230", "RDO", "RDO", "N1330"], group: "C", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "T/F", line: "23", cpc: "", week: ["1300", "700", "S530", "2230", "RDO", "RDO", "N1330"], group: "A", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "T/F", line: "24", cpc: "", week: ["1330", "730", "630", "600", "RDO", "RDO", "1500"], group: "B", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "T/F", line: "25", cpc: "", week: ["1330", "730", "630", "600", "RDO", "RDO", "1500"], group: "B", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "T/F", line: "26", cpc: "", week: ["M2100", "M2100", "M2100", "RDO", "RDO", "RDO", "M2100"], group: "C", mid: "", aws: "", fourTen: "Yes", flex: "", status: "Open" },
  { area: "Area A", pattern: "F/S", line: "27", cpc: "", week: ["N1330", "1300", "700", "S530", "2230", "RDO", "RDO"], group: "C", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "F/S", line: "28", cpc: "", week: ["1430", "1300", "700", "600", "600", "RDO", "RDO"], group: "A", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "F/S", line: "29", cpc: "", week: ["1500", "1300", "700", "630", "600", "RDO", "RDO"], group: "B", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "F/S", line: "30", cpc: "", week: ["1500", "1330", "730", "630", "600", "RDO", "RDO"], group: "B", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "F/S", line: "31", cpc: "", week: ["1500", "1330", "1200", "630", "600", "RDO", "RDO"], group: "C", mid: "", aws: "", fourTen: "No", flex: "", status: "Open" },
  { area: "Area A", pattern: "R-DEV", line: "32", cpc: "", week: ["RDO", "1430", "1300", "700", "615", "600", "RDO"], group: "A", mid: "", aws: "", fourTen: "No", flex: "", status: "Open", lineType: "DEV" },
  { area: "Area A", pattern: "R-DEV", line: "33", cpc: "", week: ["RDO", "RDO", "1430", "1300", "700", "615", "600"], group: "C only", mid: "", aws: "", fourTen: "No", flex: "", status: "Open", lineType: "DEV" },
  { area: "Area A", pattern: "R-DEV", line: "34", cpc: "", week: ["600", "RDO", "RDO", "1430", "1300", "700", "615"], group: "B", mid: "", aws: "", fourTen: "No", flex: "", status: "Open", lineType: "DEV" },
  { area: "Area A", pattern: "R-DEV", line: "35", cpc: "", week: ["615", "600", "RDO", "RDO", "1430", "1300", "700"], group: "B only", mid: "", aws: "", fourTen: "No", flex: "", status: "Open", lineType: "DEV" },
  { area: "Area A", pattern: "R-DEV", line: "36", cpc: "", week: ["700", "615", "600", "RDO", "RDO", "1430", "1300"], group: "C only", mid: "", aws: "", fourTen: "No", flex: "", status: "Open", lineType: "DEV" },
  { area: "Area A", pattern: "R-DEV", line: "37", cpc: "", week: ["1300", "700", "615", "600", "RDO", "RDO", "1430"], group: "A", mid: "", aws: "", fourTen: "No", flex: "", status: "Open", lineType: "DEV" },
  { area: "Area A", pattern: "R-DEV", line: "38", cpc: "", week: ["1430", "1300", "700", "615", "600", "RDO", "RDO"], group: "A", mid: "", aws: "", fourTen: "No", flex: "", status: "Open", lineType: "DEV" },
  { area: "Area A", pattern: "D-DEV", line: "39", cpc: "", week: ["RDO", "1430", "1300", "700", "615", "600", "RDO"], group: "B", mid: "", aws: "", fourTen: "No", flex: "", status: "Open", lineType: "DEV" },
  { area: "Area A", pattern: "D-DEV", line: "40", cpc: "", week: ["RDO", "RDO", "1430", "1300", "700", "615", "600"], group: "C", mid: "", aws: "", fourTen: "No", flex: "", status: "Open", lineType: "DEV" },
  { area: "Area A", pattern: "D-DEV", line: "41", cpc: "", week: ["600", "RDO", "RDO", "1430", "1300", "700", "615"], group: "C", mid: "", aws: "", fourTen: "No", flex: "", status: "Open", lineType: "DEV" },
  { area: "Area A", pattern: "D-DEV", line: "42", cpc: "", week: ["615", "600", "RDO", "RDO", "1430", "1300", "700"], group: "Unassigned", mid: "", aws: "", fourTen: "No", flex: "", status: "Open", lineType: "DEV" },
  { area: "Area A", pattern: "D-DEV", line: "43", cpc: "", week: ["700", "615", "600", "RDO", "RDO", "1430", "1300"], group: "B", mid: "", aws: "", fourTen: "No", flex: "", status: "Open", lineType: "DEV" },
  { area: "Area A", pattern: "D-DEV", line: "44", cpc: "", week: ["1300", "700", "615", "600", "RDO", "RDO", "1430"], group: "C", mid: "", aws: "", fourTen: "No", flex: "", status: "Open", lineType: "DEV" },
  { area: "Area A", pattern: "D-DEV", line: "45", cpc: "", week: ["1430", "1300", "700", "615", "600", "RDO", "RDO"], group: "A", mid: "", aws: "", fourTen: "No", flex: "", status: "Open", lineType: "DEV" },
  ...mockRdoLines("Area B", [
    ["S/S", "1", "VL", "A", "No", "Yes", { fourTen: "Yes" }],
    ["S/S", "2", "BW", "C", "No", "No"],
    ["S/S", "3", "MM", "C", "No", "No"],
    ["S/S", "4", "TT", "B", "No", "Yes"],
    ["S/S", "5", "PE", "B", "No", "No"],
    ["S/M", "6", "LJ", "C", "No", "Yes", { fourTen: "Yes" }],
    ["S/M", "7", "XL", "A", "No", "No"],
    ["S/M", "8", "KR", "C", "No", "Yes"],
    ["S/M", "9", "JX", "B", "No", "No"],
    ["S/M", "10", "MX", "A", "No", "No"],
    ["M/T", "11", "YP", "A", "No", "No"],
    ["M/T", "12", "AJ", "C", "No", "Yes"],
    ["M/T", "13", "HZ", "B", "No", "Yes"],
    ["T/W", "14", "B2", "A", "No", "Yes"],
    ["T/W", "15", "DD", "B", "No", "No"],
    ["T/W", "16", "CX", "C", "No", "No"],
    ["T/W", "17", "DE", "A", "No", "No"],
    ["W/T", "18", "ZN", "B", "No", "No"],
    ["W/T", "19", "WS", "A", "No", "No"],
    ["W/T", "20", "MK", "B", "No", "No"],
    ["W/T", "21", "BD", "C", "No", "No"],
    ["T/F", "22", "LE", "A", "No", "Yes", { fourTen: "Yes" }],
    ["T/F", "23", "WN", "B", "No", "Yes"],
    ["T/F", "24", "ZF", "C", "No", "No"],
    ["T/F", "25", "CY", "B", "No", "No"],
    ["F/S", "26", "MV", "A", "No", "Yes", { fourTen: "Yes" }],
    ["F/S", "27", "IX", "B", "No", "Yes"],
    ["F/S", "28", "PL", "C", "No", "Yes"],
    ["F/S", "29", "XM", "C", "No", "Yes"],
    ["F/S", "30", "CV", "A", "No", "Yes"],
    ["R-DEV", "31", "UA", "B", "No", "No"],
    ["R-DEV", "32", "", "Available", "No", "No"],
    ["R-DEV", "33", "LB", "C", "No", "No"],
    ["R-DEV", "34", "PW", "B", "No", "No"],
    ["R-DEV", "35", "TO", "A", "No", "No"],
    ["D-DEV", "36", "GZ", "B", "No", "No"],
    ["D-DEV", "37", "BL", "C", "No", "No"],
    ["D-DEV", "38", "PF", "C", "No", "No"],
    ["D-DEV", "39", "PX", "A", "No", "No"],
    ["D-DEV", "40", "SM", "B", "No", "No"],
  ]),
  ...mockRdoLines("Area C", [
    ["S/S", "1", "JG", "C", "No", "Yes"],
    ["S/S", "2", "CK", "C", "No", "No"],
    ["S/S", "3", "CR", "A", "No", "No"],
    ["S/S", "4", "VA", "A", "No", "No"],
    ["S/S", "5", "BM", "B", "No", "Yes", { fourTen: "Yes" }],
    ["S/S", "6", "KV", "B", "BID", "Yes", { fourTen: "Yes" }],
    ["S/M", "7", "QT", "C", "No", "No"],
    ["S/M", "8", "KC", "B", "No", "Yes"],
    ["S/M", "9", "TT", "B", "No", "Yes"],
    ["S/M", "10", "CS", "A", "No", "Yes", { fourTen: "Yes" }],
    ["S/M", "11", "YM", "C", "BID", "Yes", { fourTen: "Yes" }],
    ["M/T", "12", "NA", "C", "No", "Yes"],
    ["M/T", "13", "JH", "A", "No", "Yes"],
    ["M/T", "14", "VR", "A", "No", "Yes"],
    ["M/T", "15", "AQ", "B", "No", "Yes"],
    ["M/T", "16", "KU", "C", "BID", "Yes", { fourTen: "Yes" }],
    ["T/W", "17", "AD", "C", "No", "Yes"],
    ["T/W", "18", "CU", "A", "No", "Yes"],
    ["T/W", "19", "KX", "B", "No", "No"],
    ["T/W", "20", "BR", "A", "No", "Yes"],
    ["T/W", "21", "XS", "C", "BID", "Yes", { fourTen: "Yes" }],
    ["W/T", "22", "AS", "A", "No", "Yes"],
    ["W/T", "23", "FO", "B", "No", "No"],
    ["W/T", "24", "JA", "C", "No", "Yes"],
    ["W/T", "25", "EG", "B", "No", "Yes"],
    ["W/T", "26", "DN", "A", "BID", "Yes", { fourTen: "Yes" }],
    ["T/F", "27", "AE", "B", "No", "No"],
    ["T/F", "28", "TD", "A", "No", "No"],
    ["T/F", "29", "CD", "B", "No", "No"],
    ["T/F", "30", "JS", "C", "BID", "Yes", { fourTen: "Yes" }],
    ["F/S", "31", "OJ", "B", "No", "Yes"],
    ["F/S", "32", "BH", "B", "No", "No"],
    ["F/S", "33", "TN", "C", "No", "No"],
    ["F/S", "34", "OL", "A", "No", "Yes"],
    ["F/S", "35", "RK", "C", "BID", "Yes", { fourTen: "Yes" }],
    ["R-DEV", "36", "AD", "C", "No", "No"],
    ["R-DEV", "37", "LZ", "A", "No", "No"],
    ["R-DEV", "38", "RI", "B", "No", "No"],
    ["R-DEV", "39", "DN", "B", "No", "No"],
    ["R-DEV", "40", "LO", "C", "No", "No"],
    ["R-DEV", "41", "RS", "C", "No", "No"],
    ["R-DEV", "42", "BR", "A", "No", "No"],
    ["D-DEV", "43", "XS", "A", "No", "No"],
    ["D-DEV", "44", "CL", "B", "No", "No"],
    ["D-DEV", "45", "RJ", "C", "No", "No"],
    ["D-DEV", "46", "BT", "A", "No", "No"],
  ]),
  { area: "Area D", pattern: "S/S", line: "1", cpc: "EL", week: ["RDO", "M1100", "M700", "RDO", "M2130", "M2130", "RDO"], group: "Unselected", mid: "BID", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "S/S", line: "2", cpc: "HS", week: ["RDO", "1500", "1330", "730", "630", "600", "RDO"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "S/S", line: "3", cpc: "EX", week: ["RDO", "1330", "730", "630", "630", "630", "RDO"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "S/S", line: "4", cpc: "MR", week: ["RDO", "730", "730", "730", "730", "730", "RDO"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "S/S", line: "5", cpc: "IM", week: ["RDO", "M1100", "M1100", "M1100", "M1100", "RDO", "RDO"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "S/M", line: "7", cpc: "MW", week: ["RDO", "RDO", "M1100", "M700", "RDO", "M2130", "M2130"], group: "Unselected", mid: "BID", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "S/M", line: "8", cpc: "BB", week: ["RDO", "RDO", "1500", "1330", "730", "630", "600"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "S/M", line: "9", cpc: "TA", week: ["RDO", "RDO", "1500", "1330", "730", "630", "600"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "S/M", line: "10", cpc: "TS", week: ["RDO", "RDO", "1330", "1330", "730", "630", "630"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "M/T", line: "11", cpc: "SA", week: ["M2130", "RDO", "RDO", "M1100", "M700", "RDO", "M2130"], group: "Unselected", mid: "BID", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "M/T", line: "12", cpc: "JI", week: ["600", "RDO", "RDO", "1500", "1330", "730", "730"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "M/T", line: "13", cpc: "WT", week: ["600", "RDO", "RDO", "1500", "1330", "1330", "730"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "M/T", line: "14", cpc: "JM", week: ["630", "RDO", "RDO", "1500", "1330", "730", "630"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "T/W", line: "15", cpc: "AH", week: ["M2130", "M2130", "RDO", "RDO", "M1100", "M700", "RDO"], group: "Unselected", mid: "BID", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "T/W", line: "16", cpc: "VM", week: ["730", "600", "RDO", "RDO", "1330", "730", "730"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "T/W", line: "17", cpc: "OT", week: ["630", "600", "RDO", "RDO", "1500", "1330", "730"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "T/W", line: "18", cpc: "NX", week: ["1330", "730", "RDO", "RDO", "1500", "1330", "1330"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "T/W", line: "19", cpc: "IE", week: ["630", "630", "RDO", "RDO", "1500", "1330", "730"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "T/W", line: "20", cpc: "MS", week: ["630", "630", "RDO", "RDO", "1330", "1330", "730"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "W/T", line: "21", cpc: "TB", week: ["RDO", "M2130", "M2130", "RDO", "RDO", "M1100", "M700"], group: "Unselected", mid: "BID", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "W/T", line: "22", cpc: "CH", week: ["730", "630", "600", "RDO", "RDO", "1500", "1330"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "W/T", line: "23", cpc: "NK", week: ["730", "630", "600", "RDO", "RDO", "1330", "1330"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "W/T", line: "24", cpc: "EC", week: ["1500", "1330", "730", "RDO", "RDO", "1500", "1500"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "W/T", line: "25", cpc: "EA", week: ["1500", "1500", "1500", "RDO", "RDO", "1500", "1500"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "T/F", line: "26", cpc: "BG", week: ["M700", "RDO", "M2130", "M2130", "RDO", "RDO", "M1100"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "T/F", line: "27", cpc: "SP", week: ["1330", "730", "630", "600", "RDO", "RDO", "1330"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "T/F", line: "28", cpc: "EN", week: ["1330", "730", "630", "600", "RDO", "RDO", "1330"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "T/F", line: "29", cpc: "WP", week: ["1330", "730", "730", "730", "RDO", "RDO", "1500"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "F/S", line: "30", cpc: "MZ", week: ["M1100", "M700", "RDO", "M2130", "M2130", "RDO", "RDO"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "F/S", line: "31", cpc: "ZB", week: ["1330", "1330", "730", "630", "600", "RDO", "RDO"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "F/S", line: "32", cpc: "NL", week: ["1500", "1330", "1330", "730", "600", "RDO", "RDO"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "F/S", line: "33", cpc: "GO", week: ["M1300", "M1100", "M1100", "M1100", "RDO", "RDO", "RDO"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "F/S", line: "34", cpc: "DA", week: ["730", "730", "630", "630", "630", "RDO", "RDO"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "R-DEV", line: "35", lineType: "DEV", cpc: "VP", week: ["RDO", "1500", "1330", "730", "630", "600", "RDO"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "R-DEV", line: "36", lineType: "DEV", cpc: "MO", week: ["RDO", "RDO", "1500", "1330", "730", "630", "600"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "R-DEV", line: "37", lineType: "DEV", cpc: "HG", week: ["600", "RDO", "RDO", "1500", "1330", "730", "630"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "R-DEV", line: "38", lineType: "DEV", cpc: "ZO", week: ["730", "630", "600", "RDO", "RDO", "1500", "1330"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "R-DEV", line: "39", lineType: "DEV", cpc: "AZ", week: ["1330", "730", "630", "600", "RDO", "RDO", "1500"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "R-DEV", line: "40", lineType: "DEV", cpc: "SG", week: ["1500", "1330", "730", "630", "600", "RDO", "RDO"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "D-DEV", line: "41", lineType: "DEV", cpc: "KN", week: ["RDO", "1330", "1330", "730", "630", "630", "RDO"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "D-DEV", line: "42", lineType: "DEV", cpc: "JC", week: ["RDO", "RDO", "1330", "1330", "730", "630", "630"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "D-DEV", line: "43", lineType: "DEV", cpc: "AY", week: ["630", "RDO", "RDO", "1330", "1330", "730", "630"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "D-DEV", line: "44", lineType: "DEV", cpc: "FF", week: ["630", "630", "RDO", "RDO", "1330", "1330", "730"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "D-DEV", line: "45", lineType: "DEV", cpc: "IN", week: ["1330", "730", "630", "630", "RDO", "RDO", "1330"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  { area: "Area D", pattern: "D-DEV", line: "46", lineType: "DEV", cpc: "PJ", week: ["1330", "1330", "730", "630", "630", "RDO", "RDO"], group: "Unselected", mid: "Unselected", aws: "Unselected", flex: "Unselected", status: "Open" },
  ...mockRdoLines("Area E", [
    ["S/S", "1", "CA", "C", "No", "Yes"],
    ["S/S", "2", "BZ", "A", "BID", "Yes"],
    ["S/S", "3", "ET", "B", "BID", "Yes"],
    ["S/S", "4", "LT", "C", "BID", "Yes", { fourTen: "Yes" }],
    ["S/M", "5", "RY", "C", "BID", "No"],
    ["S/M", "6", "WW", "C", "BID", "No"],
    ["S/M", "7", "JT", "B", "BID", "No"],
    ["S/M", "8", "DS", "A", "No", "No"],
    ["M/T", "9", "MT", "C", "BID", "Yes"],
    ["M/T", "10", "SC", "A", "No", "Yes"],
    ["M/T", "11", "QQ", "A", "BID", "Yes"],
    ["M/T", "12", "YN", "B", "BID", "No"],
    ["T/W", "13", "PP", "A", "BID", "Yes"],
    ["T/W", "14", "JE", "A", "BID", "No"],
    ["T/W", "15", "IU", "C", "BID", "Yes"],
    ["T/W", "16", "BA", "B", "BID", "Yes"],
    ["W/T", "17", "JW", "B", "BID", "Yes"],
    ["W/T", "18", "CT", "B", "BID", "Yes"],
    ["W/T", "19", "PC", "A", "No", "No"],
    ["W/T", "20", "GB", "C", "BID", "No"],
    ["T/F", "21", "ZM", "B", "No", "No"],
    ["T/F", "22", "JN", "C", "BID", "Yes"],
    ["T/F", "23", "RH", "A", "BID", "No"],
    ["F/S", "24", "MD", "C", "No", "Yes"],
    ["F/S", "25", "SJ", "B", "No", "No"],
    ["F/S", "26", "AF", "B", "BID", "No"],
    ["F/S", "27", "VZ", "A", "BID", "Yes"],
    ["R-DEV", "28", "MP", "A", "No", "No"],
    ["R-DEV", "29", "MA", "A", "No", "No"],
    ["R-DEV", "30", "LW", "B", "No", "No"],
    ["R-DEV", "31", "MH", "C", "No", "No"],
    ["R-DEV", "32", "DV", "A", "No", "No"],
    ["R-DEV", "33", "ED", "C", "No", "No"],
    ["R-DEV", "34", "DO", "C", "No", "No"],
    ["R-DEV", "35", "TX", "B", "No", "No"],
    ["R-DEV", "36", "KO", "B", "No", "No"],
    ["D-DEV", "37", "TC", "A", "No", "No"],
    ["D-DEV", "38", "JU", "C", "No", "No"],
    ["D-DEV", "39", "YL", "B", "No", "No"],
  ]),
  ...mockRdoLines("Area F", [
    ["S/S", "1", "AA", "C", "No", "Yes"],
    ["S/S", "2", "XN", "C", "No", "No"],
    ["S/S", "3", "JO", "B", "No", "No"],
    ["S/S", "4", "YQ", "A", "BID", "No"],
    ["S/M", "5", "CJ", "C", "No", "No"],
    ["S/M", "6", "ML", "A", "No", "No"],
    ["S/M", "7", "NY", "B", "BID", "Yes"],
    ["S/M", "8", "JL", "B", "BID", "Yes", { fourTen: "Yes" }],
    ["M/T", "9", "AP", "A", "No", "No"],
    ["M/T", "10", "PS", "C", "No", "No"],
    ["M/T", "11", "BC", "B", "BID", "Yes"],
    ["T/W", "12", "HL", "B", "No", "No"],
    ["T/W", "13", "AX", "B", "No", "Yes"],
    ["T/W", "14", "AU", "A", "BID", "Yes"],
    ["T/W", "15", "WC", "C", "BID", "Yes", { fourTen: "Yes" }],
    ["W/T", "16", "ZU", "C", "No", "No"],
    ["W/T", "17", "JK", "B", "No", "No"],
    ["W/T", "18", "EV", "A", "No", "No"],
    ["T/F", "19", "JF", "B", "No", "Yes"],
    ["T/F", "20", "VN", "C", "No", "Yes"],
    ["T/F", "21", "DC", "A", "No", "No"],
    ["T/F", "22", "CO", "A", "BID", "Yes"],
    ["F/S", "23", "FK", "A", "No", "No"],
    ["F/S", "24", "MI", "C", "No", "Yes"],
    ["F/S", "25", "MI", "B", "BID", "Yes"],
    ["F/S", "26", "JZ", "C", "BID", "Yes", { fourTen: "Yes" }],
    ["R-DEV", "27", "PA", "A", "No", "No"],
    ["R-DEV", "28", "XF", "C", "No", "No"],
    ["R-DEV", "29", "IV", "A", "No", "No"],
    ["R-DEV", "30", "CH", "A", "No", "No"],
    ["R-DEV", "31", "KH", "C", "No", "No"],
    ["R-DEV", "32", "JB", "B", "No", "No"],
    ["R-DEV", "33", "JV", "C", "No", "No"],
    ["D-DEV", "34", "AS", "B only", "No", "No"],
    ["D-DEV", "35", "VT", "A", "No", "No"],
    ["D-DEV", "36", "TF", "B", "No", "No"],
    ["D-DEV", "37", "TV", "C", "No", "No"],
    ["D-DEV", "38", "HO", "A", "No", "No"],
    ["D-DEV", "39", "KK", "B", "No", "No"],
  ]),
  ...mockRdoLines("TMU", [
    ["S/S", "1", "EH", "A", "No", "Yes", { week: ["RDO", "1315", "1315", "725", "645", "315", "RDO"] }],
    ["S/S", "2", "HK", "C", "No", "Yes", { week: ["RDO", "1315", "1315", "815", "715", "645", "RDO"] }],
    ["S/S", "T", "HE", "", "No", "No", { week: ["RDO", "1315", "1315", "815", "715", "645", "RDO"] }],
    ["S/M", "3", "LL", "A", "No", "Yes", { week: ["RDO", "RDO", "1415", "1315", "815", "645", "315"] }],
    ["S/M", "4", "TM", "B", "BID", "Yes", { week: ["RDO", "RDO", "RDO", "M1300", "M1300", "M1100", "M700"], fourTen: "Yes" }],
    ["M/T", "5", "SB", "C", "No", "Yes", { week: ["315", "RDO", "RDO", "1315", "1315", "715", "645"] }],
    ["M/T", "6", "ZI", "A", "No", "Yes", { week: ["645", "RDO", "RDO", "1200", "1315", "815", "645"] }],
    ["M/T", "T", "WL", "B only", "No", "Yes", { week: ["315", "RDO", "RDO", "1315", "1315", "715", "645"] }],
    ["T/W", "7", "CN", "B", "No", "Yes", { week: ["1415", "1415", "RDO", "RDO", "1200", "1200", "1415"], fourTen: "Yes" }],
    ["W/T", "8", "PD", "C", "No", "Yes", { week: ["645", "315", "315", "RDO", "RDO", "1315", "815"] }],
    ["W/T", "9", "NJ", "A", "No", "Yes", { week: ["715", "645", "645", "RDO", "RDO", "1415", "1315"] }],
    ["T/F", "10", "ZT", "B", "No", "Yes", { week: ["815", "645", "645", "315", "RDO", "RDO", "1315"] }],
    ["T/F", "11", "TR", "C", "BID", "Yes", { week: ["M1200", "M1200", "M1200", "RDO", "RDO", "RDO", "M1200"], fourTen: "Yes" }],
    ["F/S", "12", "WE", "A", "No", "Yes", { week: ["1415", "1315", "725", "645", "315", "RDO", "RDO"] }],
    ["F/S", "13", "HA", "B", "No", "Yes", { week: ["1315", "1315", "815", "715", "645", "RDO", "RDO"] }],
    ["F/S", "14", "EU", "C", "No", "Yes", { week: ["1200", "1315", "815", "715", "645", "RDO", "RDO"] }],
    ["F/S", "15", "KB", "A", "No", "Yes", { week: ["1415", "1415", "1200", "815", "715", "RDO", "RDO"] }],
  ]),
];

let selectedLineId = "15";
let selectedFatigueGroup = "";
let selectedMidPreference = "";
let selectedAwsPreference = "";
let selectedFlexPreference = "";
let calendarMode = "combined";
const calendarLayouts = {
  public: "minimal",
  dashboard: "minimal",
  leave: "minimal",
  member: "minimal",
};
let displayedCalendarYear = BID_YEAR;
let scheduleCalendarView = "month";
let scheduleActiveDate = new Date(BID_YEAR, 0, 1);
const rdoFilters = {
  search: "",
  openOnly: false,
  mid: "all",
  fourTen: "all",
};
const publicRdoFilters = {
  search: "",
  openOnly: false,
  mid: "all",
  fourTen: "all",
};
const publicState = {
  area: "Area A",
  section: "Calendar",
};

const ZLA_AREAS = ["Area A", "Area B", "Area C", "Area D", "Area E", "Area F", "TMU"];
const LETTERED_AREA_BID_ROLES = ["CPC", "GL", "R-DEV", "D-DEV"];
const TMU_BID_ROLES = ["TMC", "DEV", "GL"];

const supabaseState = {
  enabled: false,
  connected: false,
  loading: false,
  authInitialized: false,
  authRestorePromise: null,
  message: "Waiting for Supabase data.",
  loadedAt: null,
  bidYearId: "",
  authEmail: "",
  authUserId: "",
  pendingAuthEmail: "",
  placeholdersCleared: false,
};

const LIVE_HELP_SESSION_KEY = "natca-zla-live-help-session-id";
const LIVE_HELP_CLOSED_MESSAGE = "Intake Bidding Office is currently closed. Please reach out 0700-1900 (excluding holidays) for help with your bidding questions.";
const LIVE_HELP_PACIFIC_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function isMissingSupabaseRoutine(error) {
  return /function .*live_help_|Could not find the function|schema cache|PGRST202/i.test(error?.message || "");
}

function isMissingSupabaseColumn(error) {
  return /column .* does not exist|Could not find .* column|schema cache|PGRST204/i.test(error?.message || "");
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function liveHelpSessionId() {
  try {
    const stored = window.localStorage?.getItem(LIVE_HELP_SESSION_KEY);
    if (stored) return stored;
    const next = window.crypto?.randomUUID?.() || `anon-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage?.setItem(LIVE_HELP_SESSION_KEY, next);
    return next;
  } catch (_error) {
    return `anon-${Date.now()}`;
  }
}

function liveHelpPacificParts(date = new Date()) {
  return LIVE_HELP_PACIFIC_FORMATTER.formatToParts(date).reduce((parts, item) => {
    if (item.type !== "literal") parts[item.type] = item.value;
    return parts;
  }, {});
}

function liveHelpPacificDateKey(date = new Date()) {
  const parts = liveHelpPacificParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isLiveHelpOfficeClosed(date = new Date()) {
  const parts = liveHelpPacificParts(date);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 19 * 60 + 1 || minutes < 7 * 60 || isLegalHolidayDate(liveHelpPacificDateKey(date));
}

function addLiveHelpClosedReply(thread, date = new Date()) {
  if (!thread || !isLiveHelpOfficeClosed(date)) return false;
  thread.messages.push({
    author: "Intake",
    role: "Intake",
    time: formatDateTime(date),
    body: LIVE_HELP_CLOSED_MESSAGE,
    verified: true,
  });
  thread.status = "Answered";
  return true;
}

function isConfirmedHelpUser() {
  return Boolean(isMemberAppVisible() && currentUser?.supabaseProfileId);
}

function currentHelpRequester() {
  if (isConfirmedHelpUser()) {
    return {
      key: `bidder:${currentUser.supabaseProfileId}`,
      bidderId: currentUser.supabaseProfileId,
      name: userFullName(),
      initials: currentUser.initials || "BUE",
      area: currentUser.area || "Area A",
      email: currentUser.email || "",
      verified: true,
      sessionId: "",
    };
  }

  const area = ZLA_AREAS.includes(publicState.area) ? publicState.area : "Area A";
  const sessionId = liveHelpSessionId();
  return {
    key: `anon:${sessionId}`,
    bidderId: null,
    name: "Unverified visitor",
    initials: "Guest",
    area,
    email: "",
    verified: false,
    sessionId,
  };
}

const AREA_NAME_BY_CODE = {
  "area-a": "Area A",
  "area-b": "Area B",
  "area-c": "Area C",
  "area-d": "Area D",
  "area-e": "Area E",
  "area-f": "Area F",
  tmu: "TMU",
};

const AREA_CODE_BY_NAME = Object.entries(AREA_NAME_BY_CODE).reduce((lookup, [code, name]) => {
  lookup[name] = code;
  return lookup;
}, {});

const areaCpcCount = 36;
const areaFatigueMax = Math.floor(areaCpcCount / 3);

const crewSizeByPattern = {
  "S/S": 6,
  "S/M": 6,
  "M/T": 6,
  "T/W": 6,
  "W/T": 6,
  "T/F": 6,
  "F/S": 6,
};

function fatigueCapacityForLine(line, candidateLineId = selectedLineId, candidateGroup = selectedFatigueGroup) {
  const area = line.area || currentUser.area || "Area A";
  const areaLines = rdoLinesForArea(area);
  const crewSize = crewSizeByPattern[line.pattern] || areaLines.filter((item) => item.pattern === line.pattern).length;
  const crewMax = Math.max(1, Math.floor(crewSize / 3));

  return ["A", "B", "C"].map((group) => {
    const areaUsed = areaLines.filter((item) => {
      if (!isCpcLine(item)) return false;
      if (item.line === candidateLineId) return candidateGroup === group;
      return item.status === "Taken" && item.group === group;
    }).length;

    const crewUsed = areaLines.filter((item) => {
      if (!isCpcLine(item)) return false;
      if (item.pattern !== line.pattern) return false;
      if (item.line === candidateLineId) return candidateGroup === group;
      return item.status === "Taken" && item.group === group;
    }).length;

    return {
      group,
      areaUsed,
      areaMax: areaFatigueMax,
      crewUsed,
      crewMax,
    };
  });
}

function isCpcLine(line) {
  return line.lineType !== "DEV" && !/DEV/i.test(line.pattern);
}

function isGroupAvailable(item) {
  return item.areaUsed < item.areaMax && item.crewUsed < item.crewMax;
}

function canChooseGroup(item, isSelected) {
  return item.areaUsed < item.areaMax && (isSelected ? item.crewUsed <= item.crewMax : item.crewUsed < item.crewMax);
}

function isForcedMid(line) {
  return line.mid === "BID" || line.mid === "Yes";
}

function isMidLineByDesign(line) {
  return line.mid === "BID";
}

function lineFourTenValue(line) {
  if (line.fourTen === "Yes" || line.fourTen === "No") return line.fourTen;
  const workedDays = line.week.filter((value) => value !== "RDO").length;
  return workedDays === 4 ? "Yes" : "No";
}

function lineScheduleLabel(line) {
  return lineFourTenValue(line) === "Yes" ? "4-10" : "5-8";
}

function confirmFlexNo() {
  return window.confirm("Are you sure you do not want to the ability to flex your shifts?");
}

const leaveBids = [
  { priority: 1, range: "Jun 9 - Jun 13, 2027", days: 5, status: "Approved", notes: "Family vacation" },
  { priority: 2, range: "Jul 3 - Jul 7, 2027", days: 5, status: "Approved", notes: "Holiday week" },
  { priority: 3, range: "Sep 2 - Sep 5, 2027", days: 4, status: "Pending", notes: "Round 1" },
  { priority: 4, range: "Nov 24 - Nov 28, 2027", days: 5, status: "Pending", notes: "Thanksgiving week" },
];

const leaveSlotWeeks = [
  {
    group: "B",
    round: 1,
    days: [
      { date: "2027-01-11", label: "Mon, Jan 11", cpc: ["ZH", "GM", "NO"], dev: [] },
      { date: "2027-01-12", label: "Tue, Jan 12", cpc: ["GM", "NO", "DG"], dev: [] },
      { date: "2027-01-13", label: "Wed, Jan 13", cpc: ["GM", "DG"], dev: ["BS"] },
      { date: "2027-01-14", label: "Thu, Jan 14", cpc: ["CZ", "VV"], dev: ["BS"] },
      { date: "2027-01-15", label: "Fri, Jan 15", cpc: [], dev: ["BS"], unavailable: true },
      { date: "2027-01-16", label: "Sat, Jan 16", cpc: [], dev: ["BS"], unavailable: true },
      { date: "2027-01-17", label: "Sun, Jan 17", cpc: ["CZ", "VV", "LA"], dev: [] },
    ],
  },
  {
    group: "C",
    round: 2,
    days: [
      { date: "2027-01-18", label: "Mon, Jan 18", cpc: ["CZ", "VV", "SS"], dev: [], holiday: true },
      { date: "2027-01-19", label: "Tue, Jan 19", cpc: ["RO", "VV", "VO"], dev: [] },
      { date: "2027-01-20", label: "Wed, Jan 20", cpc: ["VV"], dev: [] },
      { date: "2027-01-21", label: "Thu, Jan 21", cpc: [], dev: [], unavailable: true },
      { date: "2027-01-22", label: "Fri, Jan 22", cpc: [], dev: [], unavailable: true },
      { date: "2027-01-23", label: "Sat, Jan 23", cpc: ["CE"], dev: [], unavailable: true },
      { date: "2027-01-24", label: "Sun, Jan 24", cpc: ["CP"], dev: [], unavailable: true },
    ],
  },
  {
    group: "A",
    round: 3,
    days: [
      { date: "2027-01-25", label: "Mon, Jan 25", cpc: ["GK", "VV"], dev: [] },
      { date: "2027-01-26", label: "Tue, Jan 26", cpc: ["GK", "CE"], dev: [] },
      { date: "2027-01-27", label: "Wed, Jan 27", cpc: ["SZ"], dev: [] },
      { date: "2027-01-28", label: "Thu, Jan 28", cpc: [], dev: [], unavailable: true },
      { date: "2027-01-29", label: "Fri, Jan 29", cpc: [], dev: [], unavailable: true },
      { date: "2027-01-30", label: "Sat, Jan 30", cpc: [], dev: [], unavailable: true },
      { date: "2027-01-31", label: "Sun, Jan 31", cpc: ["FJ", "VV"], dev: [] },
    ],
  },
];

const extraLeaveSlotData = {
  "2027-02-10": { cpc: ["TY", "ZH", "OP"], dev: ["DL"], unavailable: true },
  "2027-02-11": { cpc: ["NO", "GK", "GM"], dev: [] },
  "2027-02-12": { cpc: ["TK", "ES", "DG"], dev: ["KM", "XO"] },
  "2027-06-10": { cpc: ["OC", "VV", "CZ"], dev: ["BS"] },
  "2027-07-07": { cpc: ["RO", "VO", "CE"], dev: [] },
  "2027-09-03": { cpc: ["HH", "HN", "TE"], dev: ["AW"] },
  "2027-11-24": { cpc: ["AR", "SZ", "FJ"], dev: ["TP"] },
  "2027-11-25": { cpc: ["VV", "CP", "SS"], dev: [], holiday: true },
  "2027-12-27": { cpc: ["CZ", "NO", "GM"], dev: ["KE", "AW"] },
};

function extraLeaveSlotStorageKey(key, area = "Area A") {
  return area === "Area A" ? key : `${area}|${key}`;
}

function extraLeaveSlotDetails(key, area = "Area A") {
  return extraLeaveSlotData[extraLeaveSlotStorageKey(key, area)];
}

let selectedLeaveDateKey = "2027-01-18";

const senioritySource = [
  ["Denham", "Corey", "CPC", "CE", "Area A", "", "(805) 501-4165"],
  ["Hutson", "Jeffrey", "CPC", "HN", "Area A", "", "(661) 607-9673"],
  ["Bonanno", "Justin", "GL", "JJ", "Area A", "", ""],
  ["Schoelen", "Michael", "GL", "OC", "Area A", "m.schoelen@yahoo.com", "(626) 392-1194"],
  ["Lane", "Joshua", "CPC", "CP", "Area A", "", "(858) 382-3497"],
  ["Wagner", "Aaron", "CPC", "AM", "Area A", "", "(661) 247-7959"],
  ["Harold", "Kristina", "CPC", "TE", "Area A", "", "(502) 712-7207"],
  ["Bickel", "Shane", "CPC", "SS", "Area A", "", "(661) 917-5860"],
  ["Couche", "Rachel", "CPC", "VC", "Area A", "", "(904) 228-6930"],
  ["Harris", "Sarah", "CPC", "SZ", "Area A", "", "(661) 435-3600"],
  ["Robertson", "Rajnish", "CPC", "RO", "Area A", "", "(303) 917-2444"],
  ["Alvarez", "Mark", "CPC", "LA", "Area A", "", "(323) 397-6000"],
  ["Carpenter", "Jonathan", "CPC", "XJ", "Area A", "", "(818) 669-8425"],
  ["Lohrman", "Joshua", "CPC", "OP", "Area A", "", "(661) 718-9456"],
  ["Norr", "Garrett", "GL", "GJ", "Area A", "", "(661) 264-8410"],
  ["Carlin", "Russell", "CPC", "AR", "Area A", "", "(661) 400-3152"],
  ["Bengard", "Erik", "GL", "EB", "Area A", "", "(909) 717-4467"],
  ["Arce", "Adolfo", "CPC", "RC", "Area A", "", "(661) 233-1620"],
  ["Holder", "Joseph", "CPC", "HH", "Area A", "", "(702) 286-3692"],
  ["Gabriel", "Colin", "CPC", "CZ", "Area A", "", "(303) 910-6273"],
  ["Susnitzky", "Brett", "CPC", "ZY", "Area A", "", "(408) 250-4781"],
  ["Barrett", "Timothy", "CPC", "VV", "Area A", "", "(805) 616-5973"],
  ["Romano", "Frank", "CPC", "FJ", "Area A", "", "(516) 419-7893"],
  ["Lowther", "Timothy (Scott)", "CPC", "GS", "Area A", "", "(505) 417-0752"],
  ["Tshudy", "Matthew", "CPC", "TY", "Area A", "", "(717) 449-9807"],
  ["Hanson", "Brett", "CPC", "ZH", "Area A", "", "(612) 512-8480"],
  ["Vo", "Kevin", "CPC", "VO", "Area A", "", "(206) 225-8217"],
  ["Moss", "Gerrit", "CPC", "GM", "Area A", "", "(661) 674-6782"],
  ["Kelsey", "Taylor", "CPC", "TK", "Area A", "", "(907) 750-1376"],
  ["Speakman", "Erik", "CPC", "ES", "Area A", "", "(630) 908-0218"],
  ["Meuleners", "Janessa", "CPC", "NO", "Area A", "", "(952) 686-8121"],
  ["Graham", "Kaleb", "CPC", "GK", "Area A", "", "(563) 260-1670"],
  ["Griffin", "Dylan", "CPC", "DG", "Area A", "", "(913) 522-8087"],
  ["Pastore", "Tanner", "CPC", "TP", "Area A", "", "(720) 383-0782"],
  ["De La O", "Kevin", "CPC", "KE", "Area A", "", "(619) 417-5144"],
  ["Madera", "Allan", "R-DEV", "AW", "Area A", "", "(714) 365-0555"],
  ["Macias", "Benny", "R-DEV", "BY", "Area A", "", "(323) 975-7140"],
  ["Von Buck", "Corbin", "R-DEV", "XO", "Area A", "", "(661) 361-3013"],
  ["Greer", "William", "D-DEV", "WG", "Area A", "", "(661) 429-5121"],
  ["Hansen", "Dallas", "D-DEV", "DL", "Area A", "", "(559) 871-7872"],
  ["Myers", "Kyle", "D-DEV", "KM", "Area A", "", "(310) 467-6856"],
  ["McCarthy", "Aidan", "D-DEV", "PM", "Area A", "", "(631) 764-3452"],
  ["Nestojko", "Adam", "D-DEV", "YD", "Area A", "", "(858) 822-8484"],
  ["Galland", "Jacob", "D-DEV", "KJ", "Area A", "", "(661) 429-1737"],
  ["Padilla", "Felipe", "D-DEV", "FG", "Area A", "", "(951) 575-8794"],
  ["Plendl", "Justin", "D-DEV", "JP", "Area A", "", "(661) 488-6796"],
  ["Montano", "Bryan", "D-DEV", "", "Area A", "", ""],
  ["Griffin", "Emily", "D-DEV", "", "Area A", "", ""],
  ["Jackson", "Leonard", "CPC", "LJ", "Area B", "", "(661) 972-3164"],
  ["Blackwell", "Guy", "CPC", "BW", "Area B", "", "(818) 679-2252"],
  ["Yap", "Clinton", "CPC", "YP", "Area B", "", "(661) 208-9368"],
  ["Tuminaro", "David", "CPC", "XL", "Area B", "", "(661) 916-2755"],
  ["Bannon", "Kevin", "CPC", "KR", "Area B", "", "(951) 310-0606"],
  ["Martinez", "Maximo", "CPC", "MM", "Area B", "", "(559) 333-0678"],
  ["Fragas", "Jacqueline", "CPC", "IX", "Area B", "", "(661) 478-4325"],
  ["Plein", "Lindsay", "CPC", "PL", "Area B", "", "(951) 204-2457"],
  ["Miller", "Keith", "CPC", "XM", "Area B", "", "(913) 660-6267"],
  ["Klein", "Geoffery", "CPC", "JX", "Area B", "", "(818) 212-0445"],
  ["White", "Andrew", "GL", "B2", "Area B", "", "(801) 309-6231"],
  ["Lemen", "Brian", "CPC", "LE", "Area B", "", "(661) 547-8551"],
  ["Martinez", "Carmen", "CPC", "CV", "Area B", "", "(323) 422-2542"],
  ["Vera", "Lauro", "CPC", "VL", "Area B", "", "(626) 831-8320"],
  ["Arellano", "Matthew", "CPC", "MX", "Area B", "", "(661) 803-8154"],
  ["Flores", "Nicholas", "CPC", "MV", "Area B", "", "(720) 299-7280"],
  ["Schuler", "Karl", "GL", "KA", "Area B", "", "(707) 479-0820"],
  ["Scott", "Caitlin", "CPC", "CY", "Area B", "", "(661) 505-0835"],
  ["Ayala", "Jeremy", "CPC", "AJ", "Area B", "", "(323) 404-5695"],
  ["Binero", "Jamila", "CPC", "ZF", "Area B", "", "(702) 416-7548"],
  ["Grauer", "Amy", "CPC", "RR", "Area B", "", "(970) 443-1679"],
  ["House", "Zephaniah", "CPC", "HZ", "Area B", "", "(310) 877-3877"],
  ["Denmeade", "Drew", "CPC", "DD", "Area B", "", "(661) 670-6900"],
  ["Naber", "William", "CPC", "WN", "Area B", "", "(609) 703-0568"],
  ["Cadotte", "Beau", "CPC", "BD", "Area B", "", "(608) 477-1051"],
  ["Ostermeyer", "Mark", "CPC", "MK", "Area B", "", "(317) 439-5117"],
  ["Lott", "Michael", "CPC", "CX", "Area B", "", "(434) 738-7805"],
  ["He", "Xinran", "CPC", "ZN", "Area B", "", "(973) 955-5054"],
  ["Schiffer", "Wyatt", "CPC", "WS", "Area B", "", "(563) 212-6235"],
  ["Tison", "Dalton", "CPC", "DE", "Area B", "", "(706) 506-2320"],
  ["Osmers", "Thomas", "R-DEV", "TO", "Area B", "", "(571) 271-4069"],
  ["Barajas Duran", "Luis", "R-DEV", "LB", "Area B", "", "(907) 346-7447"],
  ["Fonseca", "Alexis", "R-DEV", "PW", "Area B", "", "(310) 359-2686"],
  ["Laboy", "Andres", "D-DEV", "BL", "Area B", "", "(224) 330-8718"],
  ["Serrano", "Adam", "R-DEV", "UA", "Area B", "", "(562) 968-6988"],
  ["Giraud-Carrier", "Pierre", "D-DEV", "PF", "Area B", "", "(801) 953-2501"],
  ["Campos", "Priscila", "D-DEV", "PX", "Area B", "", "(323) 868-0935"],
  ["Semder", "Michael", "D-DEV", "SM", "Area B", "", "(805) 363-0269"],
  ["Chambers", "Grant", "D-DEV", "GZ", "Area B", "", "(949) 616-4515"],
  ["Hart", "Jeremy", "CPC", "JG", "Area C", "", "(714) 519-4409"],
  ["Blackwell", "Carlyann", "CPC", "CR", "Area C", "", "(661) 478-7157"],
  ["Kelley", "Charles", "CPC", "CK", "Area C", "", "(805) 258-1108"],
  ["Cordovano", "Charles", "CPC", "VA", "Area C", "", "(661) 400-5796"],
  ["Seong", "Kevin", "CPC", "KV", "Area C", "", "(661) 886-2029"],
  ["Johnson", "Elaine", "CPC", "QT", "Area C", "", "(786) 201-3257"],
  ["Carlin", "Dustin", "CPC", "XD", "Area C", "", "(661) 965-5629"],
  ["Riepma", "Nicholas", "CPC", "TN", "Area C", "", "(661) 998-9607"],
  ["Harris", "Matthew", "CPC", "", "Area C", "", ""],
  ["Mendez", "Anthony", "CPC", "OJ", "Area C", "", "(760) 792-2665"],
  ["Schwartz", "Joshua", "CPC", "BH", "Area C", "", "(661) 300-1673"],
  ["Todd", "Trisha", "GL", "TT", "Area C", "", "(952) 484-4159"],
  ["Estes", "Clinton", "CPC", "KU", "Area C", "", "(620) 313-0764"],
  ["Zimmer", "Brannon", "R-DEV", "BR", "Area C", "", "(661) 406-1311"],
  ["Bird", "Daniel", "CPC", "IY", "Area C", "", "(480) 304-1679"],
  ["Mikhaylov", "Leana", "CPC", "YM", "Area C", "", "(971) 506-7051"],
  ["Bardeen", "Brock", "CPC", "BM", "Area C", "", "(661) 289-4717"],
  ["Colbenson", "Steven", "CPC", "CS", "Area C", "", "(661) 860-1142"],
  ["Kroessler", "Andrew", "CPC", "OL", "Area C", "", "(714) 271-0767"],
  ["Garrison", "Samantha", "CPC", "JS", "Area C", "", "(480) 234-5716"],
  ["Livingston", "Anders", "CPC", "NA", "Area C", "", "(678) 877-2630"],
  ["Wang", "Andrew", "CPC", "VR", "Area C", "", "(626) 551-1212"],
  ["Viscovich", "Joseph", "GL", "VI", "Area C", "", "(530) 953-9350"],
  ["Collier", "Casey", "CPC", "KC", "Area C", "", "(731) 607-9489"],
  ["Bracy", "Yolanda", "CPC", "AO", "Area C", "", "(724) 594-6822"],
  ["Diaz", "Coriana", "CPC", "CD", "Area C", "", "(661) 522-1578"],
  ["Eng", "Alyssa", "CPC", "AE", "Area C", "", "(808) 285-3150"],
  ["Kleinschmidt", "Austin", "CPC", "TD", "Area C", "", "(320) 221-1715"],
  ["Murawski", "David", "CPC", "CU", "Area C", "", "(815) 341-2103"],
  ["Lam", "Thomas", "CPC", "TL", "Area C", "", "(503) 740-5679"],
  ["Spitzer", "Audrey", "CPC", "AS", "Area C", "", "(804) 263-7971"],
  ["Horner", "Jeffrey", "CPC", "JH", "Area C", "", "(512) 573-1108"],
  ["Kalista", "Anton", "CPC", "AQ", "Area C", "", "(952) 836-5574"],
  ["Itai", "Tayna", "CPC", "KX", "Area C", "", "(808) 230-7562"],
  ["Schlegelmilch", "Michael", "CPC", "FO", "Area C", "", "(480) 452-8876"],
  ["Vandenberg", "Richard", "CPC", "RK", "Area C", "", "(631) 487-6830"],
  ["Fuess", "Jacob", "CPC", "JA", "Area C", "", "(951) 265-3775"],
  ["Galvan", "Eduardo", "CPC", "EG", "Area C", "", "(408) 529-2629"],
  ["Maas", "David", "R-DEV", "DN", "Area C", "", "(402) 440-9771"],
  ["Arebalo", "Arthur", "R-DEV", "AD", "Area C", "", "(909) 275-0847"],
  ["Rambo", "Savannah", "R-DEV", "RS", "Area C", "", "(423) 991-3006"],
  ["Felix", "Lorraine", "R-DEV", "LZ", "Area C", "", "(562) 587-8087"],
  ["Emel", "Cole", "D-DEV", "CL", "Area C", "", "(941) 380-2077"],
  ["Hall", "Blaine", "R-DEV", "RI", "Area C", "", "(201) 888-0076"],
  ["Rossil", "Aliyah", "R-DEV", "LO", "Area C", "", "(661) 208-0636"],
  ["Barajas Rosales", "Randy", "D-DEV", "RJ", "Area C", "", "(907) 887-4769"],
  ["Tran", "Bryan", "D-DEV", "BT", "Area C", "", "(714) 804-8706"],
  ["Ramirez", "Michael", "D-DEV", "XS", "Area C", "", "(858) 888-3199"],
  ["Giovengo", "James", "CPC", "GO", "Area D", "", "(661) 505-3311"],
  ["Greer", "William", "CPC", "IM", "Area D", "", "(661) 932-1836"],
  ["Hernandez", "Frank", "GL", "D1", "Area D", "", "(805) 660-1312"],
  ["Castilleja", "Sunny", "GL", "SN", "Area D", "", "(661) 361-9061"],
  ["Snaer", "Marc", "CPC", "MZ", "Area D", "", "(714) 325-1748"],
  ["Dunlap", "Trevor", "CPC", "TB", "Area D", "", "(661) 236-8394"],
  ["Wouters", "Micah", "CPC", "MW", "Area D", "", "(661) 723-3221"],
  ["Roeker", "Erin", "CPC", "EL", "Area D", "", "(661) 547-2976"],
  ["Hau", "Aleck", "CPC", "AH", "Area D", "", "(626) 392-3743"],
  ["Gatehouse", "Christopher", "CPC", "DJ", "Area D", "", "(760) 553-5080"],
  ["Holst", "Megan", "CPC", "MR", "Area D", "", "(210) 501-3990"],
  ["Yepez", "Edmundo", "CPC", "EX", "Area D", "", "(626) 825-2139"],
  ["Mattei", "Damien", "CPC", "DA", "Area D", "", "(661) 433-4573"],
  ["Sanchez", "Hector", "CPC", "HS", "Area D", "", "(323) 472-3003"],
  ["Gunter", "Benjamin", "CPC", "BG", "Area D", "", "(661) 670-4609"],
  ["Maita", "Vincent", "CPC", "VM", "Area D", "", "(408) 677-6023"],
  ["Kledplee", "Worasith", "CPC", "NL", "Area D", "", ""],
  ["Meyer", "Brandi", "CPC", "WP", "Area D", "", "(661) 490-3422"],
  ["Baum", "Remington", "CPC", "ZB", "Area D", "", "(619) 884-6016"],
  ["Alexander", "Jonathan", "CPC", "SA", "Area D", "", "(609) 233-9425"],
  ["Serai", "Stephanie", "CPC", "SP", "Area D", "", "(808) 381-0102"],
  ["Shuman", "Tyler", "CPC", "TS", "Area D", "", "(719) 440-8531"],
  ["Soto", "Ian", "CPC", "EN", "Area D", "", "(951) 733-1353"],
  ["Josepha", "Brian", "CPC", "BB", "Area D", "", "(786) 338-5321"],
  ["Lanphere", "Jye", "CPC", "JI", "Area D", "", "(509) 954-1752"],
  ["Mondragon Valencia", "Isidro", "CPC", "TA", "Area D", "", "(951) 427-8884"],
  ["Karcz", "Kara", "CPC", "NK", "Area D", "", "(603) 475-8759"],
  ["Hurt", "Chadwick", "CPC", "CH", "Area D", "", "(209) 985-4698"],
  ["Childs", "Eric", "CPC", "EC", "Area D", "", "(760) 470-4941"],
  ["McCann", "Weston", "CPC", "JM", "Area D", "", "(661) 388-8875"],
  ["Thompson", "Jonathan", "CPC", "WT", "Area D", "", "(301) 538-2372"],
  ["Soto", "Matthew", "CPC", "MS", "Area D", "", "(714) 213-6209"],
  ["Turkmen", "Ozgur", "CPC", "OT", "Area D", "", "(602) 291-0844"],
  ["Lee", "Laura", "CPC", "IE", "Area D", "", "(951) 733-1353"],
  ["Avila", "Ethan", "CPC", "EA", "Area D", "", "(760) 468-5808"],
  ["Ortiz", "Jess", "R-DEV", "ZO", "Area D", "", "(661) 208-2934"],
  ["Johnson", "Noah", "CPC", "NX", "Area D", "", "(317) 800-4861"],
  ["Bond", "Sydni", "R-DEV", "SG", "Area D", "", "(949) 482-8123"],
  ["Nguyen", "Hoang", "R-DEV", "HG", "Area D", "", "(661) 353-8223"],
  ["Haag", "Matthew", "R-DEV", "MO", "Area D", "", "(916) 996-9650"],
  ["Paul", "Vincent", "R-DEV", "VP", "Area D", "", "(323) 217-7452"],
  ["Hernandez", "Andrei", "R-DEV", "AZ", "Area D", "", "(951) 533-9379"],
  ["Salaver", "Jonathan", "D-DEV", "FF", "Area D", "", "(240) 565-9440"],
  ["Jones", "Patrick", "D-DEV", "PJ", "Area D", "", "(323) 926-8032"],
  ["Akhiary", "Kian", "D-DEV", "KN", "Area D", "", "(818) 422-3607"],
  ["Zermeno", "Ubaldo", "D-DEV", "JC", "Area D", "", "(562) 412-5856"],
  ["Martinez", "Ian", "D-DEV", "IN", "Area D", "", "(661) 361-4813"],
  ["Snaer", "Aysia", "D-DEV", "AY", "Area D", "", "(661) 878-1876"],
  ["Kuenzi", "Daniel", "CPC", "DS", "Area E", "", "(661) 302-7159"],
  ["Castilleja", "Luis", "CPC", "LT", "Area E", "", "(661) 361-9060"],
  ["Festerling", "Brian", "CPC", "BZ", "Area E", "", "(805) 558-8076"],
  ["Johnson", "Ryan", "CPC", "RY", "Area E", "", "(661) 878-3028"],
  ["Williams", "Christopher", "CPC", "CA", "Area E", "", "(818) 472-4702"],
  ["Perez", "Edson", "CPC", "ET", "Area E", "", "(661) 433-8277"],
  ["Parker", "Cristin", "R-DEV", "TX", "Area E", "", "(817) 403-7031"],
  ["Hongkham", "Robert", "GL", "QQ", "Area E", "", "(626) 320-2017"],
  ["Squire", "James", "CPC", "SJ", "Area E", "", "(619) 757-3536"],
  ["McIntosh", "Justin", "CPC", "MD", "Area E", "", "(661) 445-4414"],
  ["Penalosa", "Michael", "R-DEV", "MP", "Area E", "", "(626) 488-9500"],
  ["Vaden", "Cherron", "CPC", "WW", "Area E", "", "(951) 452-4008"],
  ["Fabarez", "Adam", "CPC", "AF", "Area E", "", "(714) 222-9178"],
  ["Vetor", "Zachary", "CPC", "VZ", "Area E", "", "(765) 669-0463"],
  ["Elliott", "James", "CPC", "MT", "Area E", "", "(561) 414-7113"],
  ["Lanham", "Joshua", "CPC", "JT", "Area E", "", "(916) 335-1290"],
  ["Haberstick", "John", "CPC", "RH", "Area E", "", "(561) 324-1483"],
  ["Abramson", "Matana", "CPC", "ZM", "Area E", "", "(732) 773-4445"],
  ["Cahal", "Michael", "CPC", "CC", "Area E", "", "(602) 930-1624"],
  ["Whiting", "Ryan", "CPC", "YN", "Area E", "", "(480) 227-4638"],
  ["Arvoy", "Pasquale", "CPC", "PP", "Area E", "", "(203) 240-3976"],
  ["Smith", "Jacob", "CPC", "JW", "Area E", "", "(901) 219-5954"],
  ["Sparks", "John", "CPC", "JN", "Area E", "", "(907) 360-4138"],
  ["Burrows", "Grant", "CPC", "GB", "Area E", "", "(626) 622-9127"],
  ["Leonez Cordova", "Jery", "CPC", "JE", "Area E", "", "(661) 728-6517"],
  ["McMath", "Demario", "R-DEV", "MH", "Area E", "", "(662) 251-2877"],
  ["Edralin", "Jonathan", "R-DEV", "", "Area E", "", ""],
  ["Barragan", "Victor", "CPC", "BA", "Area E", "", "(305) 491-3745"],
  ["Stahley", "Adam", "CPC", "IU", "Area E", "", "(317) 450-2985"],
  ["Roeker", "Cory", "CPC", "CT", "Area E", "", "(661) 542-0101"],
  ["Diaz", "Victor", "R-DEV", "KO", "Area E", "", "(323) 580-4778"],
  ["Schmidt", "Lilian", "CPC", "SC", "Area E", "", "(916) 712-8729"],
  ["Mahan", "Sean", "R-DEV", "MA", "Area E", "", "(281) 813-1332"],
  ["Goldsmith", "David", "R-DEV", "DO", "Area E", "", "(971) 678-8088"],
  ["Denomme", "Devon", "R-DEV", "DV", "Area E", "", "(401) 678-6295"],
  ["Price", "Daniel", "CPC", "PC", "Area E", "", "(661) 264-8637"],
  ["Clanton", "Tyler", "D-DEV", "TC", "Area E", "", "(619) 399-9242"],
  ["Wan", "Lizabeth", "R-DEV", "LW", "Area E", "", "(415) 806-1713"],
  ["Navarrete", "Julian", "D-DEV", "JU", "Area E", "", "(520) 247-6920"],
  ["Tejeda", "Jorge", "D-DEV", "YL", "Area E", "", "(619) 767-8484"],
  ["Williams", "Jaclyn", "CPC", "JO", "Area F", "", "(661) 435-4964"],
  ["Mancinelli", "Michelle", "CPC", "XN", "Area F", "", "(626) 260-0820"],
  ["Scott", "Jason", "CPC", "JL", "Area F", "", "(310) 948-6772"],
  ["Lowe", "Lydia", "R-DEV", "LY", "Area F", "", ""],
  ["Rosales", "Elda", "CPC", "YQ", "Area F", "", "(619) 861-2398"],
  ["Williams", "David", "CPC", "AA", "Area F", "", "(818) 322-7362"],
  ["Dunlap", "Kelli", "CPC", "FK", "Area F", "", "(661) 916-5542"],
  ["Hearns", "Rodney", "CPC", "WC", "Area F", "", "(334) 477-6119"],
  ["Riley", "Joel", "CPC", "JZ", "Area F", "", "(661) 726-4564"],
  ["Piolatto", "Michael", "CPC", "MI", "Area F", "", "(661) 317-6167"],
  ["Chung", "Charlie", "CPC", "CJ", "Area F", "", "(818) 913-0691"],
  ["Arture", "Joe", "CPC", "NY", "Area F", "", "(626) 251-7383"],
  ["Green", "Brandon", "CPC", "VJ", "Area F", "", "(310) 701-3338"],
  ["Lee", "Jessica", "CPC", "ML", "Area F", "", "(224) 401-3324"],
  ["Pascan", "Sergiu", "CPC", "PS", "Area F", "", "(209) 573-0812"],
  ["Diaz", "Sandro", "GL", "PB", "Area F", "", "(561) 389-8303"],
  ["Coslin", "Kristi", "CPC", "CO", "Area F", "", "(254) 855-6965"],
  ["Nesmith", "Andrew", "CPC", "AP", "Area F", "", "(850) 591-3077"],
  ["Buckner", "Jasmin", "CPC", "JF", "Area F", "", "(813) 569-9093"],
  ["Nguyen", "Minh", "CPC", "VN", "Area F", "M_nguyen111@yahoo.com", "(714) 234-8798"],
  ["Lacambacal", "Christian", "CPC", "BC", "Area F", "", "(702) 580-3077"],
  ["Garcia", "Walter", "CPC", "ZU", "Area F", "", "(661) 886-6169"],
  ["Lalputan", "Hakeem", "CPC", "HL", "Area F", "", "(703) 459-3422"],
  ["Kotoff", "Aaron", "CPC", "AX", "Area F", "", "(562) 587-5958"],
  ["Hamilton", "Aurore", "CPC", "AU", "Area F", "", "(337) 412-9295"],
  ["Pereda", "Christian", "CPC", "DC", "Area F", "", "(516) 710-5045"],
  ["Jones", "Evan", "CPC", "EV", "Area F", "", "(678) 689-7903"],
  ["Kim", "Joshua", "CPC", "JK", "Area F", "", "(951) 310-1671"],
  ["Heykes", "Connor", "R-DEV", "", "Area F", "", ""],
  ["Fitzpatrick", "Aaron", "R-DEV", "XF", "Area F", "", "(269) 303-3469"],
  ["Birkett", "Andrew", "R-DEV", "JB", "Area F", "", "(248) 720-9622"],
  ["Miller", "Khalil", "R-DEV", "KH", "Area F", "", "(248) 228-4312"],
  ["Schneider", "Charles", "R-DEV", "IV", "Area F", "", "(405) 246-8888"],
  ["Maniwong-Schlottman", "Absalom", "D-DEV", "", "Area F", "", ""],
  ["Polli", "Austin", "R-DEV", "PA", "Area F", "", "(760) 354-4809"],
  ["Lambert", "Christopher", "D-DEV", "TV", "Area F", "", "(480) 532-3041"],
  ["Antrum", "Jamie", "R-DEV", "JV", "Area F", "", "(917) 864-3210"],
  ["Villalobos", "Tyler", "D-DEV", "VT", "Area F", "", "(909) 538-2992"],
  ["Barcenas", "Joshua", "D-DEV", "HO", "Area F", "", "(626) 756-7044"],
  ["Kimball", "Bryan", "D-DEV", "KK", "Area F", "", "(702) 862-9183"],
  ["Giron Gonzalez", "Josue", "D-DEV", "TF", "Area F", "", "(760) 269-9189"],
  ["Hopkins", "Matthew", "DEV", "HK", "TMU", "", "(503) 440-8029"],
  ["Mauldin", "Trent", "TMC", "TR", "TMU", "", "(661) 350-7099"],
  ["Baugh", "Jeanette", "TMC", "KB", "TMU", "", "(724) 513-6397"],
  ["Beale", "Scott", "TMC", "SB", "TMU", "", "(650) 784-8884"],
  ["Hay", "Christopher", "TMC", "HA", "TMU", "", "(209) 207-4124"],
  ["Henry", "Larry", "TMC", "LL", "TMU", "", "(619) 961-3368"],
  ["Prater", "Matthew", "TMC", "ZT", "TMU", "", "(310) 525-9888"],
  ["Carey", "Nicolas", "TMC", "EU", "TMU", "", "(909) 762-2747"],
  ["Zimmerman", "Jared", "TMC", "ZI", "TMU", "", "(801) 635-9184"],
  ["Palmer", "Whitney", "DEV", "WE", "TMU", "", "(619) 203-4108"],
  ["Matsumoto", "Christopher", "TMC", "CN", "TMU", "", "(661) 317-5931"],
  ["Henry", "Erika", "TMC", "EH", "TMU", "", "(619) 840-9283"],
  ["Moreno", "Tracy", "TMC", "", "TMU", "", ""],
  ["Wilson", "Paul", "TMC", "PD", "TMU", "", "(661) 575-7973"],
  ["Willey", "Nikki", "TMC", "NJ", "TMU", "", "(707) 529-9552"],
];

const roundDateBlocks = [
  ["Wed, 10/01", "Sat, 10/11", "Wed, 10/22", "Sat, 11/01"],
  ["Thu, 10/02", "Sun, 10/12", "Thu, 10/23", "Sun, 11/02"],
  ["Fri, 10/03", "Tue, 10/14", "Fri, 10/24", "Mon, 11/03"],
  ["Sat, 10/04", "Wed, 10/15", "Sat, 10/25", "Tue, 11/04"],
  ["Sun, 10/05", "Thu, 10/16", "Sun, 10/26", "Wed, 11/05"],
  ["Mon, 10/06", "Fri, 10/17", "Mon, 10/27", "Thu, 11/06"],
  ["Tue, 10/07", "Sat, 10/18", "Tue, 10/28", "Fri, 11/07"],
  ["Wed, 10/08", "Sun, 10/19", "Wed, 10/29", "Sat, 11/08"],
];

const bidStartTimes = ["0700", "0900", "1100", "1300", "1500", "1700"];
const databaseBidWindows = new Map();
const BID_TIME_ZONE = "America/Los_Angeles";
const bidWindowPartFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BID_TIME_ZONE,
  weekday: "short",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const BID_OFFICE_CLOSED_DATE_KEYS = new Set([
  "2026-10-12",
  "2026-11-11",
]);

function roundDateBlocksForArea(area = currentViewArea()) {
  if (area !== "Area A") return roundDateBlocks;

  const requiredDateCount = Math.max(roundDateBlocks.length, Math.ceil(activeRosterEntries(area).length / bidStartTimes.length));
  return areaRoundDateBlocksFromStart(requiredDateCount, roundDateBlocks[0]?.length || 4);
}

function areaRoundDateBlocksFromStart(requiredDateCount, roundCount) {
  const rounds = Array.from({ length: roundCount }, () => []);
  const date = new Date(BID_YEAR - 1, 9, 1);

  rounds.forEach((roundDates, roundIndex) => {
    while (roundDates.length < requiredDateCount) {
      if (isBidOfficeOpenDate(date)) roundDates.push(bidOfficeDateLabel(date));
      date.setDate(date.getDate() + 1);
    }

    if (roundIndex < roundCount - 1) advancePastFullBidOfficeCheckDay(date);
  });

  return Array.from({ length: requiredDateCount }, (_, dateIndex) => {
    return rounds.map((roundDates) => roundDates[dateIndex] || "");
  });
}

function advancePastFullBidOfficeCheckDay(date) {
  while (true) {
    if (isBidOfficeOpenDate(date)) {
      date.setDate(date.getDate() + 1);
      return;
    }

    date.setDate(date.getDate() + 1);
  }
}

function isBidOfficeOpenDate(date) {
  const key = dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return !BID_OFFICE_CLOSED_DATE_KEYS.has(key);
}

function bidOfficeDateLabel(date) {
  return `${dayNames[date.getDay()]}, ${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function bidWindowLabel(date, start) {
  const hour = Number(start.slice(0, 2));
  const endHour = hour + 1;
  return `${date} · ${start}-${String(endHour).padStart(2, "0")}59`;
}

function databaseBidWindowKey(bidderId, roundNumber) {
  return `${bidderId}|${roundNumber}`;
}

function databaseBidWindowForRankRound(area, rank, roundNumber) {
  const bidderId = seniorityEntryProfileId(activeRosterEntries(area)[rank - 1]);
  return bidderId ? databaseBidWindows.get(databaseBidWindowKey(bidderId, roundNumber)) || null : null;
}

function bidWindowDateParts(date) {
  return Object.fromEntries(bidWindowPartFormatter.formatToParts(date).map((part) => [part.type, part.value]));
}

function bidWindowScheduleLabel(window) {
  if (!window?.start || !window?.end) return "";
  const start = bidWindowDateParts(window.start);
  const inclusiveEnd = bidWindowDateParts(new Date(window.end.getTime() - 60_000));
  return `${start.weekday}, ${start.month}/${start.day} · ${start.hour}${start.minute}-${inclusiveEnd.hour}${inclusiveEnd.minute}`;
}

function publicBidTimeLabel(roundLabel) {
  const round = parseRoundWindow(roundLabel);
  if (!round) return roundLabel;
  const weekdayNames = {
    Mon: "Monday",
    Tue: "Tuesday",
    Wed: "Wednesday",
    Thu: "Thursday",
    Fri: "Friday",
    Sat: "Saturday",
    Sun: "Sunday",
  };

  return `${weekdayNames[round.weekday] || round.weekday}, ${round.month}/${String(round.day).padStart(2, "0")} · ${round.start}`;
}

function escapeIcsText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function icsDateTime(year, month, day, time) {
  return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}T${time}00`;
}

function icsTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function addMinuteToTime(time) {
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  const next = new Date(Date.UTC(2000, 0, 1, hour, minute + 1));
  return `${String(next.getUTCHours()).padStart(2, "0")}${String(next.getUTCMinutes()).padStart(2, "0")}`;
}

function parseRoundWindow(roundLabel) {
  const match = roundLabel.match(/^([A-Za-z]{3}),\s*(\d{2})\/(\d{2})\s*·\s*(\d{4})-(\d{4})$/);
  if (!match) return null;
  const [, weekday, month, day, start, end] = match;
  return {
    weekday,
    month: Number(month),
    day: Number(day),
    start,
    end: addMinuteToTime(end),
  };
}

function roundWindowDate(parsedWindow, time) {
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  return new Date(BID_YEAR - 1, parsedWindow.month - 1, parsedWindow.day, hour, minute);
}

function bidWindowForRankRound(rank, roundNumber, area = currentViewArea()) {
  const importedWindow = databaseBidWindowForRankRound(area, rank, roundNumber);
  if (importedWindow) return importedWindow;

  const index = rank - 1;
  const rowBlock = Math.floor(index / bidStartTimes.length);
  const dateLabel = roundDateBlocksForArea(area)[rowBlock]?.[roundNumber - 1];
  const startTime = bidStartTimes[index % bidStartTimes.length];
  if (!dateLabel || !startTime) return null;

  const parsedWindow = parseRoundWindow(bidWindowLabel(dateLabel, startTime));
  if (!parsedWindow) return null;

  return {
    rank,
    round: roundNumber,
    start: roundWindowDate(parsedWindow, parsedWindow.start),
    end: roundWindowDate(parsedWindow, parsedWindow.end),
  };
}

function currentUserSeniorityRank(area = currentUser.area) {
  if (area === currentUser.area && Number.isFinite(currentUser.seniorityRank)) {
    return currentUser.seniorityRank;
  }

  const currentEntryIndex = activeRosterEntries(area).findIndex(seniorityEntryMatchesCurrentUser);
  return currentEntryIndex >= 0 ? currentEntryIndex + 1 : null;
}

function currentUserBidderCount(area = currentUser.area) {
  if (area === currentUser.area && Number.isFinite(currentUser.bidderCount) && currentUser.bidderCount > 0) {
    return currentUser.bidderCount;
  }

  return activeRosterEntries(area).length || currentUser.bidderCount;
}

function currentUserBidWindow(date = new Date(), area = currentUser.area) {
  const rank = currentUserSeniorityRank(area);
  if (!Number.isFinite(rank)) return null;

  const roundCount = roundDateBlocksForArea(area)[0]?.length || 0;
  const windows = Array.from({ length: roundCount }, (_, index) => bidWindowForRankRound(rank, index + 1, area))
    .filter(Boolean);

  return windows.find((window) => date < window.end) || null;
}

function roundWindows(roundNumber, area = currentViewArea()) {
  return activeRosterEntries(area)
    .map((_, index) => bidWindowForRankRound(index + 1, roundNumber, area))
    .filter(Boolean);
}

function areaBidRoundState(date = new Date(), area = currentViewArea()) {
  const roundCount = roundDateBlocksForArea(area)[0]?.length || 0;
  for (let round = 1; round <= roundCount; round += 1) {
    const windows = roundWindows(round, area);
    const activeWindow = windows.find((window) => date >= window.start && date < window.end);
    if (activeWindow) {
      return {
        phase: "open",
        round,
        activeRank: activeWindow.rank,
        startsAt: activeWindow.start,
        endsAt: activeWindow.end,
      };
    }

    const roundEnd = windows.reduce((latest, window) => (window.end > latest ? window.end : latest), new Date(0));
    const validationEndsAt = new Date(roundEnd.getTime() + ROUND_VALIDATION_DURATION_MS);
    if (date >= roundEnd && date < validationEndsAt) {
      return {
        phase: "validation",
        round,
        validationEndsAt,
      };
    }
  }

  return null;
}

function downloadBidWindowsIcs(rank = null) {
  const requestedRank = Number(rank);
  const hasRequestedRank = rank !== null && rank !== undefined && rank !== "" && Number.isFinite(requestedRank);
  const person = hasRequestedRank
    ? seniority.find((item) => item.rank === requestedRank)
    : seniority.find(personMatchesCurrentUser) || buildSeniority(currentUser.area).find(personMatchesCurrentUser);
  if (!person) return;

  const calendarYear = BID_YEAR - 1;
  const stamp = icsTimestamp();
  const owner = person.initials || currentUser.initials;
  const events = person.rounds
    .map((roundLabel, index) => {
      const round = parseRoundWindow(roundLabel);
      if (!round) return "";
      const roundNumber = index + 1;
      const summary = `NATCA ZLA ${BID_YEAR} Bidding - Round ${roundNumber}`;
      const description = [
        `${person.firstName} ${person.lastName} (${owner})`,
        `${person.bidAs} bidding window`,
        `Round ${roundNumber}: ${roundLabel}`,
      ].join("\n");

      return [
        "BEGIN:VEVENT",
        `UID:natca-zla-${BID_YEAR}-${owner.toLowerCase()}-r${roundNumber}@zlabidding.local`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=America/Los_Angeles:${icsDateTime(calendarYear, round.month, round.day, round.start)}`,
        `DTEND;TZID=America/Los_Angeles:${icsDateTime(calendarYear, round.month, round.day, round.end)}`,
        `SUMMARY:${escapeIcsText(summary)}`,
        `DESCRIPTION:${escapeIcsText(description)}`,
        "LOCATION:NATCA ZLA Bidding Website",
        "END:VEVENT",
      ].join("\r\n");
    })
    .filter(Boolean);

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NATCA ZLA//Bidding Prototype//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:NATCA ZLA Bidding Windows",
    "X-WR-TIMEZONE:America/Los_Angeles",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `natca-zla-${owner.toLowerCase()}-${BID_YEAR}-bid-windows.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function fallbackInitials(firstName, lastName) {
  return `${firstName[0] || ""}${lastName[0] || ""}`.toUpperCase();
}

function seniorityEntryArea(entry) {
  return entry[4] || "Area A";
}

function seniorityEntryEmail(entry) {
  return entry[5] || "";
}

function seniorityEntryPhone(entry) {
  return entry[6] || "";
}

function seniorityEntryActive(entry) {
  return entry[7] !== false;
}

function normalizeLeaveSlotAllowance(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : DEFAULT_BUE_LEAVE_SLOT_ALLOWANCE;
}

function seniorityEntryLeaveSlotAllowance(entry) {
  return normalizeLeaveSlotAllowance(entry?.[8]);
}

function normalizedInitials(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function seniorityIdentityMatchesCurrentUser({ area, initials, email } = {}) {
  if ((area || currentUser.area) !== currentUser.area) return false;

  const personEmail = normalizedEmail(email);
  const userEmail = normalizedEmail(currentUser.email);
  if (personEmail && userEmail && personEmail === userEmail) return true;

  const personInitials = normalizedInitials(initials);
  const userInitials = normalizedInitials(currentUser.initials);
  return Boolean(personInitials && userInitials && personInitials === userInitials);
}

function seniorityEntryMatchesCurrentUser(entry) {
  if (!entry) return false;
  return seniorityIdentityMatchesCurrentUser({
    area: seniorityEntryArea(entry),
    initials: entry[3] || fallbackInitials(entry[1] || "", entry[0] || ""),
    email: seniorityEntryEmail(entry),
  });
}

function personMatchesCurrentUser(person) {
  return seniorityIdentityMatchesCurrentUser(person);
}

function activeRosterEntries(area = null) {
  return senioritySource.filter((entry) =>
    seniorityEntryActive(entry) &&
    (!area || seniorityEntryArea(entry) === area)
  );
}

function rosterEntryToPerson(entry, rank = null, options = {}) {
  const [lastName, firstName, bidAs, initials] = entry;
  const area = seniorityEntryArea(entry);
  const resolvedRank = Number.isFinite(rank) ? rank : activeRosterEntries(seniorityEntryArea(entry)).findIndex((item) => item === entry) + 1;
  const shouldUseFallbackInitials = options.fallbackInitials !== false;
  return {
    rank: resolvedRank,
    firstName,
    lastName,
    bidAs: normalizeBidRoleForArea(bidAs, area),
    initials: initials || (shouldUseFallbackInitials ? fallbackInitials(firstName, lastName) : ""),
    area,
    email: seniorityEntryEmail(entry),
    phone: seniorityEntryPhone(entry),
    active: seniorityEntryActive(entry),
    leaveSlotAllowance: seniorityEntryLeaveSlotAllowance(entry),
  };
}

function buildSeniority(area = currentViewArea()) {
  const roundState = areaBidRoundState(new Date(), area);
  const openRank = roundState?.phase === "open" ? roundState.activeRank : null;
  const openRound = roundState?.phase === "open" ? roundState.round : null;
  const roundCount = roundDateBlocksForArea(area)[0]?.length || 4;
  return activeRosterEntries(area).map((entry, index) => {
    const [lastName, firstName, bidAs, initials] = entry;
    const normalizedBidAs = normalizeBidRoleForArea(bidAs, area);
    const rank = index + 1;
    const hasActiveBidder = Number.isFinite(openRank);
    const isCurrentBidder = hasActiveBidder && rank === openRank;

    return {
      rank,
      firstName,
      lastName,
      bidAs: normalizedBidAs,
      initials: initials || fallbackInitials(firstName, lastName),
      area,
      email: seniorityEntryEmail(entry),
      phone: seniorityEntryPhone(entry),
      active: true,
      leaveSlotAllowance: seniorityEntryLeaveSlotAllowance(entry),
      status: !hasActiveBidder ? "waiting" : rank < openRank ? "done" : isCurrentBidder ? "active" : "waiting",
      rounds: Array.from({ length: roundCount }, (_, roundIndex) => {
        return bidWindowScheduleLabel(bidWindowForRankRound(rank, roundIndex + 1, area));
      }),
      completed: hasActiveBidder && rank < openRank ? [1] : [],
      openRound: isCurrentBidder ? openRound : undefined,
    };
  });
}

let seniority = buildSeniority();

const history = [
  { area: "Area A", time: "May 7, 2026 14:32", actor: "OC", title: "Draft saved", detail: "Selected Line 15 OC and updated Flex preference." },
  { area: "Area A", time: "May 7, 2026 14:18", actor: "OC", title: "Leave queue reordered", detail: "Moved Thanksgiving week to priority 4." },
  { area: "Area A", time: "May 7, 2026 14:04", actor: "OC", title: "RDO line viewed", detail: "Compared Line 14 OP, Line 15 OC, and Line 18 GM." },
  { area: "Area A", time: "May 7, 2026 13:52", actor: "System", title: "Bid window opened", detail: "Your Area A seniority window started. You are on the clock." },
];

let intakeQueue = [
  {
    id: "rdo-oc-15",
    type: "RDO Line",
    area: "Area A",
    name: "Michael Schoelen",
    initials: "OC",
    bidAs: "GL",
    seniority: 5,
    status: "Approved",
    submittedAt: "May 26, 2026 10:42",
    approvedBy: "OC",
    approvedAt: "May 26, 2026 10:49",
    line: "15",
    fatigueGroup: "C",
    flex: "Yes",
    aws: "No",
    mid: "No",
    summary: "Line 15 · Group C · Flex Yes · AWS No · Mid No",
  },
  {
    id: "leave-oc-sep",
    type: "Leave",
    area: "Area A",
    name: "Michael Schoelen",
    initials: "OC",
    bidAs: "GL",
    seniority: 5,
    status: "Pending",
    submittedAt: "May 26, 2026 10:44",
    range: "Sep 2 - Sep 5, 2027",
    days: 4,
    summary: "Sep 2 - Sep 5, 2027 · 4 days",
  },
];

let activeOverrideId = null;
let activeDenialId = null;
let activeIntakeDetailId = null;
let intakeSearchQuery = "";
const intakeFilters = {
  status: "all",
  type: "all",
  area: "all",
  round: "all",
};
let helpPanelMode = "user";
let activeHelpThreadId = "help-oc-1";
let helpThreads = [
  {
    id: "help-oc-1",
    area: "Area A",
    requester: "Michael Schoelen",
    initials: "OC",
    status: "Open",
    updatedAt: "May 26, 2026 11:12",
    messages: [
      {
        author: "OC",
        role: "BUE",
        time: "May 26, 2026 11:08",
        body: "Can intake confirm my leave request before I submit?",
      },
      {
        author: "Intake",
        role: "Intake",
        time: "May 26, 2026 11:12",
        body: "We can review it. Send the exact dates and we will confirm the available slots.",
      },
    ],
  },
];

function pendingIntakeItems() {
  return intakeQueue.filter((item) => item.status === "Pending");
}

function currentUserRdoRequest() {
  return intakeQueue.find((item) =>
    item.type === "RDO Line" &&
    item.initials === currentUser.initials &&
    ["Pending", "Approved"].includes(item.status)
  );
}

function currentUserHasRdoRequestForLeave() {
  return Boolean(currentUserRdoRequest()) ||
    rdoLines.some((line) => line.status === "Taken" && line.cpc === currentUser.initials);
}

function leaveRdoRequestErrorMessage() {
  return currentUserHasRdoRequestForLeave()
    ? ""
    : "Submit your RDO request before submitting leave. Intake approval is not required first.";
}

function currentUserRdoAssignment() {
  const request = currentUserRdoRequest();
  if (request) {
    return {
      request,
      line: rdoLines.find((line) => line.line === request.line && lineForArea(line, request.area || currentUser.area)) || null,
    };
  }

  const approvedLine = rdoLines.find((line) =>
    lineForArea(line, currentUser.area) &&
    line.status === "Taken" &&
    line.cpc === currentUser.initials
  );
  return approvedLine ? { request: null, line: approvedLine } : null;
}

function selectedLineRequest(line) {
  return intakeQueue.find((item) =>
    item.type === "RDO Line" &&
    item.line === line.line &&
    item.initials === currentUser.initials &&
    item.status === "Pending"
  );
}

function logHistory(area, title, detail, actor = currentUser?.initials || "Guest") {
  history.unshift({
    area,
    time: formatDateTime(new Date()),
    actor,
    title,
    detail,
  });
}

function warnUnconfirmedBidder(action = "submit bids") {
  const message = `Sign in as a confirmed BUE before you ${action}. Public chat users are not verified for bidding.`;
  if (isMemberAppVisible()) {
    setLeaveBuilderStatus(message, "error");
  } else {
    setHelpStatus(message, "error");
  }
  window.alert(message);
}

function canSubmitBueBid() {
  return isConfirmedHelpUser();
}

function shouldEnforceBidWindows() {
  return enforceBidWindows;
}

function normalizeBidWindowTestRound(value) {
  const round = Number(value);
  return Number.isInteger(round) && round >= 1 && round <= 4 ? round : null;
}

function activeTestBidRound() {
  return bidWindowLockIsBypassed() ? bidWindowTestRound : null;
}

function bidWindowLockIsBypassed() {
  return !shouldEnforceBidWindows();
}

function currentUserBidWindowStatus(date = new Date()) {
  const window = currentUserBidWindow(date);
  const inHomeArea = isViewingHomeArea();
  return {
    window,
    isOpen: Boolean(inHomeArea && (bidWindowLockIsBypassed() || (window && date >= window.start && date <= window.end))),
  };
}

function bidWindowErrorMessage(actionLabel = "Bids", date = new Date()) {
  const { window, isOpen } = currentUserBidWindowStatus(date);
  if (isOpen) return "";
  if (!isViewingHomeArea()) return `${actionLabel} can only be submitted from your home area view.`;
  if (!window) return `${actionLabel} can only be submitted during your allotted bid window.`;
  if (date < window.start) return `${actionLabel} can only be submitted during your allotted bid window. Your Round ${window.round} window opens ${formatDateTime(window.start)}.`;
  return `${actionLabel} can only be submitted during your allotted bid window. Your Round ${window.round} window closed ${formatDateTime(window.end)}.`;
}

function leaveBidWindowErrorMessage(date = new Date()) {
  return bidWindowErrorMessage("Leave bids", date);
}

function rdoBidWindowErrorMessage(date = new Date()) {
  return bidWindowErrorMessage("RDO bids", date);
}

async function setBidWindowEnforcement(enabled) {
  if (!hasSystemAdminAccess()) return;
  enforceBidWindows = Boolean(enabled);
  storeJsonValue(BID_WINDOW_LOCK_STORAGE_KEY, enforceBidWindows);
  syncBidWindowTestingControls();

  try {
    const result = await saveSupabaseBidWindowEnforcement(enforceBidWindows);
    if (result.missingRoutine) {
      bidWindowSettingsFallbackMessage = "Testing mode changed for this browser. Install database/bid_window_testing_admin.sql to share it with all BUEs.";
    } else {
      bidWindowSettingsFallbackMessage = "";
    }
  } catch (error) {
    enforceBidWindows = !enforceBidWindows;
    storeJsonValue(BID_WINDOW_LOCK_STORAGE_KEY, enforceBidWindows);
    syncBidWindowTestingControls();
    window.alert(error.message || "Bid-window testing mode could not be saved.");
    return;
  }

  logHistory(
    "All Areas",
    enforceBidWindows ? "Bid-window lock enabled" : "Bid-window lock disabled",
    `${currentUser.initials} ${enforceBidWindows ? "required BUEs to submit inside their assigned bid windows" : "allowed BUE self-service bids outside assigned bid windows for testing"}.`
  );
  renderApp();
}

async function setBidWindowTestRound(value) {
  if (!hasSystemAdminAccess()) return;
  const previousRound = bidWindowTestRound;
  bidWindowTestRound = normalizeBidWindowTestRound(value);
  storeJsonValue(BID_WINDOW_TEST_ROUND_STORAGE_KEY, bidWindowTestRound);
  syncBidWindowTestingControls();

  try {
    const result = await saveSupabaseBidWindowTestingSettings();
    if (result.missingRoutine) {
      bidWindowSettingsFallbackMessage = "Test round changed for this browser. Install database/bid_window_testing_admin.sql to share it with all BUEs.";
    } else {
      bidWindowSettingsFallbackMessage = "";
    }
  } catch (error) {
    bidWindowTestRound = previousRound;
    storeJsonValue(BID_WINDOW_TEST_ROUND_STORAGE_KEY, bidWindowTestRound);
    syncBidWindowTestingControls();
    window.alert(error.message || "Test round could not be saved.");
    return;
  }

  logHistory(
    "All Areas",
    bidWindowTestRound ? `Testing Round ${bidWindowTestRound} selected` : "Testing round reset",
    `${currentUser.initials} set bid-window testing to ${bidWindowTestRound ? `Round ${bidWindowTestRound}` : "the actual schedule"}.`
  );
  renderApp();
}

function syncBidWindowTestingControls() {
  document.querySelectorAll("[data-bid-window-enforcement-toggle]").forEach((input) => {
    input.checked = shouldEnforceBidWindows();
    input.disabled = !hasSystemAdminAccess();
  });

  document.querySelectorAll("[data-bid-window-test-round]").forEach((select) => {
    select.value = bidWindowTestRound ? String(bidWindowTestRound) : "";
    select.disabled = !hasSystemAdminAccess() || shouldEnforceBidWindows();
  });

  const enabled = shouldEnforceBidWindows();
  const testRound = activeTestBidRound();
  setText("[data-bid-window-enforcement-state]", enabled ? "Strict Windows On" : "Testing Mode");
  setText(
    "[data-bid-window-enforcement-copy]",
    bidWindowSettingsFallbackMessage || (enabled
      ? "BUEs can submit only during their assigned bid window."
      : testRound
      ? `BUE self-service bids are open for testing as Round ${testRound}.`
      : "BUE self-service bids can be submitted outside the assigned bid window.")
  );
}

function applyBidYearSettings(settings) {
  if (!settings || typeof settings !== "object") return;
  if (typeof settings.enforce_bid_windows === "boolean") {
    enforceBidWindows = settings.enforce_bid_windows;
    bidWindowSettingsFallbackMessage = "";
    storeJsonValue(BID_WINDOW_LOCK_STORAGE_KEY, enforceBidWindows);
  }
  if (Object.hasOwn(settings, "test_bid_round")) {
    bidWindowTestRound = normalizeBidWindowTestRound(settings.test_bid_round);
    storeJsonValue(BID_WINDOW_TEST_ROUND_STORAGE_KEY, bidWindowTestRound);
  }
}

async function saveSupabaseBidWindowTestingSettings() {
  const client = supabaseClient();
  if (!client || !supabaseState.connected) return { saved: false, missingRoutine: false };

  const { error } = await client.rpc("set_bid_window_testing_settings", {
    requested_bid_year: BID_YEAR,
    should_enforce: shouldEnforceBidWindows(),
    test_round: bidWindowTestRound,
  });

  if (error) {
    if (isMissingSupabaseRoutine(error)) return { saved: false, missingRoutine: true };
    throw error;
  }

  return { saved: true, missingRoutine: false };
}

async function saveSupabaseBidWindowEnforcement(_enabled) {
  return saveSupabaseBidWindowTestingSettings();
}

async function addOrUpdateRdoSubmission() {
  if (!canSubmitBueBid()) {
    warnUnconfirmedBidder("submit an RDO bid");
    return;
  }

  const windowError = rdoBidWindowErrorMessage();
  if (windowError) {
    alert(windowError);
    return;
  }

  const line = rdoLinesForArea(currentUser.area).find((item) => item.line === selectedLineId);
  if (!line || line.status === "Taken") return;
  if (!selectedFatigueGroup) {
    alert("Choose a fatigue group before submitting this RDO bid.");
    return;
  }
  if (!isForcedMid(line) && !selectedMidPreference) {
    alert("Choose Yes or No for Mid before submitting this RDO bid.");
    return;
  }
  if (!selectedAwsPreference) {
    alert("Choose Yes or No for AWS before submitting this RDO bid.");
    return;
  }
  if (!selectedFlexPreference) {
    alert("Choose Yes or No for Flex before submitting this RDO bid.");
    return;
  }

  const existing = currentUserRdoRequest();
  const round = currentRoundNumber();
  const request = {
    id: existing?.id || `rdo-${currentUser.initials.toLowerCase()}-${Date.now()}`,
    type: "RDO Line",
    area: currentUser.area,
    name: userFullName(),
    initials: currentUser.initials,
    bidAs: currentUserBidAs(),
    seniority: currentUser.seniorityRank,
    status: "Pending",
    round,
    submittedAt: formatDateTime(new Date()),
    approvedBy: "",
    approvedAt: "",
    line: line.line,
    fatigueGroup: selectedFatigueGroup,
    flex: selectedFlexPreference,
    aws: selectedAwsPreference,
    mid: selectedMidValue(line),
    summary: `Round ${round} · Line ${line.line} · Group ${selectedFatigueGroup} · Flex ${selectedFlexPreference} · AWS ${selectedAwsPreference} · Mid ${selectedMidValue(line)}`,
  };

  try {
    await saveSupabaseRdoRequest(request);
  } catch (error) {
    alert(error.message || "Your RDO request could not be saved. Please try again before submitting leave.");
    return;
  }

  if (existing) {
    Object.assign(existing, request);
  } else {
    intakeQueue.unshift(request);
  }

  logHistory(currentUser.area, "RDO bid submitted", `${currentUser.initials} submitted ${request.summary}. Intake approval is still required before the line is populated.`);
  queueBidSubmittedEmail(request);
  renderApp();
}

function controllerName(person) {
  return `${person.firstName} ${person.lastName}`;
}

function manualBidControllerOptions(selectedInitials) {
  return bueRoster().map((person) => {
    const selected = person.initials === selectedInitials ? " selected" : "";
    return `<option value="${person.initials}"${selected}>#${person.rank} ${person.firstName} ${person.lastName} · ${person.initials} · ${person.bidAs}</option>`;
  }).join("");
}

function manualBidAreaOptions(selectedArea) {
  return Object.values(AREA_NAME_BY_CODE).map((area) => {
    const selected = area === selectedArea ? " selected" : "";
    return `<option value="${area}"${selected}>${area}</option>`;
  }).join("");
}

function manualBidSelectedPerson(selectedInitials) {
  const roster = bueRoster();
  return roster.find((person) => person.initials === selectedInitials) || roster[0] || {
    rank: currentUser.seniorityRank,
    firstName: currentUser.firstName,
    lastName: currentUser.lastName,
    initials: currentUser.initials,
    area: currentUser.area,
    bidAs: currentUserBidAs(),
  };
}

function manualBidPerson(panel) {
  const initials = panel.querySelector("[data-manual-bid-controller]")?.value || currentUser.initials;
  return manualBidSelectedPerson(initials);
}

function setManualBidStatus(panel, message, status = "info") {
  const target = panel?.querySelector("[data-manual-bid-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

function manualLeaveRangeFromDateInputs(panel) {
  const startValue = panel.querySelector("[data-manual-leave-start]")?.value || "";
  const endValue = panel.querySelector("[data-manual-leave-end]")?.value || "";
  if (!startValue && !endValue) return "";

  const keys = [...new Set([startValue || endValue, endValue || startValue].sort())];
  return formatLeaveRangeFromKeys(keys);
}

function manualLeaveRangeValue(panel) {
  return panel.querySelector("[data-manual-leave-range]")?.value.trim() || manualLeaveRangeFromDateInputs(panel);
}

function manualFatigueGroupIsAvailable(line, group, allowOverride = false) {
  if (allowOverride) return Boolean(line && group);
  if (!line || !group) return false;
  const capacity = fatigueCapacityForLine(line, null, "").find((item) => item.group === group);
  return Boolean(capacity && isGroupAvailable(capacity));
}

function manualFatigueGroupOptions(line, selectedGroup, allowOverride = false) {
  if (!line) return "";

  return fatigueCapacityForLine(line, null, "").map((item) => {
    const isSelected = item.group === selectedGroup;
    const isAvailable = isGroupAvailable(item);
    const isSelectable = isAvailable || allowOverride;
    const label = `Group ${item.group}`;
    const capacity = `Area ${item.areaUsed}/${item.areaMax}, crew ${item.crewUsed}/${item.crewMax}`;
    const suffix = isAvailable ? "" : allowOverride ? " - Full, override" : " - Full";
    return `<option class="${isAvailable ? "" : "manual-fatigue-group-full"}" value="${item.group}"${isSelected ? " selected" : ""}${isSelectable ? "" : " disabled"}>${label}${suffix} (${capacity})</option>`;
  }).join("");
}

function rdoLineOptionLabel(line) {
  const status = line.status === "Taken"
    ? ` · ${line.cpc || "Taken"} · unavailable`
    : " · Open";
  return `Line ${line.line} · ${line.pattern}${status}`;
}

function renderManualBidPanel(panel) {
  const values = {
    controller: panel.querySelector("[data-manual-bid-controller]")?.value || currentUser.initials,
    type: panel.querySelector("[data-manual-bid-type]")?.value || "RDO Line",
    area: panel.querySelector("[data-manual-bid-area]")?.value || currentViewArea(),
    line: panel.querySelector("[data-manual-rdo-line]")?.value || selectedLineId,
    fatigueGroup: panel.querySelector("[data-manual-fatigue-group]")?.value || selectedFatigueGroup || "A",
    fatigueOverride: Boolean(panel.querySelector("[data-manual-fatigue-override]")?.checked),
    flex: panel.querySelector("[data-manual-flex]")?.value || selectedFlexPreference || "Yes",
    aws: panel.querySelector("[data-manual-aws]")?.value || selectedAwsPreference || "No",
    mid: panel.querySelector("[data-manual-mid]")?.value || selectedMidPreference || "No",
    range: panel.querySelector("[data-manual-leave-range]")?.value || "",
    leaveStart: panel.querySelector("[data-manual-leave-start]")?.value || "",
    leaveEnd: panel.querySelector("[data-manual-leave-end]")?.value || "",
    days: panel.querySelector("[data-manual-leave-days]")?.value || "",
    round: panel.querySelector("[data-manual-leave-round]")?.value || String(currentRoundNumber()),
    notes: panel.querySelector("[data-manual-leave-notes]")?.value || "",
  };
  const selectedPerson = manualBidSelectedPerson(values.controller);
  const lockedArea = selectedPerson.area || currentViewArea();

  const controllerSelect = panel.querySelector("[data-manual-bid-controller]");
  if (controllerSelect) {
    const roster = bueRoster();
    controllerSelect.innerHTML = manualBidControllerOptions(values.controller);
    controllerSelect.value = roster.some((person) => person.initials === values.controller) ? values.controller : roster[0]?.initials || "";
  }

  const typeSelect = panel.querySelector("[data-manual-bid-type]");
  if (typeSelect) typeSelect.value = values.type;

  const areaSelect = panel.querySelector("[data-manual-bid-area]");
  if (areaSelect) {
    areaSelect.innerHTML = manualBidAreaOptions(lockedArea);
    areaSelect.value = lockedArea;
    areaSelect.disabled = true;
    areaSelect.title = "Area is set from the controller roster. Change it from the Admin panel.";
  }

  const rdoFields = panel.querySelector("[data-manual-rdo-fields]");
  const leaveFields = panel.querySelector("[data-manual-leave-fields]");
  const isLeave = values.type === "Leave";
  if (rdoFields) rdoFields.hidden = isLeave;
  if (leaveFields) leaveFields.hidden = !isLeave;

  const lineSelect = panel.querySelector("[data-manual-rdo-line]");
  const areaLines = rdoLinesForArea(areaSelect?.value || lockedArea);
  if (lineSelect) {
    const openLines = areaLines.filter((line) => line.status !== "Taken");
    lineSelect.innerHTML = areaLines.map((line) => {
      const isTaken = line.status === "Taken";
      const selected = !isTaken && line.line === values.line ? " selected" : "";
      return `<option class="${isTaken ? "manual-rdo-line-taken" : ""}" value="${line.line}"${selected}${isTaken ? " disabled" : ""}>${escapeHtml(rdoLineOptionLabel(line))}</option>`;
    }).join("");
    lineSelect.value = openLines.some((line) => line.line === values.line) ? values.line : openLines[0]?.line || "";
    lineSelect.disabled = !openLines.length;
    lineSelect.title = openLines.length ? "" : "No open RDO lines are available for this controller's area.";
  }

  const selectedLine = areaLines.find((line) => line.line === lineSelect?.value);
  const fatigueOverrideInput = panel.querySelector("[data-manual-fatigue-override]");
  if (fatigueOverrideInput) {
    fatigueOverrideInput.checked = values.fatigueOverride;
  }
  const fatigueSelect = panel.querySelector("[data-manual-fatigue-group]");
  if (fatigueSelect) {
    const requestedGroup = ["A", "B", "C"].includes(values.fatigueGroup) ? values.fatigueGroup : "A";
    const availableGroups = selectedLine
      ? fatigueCapacityForLine(selectedLine, null, "")
        .filter((item) => values.fatigueOverride || isGroupAvailable(item))
        .map((item) => item.group)
      : [];
    const resolvedGroup = availableGroups.includes(requestedGroup) ? requestedGroup : availableGroups[0] || "";
    fatigueSelect.innerHTML = manualFatigueGroupOptions(selectedLine, resolvedGroup, values.fatigueOverride);
    fatigueSelect.value = resolvedGroup;
    fatigueSelect.disabled = !resolvedGroup;
    fatigueSelect.title = resolvedGroup ? "" : "No fatigue groups are available for this line.";
  }
  const midSelect = panel.querySelector("[data-manual-mid]");
  if (midSelect) {
    if (selectedLine && isMidLineByDesign(selectedLine)) {
      midSelect.innerHTML = '<option value="BID">Bid Line</option>';
      midSelect.value = "BID";
      midSelect.disabled = true;
    } else {
      midSelect.innerHTML = `
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      `;
      midSelect.value = values.mid === "Yes" ? "Yes" : "No";
      midSelect.disabled = false;
    }
  }

  const flexSelect = panel.querySelector("[data-manual-flex]");
  if (flexSelect) flexSelect.value = values.flex === "No" ? "No" : "Yes";
  const awsSelect = panel.querySelector("[data-manual-aws]");
  if (awsSelect) awsSelect.value = values.aws === "Yes" ? "Yes" : "No";

  const rangeInput = panel.querySelector("[data-manual-leave-range]");
  if (rangeInput) rangeInput.value = values.range;
  const startInput = panel.querySelector("[data-manual-leave-start]");
  if (startInput) startInput.value = values.leaveStart;
  const endInput = panel.querySelector("[data-manual-leave-end]");
  if (endInput) endInput.value = values.leaveEnd;
  const daysInput = panel.querySelector("[data-manual-leave-days]");
  const roundSelect = panel.querySelector("[data-manual-leave-round]");
  if (roundSelect) roundSelect.value = ["1", "2", "3", "4", "5", "6"].includes(values.round) ? values.round : String(currentRoundNumber());
  if (daysInput) {
    const resolvedRound = Number(roundSelect?.value || values.round || currentRoundNumber());
    const dateInputRange = manualLeaveRangeFromDateInputs(panel);
    const autoDays = dateInputRange ? chargeableLeaveDatesForInitials(dateInputRange, controllerSelect?.value || values.controller, resolvedRound).length : "";
    daysInput.value = daysInput.hasAttribute("data-manual-leave-days-auto") ? autoDays : values.days;
  }
  const notesInput = panel.querySelector("[data-manual-leave-notes]");
  if (notesInput) notesInput.value = values.notes;
}

function renderManualBidEntry() {
  document.querySelectorAll("[data-manual-bid-panel]").forEach(renderManualBidPanel);
}

function submitManualRdoBid(panel, person, area) {
  const lineId = panel.querySelector("[data-manual-rdo-line]")?.value;
  const line = rdoLinesForArea(area).find((item) => item.line === lineId);
  if (!line) {
    setManualBidStatus(panel, "Choose an RDO line before adding this bid.", "error");
    return;
  }
  if (line.status === "Taken") {
    setManualBidStatus(panel, `Line ${line.line} has already been bid and cannot be selected here.`, "error");
    return;
  }

  const fatigueGroup = panel.querySelector("[data-manual-fatigue-group]")?.value || "A";
  const fatigueOverride = Boolean(panel.querySelector("[data-manual-fatigue-override]")?.checked);
  const fatigueGroupClosed = !manualFatigueGroupIsAvailable(line, fatigueGroup);
  if (!manualFatigueGroupIsAvailable(line, fatigueGroup, fatigueOverride)) {
    setManualBidStatus(panel, `Group ${fatigueGroup} is full for Line ${line.line}. Choose an available fatigue group before adding this bid.`, "error");
    return;
  }
  const usedFatigueOverride = fatigueOverride && fatigueGroupClosed;
  const flex = panel.querySelector("[data-manual-flex]")?.value || "Yes";
  const aws = panel.querySelector("[data-manual-aws]")?.value || "No";
  const mid = isMidLineByDesign(line) ? "BID" : panel.querySelector("[data-manual-mid]")?.value || "No";
  const submittedAt = formatDateTime(new Date());
  const existing = intakeQueue.find((item) =>
    item.type === "RDO Line" &&
    item.initials === person.initials &&
    ["Pending", "Approved"].includes(item.status)
  );
  const request = {
    id: existing?.id || `manual-rdo-${person.initials.toLowerCase()}-${Date.now()}`,
    type: "RDO Line",
    area,
    name: controllerName(person),
    initials: person.initials,
    bidAs: person.bidAs,
    seniority: person.rank,
    status: "Pending",
    submittedAt,
    approvedBy: "",
    approvedAt: "",
    manualEntry: true,
    enteredBy: currentUser.initials,
    line: line.line,
    fatigueGroup,
    fatigueOverride: usedFatigueOverride,
    reviewNote: usedFatigueOverride ? `Fatigue override: Group ${fatigueGroup} was full or closed when entered by ${currentUser.initials}.` : "",
    flex,
    aws,
    mid,
    summary: `Line ${line.line} · Group ${fatigueGroup} · Flex ${flex} · AWS ${aws} · Mid ${mid}${usedFatigueOverride ? " · Fatigue override" : ""}`,
  };

  if (existing) {
    Object.assign(existing, request);
  } else {
    intakeQueue.unshift(request);
  }

  logHistory(area, "Manual RDO bid entered", `${currentUser.initials} entered ${request.summary} for ${person.initials}. Intake approval is still required before the line is populated.`);
  queueBidSubmittedEmail(request);
  activeOverrideId = null;
  activeDenialId = null;
  renderApp();
  setManualBidStatus(panel, `${person.initials}'s RDO bid was added to the intake queue.`, "success");
}

function manualLeaveValidationMessage({ person, area, range, dateKeys, round, days, weekKeys }) {
  const rdoConflicts = dateKeys.filter((key) => isRdoDateForInitials(key, person.initials));
  if (rdoConflicts.length) {
    return `Leave cannot include ${person.initials}'s RDO: ${formatLeaveConflictDates(rdoConflicts)}.`;
  }

  if (round === 1) {
    const usedWeeks = roundOneWeekKeySetForItems([
      ...leaveRoundUsageForInitials(person.initials, 1),
      { range, round },
    ]);

    if (usedWeeks.size > roundOneWeekLimit()) {
      return `Round 1 can include up to ${roundOneWeekLimit()} bid weeks for ${person.initials}. This request counts as ${weekKeys.length} and would bring ${person.initials} to ${usedWeeks.size}.`;
    }
    return "";
  }

  const roundLimit = leaveDayLimitForRound(round);
  const alreadyBidDays = leaveRoundUsageForInitials(person.initials, round)
    .reduce((total, item) => total + leaveItemChargedDays(item), 0);
  const projectedDays = alreadyBidDays + days;
  if (projectedDays > roundLimit) {
    return `Round ${round} can include up to ${roundLimit} charged days for ${person.initials}. This would bring ${person.initials} to ${projectedDays}.`;
  }

  return "";
}

function submitManualLeaveBid(panel, person, area) {
  const range = manualLeaveRangeValue(panel);
  const round = Number(panel.querySelector("[data-manual-leave-round]")?.value || currentRoundNumber());
  const notes = panel.querySelector("[data-manual-leave-notes]")?.value.trim() || "";
  const dateKeys = datesInLeaveRange(range);
  if (!dateKeys.length) {
    setManualBidStatus(panel, "Use a range like Jan 10 - Jan 16, 2027.", "error");
    return;
  }
  if (invalidLeaveYearDateKeys(dateKeys).length) {
    setManualBidStatus(panel, "Leave bids must stay between Jan 10, 2027 and Jan 8, 2028.", "error");
    return;
  }

  const chargeableDates = chargeableLeaveDatesForInitials(range, person.initials, round);
  const enteredDays = Number(panel.querySelector("[data-manual-leave-days]")?.value || chargeableDates.length);
  if (!Number.isFinite(enteredDays) || enteredDays < 1) {
    setManualBidStatus(panel, "Enter the number of charged leave days.", "error");
    return;
  }
  if (enteredDays !== chargeableDates.length) {
    setManualBidStatus(panel, `That range charges ${chargeableDates.length} ${chargeableDates.length === 1 ? "day" : "days"} for ${person.initials}.`, "error");
    return;
  }

  const weekKeys = round === 1 ? roundOneWeekKeysForDateKeys(dateKeys) : [];
  const weekUnits = weekKeys.length;
  const validationMessage = manualLeaveValidationMessage({
    person,
    area,
    range,
    dateKeys,
    round,
    days: enteredDays,
    weekKeys,
  });
  if (validationMessage) {
    setManualBidStatus(panel, validationMessage, "error");
    return;
  }

  const capacityMessage = leaveAreaCapacityMessage(area, person.bidAs, [{
    area,
    bidAs: person.bidAs,
    initials: person.initials,
  }]);
  if (capacityMessage) {
    setManualBidStatus(panel, capacityMessage, "error");
    return;
  }

  const submittedAt = formatDateTime(new Date());
  const request = {
    id: `manual-leave-${person.initials.toLowerCase()}-${Date.now()}`,
    type: "Leave",
    area,
    name: controllerName(person),
    initials: person.initials,
    bidAs: person.bidAs,
    seniority: person.rank,
    status: "Pending",
    submittedAt,
    manualEntry: true,
    enteredBy: currentUser.initials,
    range,
    days: enteredDays,
    round,
    weekUnits,
    weekKeys,
    summary: `${range} · ${enteredDays} ${enteredDays === 1 ? "day" : "days"}${weekUnits ? ` · ${weekUnits} bid week${weekUnits === 1 ? "" : "s"}` : ""}`,
  };

  intakeQueue.unshift(request);
  leaveBids.push({
    priority: nextLeavePriority(),
    range: request.range,
    days: request.days,
    status: "Pending",
    notes,
    initials: person.initials,
    area,
    round,
    weekUnits,
    weekKeys,
  });

  logHistory(area, "Manual leave bid entered", `${currentUser.initials} entered ${request.range} for ${person.initials}. Intake approval is required before leave slots are populated.`);
  queueBidSubmittedEmail(request);
  activeOverrideId = null;
  activeDenialId = null;
  renderApp();
  setManualBidStatus(panel, `${person.initials}'s leave bid was added to the intake queue.`, "success");
}

function submitManualBidEntry(panel) {
  if (!(hasIntakeAccess() || hasSystemAdminAccess())) {
    setManualBidStatus(panel, "Manual bid entry requires intake or admin access.", "error");
    return;
  }

  const person = manualBidPerson(panel);
  const area = panel.querySelector("[data-manual-bid-area]")?.value || currentViewArea();
  const type = panel.querySelector("[data-manual-bid-type]")?.value || "RDO Line";
  if (type === "Leave") {
    submitManualLeaveBid(panel, person, area);
    return;
  }
  submitManualRdoBid(panel, person, area);
}

function setLeaveBuilderStatus(message, status = "info") {
  const target = document.querySelector("[data-leave-builder-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

function leaveBuilderValues() {
  const range = document.querySelector("[data-leave-range-input]")?.value.trim() || "";
  const days = Number(document.querySelector("[data-leave-days-input]")?.value || 0);
  const notes = document.querySelector("[data-leave-notes-input]")?.value.trim() || "";
  return { range, days, notes };
}

function orderedLeaveRangeKeys() {
  return [leaveRangeStartKey, leaveRangeEndKey].sort();
}

function leaveBuilderDateKeys() {
  if (!leaveRangeStartKey || !leaveRangeEndKey) return [];
  const [startKey, endKey] = orderedLeaveRangeKeys();
  const keys = [];
  const cursor = dateFromKey(startKey);
  const end = dateFromKey(endKey);

  while (cursor <= end) {
    keys.push(dateKeyFromDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return keys;
}

function formatLeaveRangeFromKeys(keys) {
  if (!keys.length) return "";
  const start = dateFromKey(keys[0]);
  const end = dateFromKey(keys[keys.length - 1]);
  const sameDay = keys.length === 1;
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();
  const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });
  const fullFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

  if (sameDay) return fullFormatter.format(start);
  if (sameMonth && sameYear) {
    return `${monthFormatter.format(start)} ${start.getDate()} - ${end.getDate()}, ${end.getFullYear()}`;
  }
  if (sameYear) {
    return `${monthFormatter.format(start)} ${start.getDate()} - ${monthFormatter.format(end)} ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${fullFormatter.format(start)} - ${fullFormatter.format(end)}`;
}

function uiStatusFromDatabase(status) {
  const normalized = String(status || "").toLowerCase();
  const labels = {
    draft: "Draft",
    preview: "Preview",
    pending: "Pending",
    approved: "Approved",
    denied: "Denied",
    cancelled: "Cancelled",
  };
  return labels[normalized] || "Pending";
}

function databaseStatusFromUi(status) {
  return String(status || "Pending").toLowerCase();
}

function syncLeaveBuilderInputs() {
  const keys = leaveBuilderDateKeys();
  const rangeInput = document.querySelector("[data-leave-range-input]");
  const daysInput = document.querySelector("[data-leave-days-input]");
  const chargeableDays = chargeableLeaveDatesForInitials(formatLeaveRangeFromKeys(keys), currentUser.initials, currentRoundNumber()).length;

  if (rangeInput) rangeInput.value = formatLeaveRangeFromKeys(keys);
  if (daysInput) daysInput.value = keys.length ? chargeableDays : "";
}

function syncLeavePickerMonthToRange() {
  const anchorDate = dateFromKey(leaveRangeStartKey || selectedLeaveDateKey);
  leavePickerYear = anchorDate.getFullYear();
  leavePickerMonthIndex = anchorDate.getMonth();
}

function setLeavePickerOpen(isOpen) {
  leavePickerOpen = isOpen;
  document.querySelector("[data-leave-range-input]")?.setAttribute("aria-expanded", String(isOpen));
  renderLeaveDatePicker();
}

function isLeaveBuilderRangeDate(key) {
  return leaveBuilderDateKeys().includes(key);
}

function isLeaveBuilderRangeEdge(key) {
  return key === leaveRangeStartKey || key === leaveRangeEndKey;
}

function isLeavePreviewRangeDate(key) {
  return leaveRangePreviewActive && isLeaveBuilderRangeDate(key);
}

function selectLeaveBuilderDate(key) {
  leaveRangePreviewActive = false;

  if (!leaveRangeSelectionComplete) {
    leaveRangeEndKey = key;
    leaveRangeSelectionComplete = true;
  } else {
    leaveRangeStartKey = key;
    leaveRangeEndKey = key;
    leaveRangeSelectionComplete = false;
  }

  const keys = leaveBuilderDateKeys();
  syncLeaveBuilderInputs();
  syncLeavePickerMonthToRange();
  const range = formatLeaveRangeFromKeys(keys);
  const chargeableDays = chargeableLeaveDatesForInitials(range, currentUser.initials, currentRoundNumber()).length;

  if (leaveRangeSelectionComplete) {
    const weekUnits = roundOneWeekUnitsForDateKeys(keys);
    const roundOneNote = isRoundOneLeaveRound()
      ? `${weekUnits} bid ${weekUnits === 1 ? "week" : "weeks"}, ${chargeableDays} chargeable ${chargeableDays === 1 ? "day" : "days"}`
      : `${chargeableDays} ${chargeableDays === 1 ? "day" : "days"}`;
    setLeaveBuilderStatus(`${range} selected: ${roundOneNote}.`, "success");
  } else {
    const roundOneNote = isRoundOneLeaveRound()
      ? ` This counts as 1 bid week and ${chargeableDays} chargeable ${chargeableDays === 1 ? "day" : "days"}.`
      : "";
    setLeaveBuilderStatus(`${range} selected.${roundOneNote} Select another date to expand the range.`, "info");
  }
}

function renderLeaveDatePicker() {
  const picker = document.querySelector("[data-leave-date-picker]");
  if (!picker) return;

  picker.hidden = !leavePickerOpen;
  if (!leavePickerOpen) return;

  const firstDay = new Date(leavePickerYear, leavePickerMonthIndex, 1).getDay();
  const daysInMonth = new Date(leavePickerYear, leavePickerMonthIndex + 1, 0).getDate();
  const selectedKeys = new Set(leaveBuilderDateKeys());
  const cells = [];

  dayNames.forEach((day) => cells.push(`<span class="picker-dow">${day[0]}</span>`));
  for (let index = 0; index < firstDay; index += 1) cells.push("<span></span>");

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = dateKey(leavePickerYear, leavePickerMonthIndex + 1, day);
    const isInRange = selectedKeys.has(key);
    const isEdge = isLeaveBuilderRangeEdge(key);
    const isUnavailable = !isBidLeaveYearDate(key);
    cells.push(`
      <button class="${isInRange ? "in-range" : ""} ${isEdge ? "range-edge" : ""} ${isUnavailable ? "unavailable" : ""}" type="button" ${isUnavailable ? "disabled" : `data-leave-picker-date="${key}"`} aria-label="${monthNames[leavePickerMonthIndex]} ${day}, ${leavePickerYear}${isUnavailable ? ": leave bidding unavailable" : ""}">
        ${day}
      </button>
    `);
  }

  picker.innerHTML = `
    <div class="leave-picker-head">
      <button type="button" aria-label="Previous month" data-leave-picker-month="previous">‹</button>
      <strong>${monthNames[leavePickerMonthIndex]} ${leavePickerYear}</strong>
      <button type="button" aria-label="Next month" data-leave-picker-month="next">›</button>
    </div>
    <div class="leave-picker-grid">${cells.join("")}</div>
  `;
}

function nextLeavePriority() {
  return Math.max(0, ...leaveBids.map((bid) => Number(bid.priority) || 0)) + 1;
}

function currentRoundLeaveLimit() {
  const round = currentRoundNumber();
  if (round <= 1) return roundOneWeekLimit();
  return round <= 3 ? 10 : 5;
}

function leaveDayLimitForRound(round) {
  return round <= 3 ? 10 : 5;
}

function currentRoundNumber() {
  return activeTestBidRound() || latestAreaRound();
}

function isRoundOneLeaveRound() {
  return currentRoundNumber() === 1;
}

function roundOneWeekLimit() {
  return 2;
}

function roundRuleForRound(round = currentRoundNumber()) {
  return roundRules[round] || {
    label: "5 days",
    detail: "Leave may include up to 5 charged days.",
  };
}

function roundOneWeekUnitsForDateKeys(dateKeys) {
  return roundOneWeekKeysForDateKeys(dateKeys).length;
}

function roundOneWeekKeyForDateKey(key) {
  const date = dateFromKey(key);
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  return dateKeyFromDate(start);
}

function roundOneWeekKeysForDateKeys(dateKeys) {
  const sortedKeys = [...new Set(dateKeys)].sort();
  const periodKeys = [];
  let periodEnd = null;

  sortedKeys.forEach((key) => {
    const date = dateFromKey(key);
    if (!periodEnd || date > periodEnd) {
      const start = dateFromKey(key);
      periodEnd = new Date(start);
      periodEnd.setDate(start.getDate() + 6);
      periodKeys.push(key);
    }
  });

  return periodKeys;
}

function roundOneWeekKeySetForItems(items = []) {
  const dateKeys = items.flatMap((item) =>
    isRoundOneLeaveItem(item) ? datesInLeaveRange(item.range) : []
  );
  return new Set(roundOneWeekKeysForDateKeys(dateKeys));
}

function roundOneDraftWeekKeySet(extraItems = []) {
  return roundOneWeekKeySetForItems([...leaveDraftQueue, ...extraItems]);
}

function leaveDraftTotalDays() {
  return leaveDraftQueue.reduce((total, item) => total + Number(item.days || 0), 0);
}

function leaveDraftTotalWeeks() {
  return roundOneDraftWeekKeySet().size;
}

function isRoundOneLeaveItem(item) {
  return item?.round === 1 || Number(item?.weekUnits || 0) > 0;
}

function chargeableLeaveDatesForInitials(range, initials = currentUser.initials, round = currentRoundNumber()) {
  const keys = datesInLeaveRange(range);
  if (round !== 1) return keys;
  return keys.filter((key) => !isRdoDateForInitials(key, initials));
}

function leaveApprovalDates(item) {
  return chargeableLeaveDatesForInitials(
    item.range,
    item.initials,
    isRoundOneLeaveItem(item) ? 1 : Number(item.round || 0)
  );
}

function leaveRoundForItem(item) {
  const explicitRound = Number(item.round);
  if (Number.isFinite(explicitRound) && explicitRound > 0) return explicitRound;
  const roundMatch = String(item.notes || item.summary || "").match(/Round\s+(\d+)/i);
  return roundMatch ? Number(roundMatch[1]) : 1;
}

function leaveCommittedItems() {
  return leaveBids
    .filter((item) => ["Approved", "Pending"].includes(item.status))
    .map((item) => ({ ...item, round: leaveRoundForItem(item) }));
}

function activeLeaveItemsForInitials(initials, extraItems = []) {
  const targetInitials = String(initials || currentUser.initials).trim().toUpperCase();
  const items = [
    ...leaveBids,
    ...intakeQueue.filter((item) => item.type === "Leave"),
    ...extraItems,
  ];
  const byRequest = new Map();

  items.forEach((item) => {
    if (!["Approved", "Pending"].includes(item.status || "Pending")) return;
    const itemInitials = String(item.initials || currentUser.initials).trim().toUpperCase();
    if (itemInitials !== targetInitials) return;
    const round = leaveRoundForItem(item);
    const key = `${itemInitials}|${round}|${item.range}|${item.status || "Pending"}`;
    byRequest.set(key, {
      ...item,
      initials: itemInitials,
      round,
      status: item.status || "Pending",
    });
  });

  return [...byRequest.values()];
}

function leaveRoundUsageForInitials(initials, round, extraItems = []) {
  return activeLeaveItemsForInitials(initials, extraItems)
    .filter((item) => leaveRoundForItem(item) === round);
}

function leaveItemArea(item) {
  return item.area || currentUser.area;
}

function leaveItemBidAs(item) {
  if (item.bidAs) return item.bidAs;
  const initials = item.initials || currentUser.initials;
  const person = bueByInitials(initials);
  return person?.bidAs || currentUserBidAs();
}

function leaveSlotUnitsForItem() {
  return 1;
}

function areaLeaveSlotBudget(area = currentViewArea(), bucket = "cpc") {
  return bueRoster()
    .filter((person) => person.area === area && leaveSlotBucketForBidAs(person.bidAs) === bucket)
    .reduce((total, person) => total + normalizeLeaveSlotAllowance(person.leaveSlotAllowance), 0);
}

function areaLeaveSlotUsed(area = currentViewArea(), bucket = "cpc", extraItems = []) {
  return [...leaveCommittedItems(), ...extraItems]
    .filter((item) => leaveItemArea(item) === area && leaveSlotBucketForBidAs(leaveItemBidAs(item)) === bucket)
    .reduce((total, item) => total + leaveSlotUnitsForItem(item), 0);
}

function areaLeaveSlotUsedDays(area = currentViewArea(), bucket = "cpc", extraItems = []) {
  return [...leaveCommittedItems(), ...extraItems]
    .filter((item) => leaveItemArea(item) === area && leaveSlotBucketForBidAs(leaveItemBidAs(item)) === bucket)
    .reduce((total, item) => total + leaveItemChargedDays(item), 0);
}

function estimatedLeaveDaysFromHours(hours, hoursPerDay = LEAVE_SLOT_HOURS_PER_DAY) {
  const value = Number(hours);
  const divisor = Number(hoursPerDay);
  return Number.isFinite(value) && Number.isFinite(divisor) && divisor > 0 ? value / divisor : 0;
}

function formatEstimatedLeaveDays(days) {
  const value = Number(days);
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function formatRoundedUpLeaveDays(days) {
  const value = Number(days);
  return Number.isFinite(value) ? Math.ceil(value).toLocaleString("en-US") : "0";
}

function formatLeaveDaysLabel(days) {
  const value = Number(days);
  const label = Math.abs(value - 1) < 0.05 ? "day" : "days";
  return `${formatEstimatedLeaveDays(value)} ${label}`;
}

function submittedRdoLineForInitials(initials = currentUser.initials) {
  const normalized = String(initials || "").trim().toUpperCase();
  const request = intakeQueue.find((item) =>
    item.type === "RDO Line" &&
    item.initials === normalized &&
    ["Pending", "Approved"].includes(item.status)
  );
  const person = bueByInitials(normalized);
  const area = request?.area || person?.area || currentUser.area;

  if (request?.line) {
    return rdoLines.find((line) => line.line === request.line && lineForArea(line, area)) || null;
  }

  return rdoLines.find((line) => line.cpc === normalized && line.status === "Taken" && lineForArea(line, area)) || null;
}

function leaveHoursPerDayForInitials(initials = currentUser.initials) {
  const line = submittedRdoLineForInitials(initials);
  return line && lineFourTenValue(line) === "Yes" ? CWS_LEAVE_HOURS_PER_DAY : LEAVE_SLOT_HOURS_PER_DAY;
}

function currentUserLeaveAllowanceHours() {
  const hours = normalizeLeaveSlotAllowance(currentUser.leaveSlotAllowance);
  return hours > 0 ? hours : DEFAULT_BUE_LEAVE_SLOT_ALLOWANCE;
}

function currentUserBaseLeaveAllowanceDays() {
  return estimatedLeaveDaysFromHours(currentUserLeaveAllowanceHours(), leaveHoursPerDayForInitials());
}

function areaLeaveBucketTotals(area = currentViewArea(), extraItems = []) {
  return {
    cpcTotal: areaLeaveSlotBudget(area, "cpc"),
    devTotal: areaLeaveSlotBudget(area, "dev"),
    cpcUsed: areaLeaveSlotUsed(area, "cpc", extraItems),
    devUsed: areaLeaveSlotUsed(area, "dev", extraItems),
  };
}

function leaveAreaCapacityMessage(area, bidAs, extraItems = []) {
  const bucket = leaveSlotBucketForBidAs(bidAs);
  if (!bucket) return "";
  const total = areaLeaveSlotBudget(area, bucket);
  const used = areaLeaveSlotUsed(area, bucket);
  const projectedUsed = areaLeaveSlotUsed(area, bucket, extraItems);
  if (projectedUsed <= total) return "";

  const label = bucket === "dev" ? "DEV" : "CPC";
  return `${area} ${label} leave slots are exhausted (${used} used of ${total}). No additional leave bids can be submitted in that bucket.`;
}

function leaveItemChargedDays(item) {
  const days = Number(item.days);
  if (Number.isFinite(days) && days > 0) return days;
  return chargeableLeaveDatesForInitials(item.range, item.initials || currentUser.initials, leaveRoundForItem(item)).length;
}

function leaveHolidayDateSet(items) {
  return items.reduce((holidays, item) => {
    datesInLeaveRange(item.range).forEach((key) => {
      if (isHolidayDate(key, item.initials || currentUser.initials)) holidays.add(key);
    });
    return holidays;
  }, new Set());
}

function leaveHolidayCreditsForRound(round) {
  if (round < 4) return 0;
  const priorItems = leaveCommittedItems().filter((item) =>
    (!item.initials || item.initials === currentUser.initials) &&
    leaveRoundForItem(item) < round
  );
  return leaveHolidayDateSet(priorItems).size;
}

function leaveAllowanceLimitForRound(round) {
  return currentUserBaseLeaveAllowanceDays() + leaveHolidayCreditsForRound(round);
}

function leaveProjectedChargedDays(extraItems = []) {
  return [...leaveCommittedItems(), ...leaveDraftQueue, ...extraItems]
    .reduce((total, item) => total + leaveItemChargedDays(item), 0);
}

function leaveCommittedChargedDays() {
  return leaveCommittedItems()
    .filter((item) => !item.initials || item.initials === currentUser.initials)
    .reduce((total, item) => total + leaveItemChargedDays(item), 0);
}

function leaveHolidayBidCount() {
  const committedItems = leaveCommittedItems().filter((item) => !item.initials || item.initials === currentUser.initials);
  return leaveHolidayDateSet([...committedItems, ...leaveDraftQueue]).size;
}

function leaveDraftDateSet() {
  return leaveDraftQueue.reduce((dates, item) => {
    leaveDisplayDatesForItem(item, currentUser.initials).forEach((key) => dates.add(key));
    return dates;
  }, new Set());
}

function isDraftLeaveDate(key) {
  return leaveDraftDateSet().has(key);
}

function activeLeavePreviewItem() {
  if (!leaveRangePreviewActive || !leaveRangeSelectionComplete) return null;
  const range = formatLeaveRangeFromKeys(leaveBuilderDateKeys());
  if (!range) return null;

  return {
    range,
    initials: currentUser.initials,
    bidAs: currentUserBidAs(),
    round: currentRoundNumber(),
  };
}

function leaveDisplayDatesForItem(item, initials = currentUser.initials) {
  return chargeableLeaveDatesForInitials(
    item.range,
    item.initials || initials,
    isRoundOneLeaveItem(item) ? 1 : Number(item.round || currentRoundNumber())
  );
}

function showInitialsInVisibleSlot(visible, bucket, initials) {
  if (!bucket || !initials) return;
  const capacity = leaveSlotCapacityForDetails(visible, bucket);
  const values = visible[bucket] || [];
  if (values.includes(initials)) return;

  if (values.length < capacity) {
    values.push(initials);
  } else if (capacity > 0) {
    values[capacity - 1] = initials;
  }

  visible[bucket] = values.slice(0, capacity);
}

function visibleLeaveSlotDetailsFromMap(
  key,
  area = currentUser.area,
  slotMap = leaveSlotMap(area),
  { includePrivateOverlays = true } = {}
) {
  const details = leaveSlotsForDateFromMap(key, area, slotMap);
  const visible = {
    ...details,
    cpc: [...(details.cpc || [])],
    dev: [...(details.dev || [])],
  };
  const showCurrentUserOverlay = includePrivateOverlays && area === currentUser.area;
  const previewItem = activeLeavePreviewItem();
  if (showCurrentUserOverlay && previewItem && leaveDisplayDatesForItem(previewItem, currentUser.initials).includes(key)) {
    const bucket = leaveSlotBucketForBidAs(previewItem.bidAs);
    showInitialsInVisibleSlot(visible, bucket, currentUser.initials);
  }

  leaveBids.forEach((item) => {
    if (!showCurrentUserOverlay) return;
    if (!["Pending", "Approved"].includes(item.status)) return;
    if (!leaveDisplayDatesForItem(item, currentUser.initials).includes(key)) return;
    showInitialsInVisibleSlot(visible, leaveSlotBucketForBidAs(item.bidAs || currentUserBidAs()), currentUser.initials);
  });

  leaveDraftQueue.forEach((item) => {
    if (!showCurrentUserOverlay) return;
    if (!leaveDisplayDatesForItem(item, currentUser.initials).includes(key)) return;
    const bucket = leaveSlotBucketForBidAs(item.bidAs || currentUserBidAs());
    showInitialsInVisibleSlot(visible, bucket, currentUser.initials);
  });

  intakeQueue.forEach((item) => {
    if (item.area !== area) return;
    if (item.type !== "Leave" || !["Pending", "Approved"].includes(item.status)) return;
    if (!leaveDisplayDatesForItem(item, item.initials).includes(key)) return;
    const bucket = leaveSlotBucketForBidAs(item.bidAs);
    showInitialsInVisibleSlot(visible, bucket, item.initials);
  });

  return visible;
}

function visibleLeaveSlotDetails(key, area = currentUser.area) {
  return visibleLeaveSlotDetailsFromMap(key, area);
}

function personalLeaveDateStatus(key) {
  let status = "";
  const applyStatus = (itemStatus) => {
    if (itemStatus === "Approved") status = "approved";
    if (itemStatus === "Pending" && status !== "approved") status = "pending";
  };

  leaveBids.forEach((bid) => {
    if (!["Pending", "Approved"].includes(bid.status)) return;
    if (datesInLeaveRange(bid.range).includes(key)) applyStatus(bid.status);
  });

  intakeQueue.forEach((item) => {
    if (item.type !== "Leave" || item.initials !== currentUser.initials || !["Pending", "Approved"].includes(item.status)) return;
    if (datesInLeaveRange(item.range).includes(key)) applyStatus(item.status);
  });

  return status;
}

function isPersonalLeaveDate(key) {
  return Boolean(personalLeaveDateStatus(key));
}

function draftRangeExists(range) {
  const normalized = range.toLowerCase();
  return leaveDraftQueue.some((item) => item.range.toLowerCase() === normalized);
}

function addOrUpdateLeaveSubmission() {
  const { range, days, notes } = leaveBuilderValues();
  const round = currentRoundNumber();
  const isRoundOne = round === 1;
  if (!range) {
    setLeaveBuilderStatus("Enter a date range before adding leave.", "error");
    return;
  }

  if (!Number.isFinite(days) || days <= 0) {
    setLeaveBuilderStatus("Enter the number of leave days before adding leave.", "error");
    return;
  }

  const dateKeys = datesInLeaveRange(range);
  if (!dateKeys.length) {
    setLeaveBuilderStatus("Use a range like Jun 9 - Jun 13, 2027 or a single day like Jun 9, 2027.", "error");
    return;
  }

  if (invalidLeaveYearDateKeys(dateKeys).length) {
    setLeaveBuilderStatus("Leave bids must stay between Jan 10, 2027 and Jan 8, 2028.", "error");
    return;
  }

  const rdoConflicts = dateKeys.filter((key) => isRdoDateForInitials(key, currentUser.initials));
  if (rdoConflicts.length) {
    setLeaveBuilderStatus(`You cannot bid your own RDO: ${formatLeaveConflictDates(rdoConflicts)}.`, "error");
    return;
  }

  const chargeableDates = chargeableLeaveDatesForInitials(range, currentUser.initials, round);
  const weekKeys = isRoundOne ? roundOneWeekKeysForDateKeys(dateKeys) : [];
  const weekUnits = weekKeys.length;
  if (chargeableDates.length !== days) {
    setLeaveBuilderStatus(`That request charges ${chargeableDates.length} ${chargeableDates.length === 1 ? "day" : "days"}. Update the Days field before adding it.`, "error");
    return;
  }

  if (isRoundOne) {
    const existingWeeks = roundOneDraftWeekKeySet();
    const combinedWeeks = roundOneDraftWeekKeySet([{ range, round, weekKeys }]).size;
    if (combinedWeeks > roundOneWeekLimit()) {
      setLeaveBuilderStatus(`Round 1 can include up to ${roundOneWeekLimit()} bid weeks. This would use ${combinedWeeks}.`, "error");
      return;
    }
    var newRoundOneWeeks = Math.max(0, combinedWeeks - existingWeeks.size);
  } else {
    const currentTotal = leaveDraftTotalDays();
    if (currentTotal + days > currentRoundLeaveLimit()) {
      setLeaveBuilderStatus(`Round ${round} can include up to ${currentRoundLeaveLimit()} total days. This batch would be ${currentTotal + days}.`, "error");
      return;
    }

  }

  const projectedChargedDays = leaveProjectedChargedDays([{ range, days, round, weekUnits, weekKeys }]);
  const allowanceLimit = leaveAllowanceLimitForRound(round);
  if (projectedChargedDays > allowanceLimit) {
    const credits = leaveHolidayCreditsForRound(round);
    const creditText = credits ? ` including ${credits} holiday ${credits === 1 ? "credit" : "credits"}` : "";
    setLeaveBuilderStatus(`This would exceed the ${formatLeaveDaysLabel(allowanceLimit)} leave allowance${creditText} for Round ${round}.`, "error");
    return;
  }

  const capacityMessage = leaveAreaCapacityMessage(currentUser.area, currentUserBidAs(), [
    ...leaveDraftQueue,
    { area: currentUser.area, bidAs: currentUserBidAs(), initials: currentUser.initials },
  ]);
  if (capacityMessage) {
    setLeaveBuilderStatus(capacityMessage, "error");
    return;
  }

  const normalizedRange = range.toLowerCase();
  const matchingBid = leaveBids.find((bid) => bid.range.toLowerCase() === normalizedRange);
  if (matchingBid?.status === "Approved") {
    setLeaveBuilderStatus("That date range is already approved in your leave queue. Change the range to add a new request.", "error");
    return;
  }

  if (draftRangeExists(range)) {
    setLeaveBuilderStatus("That date range is already in your preview batch.", "error");
    return;
  }

  const previousPreviewKeys = leaveRangePreviewActive ? leaveBuilderDateKeys() : [];
  const draft = {
    id: `draft-leave-${currentUser.initials.toLowerCase()}-${Date.now()}`,
    range,
    days,
    notes,
    round,
    weekUnits,
    weekKeys,
  };
  leaveDraftQueue.push(draft);
  const leaveNotesInput = document.querySelector("[data-leave-notes-input]");
  if (leaveNotesInput) leaveNotesInput.value = "";
  leaveRangeSelectionComplete = true;
  leaveRangePreviewActive = false;

  refreshLeaveDraftUi([
    ...previousPreviewKeys,
    ...leaveDisplayDatesForItem(draft, currentUser.initials),
  ]);
  const roundOneSuffix = isRoundOne
    ? newRoundOneWeeks
      ? ` using ${newRoundOneWeeks} new bid ${newRoundOneWeeks === 1 ? "week" : "weeks"} and charging ${days} ${days === 1 ? "day" : "days"}`
      : ` inside an existing bid week, charging ${days} ${days === 1 ? "day" : "days"}`
    : "";
  setLeaveBuilderStatus(`${range} added to the preview batch${roundOneSuffix}. Submit the batch when everything looks right.`, "success");
}

function previewLeaveSubmission() {
  const { range, days } = leaveBuilderValues();
  const round = currentRoundNumber();
  const dateKeys = datesInLeaveRange(range);
  const previousPreviewKeys = leaveRangePreviewActive ? leaveBuilderDateKeys() : [];

  if (!dateKeys.length) {
    setLeaveBuilderStatus("Enter a date range before previewing leave.", "error");
    return;
  }

  if (invalidLeaveYearDateKeys(dateKeys).length) {
    setLeaveBuilderStatus("Leave bids must stay between Jan 10, 2027 and Jan 8, 2028.", "error");
    return;
  }

  const rdoConflicts = dateKeys.filter((key) => isRdoDateForInitials(key, currentUser.initials));
  if (rdoConflicts.length) {
    setLeaveBuilderStatus(`You cannot bid your own RDO: ${formatLeaveConflictDates(rdoConflicts)}.`, "error");
    return;
  }

  const chargeableDates = chargeableLeaveDatesForInitials(range, currentUser.initials, round);
  const weekUnits = round === 1 ? roundOneWeekUnitsForDateKeys(dateKeys) : 0;
  if (Number.isFinite(days) && days > 0 && chargeableDates.length !== days) {
    setLeaveBuilderStatus(`That request charges ${chargeableDates.length} ${chargeableDates.length === 1 ? "day" : "days"}. Update the Days field before previewing it.`, "error");
    return;
  }

  if (round === 1 && weekUnits > roundOneWeekLimit()) {
    setLeaveBuilderStatus(`Round 1 can include up to ${roundOneWeekLimit()} bid weeks. This range counts as ${weekUnits}.`, "error");
    return;
  }

  const previewYear = dateFromKey(dateKeys[0]).getFullYear();
  const calendarYearChanged = displayedCalendarYear !== previewYear;
  leaveRangePreviewActive = true;
  selectedLeaveDateKey = dateKeys[0];
  displayedCalendarYear = previewYear;
  if (calendarYearChanged) {
    updateCalendarYearLabels();
    makeCalendar("leave-calendar");
  } else {
    syncMemberCalendarSelection([...previousPreviewKeys, ...dateKeys]);
  }
  renderLeaveSlotBoard();
  const previewMessage = round === 1
    ? `Previewing ${weekUnits} Round 1 bid ${weekUnits === 1 ? "week" : "weeks"} with ${chargeableDates.length} chargeable ${chargeableDates.length === 1 ? "day" : "days"}.`
    : "Previewing this range on the calendar. Use Add to Batch when you want to stage it.";
  setLeaveBuilderStatus(previewMessage, "info");
}

function removeLeaveDraft(id) {
  const removedDraft = leaveDraftQueue.find((item) => item.id === id);
  leaveDraftQueue = leaveDraftQueue.filter((item) => item.id !== id);
  refreshLeaveDraftUi(removedDraft ? leaveDisplayDatesForItem(removedDraft, currentUser.initials) : []);
  setLeaveBuilderStatus("Removed from the preview batch.", "info");
}

function refreshLeaveDraftUi(affectedDateKeys = []) {
  syncMemberCalendarSelection(affectedDateKeys);
  renderLeaveDraftQueue();
  renderLeaveAllowanceSummary();
}

function leaveDraftPreSubmissionMessage(drafts = leaveDraftQueue) {
  const requestedDates = new Map();
  const overlappingDates = new Set();

  drafts.forEach((draft) => {
    datesInLeaveRange(draft.range).forEach((key) => {
      if (requestedDates.has(key)) overlappingDates.add(key);
      requestedDates.set(key, Number(draft.round || currentRoundNumber()));
    });
  });

  if (overlappingDates.size) {
    return `This batch contains overlapping leave dates: ${formatLeaveConflictDates([...overlappingDates].sort())}. Remove the duplicate dates before submitting.`;
  }

  const previousRoundDates = new Set();
  activeLeaveItemsForInitials(currentUser.initials).forEach((item) => {
    const priorRound = leaveRoundForItem(item);
    datesInLeaveRange(item.range).forEach((key) => {
      const requestedRound = requestedDates.get(key);
      if (requestedRound && priorRound < requestedRound) previousRoundDates.add(key);
    });
  });
  if (previousRoundDates.size) {
    return `You already bid these dates in a previous round: ${formatLeaveConflictDates([...previousRoundDates].sort())}. Each date may be bid only once across rounds.`;
  }

  const rdoDates = [...requestedDates.keys()].filter((key) => isRdoDateForInitials(key, currentUser.initials));
  if (rdoDates.length) {
    return `You cannot bid dates that are RDOs on your approved bid line: ${formatLeaveConflictDates(rdoDates)}.`;
  }

  return "";
}

async function submitLeaveDraftBatch() {
  if (!canSubmitBueBid()) {
    warnUnconfirmedBidder("submit leave bids");
    return;
  }

  const windowError = leaveBidWindowErrorMessage();
  if (windowError) {
    setLeaveBuilderStatus(windowError, "error");
    return;
  }

  const rdoRequestError = leaveRdoRequestErrorMessage();
  if (rdoRequestError) {
    setLeaveBuilderStatus(rdoRequestError, "error");
    return;
  }

  if (!leaveDraftQueue.length) {
    setLeaveBuilderStatus("Add at least one leave request before submitting a batch.", "error");
    return;
  }

  const preSubmissionMessage = leaveDraftPreSubmissionMessage();
  if (preSubmissionMessage) {
    setLeaveBuilderStatus(preSubmissionMessage, "error");
    return;
  }

  const capacityMessage = leaveAreaCapacityMessage(
    currentUser.area,
    currentUserBidAs(),
    leaveDraftQueue.map((draft) => ({
      ...draft,
      area: currentUser.area,
      bidAs: currentUserBidAs(),
      initials: currentUser.initials,
    }))
  );
  if (capacityMessage) {
    setLeaveBuilderStatus(capacityMessage, "error");
    return;
  }

  const batchId = `leave-batch-${currentUser.initials.toLowerCase()}-${Date.now()}`;
  const submittedAt = formatDateTime(new Date());
  const startingPriority = nextLeavePriority();
  const newRequests = leaveDraftQueue.map((draft) => ({
    id: `leave-${currentUser.initials.toLowerCase()}-${Date.now()}-${draft.id}`,
    type: "Leave",
    area: currentUser.area,
    name: userFullName(),
    initials: currentUser.initials,
    bidAs: currentUserBidAs(),
    seniority: currentUser.seniorityRank,
    priority: startingPriority + leaveDraftQueue.indexOf(draft),
    status: "Pending",
    submittedAt,
    batchId,
    range: draft.range,
    days: draft.days,
    round: draft.round,
    weekUnits: draft.weekUnits || 0,
    weekKeys: draft.weekKeys || [],
    summary: `${draft.range} · ${draft.days} ${draft.days === 1 ? "day" : "days"}${draft.weekUnits ? ` · ${draft.weekUnits} bid week` : ""}`,
  }));

  const draftsByRange = new Map(leaveDraftQueue.map((draft) => [draft.range, draft]));
  let savedToSupabase = false;
  try {
    const slotLabel = leaveSlotBucketForBidAs(currentUserBidAs()) === "dev" ? "DEV" : "CPC";
    setLeaveBuilderStatus(`Checking ${slotLabel} slots, prior-round dates, and bid-line RDOs before submission...`, "info");
    savedToSupabase = await saveSupabaseLeaveRequests(newRequests, draftsByRange);
  } catch (error) {
    setLeaveBuilderStatus(error.message || "Leave batch could not be saved to Supabase. Please try again before leaving this page.", "error");
    return;
  }

  newRequests.forEach((request) => {
    const draft = draftsByRange.get(request.range);
    if (!savedToSupabase) {
      intakeQueue.unshift(request);
      leaveBids.push({
        priority: request.priority,
        range: request.range,
        days: request.days,
        status: "Pending",
        notes: draft?.notes || "",
        initials: request.initials,
        area: request.area,
        round: request.round,
        weekUnits: request.weekUnits,
        weekKeys: request.weekKeys,
      });
    }
  });

  logHistory(
    currentUser.area,
    "Leave batch submitted",
    `${currentUser.initials} submitted ${newRequests.length} leave ${newRequests.length === 1 ? "request" : "requests"} totaling ${leaveDraftTotalDays()} charged days${leaveDraftTotalWeeks() ? ` across ${leaveDraftTotalWeeks()} bid weeks` : ""}. Intake approval is required before leave slots are populated.`
  );

  leaveDraftQueue = [];
  activeOverrideId = null;
  activeDenialId = null;
  queueBidSubmittedEmail(newRequests);
  renderApp();
  setLeaveBuilderStatus(savedToSupabase ? "Leave batch saved to Supabase and sent to intake review." : "Leave batch sent to intake review.", "success");
}

async function sendBidNotification(email, notification) {
  const client = supabaseClient();
  if (!client) throw new Error("Supabase is not configured on this page.");

  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error("Sign in with Supabase before sending email notifications.");
  }

  const response = await fetch("/api/notifications/bid", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...notification,
      subject: email.subject,
      body: email.body,
    }),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || "The email notification could not be sent.");
  }

  return result;
}

function queueNotificationEmail(to, subject, body, area = currentUser.area, notification = null) {
  const email = {
    to,
    subject,
    body,
    time: formatDateTime(new Date()),
    status: notification ? "Sending" : "Logged only",
    error: "",
  };
  prototypeEmails.unshift(email);
  logHistory(area, "Email queued", `${currentUser.initials} queued "${subject}" to ${to}.`);

  if (!notification) return;

  sendBidNotification(email, notification)
    .then((result) => {
      email.status = "Sent";
      email.to = result.recipient || email.to;
      logHistory(area, "Email sent", `${subject} was sent to ${email.to}.`);
      renderEmailLog();
    })
    .catch((error) => {
      email.status = "Not sent";
      email.error = error.message || String(error);
      logHistory(area, "Email failed", `${subject} was not sent. ${email.error}`);
      renderEmailLog();
      console.warn("Bid notification email failed:", error);
    });
}

function bidRecipientEmail(item) {
  const recipient = bueByInitials(item.initials) || Object.values(testAccounts).find((account) => account.initials === item.initials);
  return recipient?.email || `${item.initials.toLowerCase()}@natcazla.com`;
}

function bidEmailDetail(item) {
  if (item.type === "RDO Line") {
    return `RDO Line ${item.line}, Fatigue Group ${item.fatigueGroup}, Flex: ${item.flex}, AWS: ${item.aws}, Mid: ${item.mid}.`;
  }

  const weekText = item.weekUnits ? `, ${item.weekUnits} bid ${item.weekUnits === 1 ? "week" : "weeks"}` : "";
  const roundText = item.round ? `, Round ${item.round}` : "";
  return `${item.range}, ${item.days} ${item.days === 1 ? "day" : "days"}${weekText}${roundText}.`;
}

const BID_OFFICE_CONTACT = "If you have any questions, please use the messaging system on the website, or text the Bidding Office at (661) 434-1004.";

function bidRound(item) {
  const round = item.type === "Leave" ? leaveRoundForItem(item) : Number(item.round || currentRoundNumber());
  return Number.isFinite(round) && round > 0 ? round : currentRoundNumber();
}

function queueBidSubmittedEmail(items) {
  const submissions = Array.isArray(items) ? items : [items];
  if (!submissions.length) return;

  const first = submissions[0];
  const round = bidRound(first);
  const detail = submissions.map((item, index) => {
    const prefix = submissions.length > 1 ? `${index + 1}. ` : "";
    return `${prefix}${item.type} bid details: ${bidEmailDetail(item)}`;
  }).join("\n");
  const subjectType = submissions.length > 1 ? `${submissions.length} leave bids` : `${first.type} bid`;

  queueNotificationEmail(
    bidRecipientEmail(first),
    `Bid received for ${first.initials} Round ${round} ${BID_YEAR}`,
    `Your ${subjectType} has been received and sent to Bidding Intake for review.\n\n${detail}\n\nYou will receive another email once Intake approves the bid.\n\n${BID_OFFICE_CONTACT}`,
    first.area,
    {
      kind: "submitted",
      eventId: first.id || `${first.initials}-${Date.now()}`,
      initials: first.initials,
      area: first.area,
    }
  );
}

function queueBidVerifiedEmail(item) {
  const round = bidRound(item);
  const subject = `Bid approved for ${item.initials} Round ${round} ${BID_YEAR}`;
  const detail = bidEmailDetail(item);
  queueNotificationEmail(
    bidRecipientEmail(item),
    subject,
    `Your submitted bid has been approved for Round ${round}.\n\n${item.type} bid details: ${detail}\n\n${BID_OFFICE_CONTACT}`,
    item.area,
    {
      kind: "approved",
      eventId: item.id || `${item.initials}-${Date.now()}`,
      initials: item.initials,
      area: item.area,
    }
  );
}

function queueBidDeniedEmail(item) {
  const round = bidRound(item);
  const detail = bidEmailDetail(item);
  const reason = item.denialReason ? `\n\nReason: ${item.denialReason}` : "";
  queueNotificationEmail(
    bidRecipientEmail(item),
    `Bid denied for ${item.initials} Round ${round} ${BID_YEAR}`,
    `Your submitted bid was not approved for Round ${round}.\n\n${item.type} bid details: ${detail}${reason}\n\nPlease use the messaging system on the website, or text the Bidding Office at (661) 434-1004.`,
    item.area,
    {
      kind: "denied",
      eventId: item.id || `${item.initials}-${Date.now()}`,
      initials: item.initials,
      area: item.area,
    }
  );
}

function leaveBidForItem(item, range = item.range) {
  return leaveBids.find((entry) =>
    entry.range === range &&
    (!entry.initials || !item.initials || entry.initials === item.initials)
  ) || leaveBids.find((entry) => entry.range === range);
}

function applyRdoApproval(item) {
  const line = rdoLines.find((entry) => entry.line === item.line && lineForArea(entry, item.area));
  if (!line) return;

  item.status = "Approved";
  item.approvedBy = currentUser.initials;
  item.approvedAt = formatDateTime(new Date());
  item.appliedLine = item.bidAs === "GL" ? null : item.line;
  syncApprovedRdoItem(item);
  reconcilePendingLeaveForRdo(item.initials, item.area);
  logHistory(
    item.area,
    "RDO bid approved",
    item.bidAs === "GL"
      ? `${currentUser.initials} approved ${item.initials}'s ghost-line bid for ${item.summary}. GL bids are logged but do not populate public floor templates.`
      : `${currentUser.initials} approved ${item.initials}'s ${item.summary}. The system applied ${item.initials} to Line ${item.line}.`
  );
  queueBidVerifiedEmail(item);
}

function refreshLeaveItemCharge(item) {
  if (item.type && item.type !== "Leave") return false;
  const originalDays = Number(item.days || 0);
  const round = leaveRoundForItem(item);
  const dateKeys = datesInLeaveRange(item.range);
  const chargeableDates = chargeableLeaveDatesForInitials(item.range, item.initials || currentUser.initials, round);
  item.days = chargeableDates.length;
  if (round === 1) {
    item.weekKeys = roundOneWeekKeysForDateKeys(dateKeys);
    item.weekUnits = item.weekKeys.length;
  }
  item.summary = `${item.range} · ${item.days} ${item.days === 1 ? "day" : "days"}${item.weekUnits ? ` · ${item.weekUnits} bid week${item.weekUnits === 1 ? "" : "s"}` : ""}`;
  return originalDays !== item.days;
}

function reconcilePendingLeaveForRdo(initials, area = currentUser.area) {
  let adjusted = 0;
  intakeQueue.forEach((item) => {
    if (item.type !== "Leave" || item.initials !== initials || item.area !== area || item.status !== "Pending") return;
    if (refreshLeaveItemCharge(item)) adjusted += 1;
  });
  leaveBids.forEach((item) => {
    if (item.initials !== initials || item.area !== area || item.status !== "Pending") return;
    refreshLeaveItemCharge(item);
  });
  if (adjusted) {
    logHistory(area, "Pending leave adjusted", `${initials}'s pending leave was recalculated after RDO approval.`);
  }
}

function syncApprovedRdoItem(item) {
  const line = rdoLines.find((entry) => entry.line === item.line && lineForArea(entry, item.area));
  if (!line || item.bidAs === "GL") return;

  rdoLines.forEach((entry) => {
    if (entry !== line && lineForArea(entry, item.area) && entry.cpc === item.initials) {
      entry.cpc = "";
      entry.status = "Open";
    }
  });

  line.cpc = item.initials;
  line.status = "Taken";
  line.group = item.fatigueGroup;
  line.flex = item.flex;
  line.aws = item.aws;
  line.mid = item.mid;
}

function applyLeaveApproval(item) {
  const rdoConflicts = leaveRdoConflicts(item);
  if (rdoConflicts.length) {
    item.reviewNote = `Cannot approve: ${formatLeaveConflictDates(rdoConflicts)} ${rdoConflicts.length === 1 ? "is" : "are"} the bidder's RDO. Deny it or edit the date range before approval.`;
    activeOverrideId = item.id;
    return false;
  }

  const conflicts = leaveApprovalConflicts(item);
  if (conflicts.length && !item.leaveCapacityOverride) {
    item.reviewNote = `Needs override: ${formatLeaveConflictDates(conflicts)} already ${conflicts.length === 1 ? "has" : "have"} filled leave slots.`;
    activeOverrideId = item.id;
    return false;
  }

  const bid = leaveBidForItem(item);
  if (bid) bid.status = "Approved";
  syncApprovedLeaveItem(item);
  item.status = "Approved";
  item.approvedBy = currentUser.initials;
  item.approvedAt = formatDateTime(new Date());
  item.reviewNote = item.leaveCapacityOverride ? `Approved with override for ${formatLeaveConflictDates(conflicts)}.` : "";
  logHistory(item.area, "Leave bid approved", `${currentUser.initials} approved ${item.initials}'s leave request for ${item.range}. Leave slots were updated by the system.`);
  queueBidVerifiedEmail(item);
  return true;
}

function datesInLeaveRange(range) {
  const normalized = range.replace(/\s+/g, " ").trim();
  const singleDate = normalized.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (singleDate) {
    const [, month, day, year] = singleDate;
    const date = new Date(`${month} ${day}, ${year}`);
    return Number.isNaN(date.getTime()) ? [] : [dateKeyFromDate(date)];
  }

  const [, startMonth, startDay, endMonthOptional, endDay, year] =
    normalized.match(/^([A-Za-z]+)\s+(\d{1,2})\s+-\s+(?:([A-Za-z]+)\s+)?(\d{1,2}),\s+(\d{4})$/) || [];

  if (!startMonth || !startDay || !endDay || !year) return [];

  const endMonth = endMonthOptional || startMonth;
  const start = new Date(`${startMonth} ${startDay}, ${year}`);
  const end = new Date(`${endMonth} ${endDay}, ${year}`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const keys = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    keys.push(dateKeyFromDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

function leaveSlotBucketForBidAs(bidAs) {
  if (bidAs === "R-DEV" || bidAs === "D-DEV" || bidAs === "DEV") return "dev";
  if (bidAs === "CPC" || bidAs === "GL" || bidAs === "TMC") return "cpc";
  return null;
}

function removeInitialsFromLeaveRange(range, initials) {
  datesInLeaveRange(range).forEach((key) => {
    const area = bueByInitials(initials)?.area || currentUser.area;
    const details = extraLeaveSlotDetails(key, area);
    if (!details) return;
    details.cpc = (details.cpc || []).filter((value) => value !== initials);
    details.dev = (details.dev || []).filter((value) => value !== initials);
  });
}

function syncApprovedLeaveItem(item) {
  const bid = leaveBidForItem(item);
  if (bid) bid.status = "Approved";
  const bucket = leaveSlotBucketForBidAs(item.bidAs);
  if (!bucket) return;

  leaveApprovalDates(item).forEach((key) => {
    const area = item.area || currentUser.area;
    const storageKey = extraLeaveSlotStorageKey(key, area);
    const details = extraLeaveSlotData[storageKey] || { area, date: key, cpc: [], dev: [] };
    const values = details[bucket] || [];
    const capacity = leaveSlotCapacityForDetails(details, bucket);
    if (!values.includes(item.initials) && values.length < capacity) {
      values.push(item.initials);
    }
    details[bucket] = values;
    extraLeaveSlotData[storageKey] = details;
  });
}

function leaveApprovalBucket(item) {
  return leaveSlotBucketForBidAs(item.bidAs) || "cpc";
}

function leaveApprovalConflicts(item) {
  if (item.type !== "Leave") return [];
  const bucket = leaveApprovalBucket(item);

  return leaveApprovalDates(item).filter((key) => {
    const details = leaveSlotsForDate(key, item.area || currentUser.area);
    const values = details[bucket] || [];
    return fullLeaveDates.has(key) || (leaveSlotOpenCountForDetails(details, bucket) === 0 && !values.includes(item.initials));
  });
}

function leaveRdoConflicts(item) {
  if (item.type !== "Leave") return [];
  if (isRoundOneLeaveItem(item)) return [];
  return datesInLeaveRange(item.range).filter((key) => isRdoDateForInitials(key, item.initials));
}

function formatLeaveConflictDates(keys) {
  if (!keys.length) return "";
  return keys
    .map((key) => {
      const date = dateFromKey(key);
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    })
    .join(", ");
}

function captureIntakeOverrideFields(item) {
  const editor = document.querySelector("[data-override-editor]");
  if (!item || !editor) return;

  if (item.type === "RDO Line") {
    item.line = editor.querySelector("[data-override-line]")?.value || item.line;
    item.fatigueGroup = editor.querySelector("[data-override-group]")?.value || item.fatigueGroup;
    item.flex = editor.querySelector("[data-override-flex]")?.value || item.flex;
    item.aws = editor.querySelector("[data-override-aws]")?.value || item.aws;
    item.mid = editor.querySelector("[data-override-mid]")?.value || item.mid;
    item.summary = `Line ${item.line} · Group ${item.fatigueGroup} · Flex ${item.flex} · AWS ${item.aws} · Mid ${item.mid}`;
    return;
  }

  item.range = editor.querySelector("[data-override-range]")?.value || item.range;
  item.days = Number(editor.querySelector("[data-override-days]")?.value || item.days);
  item.leaveCapacityOverride = Boolean(editor.querySelector("[data-override-capacity]")?.checked);
  item.summary = `${item.range} · ${item.days} days`;
}

function approveIntakeItem(id) {
  const item = intakeQueue.find((entry) => entry.id === id);
  if (!item || item.status !== "Pending") return;
  if (activeOverrideId === id) captureIntakeOverrideFields(item);
  let approved = true;
  if (item.type === "RDO Line") applyRdoApproval(item);
  if (item.type === "Leave") approved = applyLeaveApproval(item);
  if (!approved) {
    renderApp();
    setPage("intake");
    return;
  }
  activeOverrideId = null;
  activeDenialId = null;
  renderApp();
  setPage("intake");
}

function denyIntakeItem(id) {
  const item = intakeQueue.find((entry) => entry.id === id);
  if (!item || item.status !== "Pending") return;

  const reason = document.querySelector("[data-denial-reason]")?.value.trim() || "";
  if (!reason) {
    item.denialDraftError = "Enter a denial reason before sending this back to the BUE.";
    activeDenialId = id;
    activeOverrideId = null;
    renderApp();
    setPage("intake");
    return;
  }

  item.status = "Denied";
  item.deniedBy = currentUser.initials;
  item.deniedAt = formatDateTime(new Date());
  item.denialReason = reason;
  item.reviewNote = `Denied: ${reason}`;
  delete item.denialDraftError;

  if (item.type === "Leave") {
    const bid = leaveBidForItem(item);
    if (bid) {
      bid.status = "Denied";
    }
  }

  logHistory(item.area, `${item.type} denied`, `${currentUser.initials} denied ${item.initials}'s ${item.type} request. Reason: ${reason}`);
  queueBidDeniedEmail(item);
  activeDenialId = null;
  activeOverrideId = null;
  renderApp();
  setPage("intake");
}

function saveIntakeOverride(id) {
  const item = intakeQueue.find((entry) => entry.id === id);
  if (!item) return;

  const original = item.summary;
  const originalLine = item.line;
  const originalRange = item.range;
  captureIntakeOverrideFields(item);

  if (item.status === "Approved") {
    if (item.type === "RDO Line") {
      if (item.bidAs !== "GL" && originalLine !== item.line) {
        const oldLine = rdoLines.find((entry) => entry.line === originalLine && lineForArea(entry, item.area));
        if (oldLine?.cpc === item.initials) {
          oldLine.cpc = "";
          oldLine.status = "Open";
        }
      }
      syncApprovedRdoItem(item);
      item.appliedLine = item.bidAs === "GL" ? null : item.line;
    }
    if (item.type === "Leave") {
      removeInitialsFromLeaveRange(originalRange, item.initials);
      syncApprovedLeaveItem(item);
    }
  }

  logHistory(
    item.area,
    item.status === "Approved" ? "Admin override applied" : "Intake override saved",
    `${currentUser.initials} edited ${item.initials}'s ${item.type} request from "${original}" to "${item.summary}".`
  );
  activeDenialId = null;
  renderApp();
  setPage("intake");
}

function selectedRdoWeekdays() {
  const line = rdoLinesForArea(currentUser.area).find((item) => item.line === selectedLineId) || rdoLinesForArea(currentUser.area)[0] || rdoLines[0];
  return rdoWeekdaysForLine(line);
}

function rdoWeekdaysForLine(line) {
  if (!line) return new Set();
  return new Set(line.week.map((value, index) => (value === "RDO" ? index : null)).filter((index) => index !== null));
}

function rdoLineForInitials(initials = currentUser.initials) {
  const request = intakeQueue.find((item) =>
    item.type === "RDO Line" &&
    item.initials === initials &&
    item.status === "Approved"
  );
  if (request?.line) return rdoLines.find((line) => line.line === request.line && lineForArea(line, request.area || currentUser.area)) || null;

  const populatedLine = rdoLines.find((line) => line.cpc === initials && line.status === "Taken" && lineForArea(line, currentUser.area));
  if (populatedLine) return populatedLine;

  if (initials === currentUser.initials) {
    if (supabaseState.connected) return null;
    return rdoLinesForArea(currentUser.area).find((line) => line.line === selectedLineId) || null;
  }

  return null;
}

function isRdoDateForInitials(key, initials = currentUser.initials) {
  const line = rdoLineForInitials(initials);
  if (!line) return false;
  return rdoWeekdaysForLine(line).has(dateFromKey(key).getDay());
}

function isBidLeaveYearDate(key) {
  return key >= BID_LEAVE_YEAR_START_KEY && key <= BID_LEAVE_YEAR_END_KEY;
}

function invalidLeaveYearDateKeys(dateKeys) {
  return dateKeys.filter((key) => !isBidLeaveYearDate(key));
}

function calendarActiveDate() {
  const activeDate = dateFromKey(selectedLeaveDateKey);
  const day = Math.min(activeDate.getDate(), new Date(displayedCalendarYear, activeDate.getMonth() + 1, 0).getDate());
  return new Date(displayedCalendarYear, activeDate.getMonth(), day);
}

function makeCalendarRenderContext({ area, showRdo, showPersonalLeave, deferSlotTooltip, publicReadOnly = false }) {
  return {
    area,
    mode: calendarMode,
    showRdo,
    showPersonalLeave,
    deferSlotTooltip,
    publicReadOnly,
    rdoWeekdays: showRdo ? selectedRdoWeekdays() : new Set(),
    draftDates: showPersonalLeave ? leaveDraftDateSet() : new Set(),
    previewDates: showPersonalLeave && leaveRangePreviewActive ? new Set(leaveBuilderDateKeys()) : new Set(),
    slotMap: leaveSlotMap(area),
    baseSlotDetails: new Map(),
    visibleSlotDetails: new Map(),
    personalLeaveStatuses: new Map(),
    holidayKinds: new Map(),
    fatigueGroups: new Map(),
  };
}

function cachedBaseLeaveSlotDetails(key, context) {
  if (!context.baseSlotDetails.has(key)) {
    context.baseSlotDetails.set(key, leaveSlotsForDateFromMap(key, context.area, context.slotMap));
  }

  return context.baseSlotDetails.get(key);
}

function cachedVisibleLeaveSlotDetails(key, context) {
  if (!context.visibleSlotDetails.has(key)) {
    context.visibleSlotDetails.set(
      key,
      visibleLeaveSlotDetailsFromMap(key, context.area, context.slotMap, {
        includePrivateOverlays: !context.publicReadOnly,
      })
    );
  }

  return context.visibleSlotDetails.get(key);
}

function cachedPersonalLeaveDateStatus(key, context) {
  if (!context.personalLeaveStatuses.has(key)) {
    context.personalLeaveStatuses.set(key, personalLeaveDateStatus(key));
  }

  return context.personalLeaveStatuses.get(key);
}

function cachedCalendarHolidayKind(key, context, options = {}) {
  if (!context.holidayKinds.has(key)) {
    context.holidayKinds.set(key, calendarHolidayKind(key, options));
  }

  return context.holidayKinds.get(key);
}

function cachedFatigueGroupForDate(key, context) {
  const weekKey = roundOneWeekKeyForDateKey(key);
  if (!context.fatigueGroups.has(weekKey)) {
    context.fatigueGroups.set(weekKey, fatigueGroupForDate(key));
  }

  return context.fatigueGroups.get(weekKey);
}

function makeCalendar(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const isPublicCalendar = targetId === "public-calendar";
  const ownerPage = target.closest(".page");
  if (!isPublicCalendar && ownerPage && !ownerPage.classList.contains("active")) return;
  const area = targetId === "public-calendar" ? publicState.area : currentViewArea();
  const showRdo = !isPublicCalendar && area === currentUser.area;
  const showPersonalLeave = !isPublicCalendar && area === currentUser.area;
  const calendarScope = isPublicCalendar
    ? "public"
    : targetId === "dashboard-calendar"
      ? "dashboard"
      : targetId === "leave-calendar"
        ? "leave"
        : targetId === "full-calendar"
          ? "member"
          : "";
  const expandedSlots = Boolean(calendarScope && calendarLayouts[calendarScope] === "full");
  const monthIndexes = monthNames.map((_, index) => index);
  const context = makeCalendarRenderContext({
    area,
    showRdo,
    showPersonalLeave,
    deferSlotTooltip: false,
    publicReadOnly: isPublicCalendar,
  });

  target.classList.remove("month-view", "week-view");
  target.classList.toggle("expanded-slots-calendar", expandedSlots);

  target.innerHTML = monthIndexes
    .map((monthIndex) => renderMonthCard(monthIndex, displayedCalendarYear, {
      showRdo,
      showPersonalLeave,
      area,
      deferSlotTooltip: false,
      expandedSlots,
      context,
    }))
    .join("") + renderLeaveYearContinuation(displayedCalendarYear, {
      showRdo,
      showPersonalLeave,
      area,
      deferSlotTooltip: false,
      expandedSlots,
      context,
    });
}

function renderMonthCard(monthIndex, year, options = {}) {
  const { showRdo = true, showPersonalLeave = true, area, deferSlotTooltip = false, expandedSlots = false } = options;
  const name = monthNames[monthIndex];
  const date = new Date(year, monthIndex, 1);
  const firstDay = date.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = [];

  dayNames.forEach((day) => cells.push(`<span class="dow">${expandedSlots ? day.slice(0, 3) : day[0]}</span>`));
  for (let i = 0; i < firstDay; i += 1) cells.push("<span></span>");

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(renderCalendarDay(monthIndex, day, false, year, {
      showRdo,
      showPersonalLeave,
      area,
      deferSlotTooltip,
      expandedSlots,
      context: options.context,
    }));
  }

  return `
    <article class="month-card">
      <h3>${expandedSlots ? `${name} ${year}` : name}</h3>
      <div class="month-grid">${cells.join("")}</div>
    </article>
  `;
}

function renderLeaveYearContinuation(year, options = {}) {
  if (year !== BID_YEAR || !options.expandedSlots) return "";
  return renderMonthCard(0, BID_YEAR + 1, options);
}

function renderWeekCalendar(activeDate, options = {}) {
  const { showRdo = true, showPersonalLeave = true } = options;
  const context = options.context || makeCalendarRenderContext({
    area: options.area || currentViewArea(),
    showRdo,
    showPersonalLeave,
    deferSlotTooltip: false,
  });
  const start = new Date(activeDate);
  start.setDate(activeDate.getDate() - activeDate.getDay());
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
  const label = `${formatCalendarDate(dateKeyFromDate(weekDays[0]))} - ${formatCalendarDate(dateKeyFromDate(weekDays[6]))}`;

  return `
    <article class="month-card week-card">
      <h3>${label}</h3>
      <div class="week-calendar-grid">
        ${weekDays.map((date) => `
          <div class="week-day-column">
            <span class="week-day-label">${dayNames[date.getDay()]}</span>
            ${renderCalendarDay(date.getMonth(), date.getDate(), true, date.getFullYear(), { showRdo, showPersonalLeave, area: options.area, context })}
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function renderCalendarDay(monthIndex, day, includeMonth = false, year = displayedCalendarYear, options = {}) {
  const { showRdo = true, showPersonalLeave = true } = options;
  const context = options.context || null;
  const mode = options.mode || context?.mode || calendarMode;
  const showVacationLayer = mode === "vacation" || mode === "combined";
  const showFatigueLayer = mode === "fatigue" || mode === "combined";
  const date = new Date(year, monthIndex, day);
  const weekday = date.getDay();
  const key = dateKey(year, monthIndex + 1, day);
  const isPreviousLeaveYear = key < BID_LEAVE_YEAR_START_KEY;
  const isAfterLeaveYear = key > BID_LEAVE_YEAR_END_KEY;
  const isInsideLeaveYear = !isPreviousLeaveYear && !isAfterLeaveYear;
  const fatigueGroup = !isInsideLeaveYear || !showFatigueLayer ? "" : context ? cachedFatigueGroupForDate(key, context) : fatigueGroupForDate(key);
  const fatigueClass = groupClass(fatigueGroup);
  const nextFatigueGroup = weekday === 6 ? nextFatigueGroupAfter(fatigueGroup) : "";
  const nextFatigueClass = groupClass(nextFatigueGroup);
  const isFatigueWeekStart = fatigueClass && (weekday === 0 || day === 1);
  const rdoWeekdays = context ? context.rdoWeekdays : selectedRdoWeekdays();
  const isRdo = showVacationLayer && isInsideLeaveYear && showRdo && rdoWeekdays.has(weekday);
  const leaveStatus = showVacationLayer && isInsideLeaveYear && showPersonalLeave
    ? context ? cachedPersonalLeaveDateStatus(key, context) : personalLeaveDateStatus(key)
    : "";
  const canShowLeaveState = showVacationLayer && !isRdo && isInsideLeaveYear;
  const isApprovedLeave = leaveStatus === "approved" && canShowLeaveState;
  const isPendingLeave = leaveStatus === "pending" && canShowLeaveState;
  const isDraftLeave = showVacationLayer && showPersonalLeave && canShowLeaveState && (
    context ? context.draftDates.has(key) || context.previewDates.has(key) : isDraftLeaveDate(key) || isLeavePreviewRangeDate(key)
  );
  const holidayKind = !isInsideLeaveYear || !showVacationLayer ? null : context ? cachedCalendarHolidayKind(key, context, options) : calendarHolidayKind(key, options);
  const baseSlotDetails = context ? cachedBaseLeaveSlotDetails(key, context) : null;
  const detailArea = context?.area || options.area || currentUser.area;
  const isClosed = canShowLeaveState && (
    baseSlotDetails
      ? leaveSlotOpenCountForDetails(baseSlotDetails, "cpc") === 0 || (detailArea === "Area A" && fullLeaveDates.has(key))
      : isLeaveSlotsFull(key, options.area)
  );
  const expandedSlots = Boolean(options.expandedSlots);
  const hasDetail = isInsideLeaveYear && (showVacationLayer || expandedSlots);
  const isSelected = canShowLeaveState && key === selectedLeaveDateKey;
  const slotTooltip = hasDetail && !options.deferSlotTooltip
    ? quickLeaveSlotTooltip(key, holidayKind, options.area, context ? cachedVisibleLeaveSlotDetails(key, context) : null, expandedSlots)
    : "";
  const className = [
    holidayKind?.className || "",
    isPreviousLeaveYear ? "previous-leave-year-day" : "",
    isAfterLeaveYear ? "after-leave-year-day" : "",
    isDraftLeave ? "draft-leave-day" : "",
    isPendingLeave ? "pending-leave-day" : "",
    isApprovedLeave ? "leave-day" : "",
    isRdo ? "rdo-day" : "",
    isClosed ? "closed-day" : "",
    fatigueClass ? `fatigue-week fatigue-${fatigueClass}` : "",
    nextFatigueClass ? `fatigue-split fatigue-to-${nextFatigueClass}` : "",
    hasDetail ? "has-slot-detail" : "",
    expandedSlots ? "slot-expanded-day" : "",
    isSelected ? "selected-date" : "",
  ].filter(Boolean).join(" ");
  const fatigueStatus = nextFatigueGroup
    ? `Group ${fatigueGroup} / Group ${nextFatigueGroup} transition fatigue day`
    : `Group ${fatigueGroup} fatigue week`;
  const vacationStatus = holidayKind?.label || (isRdo ? "RDO - leave bidding unavailable" : isClosed ? "CPC leave slots filled" : "View leave slots");
  const status = isPreviousLeaveYear
    ? "2026 leave year - leave bidding unavailable"
    : isAfterLeaveYear
      ? "2027 leave year ended Jan 8, 2028 - leave bidding unavailable"
    : showVacationLayer ? vacationStatus : fatigueStatus;
  const label = expandedSlots || includeMonth ? `${monthNames[monthIndex].slice(0, 3)} ${day}` : day;
  const fatigueAttribute = fatigueGroup ? `data-fatigue-week="${fatigueGroup}"` : "";
  const nextFatigueAttribute = nextFatigueGroup ? `data-fatigue-next-week="${nextFatigueGroup}"` : "";
  const ariaStatus = showVacationLayer && fatigueGroup ? `${status}; ${fatigueStatus}` : status;
  const publicReadOnly = Boolean(context?.publicReadOnly || options.publicReadOnly);
  const leaveDateAttribute = canShowLeaveState
    ? publicReadOnly ? `data-public-leave-date="${key}"` : `data-leave-date="${key}"`
    : 'aria-disabled="true"';

  return `
    <button class="${className}" type="button" ${leaveDateAttribute} ${fatigueAttribute} ${nextFatigueAttribute} aria-label="${monthNames[monthIndex]} ${day}, ${year}: ${ariaStatus}">
      ${isFatigueWeekStart ? `<i class="fatigue-week-dot" aria-hidden="true"></i>` : ""}
      ${expandedSlots ? `
        <span class="expanded-day-heading">
          <span class="date-number">${label}</span>
        </span>
      ` : `<span class="date-number">${label}</span>`}
      ${slotTooltip}
    </button>
  `;
}

function setSelectedDateYear(year) {
  const activeDate = dateFromKey(selectedLeaveDateKey);
  const day = Math.min(activeDate.getDate(), new Date(year, activeDate.getMonth() + 1, 0).getDate());
  selectedLeaveDateKey = dateKey(year, activeDate.getMonth() + 1, day);
}

function updateCalendarYearLabels() {
  setText("[data-calendar-year-label]", displayedCalendarYear);
}

function updateCalendarViewControls() {
  document.querySelectorAll("[data-calendar-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.calendarMode === calendarMode);
  });
  document.querySelectorAll("[data-calendar-layout]").forEach((button) => {
    const scope = button.dataset.calendarScope;
    const isActive = calendarLayouts[scope] === button.dataset.calendarLayout;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  document.querySelectorAll("[data-calendar-layout-description]").forEach((description) => {
    const scope = description.dataset.calendarLayoutDescription;
    description.textContent = calendarLayouts[scope] === "full"
      ? "Every CPC and developmental slot is shown directly on each date."
      : "Hover or focus a date to view its slots.";
  });
}

function renderCalendars({ includePublic = true, includeMember = true } = {}) {
  updateCalendarViewControls();
  updateCalendarYearLabels();
  if (includePublic) makeCalendar("public-calendar");
  if (includeMember) {
    makeCalendar("dashboard-calendar");
    makeCalendar("leave-calendar");
    makeCalendar("full-calendar");
  }
}

function refreshMemberCalendarDates(dateKeys = []) {
  const uniqueKeys = [...new Set(dateKeys)].filter(Boolean);
  if (!uniqueKeys.length) return;

  document.querySelectorAll(".app-shell .year-calendar[id]").forEach((calendar) => {
    const ownerPage = calendar.closest(".page");
    if (ownerPage && !ownerPage.classList.contains("active")) return;

    const area = currentViewArea();
    const showPersonalState = area === currentUser.area;
    const calendarScopes = {
      "dashboard-calendar": "dashboard",
      "leave-calendar": "leave",
      "full-calendar": "member",
    };
    const scope = calendarScopes[calendar.id];
    const expandedSlots = Boolean(scope && calendarLayouts[scope] === "full");
    const context = makeCalendarRenderContext({
      area,
      showRdo: showPersonalState,
      showPersonalLeave: showPersonalState,
      deferSlotTooltip: false,
    });

    uniqueKeys.forEach((key) => {
      const button = calendar.querySelector(`[data-leave-date="${key}"]`);
      if (!button) return;
      const date = dateFromKey(key);
      button.outerHTML = renderCalendarDay(date.getMonth(), date.getDate(), false, date.getFullYear(), {
        showRdo: showPersonalState,
        showPersonalLeave: showPersonalState,
        area,
        deferSlotTooltip: false,
        expandedSlots,
        context,
      });
    });
  });
}

function syncMemberCalendarSelection(previousPreviewKeys = []) {
  refreshMemberCalendarDates(previousPreviewKeys);

  const draftDates = leaveDraftDateSet();
  const previewDates = leaveRangePreviewActive ? new Set(leaveBuilderDateKeys()) : new Set();
  document.querySelectorAll(".app-shell [data-leave-date]").forEach((button) => {
    const key = button.dataset.leaveDate;
    button.classList.toggle("selected-date", key === selectedLeaveDateKey);
    button.classList.toggle("draft-leave-day", draftDates.has(key) || previewDates.has(key));
  });
}

function leaveSlotMap(area = currentUser.area) {
  const entries = {};

  leaveSlotWeeks.forEach((week) => {
    week.days.forEach((day) => {
      if (!slotMatchesArea(day, area)) return;
      entries[day.date] = {
        group: week.group,
        round: week.round,
        ...day,
      };
    });
  });

  Object.entries(extraLeaveSlotData).forEach(([storageKey, day]) => {
    if (!slotMatchesArea(day, area)) return;
    const date = day.date || storageKey;
    entries[date] = {
      date,
      label: formatCalendarDate(date),
      cpc: [],
      dev: [],
      ...day,
    };
  });

  return entries;
}

function leaveSlotsForDateFromMap(key, area = currentUser.area, slotMap = leaveSlotMap(area)) {
  const details = slotMap[key] || {
    date: key,
    label: formatCalendarDate(key),
    cpc: [],
    dev: [],
    holiday: isHolidayDate(key),
    holidayInLieu: isHolidayInLieuDate(key),
  };
  const holidayInLieu = details.holidayInLieu || isHolidayInLieuDate(key);

  const override = leaveSlotCapacityOverride(area, key);
  const result = {
    ...details,
    area: details.area || area,
    cpc: details.cpc || [],
    dev: details.dev || [],
    holiday: details.holiday || isHolidayDate(key),
    holidayInLieu,
  };

  if (override) {
    result.cpcCapacity = override.cpc;
    result.devCapacity = override.dev;
    result.cpcOpen = Math.max(0, override.cpc - result.cpc.length);
    result.devOpen = Math.max(0, override.dev - result.dev.length);
  }

  return result;
}

function leaveSlotsForDate(key, area = currentUser.area) {
  return leaveSlotsForDateFromMap(key, area);
}

function leaveSlotCapacityForDetails(details, bucket) {
  const configuredCapacity = Number(details?.[`${bucket}Capacity`]);
  if (Number.isFinite(configuredCapacity) && configuredCapacity >= 0) return configuredCapacity;
  return standardLeaveSlotCapacity(details?.area || currentViewArea(), bucket);
}

function standardLeaveSlotCapacity(area, bucket) {
  if (bucket === "dev") return leaveSlotCapacity.dev;
  return area === "TMU" ? 2 : leaveSlotCapacity.cpc;
}

function leaveSlotCapacityOverrideKey(area, key) {
  return `${area}|${key}`;
}

function leaveSlotCapacityOverride(area, key) {
  const value = leaveSlotCapacityOverrides[leaveSlotCapacityOverrideKey(area, key)];
  if (!value || typeof value !== "object") return null;
  const cpc = Number(value.cpc);
  const dev = Number(value.dev);
  if (!Number.isInteger(cpc) || cpc < 0 || !Number.isInteger(dev) || dev < 0) return null;
  return { cpc, dev };
}

function setLeaveSlotCapacityOverride(area, key, cpc, dev, persist = true) {
  leaveSlotCapacityOverrides[leaveSlotCapacityOverrideKey(area, key)] = { cpc, dev };
  if (persist) storeJsonValue(LEAVE_SLOT_CAPACITY_STORAGE_KEY, leaveSlotCapacityOverrides);
}

function leaveSlotOpenCountForDetails(details, bucket) {
  const configuredOpenCount = Number(details?.[`${bucket}Open`]);
  if (Number.isFinite(configuredOpenCount) && configuredOpenCount >= 0) return configuredOpenCount;
  return Math.max(0, leaveSlotCapacityForDetails(details, bucket) - (details?.[bucket] || []).length);
}

function hasLeaveSlotDetails(key, area = currentUser.area) {
  return Boolean(leaveSlotMap(area)[key]) || isHolidayDate(key) || (area === "Area A" && fullLeaveDates.has(key));
}

function isLeaveSlotsFull(key, area = currentUser.area) {
  const details = leaveSlotsForDate(key, area);
  return leaveSlotOpenCountForDetails(details, "cpc") === 0 || (area === "Area A" && fullLeaveDates.has(key));
}

function slotRows(type, initials, capacity) {
  return Array.from({ length: capacity }, (_, index) => {
    const value = initials[index] || "";
    return `
      <div class="slot-row ${value ? "filled" : "empty"}">
        <span>${type} ${index + 1}</span>
        <b>${value || "Open"}</b>
      </div>
    `;
  }).join("");
}

function quickLeaveSlotTooltip(key, holidayKind = calendarHolidayKind(key), area = currentUser.area, slotDetails = null, persistent = false) {
  const details = slotDetails || visibleLeaveSlotDetails(key, area);
  const cpcCapacity = leaveSlotCapacityForDetails(details, "cpc");
  const devCapacity = leaveSlotCapacityForDetails(details, "dev");
  const cpcSlots = Array.from({ length: cpcCapacity }, (_, index) => details.cpc[index] || "");
  const devSlots = Array.from({ length: devCapacity }, (_, index) => details.dev[index] || "");
  const renderSlotRow = (prefix, value, index) => {
    const slotLabel = `${prefix}${index + 1}`;
    const displayValue = value ? escapeHtml(value) : "Open";
    return `
      <span class="tooltip-slot-row ${value ? "filled" : "empty"}" aria-label="${slotLabel} ${displayValue}">
        <span class="tooltip-slot-name">${slotLabel}</span>
        <b class="tooltip-slot-value">${displayValue}</b>
      </span>
    `;
  };

  return `
    <span class="leave-date-tooltip slot-summary${persistent ? " permanent-slot-summary" : ""}" role="${persistent ? "group" : "tooltip"}"${persistent ? ` aria-label="Leave slots for ${formatCalendarDate(key)}"` : ""}>
      ${persistent ? "" : `<strong>${formatCalendarDate(key)}</strong>`}
      ${holidayKind && !persistent ? `<span class="tooltip-date-kind ${holidayKind.badgeClass}">${holidayKind.label}</span>` : ""}
      <span class="tooltip-slot-rows">
        <span class="tooltip-slot-heading">CPC</span>
        ${cpcSlots.map((value, index) => renderSlotRow("C", value, index)).join("")}
        <span class="tooltip-slot-rule"></span>
        <span class="tooltip-slot-heading">Dev</span>
        ${devSlots.map((value, index) => renderSlotRow("D", value, index)).join("")}
      </span>
    </span>
  `;
}

function renderLeaveSlotBoard() {
  const target = document.getElementById("leave-slot-board");
  if (!target) return;

  const details = leaveSlotsForDate(selectedLeaveDateKey, currentViewArea());
  const cpcCapacity = leaveSlotCapacityForDetails(details, "cpc");
  const devCapacity = leaveSlotCapacityForDetails(details, "dev");
  const cpcFull = leaveSlotOpenCountForDetails(details, "cpc") === 0;
  const devFull = leaveSlotOpenCountForDetails(details, "dev") === 0;
  const statusText = cpcFull ? "CPC Full" : "CPC Open";
  const statusClass = cpcFull ? "closed" : "open";

  target.innerHTML = `
    <article class="leave-day-detail">
      <div class="leave-day-detail-header">
        <div>
          <span>${details.group ? `Group ${details.group} · Round ${details.round}` : "Daily Slot View"}</span>
          <h3>${details.label}</h3>
        </div>
        <strong class="${statusClass}">${statusText}</strong>
      </div>
      <div class="leave-slot-summary">
        <span><b>${details.cpc.length}</b> / ${cpcCapacity} CPC slots filled</span>
        <span><b>${details.dev.length}</b> / ${devCapacity} developmental slots filled</span>
        ${details.holidayInLieu ? "<span><b>Holiday In-Lieu</b> observed for your RDO line</span>" : ""}
        ${details.holiday && !details.holidayInLieu ? "<span><b>Holiday</b> Federal holiday</span>" : ""}
      </div>
      <div class="daily-slot-grid">
        <section class="daily-slot-card cpc">
          <div>
            <h4>CPC Slots</h4>
            <small>${cpcFull ? "Not available for CPC leave" : "Still available for CPC leave"}</small>
          </div>
          ${slotRows("Slot", details.cpc, cpcCapacity)}
        </section>
        <section class="daily-slot-card dev">
          <div>
            <h4>Developmental Slots</h4>
            <small>${devFull ? "Developmental slots full" : "Developmental slots still open"}</small>
          </div>
          ${slotRows("Dev", details.dev, devCapacity)}
        </section>
      </div>
      ${details.unavailable ? '<p class="unavailable-note">This day is blocked or manually unavailable for additional bidding.</p>' : ""}
    </article>
  `;
}

function openLeaveSlotModal() {
  renderLeaveSlotBoard();
  const modal = document.querySelector("[data-leave-slot-modal]");
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeLeaveSlotModal() {
  const modal = document.querySelector("[data-leave-slot-modal]");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function nthWeekdayOfMonth(year, monthIndex, weekday, nth) {
  const date = new Date(year, monthIndex, 1);
  const offset = (weekday - date.getDay() + 7) % 7;
  return 1 + offset + (nth - 1) * 7;
}

function lastWeekdayOfMonth(year, monthIndex, weekday) {
  const date = new Date(year, monthIndex + 1, 0);
  return date.getDate() - ((date.getDay() - weekday + 7) % 7);
}

function legalHolidayDatesForYear(year) {
  return new Set([
    dateKey(year, 1, 1),
    dateKey(year, 1, nthWeekdayOfMonth(year, 0, 1, 3)),
    dateKey(year, 2, nthWeekdayOfMonth(year, 1, 1, 3)),
    dateKey(year, 5, lastWeekdayOfMonth(year, 4, 1)),
    dateKey(year, 6, 19),
    dateKey(year, 7, 4),
    dateKey(year, 9, nthWeekdayOfMonth(year, 8, 1, 1)),
    dateKey(year, 10, nthWeekdayOfMonth(year, 9, 1, 2)),
    dateKey(year, 11, 11),
    dateKey(year, 11, nthWeekdayOfMonth(year, 10, 4, 4)),
    dateKey(year, 12, 25),
    ...holidayOverrides,
  ]);
}

function isLegalHolidayDate(key) {
  const [year] = key.split("-").map(Number);
  return legalHolidayDatesForYear(year).has(key) ||
    legalHolidayDatesForYear(year + 1).has(key) ||
    legalHolidayDatesForYear(year - 1).has(key);
}

function firstRdoWeekdayForInitials(initials = currentUser.initials) {
  const line = rdoLineForInitials(initials);
  const rdoWeekdays = [...rdoWeekdaysForLine(line)].sort((a, b) => a - b);
  return rdoWeekdays[0];
}

function isRdoWeekdayForInitials(weekday, initials = currentUser.initials) {
  const line = rdoLineForInitials(initials);
  return rdoWeekdaysForLine(line).has(weekday);
}

function inLieuHolidayKey(actualKey, initials = currentUser.initials, blocked = new Set()) {
  const actual = dateFromKey(actualKey);
  const actualWeekday = actual.getDay();
  const firstRdoWeekday = firstRdoWeekdayForInitials(initials);
  const direction = actualWeekday === firstRdoWeekday ? 1 : -1;
  const cursor = new Date(actual);
  let key;
  let legalHolidays;

  do {
    cursor.setDate(cursor.getDate() + direction);
    key = dateKeyFromDate(cursor);
    legalHolidays = legalHolidayDatesForYear(cursor.getFullYear());
  } while (
    isRdoWeekdayForInitials(cursor.getDay(), initials) ||
    legalHolidays.has(key) ||
    blocked.has(key)
  );

  return key;
}

function federalHolidayDatesForYear(year, initials = currentUser.initials) {
  const holidays = new Set();
  const inLieuDates = holidayInLieuDatesForYear(year, initials);
  inLieuDates.forEach((key) => holidays.add(key));

  legalHolidayDatesForYear(year).forEach((key) => {
    if (!isRdoWeekdayForInitials(dateFromKey(key).getDay(), initials)) holidays.add(key);
  });

  return holidays;
}

function holidayInLieuDatesForYear(year, initials = currentUser.initials) {
  const inLieuDates = new Set();

  legalHolidayDatesForYear(year).forEach((key) => {
    if (!isRdoWeekdayForInitials(dateFromKey(key).getDay(), initials)) return;
    inLieuDates.add(inLieuHolidayKey(key, initials, inLieuDates));
  });

  return inLieuDates;
}

function isHolidayDate(key, initials = currentUser.initials) {
  const [year] = key.split("-").map(Number);
  return federalHolidayDatesForYear(year, initials).has(key) ||
    federalHolidayDatesForYear(year + 1, initials).has(key) ||
    federalHolidayDatesForYear(year - 1, initials).has(key);
}

function isHolidayInLieuDate(key, initials = currentUser.initials) {
  const [year] = key.split("-").map(Number);
  return holidayInLieuDatesForYear(year, initials).has(key) ||
    holidayInLieuDatesForYear(year + 1, initials).has(key) ||
    holidayInLieuDatesForYear(year - 1, initials).has(key);
}

function calendarHolidayKind(key, options = {}) {
  const isPublicCalendar = options.showRdo === false && options.showPersonalLeave === false;

  if (isPublicCalendar) {
    return isLegalHolidayDate(key)
      ? { label: "Holiday", className: "holiday-day", badgeClass: "holiday" }
      : null;
  }

  if (isHolidayInLieuDate(key)) {
    return { label: "Holiday In-Lieu", className: "holiday-in-lieu-day", badgeClass: "in-lieu" };
  }

  return isHolidayDate(key)
    ? { label: "Holiday", className: "holiday-day", badgeClass: "holiday" }
    : null;
}

function formatCalendarDate(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(year, month - 1, day));
}

function supabaseClient() {
  const config = window.NATCA_SUPABASE_CONFIG;
  if (!config?.url || !config?.publishableKey || !window.supabase?.createClient) return null;
  if (!supabaseState.client) {
    supabaseState.client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return supabaseState.client;
}

function setAuthStatus(message, status = "info") {
  const target = document.querySelector("[data-auth-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

function friendlyAuthFailure(error) {
  const message = error?.message || String(error || "");
  if (/load failed|failed to fetch|network/i.test(message)) {
    return "Login could not reach Supabase. Check your connection and try again.";
  }
  return message || "That login did not work.";
}

function requestedLandingPage() {
  const requestedPage = new URLSearchParams(window.location.search).get("page");
  return ["dashboard", "intake", "intake-schedule", "admin"].includes(requestedPage) ? requestedPage : "";
}

function defaultLandingPageForRole() {
  if (hasSystemAdminAccess()) return "admin";
  if (canUseIntakeView()) return "intake";
  return "dashboard";
}

function intendedLandingPage(requestedPage = requestedLandingPage()) {
  const defaultPage = defaultLandingPageForRole();
  if (requestedPage === "admin") return hasSystemAdminAccess() ? "admin" : defaultPage;
  if (requestedPage === "intake" || requestedPage === "intake-schedule") {
    return canUseIntakeView() ? requestedPage : defaultPage;
  }
  if (requestedPage === "dashboard") return "dashboard";
  return defaultPage;
}

function supabaseAuthRedirectUrl() {
  const configuredUrl = window.NATCA_SUPABASE_CONFIG?.authRedirectUrl;
  if (configuredUrl && configuredUrl !== "auto") return configuredUrl;

  const url = new URL(window.location.href);
  url.hash = "";
  const requestedPage = requestedLandingPage();
  url.search = requestedPage ? `?page=${encodeURIComponent(requestedPage)}` : "";
  return url.toString();
}

function clearSupabaseAccountState() {
  supabaseState.authEmail = "";
  supabaseState.authUserId = "";
  supabaseState.pendingAuthEmail = "";
  syncAccountFields();
}

function syncAccountFields() {
  const hasSession = Boolean(supabaseState.authUserId);
  const currentEmail = supabaseState.authEmail || "Not connected";
  setText("[data-account-current-email]", currentEmail);
  setText(
    "[data-account-session-note]",
    hasSession
      ? supabaseState.pendingAuthEmail
        ? `Email change pending confirmation for ${supabaseState.pendingAuthEmail}.`
        : "You can set a password for future email/password sign-in or request a login email change."
      : "Login email and password changes are available after signing in with Supabase."
  );

  document.querySelectorAll("[data-account-email]").forEach((input) => {
    input.disabled = !hasSession;
    input.placeholder = hasSession ? "new.email@example.com" : "";
  });
  document.querySelectorAll("[data-account-password], [data-account-password-confirm]").forEach((input) => {
    input.disabled = !hasSession;
  });
  document.querySelectorAll("[data-update-account-email], [data-update-account-password]").forEach((button) => {
    button.disabled = !hasSession;
  });
  document.querySelectorAll("[data-account-email-form], [data-account-password-form]").forEach((form) => {
    form.setAttribute("aria-disabled", String(!hasSession));
  });
}

async function refreshSupabaseAccountState() {
  const client = supabaseClient();
  if (!client) {
    clearSupabaseAccountState();
    return null;
  }

  const { data, error } = await client.auth.getSession();
  if (error || !data.session) {
    clearSupabaseAccountState();
    return null;
  }

  supabaseState.authEmail = data.session.user?.email || "";
  supabaseState.authUserId = data.session.user?.id || "";
  supabaseState.pendingAuthEmail = data.session.user?.new_email || "";
  syncAccountFields();
  return data.session;
}

function setAccountFormStatus(message, status = "info") {
  const target = document.querySelector("[data-account-form-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

function accountEmailInputValue() {
  return (document.querySelector("[data-account-email]")?.value || "").trim().toLowerCase();
}

function clearAccountPasswordInputs() {
  document.querySelectorAll("[data-account-password], [data-account-password-confirm]").forEach((input) => {
    input.value = "";
  });
}

async function requireSupabaseAccountSession() {
  const session = await refreshSupabaseAccountState();
  if (!session) {
    setAccountFormStatus("Sign in with the Supabase email link or email/password login first.", "error");
    return null;
  }
  return session;
}

function profileFromSupabase(row) {
  const fallbackInitials = [row.first_name?.[0], row.last_name?.[0]].filter(Boolean).join("").toUpperCase();
  const role = row.role || "controller";
  return {
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    initials: row.initials || fallbackInitials || "?",
    initialsVerified: Boolean(row.initials_verified),
    seniorityRank: row.seniority_rank,
    bidderCount: Number(row.bidder_count || 0),
    area: row.area_name || "Area A",
    role,
    roleLabel: role === "admin" ? "Bidding Admin" : role === "intake" ? "Bidding Intake" : "BUE Controller",
    bidAs: normalizeBidRoleForArea(row.bid_role || "CPC", row.area_name || "Area A"),
    leaveSlotAllowance: normalizeLeaveSlotAllowance(row.leave_slot_allowance),
    systemAdmin: role === "admin",
    phone: row.phone || "",
    email: row.email || "",
    supabaseProfileId: row.profile_id,
  };
}

async function claimSupabaseProfile() {
  const client = supabaseClient();
  if (!client) return null;
  const { data, error } = await client.rpc("claim_current_bidder_profile");
  if (error) throw error;
  const profile = Array.isArray(data) ? data[0] : data;
  return profile ? profileFromSupabase(profile) : null;
}

async function canRequestSupabaseLoginEmail(email) {
  const client = supabaseClient();
  if (!client) return false;
  const { data, error } = await client.rpc("can_request_login_link", { login_email: email });
  if (error) throw error;
  return data === true;
}

async function rejectUnmatchedSupabaseLogin(message = "You are signed in, but no BUE profile matches this email yet.") {
  const client = supabaseClient();
  currentUser = null;
  if (client) await client.auth.signOut();
  clearSupabaseAccountState();
  showPublicHome();
  setAuthStatus(message, "error");
}

function showLoggedInApp(page = requestedLandingPage()) {
  selectedViewArea = currentUser.area;
  document.querySelector(".login-screen")?.setAttribute("hidden", "");
  document.querySelector(".app-shell")?.removeAttribute("hidden");
  document.querySelector("[data-public-login-menu]")?.setAttribute("hidden", "");
  document.querySelector("[data-public-login-toggle]")?.setAttribute("aria-expanded", "false");
  document.querySelector("[data-account-menu]")?.setAttribute("hidden", "");
  document.querySelector("[data-account-toggle]")?.setAttribute("aria-expanded", "false");
  document.querySelector("[data-alert-menu]")?.setAttribute("hidden", "");
  document.querySelector("[data-alert-toggle]")?.setAttribute("aria-expanded", "false");
  document.querySelector("[data-help-menu]")?.setAttribute("hidden", "");
  renderApp();
  setPage(intendedLandingPage(page));
  void loadSupabaseHelpThreads().then(() => {
    renderHelpSummary();
    renderHelpPanel();
    renderAlerts();
  });
}

function showPublicHome() {
  document.querySelector(".app-shell")?.setAttribute("hidden", "");
  document.querySelector("[data-account-menu]")?.setAttribute("hidden", "");
  document.querySelector("[data-account-toggle]")?.setAttribute("aria-expanded", "false");
  document.querySelector("[data-alert-menu]")?.setAttribute("hidden", "");
  document.querySelector("[data-alert-toggle]")?.setAttribute("aria-expanded", "false");
  document.querySelector("[data-help-menu]")?.setAttribute("hidden", "");
  document.querySelector(".login-screen")?.removeAttribute("hidden");
  const loginToggle = document.querySelector("[data-public-login-toggle]");
  if (loginToggle) {
    loginToggle.textContent = "Dashboard";
    loginToggle.setAttribute("aria-expanded", "false");
  }
  document.querySelector("[data-public-login-menu]")?.setAttribute("hidden", "");
  renderPublicPage();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function initializeSupabaseAuth() {
  const client = supabaseClient();
  if (!client || supabaseState.authInitialized) return;

  supabaseState.authInitialized = true;
  client.auth.onAuthStateChange((event, session) => {
    if (session && ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"].includes(event)) {
      restoreSupabaseSession();
    }
    if (event === "SIGNED_OUT") clearSupabaseAccountState();
  });

  await restoreSupabaseSession();
}

async function restoreSupabaseSession(page = requestedLandingPage()) {
  if (supabaseState.authRestorePromise) return supabaseState.authRestorePromise;

  supabaseState.authRestorePromise = (async () => {
    const session = await refreshSupabaseAccountState();
    if (!session) return false;

    try {
      const profile = await claimSupabaseProfile();
      if (!profile) {
        await rejectUnmatchedSupabaseLogin();
        return false;
      }
      currentUser = profile;
      setAuthStatus("Signed in.", "success");
      await loadSupabaseReferenceData();
      showLoggedInApp(page);
      return true;
    } catch (error) {
      setAuthStatus(error.message || "Could not load your BUE profile.", "error");
      return false;
    } finally {
      supabaseState.authRestorePromise = null;
    }
  })();

  return supabaseState.authRestorePromise;
}

async function sendSupabaseLoginLink(email) {
  const client = supabaseClient();
  if (!client) {
    setAuthStatus("Login is not configured yet.", "error");
    return;
  }

  let canRequestLink = false;
  try {
    canRequestLink = await canRequestSupabaseLoginEmail(email);
  } catch (error) {
    setAuthStatus(error.message || "Could not verify that email against the BUE roster.", "error");
    return;
  }
  if (!canRequestLink) {
    setAuthStatus("Use the email address listed for you in the BUE roster.", "error");
    return;
  }

  await client.auth.signOut();
  clearSupabaseAccountState();

  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: supabaseAuthRedirectUrl(),
      shouldCreateUser: true,
    },
  });

  if (error) {
    setAuthStatus(error.message, "error");
    return;
  }

  setAuthStatus("Login link sent. Check that email inbox.", "success");
}

async function sendSupabasePasswordReset(email) {
  const client = supabaseClient();
  if (!client) {
    setAuthStatus("Login is not configured yet.", "error");
    return;
  }

  let canRequestLink = false;
  try {
    canRequestLink = await canRequestSupabaseLoginEmail(email);
  } catch (error) {
    setAuthStatus(error.message || "Could not verify that email against the BUE roster.", "error");
    return;
  }
  if (!canRequestLink) {
    setAuthStatus("Use the email address listed for you in the BUE roster.", "error");
    return;
  }

  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: supabaseAuthRedirectUrl(),
  });

  if (error) {
    setAuthStatus(error.message || "Password reset email could not be sent.", "error");
    return;
  }

  setAuthStatus("Password email sent. Use that link to choose a new password.", "success");
}

async function loginWithSupabasePassword(email, password) {
  const client = supabaseClient();
  if (!client) {
    setAuthStatus("Login is not configured yet.", "error");
    return;
  }

  let signInResult;
  try {
    await client.auth.signOut();
    clearSupabaseAccountState();
    signInResult = await client.auth.signInWithPassword({ email, password });
  } catch (error) {
    setAuthStatus(friendlyAuthFailure(error), "error");
    return;
  }

  const { error } = signInResult;
  if (error) {
    setAuthStatus(friendlyAuthFailure(error), "error");
    return;
  }

  await refreshSupabaseAccountState();
  try {
    const profile = await claimSupabaseProfile();
    if (!profile) {
      await rejectUnmatchedSupabaseLogin();
      return;
    }
    currentUser = profile;
    setAuthStatus("Signed in.", "success");
    await loadSupabaseReferenceData();
    showLoggedInApp(requestedLandingPage());
  } catch (error) {
    setAuthStatus(friendlyAuthFailure(error) || "Could not load your BUE profile.", "error");
  }
}

function setProfileFormStatus(message, status = "info") {
  const target = document.querySelector("[data-profile-form-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

function profileFormValues() {
  const fullName = document.querySelector("[data-profile-name]")?.value.trim() || userFullName();
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  return {
    firstName: nameParts[0] || currentUser.firstName,
    lastName: nameParts.slice(1).join(" ") || currentUser.lastName,
    initials: (document.querySelector("[data-profile-initials]")?.value || "").trim().toUpperCase(),
    phone: (document.querySelector("[data-profile-phone]")?.value || "").trim(),
    email: (document.querySelector("[data-profile-email]")?.value || "").trim(),
  };
}

function applyProfileValues(values) {
  currentUser = {
    ...currentUser,
    ...values,
    area: currentUser.area,
  };
}

async function saveSupabaseProfile(values) {
  const client = supabaseClient();
  if (!client || !currentUser.supabaseProfileId) return false;
  let { data, error } = await client.rpc("update_current_bidder_profile", {
    profile_initials: values.initials,
    profile_phone: values.phone,
    profile_email: values.email,
  });
  if (error && /profile_email|function .*update_current_bidder_profile|Could not find/i.test(error.message || "")) {
    const fallback = await client.rpc("update_current_bidder_profile", {
      profile_initials: values.initials,
      profile_phone: values.phone,
    });
    data = fallback.data;
    error = fallback.error;
  }
  if (error) {
    setProfileFormStatus(error.message || "Profile could not be saved.", "error");
    return true;
  }
  const profile = Array.isArray(data) ? data[0] : data;
  if (profile) currentUser = profileFromSupabase(profile);
  renderApp();
  setProfileFormStatus("Profile saved.", "success");
  return true;
}

async function saveProfile() {
  const values = profileFormValues();
  if (!values.initials) {
    setProfileFormStatus("Enter your initials before saving.", "error");
    return;
  }

  setProfileFormStatus("Saving profile...");
  const savedToSupabase = await saveSupabaseProfile(values);
  if (savedToSupabase) return;

  applyProfileValues(values);
  renderApp();
  setProfileFormStatus("Profile saved.", "success");
}

async function updateSupabaseAccountEmail() {
  const session = await requireSupabaseAccountSession();
  if (!session) return;

  const email = accountEmailInputValue();
  if (!email) {
    setAccountFormStatus("Enter the new login email address.", "error");
    return;
  }
  if (email === (session.user?.email || "").toLowerCase()) {
    setAccountFormStatus("That is already your login email.", "error");
    return;
  }

  setAccountFormStatus("Requesting email change...");
  const { data, error } = await supabaseClient().auth.updateUser(
    { email },
    { emailRedirectTo: supabaseAuthRedirectUrl() }
  );

  if (error) {
    setAccountFormStatus(error.message || "Login email could not be changed.", "error");
    return;
  }

  supabaseState.pendingAuthEmail = data.user?.new_email || email;
  document.querySelectorAll("[data-account-email]").forEach((input) => { input.value = ""; });
  syncAccountFields();
  setAccountFormStatus("Check your email to confirm the login email change.", "success");
}

async function updateSupabaseAccountPassword() {
  const session = await requireSupabaseAccountSession();
  if (!session) return;

  const password = document.querySelector("[data-account-password]")?.value || "";
  const confirmPassword = document.querySelector("[data-account-password-confirm]")?.value || "";

  if (password.length < 8) {
    setAccountFormStatus("Use at least 8 characters for the new password.", "error");
    return;
  }
  if (password !== confirmPassword) {
    setAccountFormStatus("The password confirmation does not match.", "error");
    return;
  }

  setAccountFormStatus("Updating password...");
  const { error } = await supabaseClient().auth.updateUser({ password });
  if (error) {
    setAccountFormStatus(error.message || "Password could not be updated.", "error");
    return;
  }

  clearAccountPasswordInputs();
  await refreshSupabaseAccountState();
  setAccountFormStatus("Password saved. You can use email/password login next time.", "success");
}

function resetProfileForm() {
  renderCurrentUser();
  setProfileFormStatus("Changes canceled.");
  setAccountFormStatus("Changes canceled.");
}

function areaNameForRow(row, areaById = new Map()) {
  return areaById.get(row.area_id) || row.areas?.name || AREA_NAME_BY_CODE[row.area_code] || row.area_name || "Area A";
}

function lineForArea(line, area = currentUser.area) {
  return (line.area || "Area A") === area;
}

function currentViewArea() {
  return selectedViewArea || currentUser.area;
}

function isViewingHomeArea() {
  return currentViewArea() === currentUser.area;
}

const RDO_LINE_CODE_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function compareRdoLinesByCode(left, right) {
  const leftCode = String(left.line || "").trim();
  const rightCode = String(right.line || "").trim();
  const leftNumber = /^\d+$/.test(leftCode) ? Number(leftCode) : null;
  const rightNumber = /^\d+$/.test(rightCode) ? Number(rightCode) : null;

  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  return RDO_LINE_CODE_COLLATOR.compare(leftCode, rightCode);
}

function rdoLinesForArea(area = currentUser.area) {
  return rdoLines
    .filter((line) => lineForArea(line, area))
    .sort(compareRdoLinesByCode);
}

function slotMatchesArea(details, area = currentUser.area) {
  return (details.area || "Area A") === area;
}

function upsertRdoLinesFromDatabase(rows, areaById) {
  rows.forEach((row) => {
    const days = (row.rdo_line_days || [])
      .sort((a, b) => a.weekday - b.weekday)
      .map((day) => day.shift_code);
    const area = areaNameForRow(row, areaById);
    const nextLine = {
      area,
      pattern: row.pattern,
      line: row.line_code,
      lineType: row.line_type,
      cpc: row.assigned_initials || row.bidders?.initials || (row.assigned_bidder_id === currentUser?.supabaseProfileId ? currentUser.initials : ""),
      week: days.length === 7 ? days : Array.from({ length: 7 }, () => ""),
      group: row.fatigue_group || "",
      mid: row.mid || "",
      aws: typeof row.aws === "boolean" ? (row.aws ? "Yes" : "No") : "",
      fourTen: row.four_ten ? "Yes" : "No",
      flex: typeof row.flex === "boolean" ? (row.flex ? "Yes" : "No") : "",
      status: row.status === "taken" ? "Taken" : row.status === "locked" ? "Taken" : "Open",
    };
    const existingIndex = rdoLines.findIndex((line) => line.line === nextLine.line && (line.area || "Area A") === area);
    if (existingIndex >= 0) {
      rdoLines[existingIndex] = { ...rdoLines[existingIndex], ...nextLine };
    } else {
      rdoLines.push(nextLine);
    }
  });

  if (!selectedLineId && rdoLines.length) {
    selectedLineId = rdoLinesForArea(currentUser?.area || "Area A")[0]?.line || rdoLines[0].line;
  }
}

function supabaseRdoSubmissionToIntakeItem(row, areaById = new Map()) {
  const bidder = row.bidders || {};
  const payload = row.payload || {};
  const line = payload.rdo_line_code || payload.line || "";
  const area = row.areas?.name || areaById.get(row.area_id || bidder.area_id) || (bidder.initials === currentUser.initials ? currentUser.area : "Area A");
  const fatigueGroup = payload.fatigue_group || payload.fatigueGroup || "";
  const flex = payload.flex || "";
  const aws = payload.aws || "";
  const mid = payload.mid || "";
  const round = Number(row.round_number || currentRoundNumber());

  return {
    id: `supabase-rdo-${row.id}`,
    supabaseSubmissionId: row.id,
    type: "RDO Line",
    area,
    name: controllerName({
      firstName: bidder.first_name || "",
      lastName: bidder.last_name || "",
    }).trim() || bidder.initials || "",
    initials: bidder.initials || "",
    bidAs: normalizeBidRoleForArea(bidder.bid_role || payload.bid_as || "CPC", area),
    seniority: bidder.seniority_rank,
    status: uiStatusFromDatabase(row.status),
    submittedAt: row.submitted_at ? formatDateTime(new Date(row.submitted_at)) : formatDateTime(new Date(row.created_at)),
    approvedAt: row.reviewed_at && row.status === "approved" ? formatDateTime(new Date(row.reviewed_at)) : "",
    deniedAt: row.reviewed_at && row.status === "denied" ? formatDateTime(new Date(row.reviewed_at)) : "",
    denialReason: row.denial_reason || "",
    round,
    line,
    fatigueGroup,
    flex,
    aws,
    mid,
    summary: payload.summary || `Round ${round} · Line ${line} · Group ${fatigueGroup} · Flex ${flex} · AWS ${aws} · Mid ${mid}`,
  };
}

function upsertRdoSubmissionsFromDatabase(rows, areaById) {
  const items = (rows || []).map((row) => supabaseRdoSubmissionToIntakeItem(row, areaById));
  const ids = new Set(items.map((item) => item.supabaseSubmissionId));
  intakeQueue = intakeQueue.filter((item) => !item.supabaseSubmissionId || !ids.has(item.supabaseSubmissionId));
  intakeQueue.unshift(...items);
}

function upsertLeaveSlotsFromDatabase(rows, areaById) {
  const grouped = new Map();

  rows.forEach((row) => {
    const area = areaNameForRow(row, areaById);
    const key = `${area}:${row.slot_date}`;
    const details = grouped.get(key) || {
      area,
      date: row.slot_date,
      label: formatCalendarDate(row.slot_date),
      cpc: [],
      dev: [],
      cpcCapacity: 0,
      devCapacity: 0,
      cpcOpen: 0,
      devOpen: 0,
      cpcConfiguredCapacity: null,
      devConfiguredCapacity: null,
      unavailable: false,
    };
    const bucket = row.slot_group === "dev" ? "dev" : "cpc";
    const value = row.slot_initials || "";

    const capacityMarker = String(row.slot_code || "").match(/^CAPACITY-(\d+)$/);
    if (capacityMarker) {
      details[`${bucket}ConfiguredCapacity`] = Number(capacityMarker[1]);
      grouped.set(key, details);
      return;
    }

    details[`${bucket}Capacity`] += 1;
    if (row.status === "open" && !row.bidder_id && !row.source_leave_request_id) {
      details[`${bucket}Open`] += 1;
    }
    if (row.status === "unavailable") details.unavailable = true;
    if (["approved", "pending", "held"].includes(row.status) && value) {
      details[bucket].push({ code: row.slot_code, initials: value });
    }

    grouped.set(key, details);
  });

  grouped.forEach((details) => {
    const sortSlots = (items) => items
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
      .map((item) => item.initials);
    const storageKey = extraLeaveSlotStorageKey(details.date, details.area);
    const existing = extraLeaveSlotData[storageKey] || {};
    const cpcCapacity = Number.isInteger(details.cpcConfiguredCapacity)
      ? details.cpcConfiguredCapacity
      : Math.max(details.cpcCapacity, standardLeaveSlotCapacity(details.area, "cpc"));
    const devCapacity = Number.isInteger(details.devConfiguredCapacity)
      ? details.devConfiguredCapacity
      : Math.max(details.devCapacity, standardLeaveSlotCapacity(details.area, "dev"));
    extraLeaveSlotData[storageKey] = {
      ...existing,
      ...details,
      cpc: sortSlots(details.cpc),
      dev: sortSlots(details.dev),
      cpcCapacity,
      devCapacity,
      cpcOpen: Math.max(0, cpcCapacity - details.cpc.length),
      devOpen: Math.max(0, devCapacity - details.dev.length),
    };
    delete extraLeaveSlotData[storageKey].cpcConfiguredCapacity;
    delete extraLeaveSlotData[storageKey].devConfiguredCapacity;
  });
}

function supabaseLeaveRequestToIntakeItem(row, areaById = new Map()) {
  const bidder = row.bidders || row;
  const area = row.area_name || areaById.get(bidder.area_id) || (bidder.initials === currentUser.initials ? currentUser.area : "Area A");
  const dateKeys = row.requested_start_date && row.requested_end_date
    ? datesBetweenKeys(row.requested_start_date, row.requested_end_date)
    : [];
  const range = dateKeys.length ? formatLeaveRangeFromKeys(dateKeys) : "Leave request";
  const round = Number(row.round_number || currentRoundNumber());
  const weekKeys = round === 1 ? roundOneWeekKeysForDateKeys(dateKeys) : [];
  const days = Number(row.charged_days || 0);

  return {
    id: `supabase-leave-${row.id}`,
    supabaseRequestId: row.id,
    type: "Leave",
    area,
    name: controllerName({
      firstName: bidder.first_name,
      lastName: bidder.last_name,
      initials: bidder.initials,
    }),
    initials: bidder.initials || "",
    bidAs: normalizeBidRoleForArea(bidder.bid_role || "CPC", area),
    seniority: bidder.seniority_rank,
    priority: Number(row.priority || 0),
    status: uiStatusFromDatabase(row.status),
    submittedAt: row.submitted_at ? formatDateTime(new Date(row.submitted_at)) : formatDateTime(new Date(row.created_at)),
    approvedAt: row.reviewed_at && row.status === "approved" ? formatDateTime(new Date(row.reviewed_at)) : "",
    deniedAt: row.reviewed_at && row.status === "denied" ? formatDateTime(new Date(row.reviewed_at)) : "",
    denialReason: row.denial_reason || "",
    range,
    days,
    round,
    weekUnits: weekKeys.length,
    weekKeys,
    notes: row.notes || "",
    summary: `${range} · ${days} ${days === 1 ? "day" : "days"}${weekKeys.length ? ` · ${weekKeys.length} bid week${weekKeys.length === 1 ? "" : "s"}` : ""}`,
  };
}

function datesBetweenKeys(startKey, endKey) {
  if (!startKey || !endKey) return [];
  const keys = [];
  const cursor = dateFromKey(startKey);
  const end = dateFromKey(endKey);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return [];

  while (cursor <= end) {
    keys.push(dateKeyFromDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

function upsertLeaveRequestsFromDatabase(rows, areaById) {
  const items = (rows || []).map((row) => supabaseLeaveRequestToIntakeItem(row, areaById));
  const ids = new Set(items.map((item) => item.supabaseRequestId));
  intakeQueue = intakeQueue.filter((item) => !item.supabaseRequestId || !ids.has(item.supabaseRequestId));
  intakeQueue.unshift(...items);

  const personalItems = items.filter((item) => item.initials === currentUser.initials);
  const personalIds = new Set(personalItems.map((item) => item.supabaseRequestId));
  for (let index = leaveBids.length - 1; index >= 0; index -= 1) {
    if (leaveBids[index].supabaseRequestId && personalIds.has(leaveBids[index].supabaseRequestId)) {
      leaveBids.splice(index, 1);
    }
  }
  personalItems.forEach((item) => {
    leaveBids.push({
      supabaseRequestId: item.supabaseRequestId,
      priority: item.priority || nextLeavePriority(),
      range: item.range,
      days: item.days,
      status: item.status,
      notes: item.notes,
      initials: item.initials,
      area: item.area,
      round: item.round,
      weekUnits: item.weekUnits,
      weekKeys: item.weekKeys,
    });
  });
}

function resetSupabaseBackedData() {
  if (supabaseState.placeholdersCleared) return;
  rdoLines.splice(0, rdoLines.length);
  leaveBids.splice(0, leaveBids.length);
  leaveSlotWeeks.splice(0, leaveSlotWeeks.length);
  Object.keys(extraLeaveSlotData).forEach((key) => delete extraLeaveSlotData[key]);
  senioritySource.splice(0, senioritySource.length);
  databaseBidWindows.clear();
  seniority = [];
  intakeQueue = [];
  helpThreads = [];
  intakeSchedules.splice(0, intakeSchedules.length);
  intakeTeamInitials.clear();
  holidayOverrides.clear();
  fullLeaveDates.clear();
  selectedLineId = "";
  supabaseState.placeholdersCleared = true;
}

function bidderRowArea(row, areaById = new Map()) {
  return row.area_name || row.areas?.name || areaById.get(row.area_id) || "Area A";
}

function bidderRowToSeniorityEntry(row, areaById = new Map()) {
  return [
    row.last_name || "",
    row.first_name || "",
    row.bid_role || "CPC",
    row.initials || "",
    bidderRowArea(row, areaById),
    row.email || "",
    row.phone || "",
    row.active !== false,
    normalizeLeaveSlotAllowance(row.leave_slot_allowance),
    row.profile_id || row.id || "",
  ];
}

function seniorityEntryProfileId(entry) {
  return entry?.[9] || "";
}

function applyRosterFromDatabase(rows, areaById = new Map()) {
  senioritySource.splice(0, senioritySource.length);
  (rows || []).forEach((row) => {
    senioritySource.push(bidderRowToSeniorityEntry(row, areaById));
  });

  if (currentUser?.supabaseProfileId) {
    const currentEntry = senioritySource.find((entry) => seniorityEntryProfileId(entry) === currentUser.supabaseProfileId);
    if (currentEntry) {
      const person = rosterEntryToPerson(currentEntry);
      currentUser = {
        ...currentUser,
        firstName: person.firstName,
        lastName: person.lastName,
        initials: person.initials,
        email: person.email,
        phone: person.phone,
        area: person.area,
        bidAs: person.bidAs,
        seniorityRank: person.rank,
        leaveSlotAllowance: person.leaveSlotAllowance,
      };
      selectedViewArea = person.area;
    }
  }

  seniority = buildSeniority();
}

function applyBidWindowsFromDatabase(rows) {
  databaseBidWindows.clear();
  (rows || []).forEach((row) => {
    const bidderId = row.bidder_id || "";
    const round = Number(row.round_number);
    const start = new Date(row.opens_at);
    const end = new Date(row.closes_at);
    if (!bidderId || !Number.isInteger(round) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;

    databaseBidWindows.set(databaseBidWindowKey(bidderId, round), {
      round,
      start,
      end,
      status: row.status || "scheduled",
    });
  });
  seniority = buildSeniority();
}

function supabaseLoadWarning(label, result) {
  if (!result?.error) return "";
  const message = result.error.message || String(result.error);
  return `${label}: ${message}`;
}

function supabaseRows(result) {
  return result?.error ? [] : result?.data || [];
}

function applyIntakeSchedulesFromDatabase(rows, areaById = new Map()) {
  intakeSchedules.splice(0, intakeSchedules.length);
  intakeTeamInitials.clear();

  (rows || []).forEach((row) => {
    const bidder = row.bidders || {};
    const initials = bidder.initials || row.initials || "";
    if (!initials) return;

    intakeTeamInitials.add(initials);
    intakeSchedules.push({
      id: row.id,
      initials,
      name: controllerName({
        firstName: bidder.first_name || row.first_name || "",
        lastName: bidder.last_name || row.last_name || "",
      }).trim() || initials,
      area: row.scope || row.area_name || areaById.get(row.area_id) || INTAKE_SCHEDULE_AREA,
      start: new Date(row.starts_at),
      end: new Date(row.ends_at),
    });
  });
}

async function ensureSupabaseBidYearId() {
  if (supabaseState.bidYearId) return supabaseState.bidYearId;
  const client = supabaseClient();
  if (!client) return "";

  const { data, error } = await client
    .from("bid_years")
    .select("id")
    .eq("bid_year", BID_YEAR)
    .single();
  if (error) throw error;
  supabaseState.bidYearId = data.id;
  return data.id;
}

async function saveSupabaseRdoRequest(request) {
  const client = supabaseClient();
  if (!client || !currentUser.supabaseProfileId) return false;
  const bidYearId = await ensureSupabaseBidYearId();
  if (!bidYearId) return false;

  const payload = {
    line: request.line,
    rdo_line_code: request.line,
    fatigue_group: request.fatigueGroup,
    flex: request.flex,
    aws: request.aws,
    mid: request.mid,
    bid_as: request.bidAs,
    summary: request.summary,
  };

  const { error } = await client
    .from("intake_submissions")
    .insert({
      bid_year_id: bidYearId,
      area_id: null,
      bidder_id: currentUser.supabaseProfileId,
      round_number: request.round,
      submission_type: "rdo",
      status: "pending",
      payload,
      submitted_at: new Date().toISOString(),
    });
  if (error) throw error;
  return true;
}

async function saveSupabaseLeaveRequests(newRequests, draftsByRange) {
  const client = supabaseClient();
  if (!client || !currentUser.supabaseProfileId) return false;
  const rdoRequest = currentUserRdoRequest();
  const rdoLine = rdoLineForInitials(currentUser.initials);

  const requestedItems = newRequests.map((request) => {
    const dateKeys = datesInLeaveRange(request.range);
    return {
      start_date: dateKeys[0],
      end_date: dateKeys[dateKeys.length - 1],
      round: request.round,
      rdo_line_code: rdoRequest?.line || rdoLine?.line || null,
      fatigue_group: rdoRequest?.fatigueGroup || rdoLine?.group || null,
      flex: rdoRequest?.flex || rdoLine?.flex || null,
      aws: rdoRequest?.aws || rdoLine?.aws || null,
      mid: rdoRequest?.mid || rdoLine?.mid || null,
      notes: draftsByRange.get(request.range)?.notes || "",
    };
  });

  const { error } = await client.rpc("submit_leave_bid_batch", {
    requested_bid_year: BID_YEAR,
    requested_items: requestedItems,
    target_initials: null,
    target_area_name: null,
    manual_entry: false,
  });
  if (error) throw error;

  const { data: savedRequests, error: refreshError } = await client.rpc("read_leave_intake_queue", {
    queue_bid_year: BID_YEAR,
  });
  if (refreshError) {
    console.warn(`Leave batch was saved, but the intake queue could not be refreshed. ${refreshError.message || refreshError}`);
  } else {
    upsertLeaveRequestsFromDatabase(savedRequests || [], new Map());
  }

  return true;
}

async function loadSupabaseReferenceData() {
  const client = supabaseClient();
  if (!client) {
    resetSupabaseBackedData();
    supabaseState.enabled = false;
    supabaseState.connected = false;
    supabaseState.message = "Supabase is not configured. No bidding data was loaded.";
    return;
  }
  if (supabaseState.loading) return;
  resetSupabaseBackedData();

  supabaseState.enabled = true;
  supabaseState.loading = true;
  supabaseState.message = "Loading bidding data from Supabase...";

  try {
    const { data: bidYear, error: bidYearError } = await client
      .from("bid_years")
      .select("id,bid_year,annual_leave_allowance_days")
      .eq("bid_year", BID_YEAR)
      .single();
    if (bidYearError) throw bidYearError;

    const [areasResult, rosterResult] = await Promise.all([
      client.from("areas").select("id,code,name,display_order").order("display_order"),
      client.rpc("read_bidding_roster"),
    ]);
    const requiredError = [areasResult, rosterResult].find((result) => result.error)?.error;
    if (requiredError) throw requiredError;

    supabaseState.bidYearId = bidYear.id;
    const areaById = new Map((areasResult.data || []).map((area) => [area.id, area.name]));
    applyRosterFromDatabase(rosterResult.data || [], areaById);

    const [
      holidaysResult,
      rdoLinesResult,
      rdoSubmissionsResult,
      leaveSlotsResult,
      leaveRequestsResult,
      intakeSchedulesResult,
      bidYearSettingsResult,
      bidWindowsResult,
    ] = await Promise.all([
      client.from("holidays").select("holiday_date,name,is_observed").eq("bid_year_id", bidYear.id),
      client.from("rdo_lines").select("id,area_id,line_code,line_type,pattern,fatigue_group,mid,aws,four_ten,flex,status,assigned_bidder_id,assigned_initials,rdo_line_days(weekday,shift_code)").eq("bid_year_id", bidYear.id),
      supabaseState.authUserId ? client.from("intake_submissions").select("id,area_id,bidder_id,round_number,status,payload,submitted_at,reviewed_at,denial_reason,created_at,bidders:bidder_id(first_name,last_name,initials,bid_role,seniority_rank,area_id),areas(name)").eq("bid_year_id", bidYear.id).eq("submission_type", "rdo").in("status", ["pending", "approved"]).order("submitted_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      client.from("leave_slots").select("area_id,slot_date,slot_group,slot_code,status,slot_initials,bidder_id,source_leave_request_id").eq("bid_year_id", bidYear.id),
      supabaseState.authUserId ? client.rpc("read_leave_intake_queue", { queue_bid_year: BID_YEAR }) : Promise.resolve({ data: [], error: null }),
      supabaseState.authUserId ? client.from("intake_schedules").select("id,area_id,intake_user_id,starts_at,ends_at,scope,bidders:intake_user_id(first_name,last_name,initials),areas(name)").order("starts_at") : Promise.resolve({ data: [], error: null }),
      client.rpc("read_bid_year_settings", { requested_bid_year: BID_YEAR }),
      supabaseState.authUserId
        ? client.from("bid_windows").select("bidder_id,round_number,opens_at,closes_at,status").eq("bid_year_id", bidYear.id)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const loadWarnings = [
      supabaseLoadWarning("holidays", holidaysResult),
      supabaseLoadWarning("RDO lines", rdoLinesResult),
      supabaseLoadWarning("RDO submissions", rdoSubmissionsResult),
      supabaseLoadWarning("leave slots", leaveSlotsResult),
      supabaseLoadWarning("leave requests", leaveRequestsResult),
      supabaseLoadWarning("intake schedules", intakeSchedulesResult),
      isMissingSupabaseRoutine(bidYearSettingsResult.error) ? null : supabaseLoadWarning("bid year settings", bidYearSettingsResult),
      supabaseLoadWarning("bid windows", bidWindowsResult),
    ].filter(Boolean);

    supabaseRows(holidaysResult).forEach((holiday) => {
      if (holiday.holiday_date) holidayOverrides.add(holiday.holiday_date);
    });

    if (!rdoLinesResult.error) upsertRdoLinesFromDatabase(rdoLinesResult.data || [], areaById);
    if (!rdoSubmissionsResult.error) upsertRdoSubmissionsFromDatabase(rdoSubmissionsResult.data || [], areaById);
    if (!leaveSlotsResult.error) upsertLeaveSlotsFromDatabase(leaveSlotsResult.data || [], areaById);
    if (!leaveRequestsResult.error) upsertLeaveRequestsFromDatabase(leaveRequestsResult.data || [], areaById);
    if (!intakeSchedulesResult.error) applyIntakeSchedulesFromDatabase(intakeSchedulesResult.data || [], areaById);
    if (!bidYearSettingsResult.error) applyBidYearSettings(Array.isArray(bidYearSettingsResult.data) ? bidYearSettingsResult.data[0] : bidYearSettingsResult.data);
    if (!bidWindowsResult.error) applyBidWindowsFromDatabase(bidWindowsResult.data || []);
    await loadSupabaseHelpThreads();

    supabaseState.connected = true;
    supabaseState.loadedAt = new Date();
    supabaseState.message = `Connected to Supabase. Loaded ${(areasResult.data || []).length} areas, ${(rosterResult.data || []).length} bidders, ${supabaseRows(bidWindowsResult).length} bid windows, ${supabaseRows(holidaysResult).length} holidays, ${supabaseRows(rdoLinesResult).length} RDO lines, ${supabaseRows(rdoSubmissionsResult).length} RDO submissions, ${supabaseRows(leaveSlotsResult).length} leave slots, ${supabaseRows(leaveRequestsResult).length} leave requests, and ${supabaseRows(intakeSchedulesResult).length} intake schedules.`;
    if (loadWarnings.length) {
      supabaseState.message += ` Some optional data could not load: ${loadWarnings.join("; ")}`;
      console.warn(supabaseState.message);
    }
  } catch (error) {
    supabaseState.connected = false;
    supabaseState.message = `Supabase data unavailable. No prototype fallback was loaded. ${error.message || error}`;
    console.warn(supabaseState.message);
  } finally {
    supabaseState.loading = false;
  }
}

function dateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateKeyFromDate(date) {
  return dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDateTimeLocalValue(date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function formatDateRange(start, end) {
  const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  const timeFormatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
  return `${dateFormatter.format(start)} · ${timeFormatter.format(start)} - ${timeFormatter.format(end)}`;
}

function latestAreaRound(date = new Date()) {
  const roundState = areaBidRoundState(date);
  if (roundState) return roundState.round;

  const activePerson = seniority.find((person) => person.openRound);
  if (activePerson) return activePerson.openRound;

  return Math.max(1, ...seniority.flatMap((person) => person.completed));
}

function setText(selector, text) {
  document.querySelectorAll(selector).forEach((element) => {
    element.textContent = text;
  });
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function publicAreaPrefix(area) {
  if (area === "TMU") return "TMU";
  return area.replace("Area ", "");
}

function publicSectionLabel(_area, section) {
  if (section === "RDO") return "RDO";
  if (section === "Bid Time") return "Bid Time";
  return "Calendar";
}

function publicHeading(area, section) {
  if (area === "FAQ") return "Bidding FAQ";
  if (area === "Previous Years") return "Previous Years";
  if (section === "RDO") return `${area} RDO Lines`;
  if (section === "Bid Time") return `${area} Bid Times`;
  return `${area} Annual Leave Calendar`;
}

function publicSheetCode(area, section) {
  if (area === "FAQ") return "Bidding references and common questions.";
  if (area === "Previous Years") return "Historical RDO, bid-time, and leave calendar resources.";
  if (section === "RDO") return "Public RDO line reference for this area.";
  if (section === "Bid Time") return "Public bid-time schedule for this area.";
  return "Hover or focus a date to view open slots and current bidder initials. Public calendars are read-only.";
}

function publicInfoText(area, section) {
  if (area === "FAQ") {
    return `
      <div class="public-info-card">
        <p>Use this public area for bidding rules, leave slot definitions, RDO line notes, and who to contact before your personal bid window opens.</p>
      </div>
    `;
  }

  if (area === "Previous Years") {
    return `
      <div class="public-info-card">
        <p>Historical annual leave calendars, RDO line sheets, and bid-time schedules will live here by bidding year.</p>
      </div>
    `;
  }

  if (section === "RDO") {
    return renderPublicRdoTable(area);
  }

  if (section === "Bid Time") {
    return renderPublicBidTimeTable(area);
  }

  return "";
}

function bidAsClass(bidAs) {
  return bidAs.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function publicRdoFilteredLines(area) {
  return rdoLinesForArea(area).filter((line) => rdoLineMatchesFilterSet(line, publicRdoFilters));
}

const PUBLIC_RDO_LINE_SECTIONS = ["CPC", "R-Dev", "D-Dev"];

function publicRdoLineSection(line) {
  if (line.lineType !== "DEV") return "CPC";
  return /D[-\s]?DEV/i.test(line.pattern) ? "D-Dev" : "R-Dev";
}

function publicRdoRowsMarkup(area, lines, showPatternGroups = true) {
  if (!lines.length) return `<tr><td colspan="11">No RDO lines match those filters for ${area}.</td></tr>`;

  let lastPattern = "";
  const rows = [];

  lines.forEach((line) => {
    if (showPatternGroups && line.pattern !== lastPattern) {
      rows.push(`<tr><th colspan="11">${line.pattern}</th></tr>`);
      lastPattern = line.pattern;
    }

    rows.push(`
      <tr class="${line.status === "Taken" ? "occupied-row" : ""}">
        <td>${line.line}</td>
        <td><b>${lineOccupant(line)}</b></td>
        ${line.week.map((value) => `<td>${shiftCell(value)}</td>`).join("")}
        <td></td>
        <td>${userChoiceCell(lineMidReferenceValue(line))}</td>
      </tr>
    `);
  });

  return rows.join("");
}

function publicRdoSectionsMarkup(area, lines = publicRdoFilteredLines(area)) {
  if (!lines.length) return `<div class="public-rdo-empty">No RDO lines match those filters for ${area}.</div>`;

  return PUBLIC_RDO_LINE_SECTIONS.map((section) => {
    const sectionLines = lines.filter((line) => publicRdoLineSection(line) === section);
    if (!sectionLines.length) return "";
    const lineLabel = sectionLines.length === 1 ? "line" : "lines";

    return `
      <section class="public-rdo-line-section" aria-labelledby="public-rdo-${bidAsClass(section)}">
        <div class="public-rdo-line-section-heading">
          <h3 id="public-rdo-${bidAsClass(section)}">${section}</h3>
          <span>${sectionLines.length} ${lineLabel}</span>
        </div>
        <div class="table-wrap rdo-page-table-wrap">
          <table class="line-table public-rdo-table">
            <thead>
              <tr>
                <th>Line #</th>
                <th>Bidder</th>
                ${dayNames.map((day) => `<th>${day}</th>`).join("")}
                <th>Group</th>
                <th>Mid</th>
              </tr>
            </thead>
            <tbody>${publicRdoRowsMarkup(area, sectionLines, section === "CPC")}</tbody>
          </table>
        </div>
      </section>
    `;
  }).join("");
}

function updatePublicRdoResults() {
  const sectionsTarget = document.querySelector("[data-public-rdo-sections]");
  if (!sectionsTarget) return;

  const lines = publicRdoFilteredLines(publicState.area);
  const lineLabel = lines.length === 1 ? "line" : "lines";
  sectionsTarget.innerHTML = publicRdoSectionsMarkup(publicState.area, lines);
  setText("[data-public-rdo-filter-count]", `${lines.length} ${publicRdoFilters.openOnly ? "open " : ""}${lineLabel}`);
}

function renderPublicRdoTable(area) {
  const areaLines = rdoLinesForArea(area);
  const lines = areaLines.filter((line) => rdoLineMatchesFilterSet(line, publicRdoFilters));
  const lineLabel = lines.length === 1 ? "line" : "lines";

  return `
    <section class="panel rdo-table-panel public-rdo-panel">
      <div class="panel-header">
        <div>
          <h2>RDO Bid Lines - ${area}</h2>
          <p>Review the negotiated lines for this area. Sign in to select a line and complete your bid preferences.</p>
        </div>
        <span class="pill open" data-public-rdo-filter-count>${lines.length} ${publicRdoFilters.openOnly ? "open " : ""}${lineLabel}</span>
      </div>
      <div class="filter-bar">
        <input type="search" value="${escapeHtml(publicRdoFilters.search)}" placeholder="Search line or bidder..." aria-label="Search public RDO lines" data-public-rdo-filter="search" />
        <label><input type="checkbox" ${publicRdoFilters.openOnly ? "checked" : ""} data-public-rdo-filter="open" /> Open Only</label>
        <select data-public-rdo-filter="mid" aria-label="Filter public lines by mid preference">
          <option value="all" ${publicRdoFilters.mid === "all" ? "selected" : ""}>Mid: All</option>
          <option value="BID" ${publicRdoFilters.mid === "BID" ? "selected" : ""}>Mid: Bid Line</option>
          <option value="UNSELECTED" ${publicRdoFilters.mid === "UNSELECTED" ? "selected" : ""}>Mid: Unselected</option>
        </select>
        <select data-public-rdo-filter="fourTen" aria-label="Filter public lines by 4-10 schedule">
          <option value="all" ${publicRdoFilters.fourTen === "all" ? "selected" : ""}>4-10: All</option>
          <option value="Yes" ${publicRdoFilters.fourTen === "Yes" ? "selected" : ""}>4-10: Yes</option>
          <option value="No" ${publicRdoFilters.fourTen === "No" ? "selected" : ""}>4-10: No</option>
        </select>
      </div>
      <div class="public-rdo-sections" data-public-rdo-sections>
        ${publicRdoSectionsMarkup(area, lines)}
      </div>
    </section>
  `;
}

function renderPublicBidTimeTable(area) {
  return `
    <div class="public-table-heading flat">
      <small>All rounds are two-hour bid windows. Times shown are bid-window start times.</small>
    </div>
    <div class="table-wrap public-table-wrap flat">
      <table class="public-bid-time-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Initials</th>
            <th>Bid As</th>
            <th>Round 1</th>
            <th>Round 2</th>
            <th>Round 3</th>
            <th>Round 4</th>
          </tr>
        </thead>
        <tbody>
          ${seniority.map((person) => `
            <tr>
              <td>${person.rank}</td>
              <td>${person.firstName} ${person.lastName}</td>
              <td>${person.initials}</td>
              <td><span class="bid-as ${bidAsClass(person.bidAs)}">${person.bidAs}</span></td>
              ${person.rounds.map((round) => `<td>${publicBidTimeLabel(round)}</td>`).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function updatePublicView(area = publicState.area, section = publicState.section) {
  publicState.area = area;
  publicState.section = section || "Calendar";

  const isInfoView = area === "FAQ" || area === "Previous Years" || section !== "Calendar";
  const tabs = document.querySelector(".public-tabs");
  const publicPanel = document.querySelector(".public-calendar-panel");
  const calendarContent = document.querySelector("[data-public-calendar-content]");
  const calendarViewControls = document.querySelector(".public-calendar-panel [data-calendar-mode-control]");
  const infoMessage = document.querySelector("[data-public-info]");
  const isTableView = area !== "FAQ" && area !== "Previous Years" && section !== "Calendar";

  setText("[data-public-heading]", publicHeading(area, publicState.section));
  setText("[data-public-sheet-code]", publicSheetCode(area, publicState.section));
  setText("[data-public-sheet-title]", isInfoView ? publicHeading(area, publicState.section) : "Bid Calendar");

  if (publicPanel) {
    publicPanel.classList.toggle("table-view", isTableView);
  }

  if (tabs) {
    const showTabs = area !== "FAQ" && area !== "Previous Years";
    tabs.hidden = !showTabs;
    tabs.querySelectorAll("[data-public-tab]").forEach((button) => {
      const tabSection = button.dataset.publicTab;
      button.dataset.publicArea = area;
      button.dataset.publicSection = tabSection;
      button.textContent = publicSectionLabel(area, tabSection);
      button.classList.toggle("active", tabSection === publicState.section);
    });
  }

  if (calendarContent) {
    calendarContent.hidden = isInfoView;
  }

  if (calendarViewControls) {
    calendarViewControls.hidden = publicState.section !== "Calendar";
  }

  if (infoMessage) {
    infoMessage.hidden = !isInfoView;
    infoMessage.classList.toggle("table-view", isTableView);
    infoMessage.innerHTML = publicInfoText(area, publicState.section);
  }

  document.querySelectorAll("[data-public-area]").forEach((button) => {
    const buttonSection = button.dataset.publicSection;
    const isActive =
      button.dataset.publicArea === area &&
      ((area === "FAQ" || area === "Previous Years") || buttonSection === publicState.section);
    button.classList.toggle("active", isActive);
  });
}

function publicRosterArea(area = publicState.area) {
  return ZLA_AREAS.includes(area) ? area : currentUser.area;
}

function renderPublicPage(area = publicState.area, section = publicState.section) {
  seniority = buildSeniority(publicRosterArea(area));
  updatePublicView(area, section);
  if (publicState.section === "Calendar" && ZLA_AREAS.includes(publicState.area)) {
    renderCalendars({ includeMember: false });
  } else {
    updateCalendarViewControls();
    updateCalendarYearLabels();
  }
}

function isMemberAppVisible() {
  const appShell = document.querySelector(".app-shell");
  return Boolean(appShell && !appShell.hidden);
}

function renderVisibleCalendars() {
  const memberVisible = isMemberAppVisible();
  renderCalendars({
    includePublic: !memberVisible,
    includeMember: memberVisible,
  });
}

function userFullName() {
  return `${currentUser.firstName} ${currentUser.lastName}`;
}

function currentUserBidAs() {
  const rosterMatch = senioritySource.find((entry) => seniorityEntryActive(entry) && seniorityEntryMatchesCurrentUser(entry));
  const seniorityMatch = seniority.find(personMatchesCurrentUser);
  return normalizeBidRoleForArea(currentUser.bidAs || rosterMatch?.[2] || seniorityMatch?.bidAs || defaultBidRoleForArea(currentUser.area), currentUser.area);
}

function activeAdminGrant() {
  if (!currentUser?.adminGrant) return null;
  const nowDate = new Date();
  const { start, end } = currentUser.adminGrant;
  return nowDate >= start && nowDate <= end ? currentUser.adminGrant : null;
}

function activeScheduledIntakeWindow() {
  if (!currentUser?.initials) return null;
  const nowDate = new Date();
  return intakeSchedules.find((schedule) => {
    const accessStart = new Date(schedule.start.getTime() - 15 * 60 * 1000);
    return schedule.initials === currentUser.initials && nowDate >= accessStart && nowDate <= schedule.end;
  }) || null;
}

function hasIntakeAccess() {
  return hasSystemAdminAccess()
    || currentUser?.role === "intake"
    || Boolean(activeAdminGrant())
    || Boolean(activeScheduledIntakeWindow());
}

function hasSystemAdminAccess() {
  return Boolean(currentUser?.systemAdmin);
}

function canUseIntakeView() {
  return hasIntakeAccess();
}

function pageForViewMode(mode) {
  if (mode === "admin") return "admin";
  if (mode === "intake") return "intake";
  return "dashboard";
}

function viewModeForPage(pageName) {
  if (pageName === "admin") return "admin";
  if (pageName === "intake" || pageName === "intake-schedule") return "intake";
  return "bue";
}

function syncViewModeSwitcher(pageName = "dashboard") {
  const activeMode = viewModeForPage(pageName);

  document.querySelectorAll("[data-intake-view-option]").forEach((element) => {
    element.hidden = !canUseIntakeView();
  });

  document.querySelectorAll("[data-admin-view-option]").forEach((element) => {
    element.hidden = !hasSystemAdminAccess();
  });

  document.querySelectorAll("[data-view-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewMode === activeMode);
  });
}

function accessLabel() {
  const grant = activeAdminGrant();
  if (grant) return `${currentUser.roleLabel} + ${grant.type} · ${grant.scope}`;
  const schedule = activeScheduledIntakeWindow();
  if (schedule) return `${currentUser.roleLabel} + Scheduled Intake · ${schedule.area}`;
  return currentUser.roleLabel;
}

function adminGrantWindowText() {
  const grant = currentUser.adminGrant;
  if (!grant) {
    const schedule = activeScheduledIntakeWindow();
    return schedule ? `${formatDateTime(schedule.start)} - ${formatDateTime(schedule.end)}` : "Not assigned";
  }
  return `${formatDateTime(grant.start)} - ${formatDateTime(grant.end)}`;
}

function userSeniorityText() {
  const rank = currentUserSeniorityRank();
  return Number.isFinite(rank) ? `#${rank} / ${currentUserBidderCount()}` : "Admin";
}

function userSeniorityLongText() {
  const rank = currentUserSeniorityRank();
  return Number.isFinite(rank) ? `#${rank} of ${currentUserBidderCount()}` : "Admin access";
}

function renderCurrentUser() {
  const canOpenIntake = canUseIntakeView();
  const displayedSeniorityRank = currentUserSeniorityRank();
  const displayedBidderCount = currentUserBidderCount();
  const hasSeniority = Number.isFinite(displayedSeniorityRank);
  const bidAs = currentUserBidAs();
  const bidAsClassName = `bid-as-${bidAsClass(bidAs)}`;
  const ahead = hasSeniority ? displayedSeniorityRank - 1 : "—";
  const behind = hasSeniority ? displayedBidderCount - displayedSeniorityRank : "—";
  const viewArea = currentViewArea();
  setText("[data-user-initials]", currentUser.initials);
  setText("[data-user-name]", userFullName());
  setText("[data-user-area]", currentUser.area);
  document.querySelectorAll("[data-user-context]").forEach((element) => {
    element.innerHTML = `
      <span class="user-context-main">
        <span class="user-context-name">${userFullName()}</span>
        <span class="user-context-area">· ${currentUser.area}</span>
      </span>
    `;
  });
  document.querySelectorAll("[data-view-area-select]").forEach((select) => {
    select.innerHTML = ZLA_AREAS.map((area) => `<option value="${area}" ${area === viewArea ? "selected" : ""}>${area}</option>`).join("");
    const isAwayArea = viewArea !== currentUser.area;
    const control = select.closest(".view-area-control");
    control?.classList.toggle("view-area-control-away", isAwayArea);
    control?.setAttribute(
      "title",
      isAwayArea ? `Viewing ${viewArea}. Your assigned area is ${currentUser.area}.` : `Viewing your assigned area: ${currentUser.area}.`
    );
    select.setAttribute(
      "aria-label",
      isAwayArea ? `Change view area. Warning: viewing ${viewArea}, not your assigned area ${currentUser.area}.` : "Change view area"
    );
  });
  setText("[data-user-role]", accessLabel());
  setText("[data-user-seniority]", userSeniorityText());
  setText("[data-user-seniority-long]", userSeniorityLongText());
  setText("[data-user-rank-metric]", hasSeniority ? `#${displayedSeniorityRank}` : "Admin");
  setText("[data-user-rank-total]", hasSeniority ? `of ${displayedBidderCount}` : "all areas");
  setText("[data-ahead-count]", ahead);
  setText("[data-behind-count]", behind);
  setText("[data-user-priority-summary]", hasSeniority ? `${ahead} ahead · ${behind} behind` : "All areas · intake access");
  setText("[data-bidder-count]", `${displayedBidderCount} bidders`);
  setText(
    "[data-seniority-summary]",
    canOpenIntake
      ? `Temporary bidding intake access for ${userFullName()}. Each BUE bid window is 2 hours. Actions are logged under ${currentUser.initials}.`
      : `Current bidding order for ${viewArea}. Each BUE bid window is 2 hours. Your position is highlighted in your home area.`
  );
  setText("[data-admin-grant-status]", activeAdminGrant() ? "Active" : "Not Assigned");
  setText("[data-admin-grant-window]", adminGrantWindowText());
  setText("[data-admin-grant-scope]", currentUser.adminGrant?.scope || "None");
  setText("[data-admin-grant-granted-by]", currentUser.adminGrant?.grantedBy || "None");

  document.querySelectorAll(".account-pill").forEach((button) => {
    button.classList.remove("bid-as-cpc", "bid-as-gl", "bid-as-r-dev", "bid-as-d-dev");
    button.classList.add(bidAsClassName);
    button.title = `${currentUser.initials} · ${bidAs}`;
  });

  document.querySelectorAll("[data-profile-name]").forEach((input) => { input.value = userFullName(); });
  document.querySelectorAll("[data-profile-area]").forEach((element) => { element.textContent = currentUser.area; });
  document.querySelectorAll("[data-profile-initials]").forEach((input) => { input.value = currentUser.initials; });
  document.querySelectorAll("[data-profile-phone]").forEach((input) => { input.value = currentUser.phone; });
  document.querySelectorAll("[data-profile-email]").forEach((input) => { input.value = currentUser.email; });
  syncAccountFields();

  document.querySelectorAll(".seniority-pill").forEach((button) => {
    button.disabled = !hasSeniority;
    button.title = hasSeniority ? "View seniority list" : "Admin accounts are not in the area seniority order.";
  });

  const rdoAssignment = currentUserRdoAssignment();
  const rdoAssignmentLine = rdoAssignment?.line;
  const rdoAssignmentRequest = rdoAssignment?.request;
  setText("[data-dashboard-rdo-line]", rdoAssignmentRequest?.line || rdoAssignmentLine?.line ? `Line ${rdoAssignmentRequest?.line || rdoAssignmentLine.line}` : "No line selected");
  setText("[data-dashboard-rdo-summary]", rdoAssignmentRequest?.summary || "Your selected RDO line will appear after you bid.");
  renderDashboardSelectedLineCard(rdoAssignment);

  document.querySelectorAll("[data-admin-only]").forEach((element) => {
    element.hidden = !canOpenIntake;
  });

  document.querySelectorAll("[data-intake-rep-only]").forEach((element) => {
    element.hidden = !canOpenIntake;
  });

  document.querySelectorAll("[data-system-admin-only]").forEach((element) => {
    element.hidden = !hasSystemAdminAccess();
  });

  document.querySelectorAll("[data-admin-tools]").forEach((element) => {
    element.hidden = !canOpenIntake;
  });

  syncBidWindowTestingControls();
  syncViewModeSwitcher();
}

function hasSubmittedRdoBid() {
  return currentUserHasRdoRequestForLeave();
}

function updateBidWindow() {
  const now = new Date();
  const roundState = areaBidRoundState(now);
  const isValidationPeriod = roundState?.phase === "validation";
  const personalBidWindow = currentUserBidWindow(now);
  const testRound = activeTestBidRound();
  const currentRound = testRound || personalBidWindow?.round || latestAreaRound(now);
  const viewingHomeArea = isViewingHomeArea();
  const isBefore = viewingHomeArea && personalBidWindow && now < personalBidWindow.start;
  const isOpen = viewingHomeArea && personalBidWindow && now >= personalBidWindow.start && now <= personalBidWindow.end;
  const isTestingBypass = bidWindowLockIsBypassed();
  const canUseBidActions = viewingHomeArea && (isOpen || isTestingBypass);
  const activeRank = activeBidderRank(now);
  const activePerson = seniority.find((person) => person.rank === activeRank);
  const areaRoundOpen = Boolean(activePerson) && !isValidationPeriod;
  const statusText = areaRoundOpen ? "Open" : "Closed";
  const showCurrentBidder = !isOpen && !isBefore && areaRoundOpen;
  const clockLabel = isTestingBypass && viewingHomeArea ? "Testing Mode" : isOpen ? "Bid Window Open" : "Bid Window Closed";
  const countdownText = isOpen
      ? formatDuration(personalBidWindow.end - now)
      : isTestingBypass && viewingHomeArea
      ? testRound ? `Round ${testRound}` : "Unlocked"
      : isBefore
      ? formatDuration(personalBidWindow.start - now)
      : isValidationPeriod
        ? formatDuration(roundState.validationEndsAt - now)
      : showCurrentBidder
        ? `#${activePerson.rank} / ${currentUserBidderCount(currentViewArea())}`
        : "Closed";
  const countdownLabel = isOpen
      ? "Window Closes In"
      : isTestingBypass && viewingHomeArea
      ? "Bid Window Lock"
      : isBefore
      ? "Next Window In"
      : isValidationPeriod
        ? "Validation Ends In"
      : showCurrentBidder
        ? "Currently Bidding"
        : "Window Status";
  const currentRoundRule = roundRuleForRound(currentRound);

  const status = document.getElementById("bid-window-status");
  if (status) {
    status.classList.toggle("closed", !areaRoundOpen);
    const copy = status.querySelector(".status-chip-copy");
    if (copy) {
      copy.querySelector("small").textContent = `Round ${currentRound}`;
      copy.querySelector("b").textContent = statusText;
    }
  }

  const clock = document.getElementById("bid-window-clock");
  if (clock) {
    clock.classList.toggle("closed", !(isOpen || (isTestingBypass && viewingHomeArea)));
    clock.querySelector("span").textContent = clockLabel;
    clock.querySelector("strong").textContent = countdownText;
    const detail = clock.querySelector("small");
    if (detail) detail.textContent = countdownLabel;
    clock.title = showCurrentBidder && activePerson
      ? `Currently bidding: Seniority #${activePerson.rank} (${activePerson.initials})`
      : "";
  }

  setText("[data-bid-window-text]", statusText);
  setText("[data-bid-window-countdown]", countdownText);
  setText("[data-bid-window-countdown-label]", countdownLabel);
  setText("[data-bid-window-close]", personalBidWindow ? formatDateTime(personalBidWindow.end) : "Not scheduled");
  setText("[data-bid-window-range]", personalBidWindow ? formatDateRange(personalBidWindow.start, personalBidWindow.end) : "Not scheduled");
  setText("[data-next-bid-window-round]", isValidationPeriod ? `Round ${currentRound} Validation` : `Round ${currentRound}`);
  setText("[data-next-bid-window-rule-round]", `Round ${currentRound}`);
  setText("[data-next-bid-window-rule]", currentRoundRule.label);
  setText("[data-next-bid-window-rule-detail]", currentRoundRule.detail);
  setText(
    "[data-current-bidder]",
    testRound
      ? `Testing Round ${testRound}`
      : isValidationPeriod
      ? `Round ${currentRound} validation period`
      : areaRoundOpen && activePerson ? `Currently Bidding: Seniority #${activePerson.rank} (${activePerson.initials})` : "Closed"
  );
  setText("[data-current-round]", `Round ${currentRound}`);
  renderRoundRuleSummary(now);

  document.querySelectorAll("[data-bid-window-pill]").forEach((pill) => {
    pill.textContent = statusText;
    pill.classList.toggle("closed", !areaRoundOpen);
  });

  document.querySelectorAll(".window-action").forEach((button) => {
    const disabled = !canUseBidActions;
    button.disabled = disabled;
    button.classList.toggle("disabled", disabled);
  });

  document.querySelectorAll("[data-bid-entry-action]").forEach((button) => {
    if (isValidationPeriod && !isTestingBypass) {
      button.textContent = "Round Closed";
      return;
    }
    if (!isViewingHomeArea()) {
      button.textContent = "Viewing Only";
      return;
    }
    if (!isOpen) {
      button.textContent = isTestingBypass && viewingHomeArea ? "Testing Bid" : "Bid Closed";
      return;
    }

    button.textContent = hasSubmittedRdoBid() ? "Change Bid" : "Bid";
  });
}

function renderWeek(targetId, week = selectedWeek) {
  const target = document.getElementById(targetId);
  if (!target) return;

  const values = Array.isArray(week[0]) ? week : dayNames.map((day, index) => [day, week[index]]);
  target.innerHTML = values
    .map(([day, value]) => `
      <div class="day-cell ${value === "RDO" ? "rdo" : ""}">
        <small>${day}</small>
        <b>${value}</b>
      </div>
    `)
    .join("");
}

function groupClass(group) {
  const normalized = group[0]?.toLowerCase();
  return normalized === "a" || normalized === "b" || normalized === "c" ? normalized : "";
}

function fatigueGroupForDate(key) {
  const date = dateFromKey(key);
  const weekStart = new Date(date);
  weekStart.setDate(date.getDate() - date.getDay());
  const weekStartUtc = Date.UTC(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
  const diffWeeks = Math.floor((weekStartUtc - FATIGUE_WEEK_ANCHOR_UTC) / WEEK_IN_MILLISECONDS);
  const rotationIndex = ((diffWeeks % FATIGUE_GROUP_ROTATION.length) + FATIGUE_GROUP_ROTATION.length) % FATIGUE_GROUP_ROTATION.length;
  return FATIGUE_GROUP_ROTATION[rotationIndex];
}

function nextFatigueGroupAfter(group) {
  const index = FATIGUE_GROUP_ROTATION.indexOf(group);
  if (index === -1) return "";
  return FATIGUE_GROUP_ROTATION[(index + 1) % FATIGUE_GROUP_ROTATION.length];
}

function shiftCell(value) {
  const isRdo = value === "RDO";
  const special = /^[MSN]/.test(value);
  const className = isRdo ? "rdo-tag" : special ? "shift special" : "shift";
  return `<span class="${className}">${value}</span>`;
}

function lineOccupant(line) {
  if (line.status === "Taken") return line.cpc || "";
  if (line.status === "Selected") return line.cpc || currentUser.initials;
  return "";
}

function selectedMidValue(line) {
  return isForcedMid(line) ? line.mid : selectedMidPreference;
}

function userChoiceCell(value) {
  if (value === "BID") return '<span class="status open">Bid Line</span>';
  if (value === "—") return "—";
  if (value === "UNSELECTED") return "Unselected";
  return value;
}

function publicPreferenceCell(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === "—" || normalized.toUpperCase() === "UNSELECTED") return "";
  return userChoiceCell(normalized);
}

function lineMidReferenceValue(line) {
  if (line.mid === "BID" || line.mid === "Yes" || line.mid === "No") return line.mid;
  return "UNSELECTED";
}

function selectedLineStatus(line) {
  const request = selectedLineRequest(line);
  const approvedRequest = currentUserRdoRequest();
  if (request) return "Pending Review";
  if (approvedRequest?.line === line.line && approvedRequest.status === "Approved") return "Approved";
  if (line.status === "Taken" && line.cpc === currentUser.initials) return "Approved";
  if (line.status === "Taken") return "Taken";
  if (line.status === "Selected") return "Selected";
  return "Open";
}

function rdoAssignmentValue(assignment, key) {
  const requestValue = assignment?.request?.[key];
  if (requestValue) return requestValue;
  if (assignment?.line?.[key]) return assignment.line[key];
  return "";
}

function renderDashboardSelectedLineCard(assignment) {
  const line = assignment?.line;
  const request = assignment?.request;
  const lineCode = request?.line || line?.line || "";
  const status = request?.status || (line?.status === "Taken" ? "Approved" : "");

  document.querySelectorAll("#dashboard-page [data-selected-initials]").forEach((element) => {
    element.textContent = currentUser.initials || "";
  });
  document.querySelectorAll("#dashboard-page [data-selected-line]").forEach((element) => {
    element.textContent = lineCode ? `Line ${lineCode}` : "No line selected";
  });
  document.querySelectorAll("#dashboard-page [data-selected-status]").forEach((element) => {
    element.innerHTML = `<em>Status</em><b>${status || "Not Bid"}</b>`;
    element.classList.toggle("closed", !status);
  });
  document.querySelectorAll("#dashboard-page [data-selected-attributes]").forEach((element) => {
    const group = rdoAssignmentValue(assignment, "fatigueGroup") || rdoAssignmentValue(assignment, "group");
    const flex = rdoAssignmentValue(assignment, "flex");
    const aws = rdoAssignmentValue(assignment, "aws");
    const mid = rdoAssignmentValue(assignment, "mid");
    const values = [
      ["Group", group],
      ["Flex", flex],
      ["AWS", aws],
      ["Mid", mid],
    ].filter(([, value]) => value);

    element.innerHTML = values.length
      ? values.map(([label, value]) => `<span>${label} <b${label === "Group" ? ` class="group ${groupClass(value)}"` : ""}>${value}</b></span>`).join("")
      : '<span class="empty-attribute-message">RDO details will populate from the database after this user bids.</span>';
  });

  const weekTarget = document.getElementById("selected-week");
  if (weekTarget && line) {
    renderWeek("selected-week", line.week);
  } else if (weekTarget) {
    weekTarget.innerHTML = "";
  }
}

function selectedLineReadinessItems(line) {
  const existingRequest = currentUserRdoRequest();
  const requestMatchesLine = existingRequest?.line === line.line;
  const fatigueGroup = selectedFatigueGroup || (requestMatchesLine ? existingRequest.fatigueGroup : "");
  const flexPreference = selectedFlexPreference || (requestMatchesLine ? existingRequest.flex : "");
  const awsPreference = selectedAwsPreference || (requestMatchesLine ? existingRequest.aws : "");
  const midPreference = selectedMidValue(line) || (requestMatchesLine ? existingRequest.mid : "");
  const lineStatus = selectedLineStatus(line);
  const selectedLineOpen = lineStatus !== "Taken";
  const preferencesComplete = Boolean(flexPreference && awsPreference && (isForcedMid(line) || midPreference));

  return [
    { label: "Selected line open", checked: selectedLineOpen },
    { label: "Fatigue group selected", checked: Boolean(fatigueGroup) },
    { label: "Preferences complete", checked: preferencesComplete },
    { label: "Leave within allowance", checked: true },
  ];
}

function syncRdoFilterControls() {
  const search = document.querySelector('[data-rdo-filter="search"]');
  const open = document.querySelector('[data-rdo-filter="open"]');
  const mid = document.querySelector('[data-rdo-filter="mid"]');
  const fourTen = document.querySelector('[data-rdo-filter="fourTen"]');

  if (search && search.value !== rdoFilters.search) search.value = rdoFilters.search;
  if (open) open.checked = rdoFilters.openOnly;
  if (mid) mid.value = rdoFilters.mid;
  if (fourTen) fourTen.value = rdoFilters.fourTen;
}

function rdoLineMatchesFilterSet(line, filters) {
  if (filters.openOnly && line.status === "Taken") return false;

  const search = filters.search.trim().toLowerCase();
  if (search) {
    const searchable = [
      line.line,
      line.cpc,
      line.pattern,
      line.group,
      line.status,
      ...line.week,
    ].join(" ").toLowerCase();
    if (!searchable.includes(search)) return false;
  }

  const midValue = lineMidReferenceValue(line);
  if (filters.mid !== "all" && midValue !== filters.mid) return false;
  if (filters.fourTen !== "all" && lineFourTenValue(line) !== filters.fourTen) return false;

  return true;
}

function rdoLineMatchesFilters(line) {
  return rdoLineMatchesFilterSet(line, rdoFilters);
}

function isRdoFilterActive() {
  return Boolean(
    rdoFilters.search.trim() ||
      !rdoFilters.openOnly ||
      rdoFilters.mid !== "all" ||
      rdoFilters.fourTen !== "all"
  );
}

function renderRdoLines() {
  const target = document.getElementById("rdo-line-rows");
  if (!target) return;

  let lastPattern = "";
  const rows = [];
  const viewArea = currentViewArea();
  const areaLines = rdoLinesForArea(viewArea);
  const filteredLines = areaLines.filter(rdoLineMatchesFilters);
  const countTarget = document.querySelector("[data-rdo-filter-count]");

  if (countTarget) {
    const lineLabel = filteredLines.length === 1 ? "line" : "lines";
    countTarget.textContent = isRdoFilterActive()
      ? `${filteredLines.length} matching ${lineLabel}`
      : `${areaLines.filter((line) => line.status !== "Taken").length} open ${lineLabel}`;
  }

  filteredLines.forEach((line) => {
    if (line.pattern !== lastPattern) {
      rows.push(`<tr><th colspan="11">${line.pattern}</th></tr>`);
      lastPattern = line.pattern;
    }

    const isSelected = line.line === selectedLineId;
    const displayCpc = lineOccupant(line);
    const isOccupied = line.status === "Taken";
    const groupValue = isSelected ? `<span class="group ${groupClass(selectedFatigueGroup)}">${selectedFatigueGroup}</span>` : "";
    const midValue = lineMidReferenceValue(line);

    rows.push(`
      <tr class="${isSelected && isViewingHomeArea() ? "selected-row" : ""} ${isOccupied || !isViewingHomeArea() ? "occupied-row" : "selectable-row"}" ${isViewingHomeArea() ? `data-line-id="${line.line}"` : ""}>
        <td>${line.line}</td>
        <td><b>${displayCpc}</b></td>
        ${line.week.map((value) => `<td>${shiftCell(value)}</td>`).join("")}
        <td class="${groupValue ? "" : "empty-group"}">${groupValue}</td>
        <td>${userChoiceCell(midValue)}</td>
      </tr>
    `);
  });

  target.innerHTML = rows.length
    ? rows.join("")
    : `<tr><td colspan="11">No RDO lines match those filters for ${viewArea}.</td></tr>`;
}

function updateSelectedLine() {
  const areaLines = rdoLinesForArea(currentViewArea());
  const line = areaLines.find((item) => item.line === selectedLineId) || areaLines[0] || rdoLines[0];
  const dashboardAssignment = currentUserRdoAssignment();
  if (!line) {
    renderDashboardSelectedLineCard(dashboardAssignment);
    return;
  }
  const midIsBidLine = isMidLineByDesign(line);
  const fatigueCapacity = fatigueCapacityForLine(line);
  const canEditLineSchedule = hasSystemAdminAccess();
  const lineSchedule = lineScheduleLabel(line);

  document.querySelectorAll("[data-selected-line]").forEach((element) => {
    element.textContent = `Line ${line.line}`;
  });
  document.querySelectorAll("[data-selected-initials]").forEach((element) => {
    if (element.closest("#dashboard-page")) return;
    element.textContent = currentUser.initials || "";
  });
  document.querySelectorAll("[data-selected-helper]").forEach((element) => {
    const request = selectedLineRequest(line);
    const approvedRequest = currentUserRdoRequest();
    element.textContent =
      !isViewingHomeArea()
        ? `Viewing ${currentViewArea()} for reference. Bidding actions stay limited to your home area.`
        : request ? `Line ${line.line} is pending intake review.` : approvedRequest?.line === line.line && approvedRequest.status === "Approved" ? `Line ${line.line} has been approved.` : line.status === "Taken" ? `Line ${line.line} has been approved.` : `Line ${line.line} is currently selected.`;
  });
  document.querySelectorAll("[data-selected-status]").forEach((element) => {
    if (element.closest("#dashboard-page")) return;
    element.innerHTML = `<em>Status</em><b>${selectedLineStatus(line)}</b>`;
    element.classList.toggle("closed", line.status === "Taken");
  });
  document.querySelectorAll("[data-selected-attributes]").forEach((element) => {
    if (element.closest("#dashboard-page")) return;
    element.innerHTML = `
      <span class="fatigue-picker">
        <em>Fatigue Group</em>
        <span class="fatigue-options">
          ${fatigueCapacity.map((item) => {
            const isSelected = selectedFatigueGroup === item.group;
            const available = canChooseGroup(item, isSelected);
            return `
              <button class="fatigue-option ${groupClass(item.group)} ${isSelected ? "active" : ""}" type="button" data-fatigue-group="${item.group}" ${available ? "" : "disabled"} title="Area ${item.areaUsed}/${item.areaMax}, crew ${item.crewUsed}/${item.crewMax}">
                <strong>${item.group}</strong>
                <small>Area ${item.areaUsed}/${item.areaMax} · Crew ${item.crewUsed}/${item.crewMax}</small>
              </button>
            `;
          }).join("")}
        </span>
      </span>
      <span class="flex-picker">
        <em>Flex</em>
        <span class="choice-options">
          ${["Yes", "No"].map((value) => `
            <button class="choice-option ${selectedFlexPreference === value ? "active" : ""}" type="button" data-flex-choice="${value}">
              ${value}
            </button>
          `).join("")}
        </span>
      </span>
      <span class="aws-picker">
        <em>AWS</em>
        <small>Line schedule</small>
        <span class="line-mode-options">
          ${canEditLineSchedule
            ? ["4-10", "5-8"].map((value) => `
                <button class="line-mode-option ${lineSchedule === value ? "active" : ""}" type="button" data-four-ten-choice="${value === "4-10" ? "Yes" : "No"}">
                  ${value}
                </button>
              `).join("")
            : `<button class="line-mode-option active locked" type="button" disabled>${lineSchedule}</button>`}
        </span>
        <span class="choice-options aws-choice-options">
          ${["Yes", "No"].map((value) => `
            <button class="choice-option ${selectedAwsPreference === value ? "active" : ""}" type="button" data-aws-choice="${value}">
              ${value}
            </button>
          `).join("")}
        </span>
      </span>
      <span class="mid-picker">
        <em>Mid</em>
        <span class="line-mode-options mid-line-options">
          <button class="line-mode-option mid-bid-line-option ${midIsBidLine ? "active locked" : ""}" type="button" disabled>
            Bid Line
          </button>
        </span>
        ${midIsBidLine
          ? ""
          : `<span class="mid-options">
              ${["Yes", "No"].map((value) => `
                <button class="mid-option ${selectedMidPreference === value ? "active" : ""}" type="button" data-mid-choice="${value}">
                  ${value}
                </button>
              `).join("")}
            </span>`}
      </span>
    `;
  });
  document.querySelectorAll("[data-bid-readiness-list]").forEach((element) => {
    element.innerHTML = selectedLineReadinessItems(line)
      .map((item) => `<li class="${item.checked ? "checked" : "pending"}">${item.label}</li>`)
      .join("");
  });

  renderWeek("selected-week", line.week);
  renderWeek("rdo-week", line.week);
  renderDashboardSelectedLineCard(dashboardAssignment);
  renderFatigueCapacity();
}

function updateLineFourTenStatus(value) {
  if (!hasSystemAdminAccess()) {
    alert("Only system admins can change whether this line is worked as 4-10s or 5-8s.");
    return;
  }

  const areaLines = rdoLinesForArea(currentViewArea());
  const line = areaLines.find((item) => item.line === selectedLineId) || null;
  if (!line) return;

  const currentValue = lineFourTenValue(line);
  if (currentValue === value) return;

  const warning = currentValue === "Yes" && value === "No"
    ? "verify this line will be changed from 4-10s to 5-8s"
    : `Verify this line will be changed from ${currentValue === "Yes" ? "4-10s" : "5-8s"} to ${value === "Yes" ? "4-10s" : "5-8s"}.`;

  if (!window.confirm(warning)) return;

  line.fourTen = value;
  logHistory(currentViewArea(), "RDO line schedule changed", `${currentUser.initials} changed Line ${line.line} from ${currentValue === "Yes" ? "4-10s" : "5-8s"} to ${value === "Yes" ? "4-10s" : "5-8s"}.`);
  renderRdoLines();
  updateSelectedLine();
}

function renderFatigueCapacity() {
  const areaLines = rdoLinesForArea(currentViewArea());
  const line = areaLines.find((item) => item.line === selectedLineId) || areaLines[0] || rdoLines[0];
  if (!line) return;
  const fatigueCapacity = fatigueCapacityForLine(line);

  document.querySelectorAll("[data-fatigue-capacity]").forEach((target) => {
    target.innerHTML = fatigueCapacity.map((item) => {
      const isSelected = selectedFatigueGroup === item.group;
      const available = canChooseGroup(item, isSelected);
      return `
        <button class="${groupClass(item.group)} ${isSelected ? "active" : ""}" type="button" data-fatigue-group="${item.group}" ${available ? "" : "disabled"}>
          <strong>${item.group}</strong>
          <span>Area ${item.areaUsed}/${item.areaMax}</span>
          <span>Crew ${item.crewUsed}/${item.crewMax}</span>
        </button>
      `;
    }).join("");
  });
}

function renderLeaveRows(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const compact = false;

  target.innerHTML = leaveBids
    .map((bid) => {
      const round = leaveRoundForItem(bid);
      return compact
        ? `
        <tr>
          <td><b>${bid.priority}</b></td>
          <td><span class="round-pill">Rd ${round}</span></td>
          <td>${bid.range}</td>
          <td>${bid.days}</td>
          <td><span class="status ${bid.status.toLowerCase()}">${bid.status}</span></td>
        </tr>
      `
        : `
        <tr>
          <td><b>${bid.priority}</b></td>
          <td><span class="round-pill">Rd ${round}</span></td>
          <td>${bid.range}</td>
          <td>${bid.days}</td>
          <td><span class="status ${bid.status.toLowerCase()}">${bid.status}</span></td>
          <td>${bid.notes ? escapeHtml(bid.notes) : "—"}</td>
        </tr>
      `;
    })
    .join("");
}

function renderLeaveDraftQueue() {
  const panel = document.querySelector("[data-leave-draft-panel]");
  const list = document.querySelector("[data-leave-draft-list]");
  const total = document.querySelector("[data-leave-draft-total]");
  const submitButton = document.querySelector("[data-submit-leave-batch]");
  if (!panel || !list || !total || !submitButton) return;

  const usedDays = leaveDraftTotalDays();
  const usedWeeks = leaveDraftTotalWeeks();
  total.textContent = isRoundOneLeaveRound()
    ? `${usedWeeks} / ${roundOneWeekLimit()} weeks · ${usedDays} ${usedDays === 1 ? "day" : "days"}`
    : `${usedDays} / ${currentRoundLeaveLimit()} days`;
  panel.classList.toggle("is-empty", leaveDraftQueue.length === 0);
  const windowError = leaveBidWindowErrorMessage();
  const rdoRequestError = leaveRdoRequestErrorMessage();
  const submitError = rdoRequestError || windowError;
  submitButton.disabled = leaveDraftQueue.length === 0 || Boolean(submitError);
  submitButton.title = submitError;

  list.innerHTML = leaveDraftQueue.length
    ? leaveDraftQueue.map((item, index) => `
      <article class="leave-draft-item">
        <span>${index + 1}</span>
        <div>
          <strong>${escapeHtml(item.range)}</strong>
          <small>${item.weekUnits ? `${item.weekUnits} bid week · ` : ""}${item.days} ${item.days === 1 ? "day" : "days"} charged</small>
          ${item.notes ? `<em>${escapeHtml(item.notes)}</em>` : ""}
        </div>
        <button type="button" aria-label="Remove ${escapeHtml(item.range)}" data-remove-leave-draft="${item.id}">×</button>
      </article>
    `).join("")
    : '<p class="empty-state small">Add leave requests here first. Nothing is sent to intake until you submit the batch.</p>';
}

function renderLeaveAllowanceSummary() {
  const holidayCount = leaveHolidayBidCount();
  const holidayText = `${holidayCount} ${holidayCount === 1 ? "holiday" : "holidays"} bid`;
  const round = currentRoundNumber();
  const credits = leaveHolidayCreditsForRound(round);
  const totalAllowance = leaveAllowanceLimitForRound(round);
  const baseAllowance = currentUserBaseLeaveAllowanceDays();
  const allowanceHours = currentUserLeaveAllowanceHours();
  const hoursPerDay = leaveHoursPerDayForInitials();
  const scheduleText = hoursPerDay === CWS_LEAVE_HOURS_PER_DAY ? "10-hour CWS days" : "8-hour days";
  const bidDays = leaveCommittedChargedDays();
  const leftDays = Math.max(0, totalAllowance - bidDays);
  const approvedDays = leaveCommittedItems()
    .filter((item) => (!item.initials || item.initials === currentUser.initials) && item.status === "Approved")
    .reduce((total, item) => total + leaveItemChargedDays(item), 0);
  const pendingDays = leaveCommittedItems()
    .filter((item) => (!item.initials || item.initials === currentUser.initials) && item.status === "Pending")
    .reduce((total, item) => total + leaveItemChargedDays(item), 0);

  setText("[data-leave-already-detail]", `Approved: ${formatLeaveDaysLabel(approvedDays)} · Pending: ${formatLeaveDaysLabel(pendingDays)} · ${holidayText}`);
  setText("[data-leave-balance-heading]", `Leave Balance (${formatEstimatedLeaveDays(allowanceHours)} hours / ${scheduleText})`);
  setText("[data-leave-total-allowance]", formatLeaveDaysLabel(totalAllowance));
  setText("[data-leave-left-days]", formatLeaveDaysLabel(leftDays));
  setText("[data-leave-bid-days]", formatLeaveDaysLabel(bidDays));
  setText("[data-leave-balance-summary]", `${formatLeaveDaysLabel(baseAllowance)} base · ${scheduleText} · ${holidayText}`);
  setText("[data-leave-balance-holidays]", holidayText);
  setText("[data-leave-holidays-bid]", credits && round >= 4 ? `${holidayCount} (${credits} credit)` : String(holidayCount));
}

function renderRoundRuleSummary(date = new Date()) {
  const roundState = areaBidRoundState(date);
  const testRound = activeTestBidRound();
  const round = testRound || latestAreaRound(date);
  const rule = roundRuleForRound(round);
  const phaseDetail = testRound
    ? "Testing mode is using this round for BUE self-service submissions."
    : roundState?.phase === "validation"
    ? "Validation period is active. No bids may be entered."
    : roundState?.phase === "open"
      ? `Currently bidding: seniority #${roundState.activeRank}.`
      : "Bidding is closed until the next scheduled round window.";

  setText("[data-round-rule-heading]", `Round ${round} Rules`);
  setText("[data-round-rule-limit]", rule.label);
  setText("[data-round-rule-detail]", `${rule.detail} ${phaseDetail}`);
}

function saveApprovalRules() {
  storeJsonValue(APPROVAL_RULES_STORAGE_KEY, approvalRules);
}

function saveRoundRules() {
  storeJsonValue(ROUND_RULES_STORAGE_KEY, roundRules);
}

function roundRuleNumbers() {
  return Object.keys(roundRules)
    .map((round) => Number(round))
    .filter((round) => Number.isFinite(round))
    .sort((first, second) => first - second);
}

function renderRoundRuleSummaryList() {
  document.querySelectorAll("[data-round-rules-summary]").forEach((list) => {
    list.innerHTML = roundRuleNumbers().map((round) => {
      const rule = roundRuleForRound(round);
      return `<div><dt>Round ${round}</dt><dd><strong>${escapeHtml(rule.label)}</strong><small>${escapeHtml(rule.detail)}</small></dd></div>`;
    }).join("");
  });
}

function renderRoundRuleEditor() {
  const editor = document.querySelector("[data-round-rule-editor]");
  if (!editor) return;

  editor.innerHTML = `
    <div class="round-rule-list">
      ${roundRuleNumbers().map((round) => {
        const rule = roundRuleForRound(round);
        return `
          <div class="round-rule-row" data-round-rule-row="${round}">
            <span>Round ${round}</span>
            <label>
              Limit
              <input type="text" data-round-rule-label="${round}" value="${escapeHtml(rule.label)}">
            </label>
            <label>
              Rule
              <textarea data-round-rule-detail="${round}" rows="3">${escapeHtml(rule.detail)}</textarea>
            </label>
            <button class="secondary-action small" type="button" data-save-round-rule="${round}">Save</button>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function saveRoundRule(round) {
  const labelInput = document.querySelector(`[data-round-rule-label="${round}"]`);
  const detailInput = document.querySelector(`[data-round-rule-detail="${round}"]`);
  if (!labelInput || !detailInput) return;

  const label = labelInput.value.trim();
  const detail = detailInput.value.trim();
  if (!label || !detail) return;

  roundRules[round] = { label, detail };
  saveRoundRules();
  renderRoundRuleSummary();
  renderRoundRuleSummaryList();
  renderRoundRuleEditor();
}

function renderApprovalRuleSummary() {
  document.querySelectorAll("[data-approval-rule-summary]").forEach((list) => {
    list.innerHTML = approvalRules.length
      ? approvalRules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")
      : '<li>No approval rules have been added yet.</li>';
  });
}

function renderApprovalRuleEditor() {
  const list = document.querySelector("[data-approval-rule-list]");
  if (!list) return;

  list.innerHTML = approvalRules.length
    ? approvalRules.map((rule, index) => `
      <li class="editable-rule-item" data-approval-rule-index="${index}">
        <button class="rule-drag-handle" type="button" draggable="true" data-approval-rule-drag-handle="${index}" aria-label="Drag approval rule ${index + 1}" title="Drag to reorder"></button>
        <span class="editable-rule-copy">${escapeHtml(rule)}</span>
        <div class="rule-actions">
          <button class="secondary-action small" type="button" data-approval-rule-edit="${index}">Edit</button>
          <button class="secondary-action small danger" type="button" data-approval-rule-remove="${index}">Remove</button>
        </div>
      </li>
    `).join("")
    : '<li class="editable-rule-item empty-rule">No approval rules have been added yet.</li>';
}

function renderRuleEditors() {
  renderRoundRuleSummaryList();
  renderRoundRuleEditor();
  renderApprovalRuleSummary();
  renderApprovalRuleEditor();
}

function resetApprovalRuleInput() {
  const input = document.querySelector("[data-approval-rule-input]");
  const button = document.querySelector("[data-add-approval-rule]");
  if (input) {
    input.value = "";
    delete input.dataset.editingIndex;
  }
  if (button) button.textContent = "Add";
}

function saveApprovalRuleFromInput() {
  const input = document.querySelector("[data-approval-rule-input]");
  if (!input) return;

  const value = input.value.trim();
  if (!value) return;

  const editingIndex = Number(input.dataset.editingIndex);
  if (Number.isInteger(editingIndex) && approvalRules[editingIndex]) {
    approvalRules[editingIndex] = value;
  } else {
    approvalRules.push(value);
  }

  saveApprovalRules();
  resetApprovalRuleInput();
  renderApprovalRuleSummary();
  renderApprovalRuleEditor();
}

function editApprovalRule(index) {
  const input = document.querySelector("[data-approval-rule-input]");
  const button = document.querySelector("[data-add-approval-rule]");
  if (!input || !approvalRules[index]) return;

  input.value = approvalRules[index];
  input.dataset.editingIndex = String(index);
  if (button) button.textContent = "Save";
  input.focus();
}

function reorderApprovalRule(fromIndex, toIndex) {
  if (
    fromIndex === toIndex ||
    !approvalRules[fromIndex] ||
    toIndex < 0 ||
    toIndex >= approvalRules.length
  ) {
    return false;
  }

  const [rule] = approvalRules.splice(fromIndex, 1);
  approvalRules.splice(toIndex, 0, rule);
  saveApprovalRules();
  resetApprovalRuleInput();
  renderApprovalRuleSummary();
  renderApprovalRuleEditor();
  return true;
}

function removeApprovalRule(index) {
  if (!approvalRules[index]) return;

  approvalRules.splice(index, 1);
  saveApprovalRules();
  resetApprovalRuleInput();
  renderApprovalRuleSummary();
  renderApprovalRuleEditor();
}

let draggedApprovalRuleIndex = null;

function approvalRuleDragItem(event) {
  return event.target.closest("[data-approval-rule-index]");
}

function startApprovalRuleDrag(event) {
  const item = approvalRuleDragItem(event);
  if (!item || !event.target.closest("[data-approval-rule-drag-handle]")) return;

  draggedApprovalRuleIndex = Number(item.dataset.approvalRuleIndex);
  item.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(draggedApprovalRuleIndex));
}

function moveApprovalRuleDuringDrag(event) {
  if (draggedApprovalRuleIndex === null) return;
  const list = event.target.closest("[data-approval-rule-list]");
  if (!list) return;

  event.preventDefault();
  const draggedItem = list.querySelector(".editable-rule-item.dragging");
  const targetItem = approvalRuleDragItem(event);
  if (!draggedItem || !targetItem || targetItem === draggedItem) return;

  const targetBounds = targetItem.getBoundingClientRect();
  const insertAfter = event.clientY > targetBounds.top + targetBounds.height / 2;
  list.insertBefore(draggedItem, insertAfter ? targetItem.nextSibling : targetItem);
}

function dropApprovalRule(event) {
  if (draggedApprovalRuleIndex === null) return;
  const list = event.target.closest("[data-approval-rule-list]");
  if (!list) return;

  event.preventDefault();
  const nextOrder = [...list.querySelectorAll("[data-approval-rule-index]")]
    .map((item) => Number(item.dataset.approvalRuleIndex))
    .filter((index) => Number.isInteger(index) && approvalRules[index]);
  if (nextOrder.length === approvalRules.length) {
    approvalRules = nextOrder.map((index) => approvalRules[index]);
    saveApprovalRules();
  }
  finishApprovalRuleDrag();
  resetApprovalRuleInput();
  renderApprovalRuleSummary();
  renderApprovalRuleEditor();
}

function finishApprovalRuleDrag() {
  document.querySelector(".editable-rule-item.dragging")?.classList.remove("dragging");
  draggedApprovalRuleIndex = null;
}

function areaLeaveSlotTotals() {
  return Object.values(leaveSlotMap()).reduce((totals, day) => {
    const cpcFilled = (day.cpc || []).length;
    const devFilled = (day.dev || []).length;
    const cpcCapacity = day.unavailable ? cpcFilled : leaveSlotCapacityForDetails(day, "cpc");
    const devCapacity = day.unavailable ? devFilled : leaveSlotCapacityForDetails(day, "dev");

    totals.cpcTotal += cpcCapacity;
    totals.devTotal += devCapacity;
    totals.cpcUsed += cpcFilled;
    totals.devUsed += devFilled;
    return totals;
  }, {
    cpcTotal: 0,
    devTotal: 0,
    cpcUsed: 0,
    devUsed: 0,
  });
}

function renderLeaveBucketCards() {
  const { cpcTotal, devTotal } = areaLeaveBucketTotals();
  const cpcTotalDays = estimatedLeaveDaysFromHours(cpcTotal);
  const devTotalDays = estimatedLeaveDaysFromHours(devTotal);
  const cpcUsedDays = areaLeaveSlotUsedDays(currentViewArea(), "cpc");
  const devUsedDays = areaLeaveSlotUsedDays(currentViewArea(), "dev");
  const cpcLeft = Math.max(0, cpcTotalDays - cpcUsedDays);
  const devLeft = Math.max(0, devTotalDays - devUsedDays);

  setText("[data-cpc-leave-remaining]", formatRoundedUpLeaveDays(cpcLeft));
  setText("[data-dev-leave-remaining]", formatRoundedUpLeaveDays(devLeft));
  setText("[data-cpc-leave-detail]", `${formatRoundedUpLeaveDays(cpcUsedDays)} used of ${formatRoundedUpLeaveDays(cpcTotalDays)} estimated days`);
  setText("[data-dev-leave-detail]", `${formatRoundedUpLeaveDays(devUsedDays)} used of ${formatRoundedUpLeaveDays(devTotalDays)} estimated days`);
}

function syncAdminScheduleFormDefaults() {
  const startInput = document.querySelector("[data-admin-schedule-start]");
  const endInput = document.querySelector("[data-admin-schedule-end]");
  if (!startInput || !endInput) return;

  const defaultStart = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
  defaultStart.setMinutes(0, 0, 0);
  const defaultEnd = new Date(defaultStart.getTime() + 4 * 60 * 60 * 1000);
  if (!startInput.value) startInput.value = formatDateTimeLocalValue(defaultStart);
  if (!endInput.value) endInput.value = formatDateTimeLocalValue(defaultEnd);
}

function setAdminScheduleStatus(message, status = "info") {
  const target = document.querySelector("[data-admin-schedule-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

function bueRoster() {
  const currentEntry = {
    rank: currentUser.seniorityRank,
    firstName: currentUser.firstName,
    lastName: currentUser.lastName,
    initials: currentUser.initials,
    area: currentUser.area,
    email: currentUser.email,
    phone: currentUser.phone,
    bidAs: currentUserBidAs(),
    leaveSlotAllowance: normalizeLeaveSlotAllowance(currentUser.leaveSlotAllowance),
  };
  const byInitials = new Map();

  senioritySource.forEach((entry) => {
    if (!seniorityEntryActive(entry)) return;
    const person = rosterEntryToPerson(entry);
    byInitials.set(person.initials, {
      ...person,
      area: person.area || currentUser.area,
      bidAs: person.bidAs || "CPC",
    });
  });
  if (currentEntry.initials) byInitials.set(currentEntry.initials, currentEntry);

  return [...byInitials.values()]
    .filter((person) => person.initials)
    .sort((a, b) => {
      const rankA = Number.isFinite(a.rank) ? a.rank : a.seniorityRank;
      const rankB = Number.isFinite(b.rank) ? b.rank : b.seniorityRank;
      if (Number.isFinite(rankA) && Number.isFinite(rankB)) return rankA - rankB;
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
    });
}

function bueByInitials(initials) {
  const normalized = String(initials || "").trim().toUpperCase();
  return bueRoster().find((person) => person.initials === normalized) || null;
}

function personDisplayName(person) {
  return [person?.firstName, person?.lastName].filter(Boolean).join(" ") || person?.initials || "";
}

function personScheduleLabel(person) {
  if (!person) return "";
  const rank = Number.isFinite(person.rank) ? person.rank : person.seniorityRank;
  const rankText = Number.isFinite(rank) ? `#${rank} ` : "";
  return `${rankText}${personDisplayName(person)} · ${person.initials} · ${person.bidAs || "CPC"}`;
}

function intakeTeamMembers() {
  return bueRoster().filter((person) => intakeTeamInitials.has(person.initials));
}

function renderRosterSelect(selector, people, selectedInitials = "") {
  document.querySelectorAll(selector).forEach((select) => {
    const currentValue = selectedInitials || select.value;
    select.innerHTML = people.length
      ? people.map((person) => `<option value="${escapeHtml(person.initials)}" ${person.initials === currentValue ? "selected" : ""}>${escapeHtml(personScheduleLabel(person))}</option>`).join("")
      : '<option value="">No BUEs available</option>';
    if (people.some((person) => person.initials === currentValue)) select.value = currentValue;
  });
}

function syncIntakeTeamControls() {
  const availablePeople = bueRoster().filter((person) => !intakeTeamInitials.has(person.initials));
  const teamPeople = intakeTeamMembers();
  renderRosterSelect("[data-intake-team-candidate]", availablePeople);
  renderRosterSelect("[data-admin-schedule-rep]", teamPeople, teamPeople[0]?.initials || "");
  renderRosterSelect("[data-schedule-rep]", teamPeople, teamPeople[0]?.initials || "");
}

function addSelectedBueToIntakeTeam() {
  if (!hasSystemAdminAccess()) return;
  const select = document.querySelector("[data-intake-team-candidate]");
  const initials = select?.value || "";
  const person = bueByInitials(initials);
  if (!person) {
    setAdminScheduleStatus("Choose a BUE to add to the intake team.", "error");
    return;
  }

  intakeTeamInitials.add(person.initials);
  logHistory("All Areas", "Intake team updated", `${currentUser.initials} added ${person.initials} to the intake team.`);
  renderApp();
  setAdminScheduleStatus(`${personDisplayName(person)} is now available for intake scheduling.`, "success");
}

function removeBueFromIntakeTeam(initials) {
  if (!hasSystemAdminAccess()) return;
  const person = bueByInitials(initials);
  if (!person || person.initials === currentUser.initials) {
    setAdminScheduleStatus("That intake team member cannot be removed here.", "error");
    return;
  }

  intakeTeamInitials.delete(person.initials);
  logHistory("All Areas", "Intake team updated", `${currentUser.initials} removed ${person.initials} from the intake team.`);
  renderApp();
  setAdminScheduleStatus(`${personDisplayName(person)} was removed from future intake scheduling choices.`, "success");
}

function setRosterStatus(message, status = "info") {
  const target = document.querySelector("[data-roster-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

function selectedRosterArea() {
  return document.querySelector("[data-roster-area-filter]")?.value || currentViewArea();
}

function rosterEntryInitials(entry) {
  return entry[3] || "";
}

function rosterEntriesForArea(area = selectedRosterArea()) {
  return senioritySource
    .filter((entry) => seniorityEntryArea(entry) === area && seniorityEntryActive(entry))
    .map((entry) => {
      const activeEntries = activeRosterEntries(area);
      const activeRank = activeEntries.findIndex((item) => item === entry) + 1;
      return {
        entry,
        sourceIndex: senioritySource.indexOf(entry),
        person: rosterEntryToPerson(entry, activeRank > 0 ? activeRank : null, { fallbackInitials: false }),
      };
    });
}

function rosterAreaOptions(selectedArea) {
  return ZLA_AREAS.map((area) => `<option value="${area}" ${area === selectedArea ? "selected" : ""}>${area}</option>`).join("");
}

function bidRoleOptionsForArea(area) {
  return area === "TMU" ? TMU_BID_ROLES : LETTERED_AREA_BID_ROLES;
}

function normalizeBidRoleForArea(bidAs, area) {
  const value = String(bidAs || "").trim().toUpperCase();
  if (area === "TMU") {
    if (value === "R-DEV" || value === "D-DEV" || value === "TMCIT") return "DEV";
    if (value === "CPC") return "TMC";
  } else {
    if (value === "TMC") return "CPC";
    if (value === "TMCIT" || value === "DEV") return "D-DEV";
  }
  return value;
}

function defaultBidRoleForArea(area) {
  return bidRoleOptionsForArea(area)[0];
}

function validBidRoleForArea(bidAs, area) {
  return bidRoleOptionsForArea(area).includes(bidAs);
}

function rosterBidAsOptions(selectedBidAs, area = selectedRosterArea()) {
  const selectedRole = normalizeBidRoleForArea(selectedBidAs, area);
  return bidRoleOptionsForArea(area).map((bidAs) => `<option value="${bidAs}" ${bidAs === selectedRole ? "selected" : ""}>${bidAs}</option>`).join("");
}

function syncRosterBidAsSelect(area, selectedBidAs) {
  const select = document.querySelector("[data-roster-bid-as]");
  if (!select) return;
  const selectedRole = normalizeBidRoleForArea(selectedBidAs || select.value, area);
  select.innerHTML = rosterBidAsOptions(selectedRole, area);
  select.value = validBidRoleForArea(selectedRole, area) ? selectedRole : defaultBidRoleForArea(area);
}

function syncBulkRosterBidAsSelect(row, selectedBidAs) {
  const area = row.querySelector("[data-bulk-area]")?.value || selectedRosterArea();
  const select = row.querySelector("[data-bulk-bid-as]");
  if (!select) return;
  const selectedRole = normalizeBidRoleForArea(selectedBidAs || select.value, area);
  select.innerHTML = rosterBidAsOptions(selectedRole, area);
  select.value = validBidRoleForArea(selectedRole, area) ? selectedRole : defaultBidRoleForArea(area);
}

function findRosterEntryByInitials(initials) {
  const normalized = String(initials || "").trim().toUpperCase();
  return senioritySource.find((entry) => rosterEntryInitials(entry) === normalized) || null;
}

function findRosterEntryByIndex(index) {
  const entryIndex = Number(index);
  if (!Number.isInteger(entryIndex) || entryIndex < 0) return null;
  return senioritySource[entryIndex] || null;
}

function findRosterEntryForEdit(index, initials) {
  const entry = findRosterEntryByIndex(index);
  if (entry && rosterEntryInitials(entry) === initials) return entry;
  return findRosterEntryByInitials(initials);
}

function defaultRosterFormValues(area = selectedRosterArea()) {
  return {
    editIndex: "",
    firstName: "",
    lastName: "",
    initials: "",
    email: "",
    phone: "",
    area,
    rank: activeRosterEntries(area).length + 1,
    bidAs: defaultBidRoleForArea(area),
    leaveSlotAllowance: DEFAULT_BUE_LEAVE_SLOT_ALLOWANCE,
  };
}

function setRosterFormValues(values = defaultRosterFormValues()) {
  const setValue = (selector, value) => {
    const input = document.querySelector(selector);
    if (input) input.value = value ?? "";
  };
  setValue("[data-roster-edit-initials]", values.editInitials || "");
  setValue("[data-roster-edit-index]", values.editIndex ?? "");
  setValue("[data-roster-first-name]", values.firstName);
  setValue("[data-roster-last-name]", values.lastName);
  setValue("[data-roster-initials]", values.initials);
  setValue("[data-roster-email]", values.email);
  setValue("[data-roster-phone]", values.phone);
  setValue("[data-roster-area]", values.area);
  setValue("[data-roster-rank]", values.rank);
  setValue("[data-roster-leave-slots]", normalizeLeaveSlotAllowance(values.leaveSlotAllowance));
  syncRosterBidAsSelect(values.area, values.bidAs);
}

function resetRosterForm() {
  setRosterFormValues(defaultRosterFormValues());
  setRosterStatus("Ready for a new BUE.");
}

function editRosterEntry(initials) {
  const entry = findRosterEntryByInitials(initials);
  if (!entry) return;
  editRosterEntryByIndex(senioritySource.indexOf(entry));
}

function editRosterEntryByIndex(index) {
  const entry = findRosterEntryByIndex(index);
  if (!entry) return;
  const person = rosterEntryToPerson(entry);
  setRosterFormValues({
    editIndex: senioritySource.indexOf(entry),
    editInitials: person.initials,
    firstName: person.firstName,
    lastName: person.lastName,
    initials: person.initials,
    email: person.email,
    phone: person.phone,
    area: person.area,
    rank: Number.isFinite(person.rank) ? person.rank : activeRosterEntries(person.area).length + 1,
    bidAs: person.bidAs,
    leaveSlotAllowance: person.leaveSlotAllowance,
  });
  setRosterStatus(`Editing ${personDisplayName(person)}.`);
}

function rosterFormValues() {
  const value = (selector) => document.querySelector(selector)?.value.trim() || "";
  const area = value("[data-roster-area]") || selectedRosterArea();
  return {
    editInitials: value("[data-roster-edit-initials]").toUpperCase(),
    firstName: value("[data-roster-first-name]"),
    lastName: value("[data-roster-last-name]"),
    initials: value("[data-roster-initials]").toUpperCase(),
    email: value("[data-roster-email]").toLowerCase(),
    phone: value("[data-roster-phone]"),
    area,
    rank: Number(value("[data-roster-rank]")),
    bidAs: normalizeBidRoleForArea(value("[data-roster-bid-as]") || defaultBidRoleForArea(area), area),
    leaveSlotAllowance: normalizeLeaveSlotAllowance(value("[data-roster-leave-slots]")),
    editIndex: Number(value("[data-roster-edit-index]")),
    active: true,
  };
}

function supabaseRosterPayload(values) {
  return {
    original_area_name: values.originalArea || values.area,
    original_initials: values.originalInitials || values.editInitials || values.initials,
    original_seniority_rank: Number.isFinite(values.originalRank) ? values.originalRank : null,
    profile_first_name: values.firstName,
    profile_last_name: values.lastName,
    profile_initials: values.initials,
    profile_email: values.email,
    profile_phone: values.phone,
    profile_area_name: values.area,
    profile_bid_role: values.bidAs || "CPC",
    profile_seniority_rank: Number.isFinite(values.rank) ? values.rank : null,
    profile_leave_slot_allowance: normalizeLeaveSlotAllowance(values.leaveSlotAllowance),
    profile_active: values.active !== false,
  };
}

function friendlyRosterSyncFailure(error) {
  const message = error?.message || "";
  if (/admin_save_bidder_roster_entry|function .*not found|Could not find/i.test(message)) {
    return "Working roster updated, but the backend roster sync helper is not installed for this Supabase project.";
  }
  if (/Authentication is required|JWT|not authenticated|session/i.test(message)) {
    return "Working roster updated. Sign in with a Supabase admin account to save it permanently.";
  }
  if (/Admin access is required/i.test(message)) {
    return "Working roster updated. The signed-in Supabase account is not marked as an admin.";
  }
  return `Working roster updated, but Supabase did not save it: ${message || "unknown error"}`;
}

async function saveSupabaseRosterEntry(values) {
  const client = supabaseClient();
  if (!client) {
    return {
      saved: false,
      message: "Working roster updated. Supabase is not configured on this page yet.",
    };
  }

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError || !sessionData?.session) {
    return {
      saved: false,
      message: "Working roster updated. Sign in with a Supabase admin account to save it permanently.",
    };
  }

  const { data, error } = await client.rpc("admin_save_bidder_roster_entry", supabaseRosterPayload(values));
  if (error) {
    return {
      saved: false,
      message: friendlyRosterSyncFailure(error),
    };
  }

  return {
    saved: true,
    profile: Array.isArray(data) ? data[0] : data,
  };
}

async function saveSupabaseRosterRows(rows) {
  const client = supabaseClient();
  if (!client) {
    return {
      saved: false,
      message: "Working roster updated. Supabase is not configured on this page yet.",
    };
  }

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError || !sessionData?.session) {
    return {
      saved: false,
      message: "Working roster updated. Sign in with a Supabase admin account to save it permanently.",
    };
  }

  const rosterRows = rows.map((row) => supabaseRosterPayload({
    ...row,
    originalArea: row.originalArea || row.area,
    originalInitials: row.originalInitials || row.initials,
  }));

  const { error } = await client.rpc("admin_save_bidder_roster_rows", { roster_rows: rosterRows });
  if (error) {
    if (/admin_save_bidder_roster_rows|function .*not found|Could not find/i.test(error.message || "")) {
      for (const row of rows) {
        const { error: rowError } = await client.rpc("admin_save_bidder_roster_entry", supabaseRosterPayload({
          ...row,
          originalArea: row.originalArea || row.area,
          originalInitials: row.originalInitials || row.initials,
        }));
        if (rowError) {
          return {
            saved: false,
            message: friendlyRosterSyncFailure(rowError),
          };
        }
      }

      return { saved: true };
    }

    return {
      saved: false,
      message: friendlyRosterSyncFailure(error),
    };
  }

  return { saved: true };
}

function placeRosterEntry(entry, area, rank) {
  const oldIndex = senioritySource.indexOf(entry);
  if (oldIndex >= 0) senioritySource.splice(oldIndex, 1);
  entry[4] = area;

  if (!seniorityEntryActive(entry)) {
    senioritySource.push(entry);
    return;
  }

  const targetEntries = activeRosterEntries(area);
  const nextRank = Math.max(1, Math.min(Number.isFinite(rank) ? rank : targetEntries.length + 1, targetEntries.length + 1));
  const beforeEntry = targetEntries[nextRank - 1];
  if (beforeEntry) {
    senioritySource.splice(senioritySource.indexOf(beforeEntry), 0, entry);
    return;
  }

  const lastEntry = targetEntries[targetEntries.length - 1];
  const insertIndex = lastEntry ? senioritySource.indexOf(lastEntry) + 1 : senioritySource.length;
  senioritySource.splice(insertIndex, 0, entry);
}

function syncCurrentUserFromRoster(previousInitials, nextInitials) {
  if (![previousInitials, nextInitials].includes(currentUser.initials)) return;
  const entry = findRosterEntryByInitials(nextInitials);
  if (!entry || !seniorityEntryActive(entry)) return;
  const person = rosterEntryToPerson(entry);
  currentUser = {
    ...currentUser,
    firstName: person.firstName,
    lastName: person.lastName,
    initials: person.initials,
    seniorityRank: person.rank,
    area: person.area,
    bidAs: person.bidAs,
    phone: person.phone,
    email: person.email,
    leaveSlotAllowance: person.leaveSlotAllowance,
  };
  selectedViewArea = person.area;
}

function rosterSyncRowsForAreas(areas, entryOverrides = new Map()) {
  return [...areas].flatMap((area) =>
    activeRosterEntries(area).map((entry, index) => {
      const person = rosterEntryToPerson(entry, index + 1, { fallbackInitials: false });
      const override = entryOverrides.get(entry) || {};
      return {
        firstName: person.firstName,
        lastName: person.lastName,
        initials: person.initials,
        email: person.email,
        phone: person.phone,
        area: person.area,
        rank: person.rank,
        bidAs: person.bidAs,
        leaveSlotAllowance: person.leaveSlotAllowance,
        active: person.active,
        originalArea: override.originalArea || person.area,
        originalInitials: override.originalInitials || person.initials,
      };
    })
  );
}

async function saveRosterEntry(event) {
  event.preventDefault();
  if (!hasSystemAdminAccess()) return;

  const values = rosterFormValues();
  if (!values.firstName || !values.lastName || !values.initials) {
    setRosterStatus("First name, last name, and initials are required.", "error");
    return;
  }
  if (!ZLA_AREAS.includes(values.area)) {
    setRosterStatus("Choose a valid area.", "error");
    return;
  }
  if (!validBidRoleForArea(values.bidAs, values.area)) {
    setRosterStatus("Choose a valid bid role.", "error");
    return;
  }
  if (!Number.isFinite(values.rank) || values.rank < 1) {
    setRosterStatus("Enter a valid seniority rank.", "error");
    return;
  }

  const existingEntry = findRosterEntryForEdit(values.editIndex, values.editInitials);
  const duplicateInitials = findRosterEntryByInitials(values.initials);
  if (duplicateInitials && duplicateInitials !== existingEntry) {
    setRosterStatus("Those initials are already assigned to another BUE.", "error");
    return;
  }

  const originalArea = existingEntry ? seniorityEntryArea(existingEntry) : values.area;
  const originalInitials = values.editInitials || values.initials;
  const entry = existingEntry || [];
  entry[0] = values.lastName;
  entry[1] = values.firstName;
  entry[2] = values.bidAs;
  entry[3] = values.initials;
  entry[5] = values.email;
  entry[6] = values.phone;
  entry[7] = true;
  entry[8] = values.leaveSlotAllowance;
  placeRosterEntry(entry, values.area, values.rank);

  syncCurrentUserFromRoster(values.editInitials || values.initials, values.initials);
  logHistory("All Areas", existingEntry ? "BUE roster amended" : "BUE added", `${currentUser.initials} saved ${values.firstName} ${values.lastName} (${values.initials}) in ${values.area} at seniority #${values.rank}.`);
  renderApp();
  editRosterEntryByIndex(senioritySource.indexOf(entry));
  setRosterStatus(`${values.firstName} ${values.lastName} saved in the working roster. Syncing to Supabase...`, "info");
  const supabaseSave = await saveSupabaseRosterRows(rosterSyncRowsForAreas(
    new Set([originalArea, values.area]),
    new Map([[entry, { originalArea, originalInitials }]])
  ));
  setRosterStatus(
    supabaseSave.saved
      ? `${values.firstName} ${values.lastName} saved to Supabase.`
      : supabaseSave.message,
    supabaseSave.saved ? "success" : "error"
  );
}

function deleteRosterEntry(initials) {
  const entry = findRosterEntryByInitials(initials);
  deleteRosterEntryByIndex(senioritySource.indexOf(entry));
}

function deleteRosterEntryByIndex(index) {
  if (!hasSystemAdminAccess()) return;
  const entry = findRosterEntryByIndex(index);
  if (!entry) return;
  const person = rosterEntryToPerson(entry);
  if (person.initials === currentUser.initials) {
    setRosterStatus("You cannot delete the account you are currently using.", "error");
    return;
  }
  if (!window.confirm(`Delete ${personDisplayName(person)} (${person.initials}) from the working roster?`)) return;

  senioritySource.splice(senioritySource.indexOf(entry), 1);
  intakeTeamInitials.delete(person.initials);
  for (let index = intakeSchedules.length - 1; index >= 0; index -= 1) {
    if (intakeSchedules[index].initials === person.initials) intakeSchedules.splice(index, 1);
  }
  logHistory("All Areas", "BUE deleted", `${currentUser.initials} deleted ${person.initials} from the working roster.`);
  resetRosterForm();
  renderApp();
  setRosterStatus(`${personDisplayName(person)} was deleted from the working roster.`, "success");
}

function bulkRowValue(row, selector) {
  return row.querySelector(selector)?.value.trim() || "";
}

function rosterTableRows() {
  return [...document.querySelectorAll("[data-roster-row]")];
}

function renumberBulkRosterRows() {
  rosterTableRows().forEach((row, index) => {
    const rankInput = row.querySelector("[data-bulk-rank]");
    if (rankInput) rankInput.value = index + 1;
  });
}

function bulkRosterRows() {
  return rosterTableRows()
    .map((row) => {
      const originalInitials = row.dataset.originalInitials || "";
      const area = bulkRowValue(row, "[data-bulk-area]");
      return {
        originalInitials,
        sourceIndex: Number(row.dataset.rosterEntryIndex),
        firstName: bulkRowValue(row, "[data-bulk-first-name]"),
        lastName: bulkRowValue(row, "[data-bulk-last-name]"),
        initials: bulkRowValue(row, "[data-bulk-initials]").toUpperCase(),
        email: bulkRowValue(row, "[data-bulk-email]").toLowerCase(),
        phone: bulkRowValue(row, "[data-bulk-phone]"),
        area,
        rank: Number(bulkRowValue(row, "[data-bulk-rank]")),
        bidAs: normalizeBidRoleForArea(bulkRowValue(row, "[data-bulk-bid-as]") || defaultBidRoleForArea(area), area),
        leaveSlotAllowance: normalizeLeaveSlotAllowance(bulkRowValue(row, "[data-bulk-leave-slots]")),
        active: true,
      };
    });
}

function validateBulkRosterRows(rows) {
  for (const row of rows) {
    if (!Number.isInteger(row.sourceIndex) || !senioritySource[row.sourceIndex]) return `Could not match ${row.initials || "that row"} to the roster. Refresh and try again.`;
    if (!row.firstName || !row.lastName) return "Every edited BUE needs first name and last name.";
    if (!ZLA_AREAS.includes(row.area)) return `Choose a valid area for ${row.initials}.`;
    if (!validBidRoleForArea(row.bidAs, row.area)) return `Choose a valid bid role for ${row.initials}.`;
    if (!Number.isFinite(row.rank) || row.rank < 1) return `Enter a valid seniority rank for ${row.initials}.`;
    if (!Number.isFinite(row.leaveSlotAllowance) || row.leaveSlotAllowance < 0) return `Enter a valid leave-slot allowance for ${row.initials}.`;
  }

  const rowsByIndex = new Map(rows.map((row) => [row.sourceIndex, row]));

  for (const row of rows) {
    if (!row.initials || row.initials === row.originalInitials) continue;
    const conflictingEntry = senioritySource.some((entry, index) => {
      if (index === row.sourceIndex) return false;
      const matchingRow = rowsByIndex.get(index);
      const proposedInitials = matchingRow ? matchingRow.initials : rosterEntryInitials(entry);
      if (!proposedInitials) return false;
      return proposedInitials === row.initials;
    });
    if (conflictingEntry) return `${row.initials} is already assigned to another BUE.`;
  }

  return "";
}

function currentAreaRanksByEntry() {
  const ranks = new Map();
  ZLA_AREAS.forEach((area) => {
    activeRosterEntries(area).forEach((entry, index) => {
      ranks.set(entry, index + 1);
    });
  });
  return ranks;
}

function rebuildRosterFromBulkRows(rows) {
  const originalRanks = currentAreaRanksByEntry();
  const originalOrder = new Map(senioritySource.map((entry, index) => [entry, index]));
  const rowsByIndex = new Map(rows.map((row, index) => [row.sourceIndex, { ...row, bulkIndex: index }]));
  const editedEntries = [];

  senioritySource.forEach((entry, index) => {
    const row = rowsByIndex.get(index);
    if (!row) return;
    const originalRow = rows.find((item) => item.sourceIndex === index);

    row.originalArea = seniorityEntryArea(entry);
    row.originalRank = originalRanks.get(entry);
    row.positionChanged = row.active && (row.area !== row.originalArea || row.rank !== row.originalRank);
    if (originalRow) {
      originalRow.originalArea = row.originalArea;
      originalRow.originalInitials = row.originalInitials;
      originalRow.originalRank = row.originalRank;
    }

    entry[0] = row.lastName;
    entry[1] = row.firstName;
    entry[2] = row.bidAs;
    entry[3] = row.initials;
    entry[4] = row.area;
    entry[5] = row.email;
    entry[6] = row.phone;
    entry[7] = row.active;
    entry[8] = row.leaveSlotAllowance;

    if (!row.active) intakeTeamInitials.delete(row.initials);
    editedEntries.push({ entry, row });
  });

  const editedByEntry = new Map(editedEntries.map((item) => [item.entry, item.row]));
  const entriesByArea = new Map(ZLA_AREAS.map((area) => [area, []]));
  const extraEntries = [];
  senioritySource.forEach((entry) => {
    const area = seniorityEntryArea(entry);
    if (entriesByArea.has(area)) {
      entriesByArea.get(area).push(entry);
    } else {
      extraEntries.push(entry);
    }
  });

  const rankSortValue = (entry) => {
    const row = editedByEntry.get(entry);
    if (row?.active) return row.rank;
    return originalRanks.get(entry) || originalOrder.get(entry) + 1;
  };

  const rebuilt = [];
  ZLA_AREAS.forEach((area) => {
    const areaEntries = entriesByArea.get(area);
    const activeEntries = areaEntries
      .filter(seniorityEntryActive)
      .sort((a, b) => {
        const rankDifference = rankSortValue(a) - rankSortValue(b);
        if (rankDifference !== 0) return rankDifference;

        const aRow = editedByEntry.get(a);
        const bRow = editedByEntry.get(b);
        if (Boolean(aRow?.positionChanged) !== Boolean(bRow?.positionChanged)) {
          return aRow?.positionChanged ? -1 : 1;
        }
        if (aRow && bRow) return aRow.bulkIndex - bRow.bulkIndex;
        return originalOrder.get(a) - originalOrder.get(b);
      });
    const inactiveEntries = areaEntries
      .filter((entry) => !seniorityEntryActive(entry))
      .sort((a, b) => originalOrder.get(a) - originalOrder.get(b));
    rebuilt.push(...activeEntries, ...inactiveEntries);
  });

  senioritySource.splice(0, senioritySource.length, ...rebuilt, ...extraEntries);
  return editedEntries;
}

async function applyBulkRosterChanges() {
  if (!hasSystemAdminAccess()) return;
  renumberBulkRosterRows();
  const rows = bulkRosterRows();
  if (!rows.length) {
    setRosterStatus("No visible roster rows to apply.", "error");
    return;
  }

  const validationMessage = validateBulkRosterRows(rows);
  if (validationMessage) {
    setRosterStatus(validationMessage, "error");
    return;
  }

  const editedEntries = rebuildRosterFromBulkRows(rows);
  editedEntries.forEach(({ row }) => {
    syncCurrentUserFromRoster(row.originalInitials, row.initials);
  });

  logHistory("All Areas", "Bulk roster update", `${currentUser.initials} applied ${editedEntries.length} visible roster rows from the bulk editor.`);
  renderApp();
  setRosterStatus(`${editedEntries.length} visible roster rows applied. Syncing to Supabase...`, "info");
  const supabaseSave = await saveSupabaseRosterRows(rows);
  setRosterStatus(
    supabaseSave.saved
      ? `${editedEntries.length} visible roster rows saved to Supabase.`
      : supabaseSave.message,
    supabaseSave.saved ? "success" : "error"
  );
}

function renderRosterManager() {
  const filter = document.querySelector("[data-roster-area-filter]");
  if (filter && !filter.value) filter.value = currentViewArea();
  const selectedArea = selectedRosterArea();
  if (filter) filter.value = selectedArea;

  const areaInput = document.querySelector("[data-roster-area]");
  if (areaInput && !areaInput.value) areaInput.value = selectedArea;
  const rankInput = document.querySelector("[data-roster-rank]");
  if (rankInput && !rankInput.value) rankInput.value = activeRosterEntries(selectedArea).length + 1;
  if (areaInput) syncRosterBidAsSelect(areaInput.value || selectedArea);

  const target = document.querySelector("[data-roster-table]");
  if (!target) return;

  const rows = rosterEntriesForArea(selectedArea);
  target.innerHTML = rows.length
    ? rows.map(({ person, sourceIndex }) => `
      <tr data-roster-row data-roster-entry-index="${sourceIndex}" data-original-initials="${escapeHtml(person.initials)}">
        <td><button class="roster-drag-handle" type="button" data-roster-drag-handle draggable="true" title="Drag to reorder seniority" aria-label="Drag ${escapeHtml(personDisplayName(person))} to reorder seniority">|||</button></td>
        <td><input class="bulk-rank" type="number" min="1" step="1" value="${Number.isFinite(person.rank) ? person.rank : ""}" data-bulk-rank readonly aria-label="Seniority rank for ${escapeHtml(person.initials)}" /></td>
        <td><input type="text" value="${escapeHtml(person.firstName)}" data-bulk-first-name aria-label="First name for ${escapeHtml(person.initials)}" /></td>
        <td><input type="text" value="${escapeHtml(person.lastName)}" data-bulk-last-name aria-label="Last name for ${escapeHtml(person.initials)}" /></td>
        <td><input class="bulk-initials" type="text" maxlength="4" value="${escapeHtml(person.initials)}" data-bulk-initials /></td>
        <td><input type="email" value="${escapeHtml(person.email)}" data-bulk-email aria-label="Email for ${escapeHtml(person.initials)}" /></td>
        <td><input type="tel" value="${escapeHtml(person.phone)}" data-bulk-phone aria-label="Phone for ${escapeHtml(person.initials)}" /></td>
        <td><select data-bulk-area>${rosterAreaOptions(person.area)}</select></td>
        <td><select data-bulk-bid-as>${rosterBidAsOptions(person.bidAs, person.area)}</select></td>
        <td><input type="number" min="0" step="1" value="${normalizeLeaveSlotAllowance(person.leaveSlotAllowance)}" data-bulk-leave-slots aria-label="Leave slots for ${escapeHtml(person.initials)}" /></td>
        <td>
          <div class="roster-row-actions">
            <button class="secondary-action small" type="button" data-edit-roster-bue="${sourceIndex}">Edit</button>
            <button class="secondary-action small danger" type="button" data-delete-roster-bue="${sourceIndex}">Delete</button>
          </div>
        </td>
      </tr>
    `).join("")
    : '<tr><td colspan="11">No BUEs in this area yet.</td></tr>';
  applyRosterColumnWidths();
}

let draggedRosterRow = null;
let resizingRosterColumn = null;
const rosterColumnWidths = {
  handle: 44,
  rank: 72,
  first: 150,
  last: 150,
  initials: 92,
  email: 190,
  phone: 165,
  area: 110,
  role: 96,
  leaveSlots: 104,
  actions: 132,
};
const rosterColumnMinimumWidths = {
  handle: 44,
  rank: 58,
  first: 100,
  last: 100,
  initials: 76,
  email: 130,
  phone: 120,
  area: 92,
  role: 82,
  leaveSlots: 88,
  actions: 112,
};

function rosterDragRow(event) {
  return event.target.closest("[data-roster-row]");
}

function applyRosterColumnWidths() {
  const table = document.querySelector("[data-roster-table-element]");
  if (!table) return;

  let tableWidth = 0;
  Object.entries(rosterColumnWidths).forEach(([column, width]) => {
    const nextWidth = Math.max(rosterColumnMinimumWidths[column] || 60, width);
    const col = table.querySelector(`[data-roster-col="${column}"]`);
    if (col) col.style.width = `${nextWidth}px`;
    tableWidth += nextWidth;
  });
  table.style.minWidth = `${tableWidth}px`;
}

function startRosterColumnResize(event) {
  const handle = event.target.closest("[data-roster-col-resizer]");
  if (!handle) return;

  event.preventDefault();
  event.stopPropagation();
  const column = handle.dataset.rosterColResizer;
  resizingRosterColumn = {
    column,
    startX: event.clientX,
    startWidth: rosterColumnWidths[column],
  };
  document.body.classList.add("roster-column-resizing");
}

function resizeRosterColumn(event) {
  if (!resizingRosterColumn) return;

  event.preventDefault();
  const { column, startX, startWidth } = resizingRosterColumn;
  const minimumWidth = rosterColumnMinimumWidths[column] || 60;
  rosterColumnWidths[column] = Math.max(minimumWidth, startWidth + event.clientX - startX);
  applyRosterColumnWidths();
}

function finishRosterColumnResize() {
  if (!resizingRosterColumn) return;
  resizingRosterColumn = null;
  document.body.classList.remove("roster-column-resizing");
}

function startRosterRowDrag(event) {
  const row = rosterDragRow(event);
  if (!row) return;
  if (!event.target.closest("[data-roster-drag-handle]")) {
    event.preventDefault();
    return;
  }

  draggedRosterRow = row;
  row.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", row.dataset.rosterEntryIndex || "");
}

function moveRosterRowDuringDrag(event) {
  if (!draggedRosterRow) return;
  const row = rosterDragRow(event);
  if (!row || row === draggedRosterRow) return;

  event.preventDefault();
  const rowBounds = row.getBoundingClientRect();
  const insertAfter = event.clientY > rowBounds.top + rowBounds.height / 2;
  row.parentNode.insertBefore(draggedRosterRow, insertAfter ? row.nextSibling : row);
  renumberBulkRosterRows();
}

function dropRosterRow(event) {
  if (!draggedRosterRow) return;
  event.preventDefault();
  renumberBulkRosterRows();
  setRosterStatus("Seniority order staged. Click Apply Bulk Changes to save it.", "info");
}

function finishRosterRowDrag() {
  if (draggedRosterRow) draggedRosterRow.classList.remove("dragging");
  draggedRosterRow = null;
  renumberBulkRosterRows();
}

function renderEmailLog() {
  const target = document.querySelector("[data-email-log]");
  if (!target) return;

  target.innerHTML = prototypeEmails.length
    ? prototypeEmails.slice(0, 8).map((email) => `
      <article>
        <strong>${escapeHtml(email.subject)}</strong>
        <span>${escapeHtml(email.to)} · ${escapeHtml(email.time)} · ${escapeHtml(email.status || "Logged")}</span>
        ${email.error ? `<small>${escapeHtml(email.error)}</small>` : ""}
      </article>
    `).join("")
    : '<p class="empty-state small">No notification emails have been queued yet.</p>';
}

function renderAdminConsole() {
  syncAdminScheduleFormDefaults();
  syncIntakeTeamControls();
  syncSlotCapacityForm();
  renderSlotCapacitySummary();
  renderRosterManager();
  renderEmailLog();

  const target = document.querySelector("[data-admin-user-list]");
  if (!target) return;

  const availablePeople = bueRoster().filter((person) => !intakeTeamInitials.has(person.initials));
  const teamPeople = intakeTeamMembers();

  target.innerHTML = `
    <section class="intake-team-builder">
      <div class="intake-team-add">
        <label>
          Add BUE to Intake Team
          <select data-intake-team-candidate>
            ${availablePeople.length
              ? availablePeople.map((person) => `<option value="${escapeHtml(person.initials)}">${escapeHtml(personScheduleLabel(person))}</option>`).join("")
              : '<option value="">All rostered BUEs are already on the intake team</option>'}
          </select>
        </label>
        <button class="primary-action small" type="button" data-add-intake-team-member ${availablePeople.length ? "" : "disabled"}>Add to Team</button>
      </div>
      <div class="intake-team-list" data-intake-team-list>
        ${teamPeople.map((person) => {
          const scheduledCount = intakeSchedules.filter((schedule) => schedule.initials === person.initials).length;
          const canRemove = person.initials !== currentUser.initials;
          return `
            <article class="admin-user-card">
              <div>
                <small>${escapeHtml(person.bidAs || "BUE Controller")}</small>
                <h3>${escapeHtml(personDisplayName(person))} · ${escapeHtml(person.initials)}</h3>
                <p>${escapeHtml(person.area || currentUser.area)} · Seniority ${Number.isFinite(person.rank) ? `#${person.rank}` : "Unranked"} · ${scheduledCount} scheduled ${scheduledCount === 1 ? "shift" : "shifts"}</p>
                <span class="status approved">Intake team</span>
              </div>
              <div class="admin-user-actions">
                <button class="secondary-action small danger" type="button" data-remove-intake-team-member="${escapeHtml(person.initials)}" ${canRemove ? "" : "disabled"}>Remove</button>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
  syncIntakeTeamControls();
}

function setSlotCapacityStatus(message, status = "info") {
  const target = document.querySelector("[data-slot-capacity-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

function slotCapacityFormSelection() {
  const area = document.querySelector("[data-slot-capacity-area]")?.value || currentViewArea();
  const startKey = document.querySelector("[data-slot-capacity-start]")?.value || BID_LEAVE_YEAR_START_KEY;
  const endKey = document.querySelector("[data-slot-capacity-end]")?.value || startKey;
  return { area, startKey, endKey };
}

function slotCapacityRangeDetails(area, startKey, endKey) {
  const keys = datesBetweenKeys(startKey, endKey);
  return keys.reduce((summary, key) => {
    const details = leaveSlotsForDate(key, area);
    summary.maxCpcCapacity = Math.max(summary.maxCpcCapacity, leaveSlotCapacityForDetails(details, "cpc"));
    summary.maxDevCapacity = Math.max(summary.maxDevCapacity, leaveSlotCapacityForDetails(details, "dev"));
    if (details.cpc.length > summary.maxCpcFilled) {
      summary.maxCpcFilled = details.cpc.length;
      summary.maxCpcDate = key;
    }
    if (details.dev.length > summary.maxDevFilled) {
      summary.maxDevFilled = details.dev.length;
      summary.maxDevDate = key;
    }
    return summary;
  }, {
    keys,
    maxCpcCapacity: 0,
    maxDevCapacity: 0,
    maxCpcFilled: 0,
    maxDevFilled: 0,
    maxCpcDate: startKey,
    maxDevDate: startKey,
  });
}

function slotCapacitySummaryEntries() {
  const capacityByAreaAndDate = new Map();

  Object.values(extraLeaveSlotData).forEach((details) => {
    const area = details?.area;
    const key = details?.date;
    if (!ZLA_AREAS.includes(area) || !/^\d{4}-\d{2}-\d{2}$/.test(key || "")) return;
    if (key < BID_LEAVE_YEAR_START_KEY || key > BID_LEAVE_YEAR_END_KEY) return;

    capacityByAreaAndDate.set(leaveSlotCapacityOverrideKey(area, key), {
      area,
      key,
      cpc: leaveSlotCapacityForDetails(details, "cpc"),
      dev: leaveSlotCapacityForDetails(details, "dev"),
    });
  });

  Object.entries(leaveSlotCapacityOverrides).forEach(([storageKey, value]) => {
    const separatorIndex = storageKey.lastIndexOf("|");
    if (separatorIndex < 0 || !value || typeof value !== "object") return;
    const area = storageKey.slice(0, separatorIndex);
    const key = storageKey.slice(separatorIndex + 1);
    const cpc = Number(value.cpc);
    const dev = Number(value.dev);
    if (!ZLA_AREAS.includes(area) || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
    if (key < BID_LEAVE_YEAR_START_KEY || key > BID_LEAVE_YEAR_END_KEY) return;
    if (!Number.isInteger(cpc) || cpc < 0 || !Number.isInteger(dev) || dev < 0) return;
    capacityByAreaAndDate.set(storageKey, { area, key, cpc, dev });
  });

  return [...capacityByAreaAndDate.values()]
    .filter((entry) => (
      entry.cpc !== standardLeaveSlotCapacity(entry.area, "cpc")
      || entry.dev !== standardLeaveSlotCapacity(entry.area, "dev")
    ))
    .sort((a, b) => ZLA_AREAS.indexOf(a.area) - ZLA_AREAS.indexOf(b.area) || a.key.localeCompare(b.key));
}

function nextCalendarDateKey(key) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + 1);
  return dateKeyFromDate(date);
}

function groupedSlotCapacitySummaryRanges(entries) {
  return entries.reduce((ranges, entry) => {
    const previous = ranges[ranges.length - 1];
    const continuesPrevious = previous
      && previous.area === entry.area
      && previous.cpc === entry.cpc
      && previous.dev === entry.dev
      && nextCalendarDateKey(previous.endKey) === entry.key;

    if (continuesPrevious) {
      previous.endKey = entry.key;
      previous.dayCount += 1;
    } else {
      ranges.push({
        area: entry.area,
        startKey: entry.key,
        endKey: entry.key,
        cpc: entry.cpc,
        dev: entry.dev,
        dayCount: 1,
      });
    }
    return ranges;
  }, []);
}

function slotCapacitySummaryRangeLabel(range) {
  return range.startKey === range.endKey
    ? formatCalendarDate(range.startKey)
    : `${formatCalendarDate(range.startKey)} – ${formatCalendarDate(range.endKey)}`;
}

function renderSlotCapacitySummary() {
  const target = document.querySelector("[data-slot-capacity-changes]");
  const countTarget = document.querySelector("[data-slot-capacity-change-count]");
  if (!target || !countTarget) return;

  const entries = slotCapacitySummaryEntries();
  const ranges = groupedSlotCapacitySummaryRanges(entries);
  countTarget.textContent = `${entries.length} changed ${entries.length === 1 ? "date" : "dates"}`;

  target.innerHTML = ZLA_AREAS.map((area) => {
    const areaRanges = ranges.filter((range) => range.area === area);
    const standardCpc = standardLeaveSlotCapacity(area, "cpc");
    const standardDev = standardLeaveSlotCapacity(area, "dev");
    return `
      <article class="slot-capacity-area-card">
        <header>
          <h4>${escapeHtml(area)}</h4>
          <span>Standard: ${standardCpc} CPC · ${standardDev} DEV</span>
        </header>
        ${areaRanges.length ? `
          <div class="slot-capacity-change-list">
            ${areaRanges.map((range) => `
              <div class="slot-capacity-change-row">
                <div>
                  <strong>${escapeHtml(slotCapacitySummaryRangeLabel(range))}</strong>
                  <small>${range.dayCount} ${range.dayCount === 1 ? "day" : "days"}</small>
                </div>
                <span class="slot-capacity-values">${range.cpc} CPC · ${range.dev} DEV</span>
              </div>
            `).join("")}
          </div>
        ` : '<p class="slot-capacity-no-changes">No nonstandard dates.</p>'}
      </article>
    `;
  }).join("");
}

function syncSlotCapacityForm() {
  const areaInput = document.querySelector("[data-slot-capacity-area]");
  const startInput = document.querySelector("[data-slot-capacity-start]");
  const endInput = document.querySelector("[data-slot-capacity-end]");
  const cpcInput = document.querySelector("[data-slot-capacity-cpc]");
  const devInput = document.querySelector("[data-slot-capacity-dev]");
  if (!areaInput || !startInput || !endInput || !cpcInput || !devInput) return;

  if (!startInput.value) startInput.value = BID_LEAVE_YEAR_START_KEY;
  endInput.min = startInput.value;
  if (!endInput.value || endInput.value < startInput.value) endInput.value = startInput.value;
  if (!ZLA_AREAS.includes(areaInput.value)) areaInput.value = currentViewArea();

  const { area, startKey, endKey } = slotCapacityFormSelection();
  const range = slotCapacityRangeDetails(area, startKey, endKey);
  const cpcCapacity = range.maxCpcCapacity;
  const devCapacity = range.maxDevCapacity;
  cpcInput.value = String(cpcCapacity);
  devInput.value = String(devCapacity);
  cpcInput.min = String(range.maxCpcFilled);
  devInput.min = String(range.maxDevFilled);

  const dayLabel = range.keys.length === 1 ? "day" : "days";
  setText("[data-slot-capacity-summary]", `${cpcCapacity} CPC · ${devCapacity} DEV × ${range.keys.length} ${dayLabel}`);
  setText(
    "[data-slot-capacity-usage]",
    range.keys.length
      ? `${formatCalendarDate(startKey)} through ${formatCalendarDate(endKey)} includes ${range.keys.length} ${dayLabel}. Highest filled day: ${range.maxCpcFilled} CPC and ${range.maxDevFilled} DEV.`
      : "Choose a valid start and end date."
  );
}

async function saveSlotCapacity(event) {
  event?.preventDefault();
  if (!hasSystemAdminAccess()) {
    setSlotCapacityStatus("Only system admins can change daily slot capacity.", "error");
    return;
  }

  const { area, startKey, endKey } = slotCapacityFormSelection();
  const cpc = Number(document.querySelector("[data-slot-capacity-cpc]")?.value);
  const dev = Number(document.querySelector("[data-slot-capacity-dev]")?.value);
  const range = slotCapacityRangeDetails(area, startKey, endKey);

  if (!ZLA_AREAS.includes(area) || !/^\d{4}-\d{2}-\d{2}$/.test(startKey) || !/^\d{4}-\d{2}-\d{2}$/.test(endKey) || !range.keys.length) {
    setSlotCapacityStatus("Choose a valid area, start date, and end date.", "error");
    return;
  }
  if (!Number.isInteger(cpc) || cpc < 0 || cpc > 99 || !Number.isInteger(dev) || dev < 0 || dev > 99) {
    setSlotCapacityStatus("Enter whole-number capacities from 0 through 99.", "error");
    return;
  }
  if (cpc < range.maxCpcFilled || dev < range.maxDevFilled) {
    const conflicts = [];
    if (cpc < range.maxCpcFilled) conflicts.push(`${range.maxCpcFilled} CPC on ${formatCalendarDate(range.maxCpcDate)}`);
    if (dev < range.maxDevFilled) conflicts.push(`${range.maxDevFilled} DEV on ${formatCalendarDate(range.maxDevDate)}`);
    setSlotCapacityStatus(`Capacity cannot be lower than filled slots in this range (${conflicts.join("; ")}).`, "error");
    return;
  }

  const client = supabaseClient();
  if (supabaseState.connected && client) {
    setSlotCapacityStatus("Saving daily capacity...");
    const { error } = await client.rpc("set_leave_slot_capacity_range", {
      requested_bid_year: BID_YEAR,
      requested_area_name: area,
      requested_start_date: startKey,
      requested_end_date: endKey,
      requested_cpc_capacity: cpc,
      requested_dev_capacity: dev,
    });
    if (error) {
      setSlotCapacityStatus(
        isMissingSupabaseRoutine(error)
          ? "The database range-capacity update has not been installed yet. Run database/leave_slot_capacity_admin.sql."
          : error.message || "Daily capacity could not be saved.",
        "error"
      );
      return;
    }
  }

  range.keys.forEach((key) => setLeaveSlotCapacityOverride(area, key, cpc, dev, false));
  storeJsonValue(LEAVE_SLOT_CAPACITY_STORAGE_KEY, leaveSlotCapacityOverrides);
  logHistory(area, "Leave capacity range updated", `${currentUser.initials} set ${formatCalendarDate(startKey)} through ${formatCalendarDate(endKey)} to ${cpc} CPC and ${dev} DEV slots per day.`);
  renderApp();
  setSlotCapacityStatus(`${range.keys.length} ${range.keys.length === 1 ? "day" : "days"} saved for ${area}: ${cpc} CPC and ${dev} DEV slots per day.`, "success");
}

function addAdminScheduleFromForm() {
  if (!hasSystemAdminAccess()) {
    setAdminScheduleStatus("Only system admins can schedule intake reps from this page.", "error");
    return;
  }

  const initials = (document.querySelector("[data-admin-schedule-rep]")?.value || "").trim().toUpperCase();
  const area = INTAKE_SCHEDULE_AREA;
  const startRaw = document.querySelector("[data-admin-schedule-start]")?.value || "";
  const endRaw = document.querySelector("[data-admin-schedule-end]")?.value || "";
  const start = new Date(startRaw);
  const end = new Date(endRaw);

  if (!initials) {
    setAdminScheduleStatus("Add at least one BUE to the intake team before scheduling a shift.", "error");
    return;
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    setAdminScheduleStatus("Choose a valid start and end time.", "error");
    return;
  }

  if (!intakeTeamInitials.has(initials)) {
    setAdminScheduleStatus("Choose someone from the intake team before adding a shift.", "error");
    return;
  }

  const person = bueByInitials(initials);
  const name = personDisplayName(person) || initials;

  intakeSchedules.push({
    id: `sched-admin-${initials.toLowerCase()}-${Date.now()}`,
    initials,
    name,
    area,
    start,
    end,
  });

  logHistory(area, "Intake shift scheduled", `${currentUser.initials} scheduled ${name} (${initials}) for ${formatDateRange(start, end)} · ${area}.`);
  renderApp();
  setAdminScheduleStatus(`${name} is scheduled. Intake access will open 15 minutes before the shift.`, "success");
}

function schedulesForDateKey(key) {
  return intakeSchedules
    .filter((schedule) => dateKeyFromDate(schedule.start) === key)
    .sort((a, b) => a.start - b.start);
}

function renderScheduleTooltip(key) {
  const schedules = schedulesForDateKey(key);
  if (!schedules.length) return "";
  return `
    <span class="schedule-tooltip" role="tooltip">
      <strong>${formatCalendarDate(key)}</strong>
      ${schedules.map((schedule) => `
        <span>
          <b>${escapeHtml(schedule.initials)}</b>
          <small>${escapeHtml(formatDateRange(schedule.start, schedule.end))}</small>
        </span>
      `).join("")}
    </span>
  `;
}

function formatScheduleStartTime(date) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function renderScheduleDayAssignments(schedules) {
  if (!schedules.length) return "";
  return `
    <span class="schedule-day-assignments">
      ${schedules.map((schedule) => `
        <span class="schedule-day-assignment">
          <b>${escapeHtml(schedule.initials)}</b>
          <small>${escapeHtml(formatScheduleStartTime(schedule.start))}</small>
        </span>
      `).join("")}
    </span>
  `;
}

function renderScheduleDayButton(date, includeMonth = false, options = {}) {
  const key = dateKeyFromDate(date);
  const schedules = schedulesForDateKey(key);
  const hasUserSchedule = schedules.some((schedule) => schedule.initials === currentUser.initials);
  const label = includeMonth ? `${monthNames[date.getMonth()].slice(0, 3)} ${date.getDate()}` : date.getDate();
  const showAssignments = Boolean(options.showAssignments);
  return `
    <button class="schedule-day ${showAssignments ? "show-assignments" : ""} ${schedules.length ? "has-schedule" : ""} ${hasUserSchedule ? "my-schedule-day" : ""}" type="button" aria-label="${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}: ${schedules.length ? "intake scheduled" : "no intake scheduled"}">
      <span class="date-number">${label}</span>
      ${showAssignments ? renderScheduleDayAssignments(schedules) : ""}
      ${renderScheduleTooltip(key)}
    </button>
  `;
}

function renderScheduleMonthCard(monthIndex, year, options = {}) {
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = [];

  dayNames.forEach((day) => cells.push(`<span class="dow">${day[0]}</span>`));
  for (let i = 0; i < firstDay; i += 1) cells.push("<span></span>");

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(renderScheduleDayButton(new Date(year, monthIndex, day), Boolean(options.includeMonth), {
      showAssignments: Boolean(options.showAssignments),
    }));
  }

  return `
    <article class="month-card">
      <h3>${options.showYear ? `${monthNames[monthIndex]} ${year}` : monthNames[monthIndex]}</h3>
      <div class="month-grid">${cells.join("")}</div>
    </article>
  `;
}

function scheduleWeekStart(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function renderScheduleWeekCard(activeDate) {
  const start = scheduleWeekStart(activeDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
  const label = `${formatCalendarDate(dateKeyFromDate(weekDays[0]))} - ${formatCalendarDate(dateKeyFromDate(weekDays[6]))}`;

  return `
    <article class="month-card week-card">
      <h3>${label}</h3>
      <div class="week-calendar-grid">
        ${weekDays.map((date) => `
          <div class="week-day-column">
            <span class="week-day-label">${dayNames[date.getDay()]}</span>
            ${renderScheduleDayButton(date, true, { showAssignments: true })}
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function updateScheduleCalendarControls() {
  document.querySelectorAll("[data-schedule-calendar-view]").forEach((button) => {
    const isActive = button.dataset.scheduleCalendarView === scheduleCalendarView;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  document.querySelectorAll("[data-schedule-period-label]").forEach((label) => {
    if (scheduleCalendarView === "year") {
      label.textContent = String(scheduleActiveDate.getFullYear());
      return;
    }

    if (scheduleCalendarView === "week") {
      const start = scheduleWeekStart(scheduleActiveDate);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      label.textContent = `${formatCalendarDate(dateKeyFromDate(start))} - ${formatCalendarDate(dateKeyFromDate(end))}`;
      return;
    }

    label.textContent = `${monthNames[scheduleActiveDate.getMonth()]} ${scheduleActiveDate.getFullYear()}`;
  });
}

function moveSchedulePeriod(direction) {
  const nextDate = new Date(scheduleActiveDate);
  if (scheduleCalendarView === "year") {
    nextDate.setFullYear(nextDate.getFullYear() + direction);
  } else if (scheduleCalendarView === "week") {
    nextDate.setDate(nextDate.getDate() + direction * 7);
  } else {
    nextDate.setMonth(nextDate.getMonth() + direction);
  }
  scheduleActiveDate = nextDate;
  renderIntakeSchedule();
}

function renderIntakeSchedule() {
  const calendar = document.getElementById("intake-schedule-calendar");
  const list = document.querySelector("[data-intake-schedule-list]");
  syncScheduleFormDefaults();
  syncIntakeTeamControls();
  updateScheduleCalendarControls();

  if (calendar) {
    calendar.classList.remove("month-view", "week-view", "year-view");
    calendar.classList.add(`${scheduleCalendarView}-view`);
    if (scheduleCalendarView === "year") {
      calendar.innerHTML = monthNames
        .map((_, monthIndex) => renderScheduleMonthCard(monthIndex, scheduleActiveDate.getFullYear()))
        .join("");
    } else if (scheduleCalendarView === "week") {
      calendar.innerHTML = renderScheduleWeekCard(scheduleActiveDate);
    } else {
      calendar.innerHTML = renderScheduleMonthCard(scheduleActiveDate.getMonth(), scheduleActiveDate.getFullYear(), {
        showAssignments: true,
        showYear: true,
      });
    }
  }

  if (!list) return;

  const adminCard = document.querySelector("[data-admin-schedule-card]");
  if (adminCard) adminCard.hidden = !hasIntakeAccess();

  const sortedSchedules = [...intakeSchedules].sort((a, b) => a.start - b.start);
  const userSchedules = sortedSchedules.filter((schedule) => schedule.initials === currentUser.initials);
  list.innerHTML = `
    <div class="schedule-list-section">
      <h3>Your Intake Assignments</h3>
      ${userSchedules.length
        ? userSchedules.map((schedule) => `
          <article>
            <strong>${escapeHtml(formatDateRange(schedule.start, schedule.end))}</strong>
            <span>${escapeHtml(schedule.area)}</span>
          </article>
        `).join("")
        : '<p class="empty-state small">No intake shifts assigned for this bidding year.</p>'}
    </div>
    <div class="schedule-list-section">
      <h3>All Intake Coverage</h3>
      ${sortedSchedules.map((schedule) => `
        <article class="${schedule.initials === currentUser.initials ? "mine" : ""}">
          <strong>${escapeHtml(schedule.name)} · ${escapeHtml(schedule.initials)}</strong>
          <span>${escapeHtml(formatDateRange(schedule.start, schedule.end))} · ${escapeHtml(schedule.area)}</span>
        </article>
      `).join("")}
    </div>
  `;
}

function syncScheduleFormDefaults() {
  const startInput = document.querySelector("[data-schedule-start]");
  const endInput = document.querySelector("[data-schedule-end]");
  if (!startInput || !endInput) return;

  const defaultStart = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  defaultStart.setMinutes(0, 0, 0);
  const defaultEnd = new Date(defaultStart.getTime() + 4 * 60 * 60 * 1000);
  if (!startInput.value) startInput.value = formatDateTimeLocalValue(defaultStart);
  if (!endInput.value) endInput.value = formatDateTimeLocalValue(defaultEnd);
}

function setScheduleFormStatus(message, status = "info") {
  const target = document.querySelector("[data-schedule-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

function addIntakeScheduleFromForm() {
  if (!hasIntakeAccess()) {
    setScheduleFormStatus("Only active intake/admin users can assign intake shifts.", "error");
    return;
  }

  const initials = (document.querySelector("[data-schedule-rep]")?.value || "").trim().toUpperCase();
  const area = INTAKE_SCHEDULE_AREA;
  const startRaw = document.querySelector("[data-schedule-start]")?.value || "";
  const endRaw = document.querySelector("[data-schedule-end]")?.value || "";
  const start = new Date(startRaw);
  const end = new Date(endRaw);

  if (!initials) {
    setScheduleFormStatus("Add at least one BUE to the intake team before scheduling a shift.", "error");
    return;
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    setScheduleFormStatus("Choose a valid start and end time for the intake shift.", "error");
    return;
  }

  if (!intakeTeamInitials.has(initials)) {
    setScheduleFormStatus("Choose someone from the intake team before adding a shift.", "error");
    return;
  }

  const person = bueByInitials(initials);
  const name = personDisplayName(person) || initials;

  intakeSchedules.push({
    id: `sched-${initials.toLowerCase()}-${Date.now()}`,
    initials,
    name,
    area,
    start,
    end,
  });

  logHistory(area, "Intake shift assigned", `${currentUser.initials} scheduled ${name} (${initials}) for ${formatDateRange(start, end)} · ${area}.`);
  renderApp();
  setPage("intake-schedule");
  setScheduleFormStatus(`${name} is scheduled for ${formatDateRange(start, end)}. Access starts 15 minutes before the shift.`, "success");
}

function seniorityCardMarkup() {
  return seniority
    .map((person) => {
      const isBiddingNow = Boolean(person.openRound);
      const isCurrentUser = personMatchesCurrentUser(person);
      return `
      <article class="seniority-card ${isBiddingNow ? "active bidding-now" : person.status === "active" ? "active" : ""}">
        <div class="seniority-card-head">
          <span>#${person.rank}</span>
        </div>
        <div class="seniority-card-name">
          <strong>${isCurrentUser ? `${person.firstName} ${person.lastName} · ${person.initials} · You` : `${person.firstName} ${person.lastName}`}</strong>
          ${isBiddingNow ? `<i class="open-now" title="Round ${person.openRound} bid window open"></i>` : ""}
        </div>
        <div class="seniority-card-meta">
          <small class="bid-as ${bidAsClass(person.bidAs)}">${person.bidAs}</small>
          ${isCurrentUser ? `<button class="secondary-action calendar-download" type="button" data-download-bid-windows="${person.rank}">Download .ics</button>` : ""}
        </div>
        <div class="round-times">
          ${person.rounds.map((time, index) => {
            const round = index + 1;
            const isComplete = person.completed.includes(round);
            const isOpen = person.openRound === round;
            return `
              <div class="round-time ${isOpen ? "open" : ""}">
                <span>R${round}</span>
                <b>${publicBidTimeLabel(time)}</b>
                <em>${isComplete ? "✓" : isOpen ? "●" : "—"}</em>
              </div>
            `;
          }).join("")}
        </div>
      </article>
    `;
    })
    .join("");
}

function seniorityTableMarkup() {
  return `
    <table class="seniority-time-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Name</th>
          <th>Initials</th>
          <th>Bid As</th>
          <th>Round 1</th>
          <th>Round 2</th>
          <th>Round 3</th>
          <th>Round 4</th>
        </tr>
      </thead>
      <tbody>
        ${seniority.map((person) => {
          const isBiddingNow = Boolean(person.openRound);
          const isCurrentUser = personMatchesCurrentUser(person);
          return `
            <tr class="${isCurrentUser ? "current-user-row" : ""} ${isBiddingNow ? "active-bidder-row" : ""}">
              <td>${person.rank}</td>
              <td>
                <div class="seniority-table-person">
                  <span class="seniority-table-name">
                    ${escapeHtml(`${person.firstName} ${person.lastName}`)}${isCurrentUser ? " · You" : ""}
                    ${isBiddingNow ? `<i class="open-now" title="Round ${person.openRound} bid window open"></i>` : ""}
                  </span>
                  ${isCurrentUser ? `<button class="secondary-action calendar-download" type="button" data-download-bid-windows="${person.rank}">Download .ics</button>` : ""}
                </div>
              </td>
              <td>${escapeHtml(person.initials)}</td>
              <td><span class="bid-as ${bidAsClass(person.bidAs)}">${escapeHtml(person.bidAs)}</span></td>
              ${person.rounds.map((round, index) => `<td class="${person.openRound === index + 1 ? "open-round-cell" : ""}">${publicBidTimeLabel(round)}</td>`).join("")}
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderSeniority() {
  const compactTarget = document.getElementById("seniority-list");
  if (compactTarget) {
    compactTarget.innerHTML = seniority
      .map((person) => {
        const isBiddingNow = Boolean(person.openRound);
        const isCurrentUser = personMatchesCurrentUser(person);
        return `
        <div class="seniority-row ${isBiddingNow ? "active bidding-now" : person.status === "active" ? "active" : ""}">
          <span>#${person.rank}</span>
          <b>${person.initials}${isCurrentUser ? " · You" : ""}</b>
          <i class="dot ${isBiddingNow ? "active" : person.status}" title="${isBiddingNow ? `Round ${person.openRound} bid window open` : ""}"></i>
        </div>
      `;
      })
      .join("");
  }

  document.querySelectorAll("[data-seniority-view]").forEach((button) => {
    const isActive = button.dataset.seniorityView === seniorityViewMode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  const cardTarget = document.getElementById("seniority-page-list");
  const tableTarget = document.getElementById("seniority-page-table");
  if (!cardTarget || !tableTarget) return;

  const isListView = seniorityViewMode === "list";
  cardTarget.hidden = isListView;
  tableTarget.hidden = !isListView;

  cardTarget.innerHTML = seniorityCardMarkup();
  tableTarget.innerHTML = isListView ? seniorityTableMarkup() : "";
}

function renderHistory() {
  const target = document.getElementById("history-timeline");
  if (!target) return;
  const isIntake = hasIntakeAccess();
  const visibleHistory = isIntake ? history : history.filter((item) => item.area === currentUser.area);

  setText("[data-history-area]", isIntake ? "All Areas" : currentUser.area);
  setText("[data-history-access]", isIntake ? `Intake: ${currentUser.initials}` : "Area Scoped");

  target.innerHTML = visibleHistory
    .map(({ area, time, actor, title, detail }) => `
      <article class="timeline-item">
        <time>${time}</time>
        <div>
          <h3>${title}</h3>
          <p>${detail}</p>
          <small class="audit-actor">Actor: ${actor}</small>
        </div>
        <span class="pill open">${area}</span>
      </article>
    `)
    .join("");
}

function alertItems() {
  const isIntake = hasIntakeAccess();
  if (isIntake) {
    const intakeAlerts = pendingIntakeItems().map((item) => ({
      category: "Intake",
      title: `${item.initials} submitted ${item.type}`,
      detail: `${item.summary} · ${item.area}`,
      action: "Review",
      page: "intake",
    }));
    const helpAlerts = helpThreads
      .filter((thread) => thread.status !== "Resolved")
      .map((thread) => ({
        category: "Help",
        title: `${thread.initials} needs help`,
        detail: `${thread.status} · ${thread.area} · updated ${thread.updatedAt}`,
        action: "Open thread",
        page: "intake",
        helpThreadId: thread.id,
      }));
    return [...intakeAlerts, ...helpAlerts];
  }

  const bidAlerts = intakeQueue
    .filter((item) => item.initials === currentUser.initials && ["Pending", "Approved", "Denied"].includes(item.status))
    .map((item) => ({
      category: item.status,
      title: `${item.type} ${item.status.toLowerCase()}`,
      detail: item.status === "Denied" ? `${item.summary} · ${item.denialReason || ""}` : item.summary,
      action: item.status === "Pending" ? "Awaiting intake" : item.status === "Denied" ? "Revise and resubmit" : "Approved",
      page: item.type === "Leave" ? "leave" : "rdos",
    }));
  const helpAlerts = helpThreads
    .filter((thread) => thread.initials === currentUser.initials && thread.status === "Answered")
    .map((thread) => ({
      category: "Help",
      title: "Intake replied",
      detail: `${thread.area} · updated ${thread.updatedAt}`,
      action: "Open conversation",
      page: "dashboard",
      helpThreadId: thread.id,
    }));
  return [...bidAlerts, ...helpAlerts];
}

function renderAlerts() {
  const items = alertItems();
  const count = items.filter((item) => item.category !== "Approved").length;
  setText("[data-alert-count]", count);
  setText("[data-intake-count]", pendingIntakeItems().length);

  if (lastAudibleAlertCount !== null && count > lastAudibleAlertCount) {
    playAlertDing();
  }
  lastAudibleAlertCount = count;

  document.querySelectorAll("[data-alert-count]").forEach((badge) => {
    badge.hidden = count === 0;
  });

  const target = document.querySelector("[data-alert-list]");
  if (!target) return;

  target.innerHTML = items.length
    ? items.map((item) => `
      <article data-page="${item.page}" ${item.helpThreadId ? `data-help-thread="${item.helpThreadId}"` : ""}>
        <span>${escapeHtml(item.category)}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.detail)}</small>
        <em>${escapeHtml(item.action)}</em>
      </article>
    `).join("")
    : '<article><span>Clear</span><strong>No active alerts</strong><small>New bid and intake notifications will appear here.</small></article>';
}

function primeAlertSound() {
  if (alertAudioContext) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  alertAudioContext = new AudioContextClass();
}

function playAlertDing() {
  if (!alertAudioContext) return;
  if (alertAudioContext.state === "suspended") {
    alertAudioContext.resume().catch(() => {});
  }
  const oscillator = alertAudioContext.createOscillator();
  const gain = alertAudioContext.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, alertAudioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(1320, alertAudioContext.currentTime + 0.08);
  gain.gain.setValueAtTime(0.0001, alertAudioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.18, alertAudioContext.currentTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, alertAudioContext.currentTime + 0.18);
  oscillator.connect(gain).connect(alertAudioContext.destination);
  oscillator.start();
  oscillator.stop(alertAudioContext.currentTime + 0.2);
}

function helpThreadFromRpc(row) {
  const messages = Array.isArray(row.messages) ? row.messages : [];
  const verified = Boolean(row.requester_verified || row.bidder_id);
  const lastMessage = messages[messages.length - 1];
  const lastMessageRole = String(lastMessage?.sender_role || "").toLowerCase();
  const status = row.status === "closed"
    ? "Resolved"
    : ["intake", "admin", "system"].includes(lastMessageRole)
      ? "Answered"
      : "Open";

  return {
    id: row.id,
    supabaseThreadId: row.id,
    requesterKey: row.bidder_id ? `bidder:${row.bidder_id}` : `anon:${row.anonymous_session_id || ""}`,
    bidderId: row.bidder_id || null,
    anonymousSessionId: row.anonymous_session_id || "",
    area: row.area_name || row.area || "Area A",
    requester: row.requester_name || (verified ? "Confirmed BUE" : "Unverified visitor"),
    initials: row.requester_initials || (verified ? "BUE" : "Guest"),
    verified,
    status,
    updatedAt: formatDateTime(new Date(row.updated_at || row.created_at || Date.now())),
    messages: messages.map((message) => {
      const role = String(message.sender_role || "").toLowerCase();
      const fromIntake = role === "intake" || role === "admin" || role === "system";
      return {
        author: message.sender_display_name || (fromIntake ? "Intake" : row.requester_initials || "Guest"),
        role: fromIntake ? "Intake" : verified ? "BUE" : "Visitor",
        time: formatDateTime(new Date(message.created_at || Date.now())),
        body: message.message || "",
        verified: fromIntake || Boolean(message.sender_verified),
      };
    }),
  };
}

function helpThreadFromLegacyRow(row) {
  const messages = row.help_messages || [];
  const requester = currentHelpRequester();
  const verified = Boolean(row.bidder_id);
  const sortedMessages = [...messages].sort((first, second) => new Date(first.created_at) - new Date(second.created_at));
  const lastMessage = sortedMessages[sortedMessages.length - 1];
  const status = row.status === "closed"
    ? "Resolved"
    : lastMessage && lastMessage.sender_id && lastMessage.sender_id !== row.bidder_id
      ? "Answered"
      : "Open";

  return {
    id: row.id,
    supabaseThreadId: row.id,
    requesterKey: row.bidder_id ? `bidder:${row.bidder_id}` : requester.key,
    bidderId: row.bidder_id || null,
    anonymousSessionId: "",
    area: requester.area,
    requester: requester.verified && row.bidder_id === requester.bidderId ? requester.name : row.subject || "Help Thread",
    initials: requester.verified && row.bidder_id === requester.bidderId ? requester.initials : "BUE",
    verified,
    status,
    updatedAt: formatDateTime(new Date(row.updated_at || row.created_at || Date.now())),
    messages: sortedMessages.map((message) => {
      const fromRequester = message.sender_id && message.sender_id === row.bidder_id;
      return {
        author: fromRequester ? requester.initials : "Intake",
        role: fromRequester ? "BUE" : "Intake",
        time: formatDateTime(new Date(message.created_at || Date.now())),
        body: message.message || "",
        verified: fromRequester,
      };
    }),
  };
}

async function loadSupabaseHelpThreads() {
  const client = supabaseClient();
  if (!client) return false;

  const requester = currentHelpRequester();
  try {
    const { data, error } = await client.rpc("live_help_threads", {
      help_bid_year: BID_YEAR,
      help_session_id: requester.sessionId || liveHelpSessionId(),
    });
    if (error) throw error;
    helpThreads = (data || []).map(helpThreadFromRpc);
    return true;
  } catch (error) {
    if (!isMissingSupabaseRoutine(error)) {
      console.warn("Live help RPC unavailable:", error.message || error);
    }
  }

  if (!requester.verified && !hasIntakeAccess()) return false;

  try {
    await ensureSupabaseBidYearId();
    let query = client
      .from("help_threads")
      .select("id,bid_year_id,bidder_id,subject,status,created_at,updated_at,help_messages(id,sender_id,message,created_at)")
      .eq("bid_year_id", supabaseState.bidYearId)
      .order("updated_at", { ascending: false });
    if (!hasIntakeAccess()) query = query.eq("bidder_id", requester.bidderId);
    const { data, error } = await query;
    if (error) throw error;
    helpThreads = (data || []).map(helpThreadFromLegacyRow);
    return true;
  } catch (error) {
    console.warn("Live help table load unavailable:", error.message || error);
    return false;
  }
}

async function saveSupabaseHelpMessage(thread, body, role) {
  const client = supabaseClient();
  if (!client) return false;

  const requester = currentHelpRequester();
  try {
    const { error } = await client.rpc("live_help_send_message", {
      help_thread_id: isUuid(thread?.supabaseThreadId) ? thread.supabaseThreadId : null,
      help_bid_year: BID_YEAR,
      help_session_id: requester.sessionId || liveHelpSessionId(),
      help_area: requester.area,
      help_message: body,
    });
    if (error) throw error;
    await loadSupabaseHelpThreads();
    return true;
  } catch (error) {
    if (!isMissingSupabaseRoutine(error)) {
      throw error;
    }
  }

  if (!requester.verified && !hasIntakeAccess()) {
    throw new Error("Supabase live help needs database/live_help.sql before unverified visitors can be saved.");
  }

  await ensureSupabaseBidYearId();
  let threadId = thread?.supabaseThreadId;
  if (!isUuid(threadId)) {
    const { data: savedThread, error: threadError } = await client
      .from("help_threads")
      .insert({
        bid_year_id: supabaseState.bidYearId,
        bidder_id: requester.bidderId,
        subject: "Live Help",
        status: "open",
      })
      .select("id")
      .single();
    if (threadError) throw threadError;
    threadId = savedThread.id;
    thread.supabaseThreadId = threadId;
    thread.id = threadId;
  }

  const { error: messageError } = await client
    .from("help_messages")
    .insert({
      thread_id: threadId,
      sender_id: role === "Intake" ? currentUser.supabaseProfileId || null : requester.bidderId,
      message: body,
    });
  if (messageError) throw messageError;

  const { error: updateError } = await client
    .from("help_threads")
    .update({ status: thread.status === "Resolved" ? "closed" : "open", updated_at: new Date().toISOString() })
    .eq("id", threadId);
  if (updateError && !isMissingSupabaseColumn(updateError)) throw updateError;
  await loadSupabaseHelpThreads();
  return true;
}

async function saveSupabaseHelpResolution(thread) {
  const client = supabaseClient();
  if (!client || !thread?.supabaseThreadId) return false;

  try {
    const { error } = await client.rpc("live_help_resolve_thread", {
      help_thread_id: thread.supabaseThreadId,
    });
    if (error) throw error;
    await loadSupabaseHelpThreads();
    return true;
  } catch (error) {
    if (!isMissingSupabaseRoutine(error)) throw error;
  }

  const { error } = await client
    .from("help_threads")
    .update({ status: "closed", updated_at: new Date().toISOString() })
    .eq("id", thread.supabaseThreadId);
  if (error) throw error;
  await loadSupabaseHelpThreads();
  return true;
}

function currentUserHelpThread() {
  const requester = currentHelpRequester();
  let thread = helpThreads.find((item) => item.requesterKey === requester.key)
    || (requester.bidderId ? helpThreads.find((item) => item.bidderId === requester.bidderId) : null)
    || (requester.sessionId ? helpThreads.find((item) => item.anonymousSessionId === requester.sessionId) : null);
  if (!thread) {
    thread = {
      id: `help-${requester.verified ? requester.initials.toLowerCase() : "anon"}-${Date.now()}`,
      requesterKey: requester.key,
      bidderId: requester.bidderId,
      anonymousSessionId: requester.sessionId,
      area: requester.area,
      requester: requester.name,
      initials: requester.initials,
      verified: requester.verified,
      status: "Open",
      updatedAt: formatDateTime(new Date()),
      messages: [],
    };
    helpThreads.unshift(thread);
  }
  return thread;
}

function activeHelpThread() {
  if (helpPanelMode === "intake" && hasIntakeAccess()) {
    return helpThreads.find((thread) => thread.id === activeHelpThreadId) || helpThreads[0] || null;
  }
  return currentUserHelpThread();
}

function setHelpStatus(message, status = "info") {
  const target = document.querySelector("[data-help-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

function openHelpPanel(threadId = null) {
  const helpMenu = document.querySelector("[data-help-menu]");
  if (!helpMenu) return;
  helpPanelMode = threadId && hasIntakeAccess() ? "intake" : "user";
  activeHelpThreadId = threadId || currentUserHelpThread().id;
  helpMenu.hidden = false;
  document.querySelector("[data-account-menu]")?.setAttribute("hidden", "");
  document.querySelector("[data-account-toggle]")?.setAttribute("aria-expanded", "false");
  document.querySelector("[data-alert-menu]")?.setAttribute("hidden", "");
  document.querySelector("[data-alert-toggle]")?.setAttribute("aria-expanded", "false");
  void loadSupabaseHelpThreads().then(() => {
    const active = activeHelpThread();
    if (active) activeHelpThreadId = active.id;
    renderHelpPanel();
    renderHelpSummary();
    renderAlerts();
  });
  renderHelpPanel();
}

function closeHelpPanel() {
  document.querySelector("[data-help-menu]")?.setAttribute("hidden", "");
  setHelpStatus("");
}

function renderHelpPanel() {
  const panel = document.querySelector("[data-help-menu]");
  if (!panel) return;
  if (panel.hidden) return;

  const thread = activeHelpThread();
  const intakeMode = helpPanelMode === "intake" && hasIntakeAccess();
  const requester = currentHelpRequester();
  const subtitle = document.querySelector("[data-help-panel-subtitle]");
  const threadList = document.querySelector("[data-help-thread-list]");
  const messageList = document.querySelector("[data-help-message-list]");
  const resolveButton = document.querySelector("[data-help-resolve]");
  panel.classList.toggle("intake-mode", intakeMode);

  if (subtitle) {
    subtitle.textContent = intakeMode
      ? "Reply to saved help conversations from the intake side."
      : requester.verified
        ? "You are chatting as a confirmed BUE. This conversation is saved."
        : "You can chat here, but you are not a confirmed user until you log in. Bids cannot be submitted from public chat.";
  }

  if (threadList) {
    threadList.hidden = !intakeMode;
    threadList.innerHTML = intakeMode
      ? helpThreads.map((item) => `
        <button class="help-thread-card ${item.id === thread?.id ? "active" : ""} ${item.verified ? "" : "unverified"}" type="button" data-help-thread-open="${item.id}">
          <span>${escapeHtml(item.status)}${item.verified ? "" : " · Unverified"}</span>
          <strong>${escapeHtml(item.requester)} · ${escapeHtml(item.initials)}</strong>
          <small>${escapeHtml(item.area)} · ${escapeHtml(item.updatedAt)}</small>
        </button>
      `).join("")
      : "";
  }

  if (messageList) {
    if (!thread) {
      messageList.innerHTML = '<div class="empty-state">No help conversations are open.</div>';
    } else {
      const warning = intakeMode && !thread.verified
        ? '<div class="help-verification-warning">This person is not verified as a logged-in BUE. Do not accept bids or account changes from this chat until they sign in.</div>'
        : !requester.verified && !intakeMode
          ? '<div class="help-verification-warning">You are chatting as an unverified visitor. Please log in before submitting any bid.</div>'
          : "";
      const messages = thread.messages.length
        ? thread.messages.map((message) => `
        <article class="help-message ${message.role.toLowerCase()}">
          <div>
            <span>${escapeHtml(message.role)} · ${escapeHtml(message.author)}</span>
            <time>${escapeHtml(message.time)}</time>
          </div>
          <p>${escapeHtml(message.body)}</p>
        </article>
      `).join("")
        : '<div class="empty-state">No messages yet. Send a question and intake will see it here.</div>';
      messageList.innerHTML = `${warning}${messages}`;
    }
  }

  if (resolveButton) {
    resolveButton.hidden = !intakeMode || !thread || thread.status === "Resolved";
  }
}

function renderHelpSummary() {
  const target = document.querySelector("[data-help-thread-summary]");
  const countTarget = document.querySelector("[data-help-thread-count]");
  const visibleThreads = hasIntakeAccess()
    ? helpThreads.filter((thread) => thread.status !== "Resolved")
    : helpThreads.filter((thread) => thread.initials === currentUser.initials && thread.status !== "Resolved");

  if (countTarget) countTarget.textContent = visibleThreads.length;
  if (!target) return;

  target.innerHTML = visibleThreads.length
    ? visibleThreads.map((thread) => `
      <button class="help-thread-card ${thread.verified ? "" : "unverified"}" type="button" data-help-thread-open="${thread.id}">
        <span>${escapeHtml(thread.status)}${thread.verified ? "" : " · Unverified"}</span>
        <strong>${escapeHtml(thread.requester)} · ${escapeHtml(thread.initials)}</strong>
        <small>${escapeHtml(thread.area)} · ${escapeHtml(thread.messages.length)} messages · ${escapeHtml(thread.updatedAt)}</small>
      </button>
    `).join("")
    : '<div class="empty-state">No open help conversations.</div>';
}

async function sendHelpMessage() {
  const input = document.querySelector("[data-help-message-input]");
  const body = input?.value.trim() || "";
  if (!body) {
    setHelpStatus("Type a message before sending.", "error");
    return;
  }

  const thread = activeHelpThread();
  if (!thread) {
    setHelpStatus("Open a help conversation before replying.", "error");
    return;
  }

  const requester = currentHelpRequester();
  const role = helpPanelMode === "intake" && hasIntakeAccess() ? "Intake" : requester.verified ? "BUE" : "Visitor";
  const sentAt = new Date();
  thread.messages.push({
    author: role === "Intake" ? currentUser.initials : requester.initials,
    role,
    time: formatDateTime(sentAt),
    body,
    verified: role === "Intake" || requester.verified,
  });
  thread.updatedAt = formatDateTime(sentAt);
  thread.verified = thread.verified || requester.verified;
  thread.status = role === "Intake" ? "Answered" : "Open";
  if (role !== "Intake") addLiveHelpClosedReply(thread, sentAt);
  input.value = "";
  activeHelpThreadId = thread.id;
  logHistory(
    thread.area,
    "Help message saved",
    `${role === "Intake" ? currentUser.initials : requester.initials} added a ${role.toLowerCase()} message to ${thread.initials}'s help thread.`,
    role === "Intake" ? currentUser.initials : requester.initials
  );
  renderApp();

  try {
    const saved = await saveSupabaseHelpMessage(thread, body, role);
    renderApp();
    setHelpStatus(
      saved
        ? role === "Intake" ? "Reply sent and saved to Supabase." : "Message sent to bidding intake and saved to Supabase."
        : "Message is visible here, but Supabase did not save it.",
      saved ? "success" : "error"
    );
  } catch (error) {
    renderApp();
    setHelpStatus(error.message || "Message is visible here, but Supabase could not save it.", "error");
  }
}

async function resolveHelpThread() {
  if (!hasIntakeAccess()) return;
  const thread = activeHelpThread();
  if (!thread) return;
  thread.status = "Resolved";
  thread.updatedAt = formatDateTime(new Date());
  logHistory(thread.area, "Help thread resolved", `${currentUser.initials} marked ${thread.initials}'s help conversation resolved.`);
  renderApp();
  try {
    await saveSupabaseHelpResolution(thread);
    renderApp();
    setHelpStatus("Thread marked resolved and saved to Supabase.", "success");
  } catch (error) {
    setHelpStatus(error.message || "Thread marked resolved here, but Supabase could not save it.", "error");
  }
}

function renderOverrideEditor(item) {
  if (!item) return "";
  const pending = item.status === "Pending";
  const approveButton = pending
    ? `<button class="primary-action" type="button" data-intake-approve="${item.id}">Approve With Changes</button>`
    : "";

  if (item.type === "RDO Line") {
    return `
      <label>Line
        <select data-override-line>
          ${rdoLinesForArea(item.area).map((line) => `<option value="${escapeHtml(line.line)}" ${line.line === item.line ? "selected" : ""}>${escapeHtml(rdoLineOptionLabel(line))}</option>`).join("")}
        </select>
      </label>
      <label>Fatigue Group
        <select data-override-group>
          ${["A", "B", "C"].map((group) => `<option ${group === item.fatigueGroup ? "selected" : ""}>${group}</option>`).join("")}
        </select>
      </label>
      <label>Flex
        <select data-override-flex>
          ${["Yes", "No"].map((value) => `<option ${value === item.flex ? "selected" : ""}>${value}</option>`).join("")}
        </select>
      </label>
      <label>AWS
        <select data-override-aws>
          ${["Yes", "No"].map((value) => `<option ${value === item.aws ? "selected" : ""}>${value}</option>`).join("")}
        </select>
      </label>
      <label>Mid
        <select data-override-mid>
          ${["Yes", "No", "BID"].map((value) => `<option ${value === item.mid ? "selected" : ""}>${value}</option>`).join("")}
        </select>
      </label>
      <div class="button-row">
        <button class="secondary-action" type="button" data-intake-save-override="${item.id}">${pending ? "Save Override" : "Save Admin Edit"}</button>
        ${approveButton}
        ${pending ? `<button class="secondary-action danger" type="button" data-intake-deny="${item.id}">Deny</button>` : ""}
      </div>
    `;
  }

  const rdoConflicts = leaveRdoConflicts(item);
  const conflicts = leaveApprovalConflicts(item);
  const rdoConflictNote = rdoConflicts.length
    ? `<p class="override-warning">RDO conflict: ${formatLeaveConflictDates(rdoConflicts)} ${rdoConflicts.length === 1 ? "is" : "are"} the bidder's RDO. This cannot be overridden; edit the range or deny the request.</p>`
    : "";
  const conflictNote = conflicts.length
    ? `<p class="override-warning">Filled dates: ${formatLeaveConflictDates(conflicts)}. Approval requires an intake override.</p>`
    : "";
  const approveLabel = rdoConflicts.length ? "Approve After Date Change" : conflicts.length ? "Approve With Override" : "Approve With Changes";

  return `
    ${rdoConflictNote}
    ${conflictNote}
    <label>Date Range <input type="text" value="${item.range}" data-override-range /></label>
    <label>Days <input type="number" value="${item.days}" data-override-days /></label>
    <label class="override-check">
      <input type="checkbox" data-override-capacity ${item.leaveCapacityOverride ? "checked" : ""} />
      Approve even though one or more dates are full
    </label>
    <div class="button-row">
      <button class="secondary-action" type="button" data-intake-save-override="${item.id}">${pending ? "Save Override" : "Save Admin Edit"}</button>
      ${pending ? `<button class="primary-action" type="button" data-intake-approve="${item.id}">${approveLabel}</button>` : ""}
      ${pending ? `<button class="secondary-action danger" type="button" data-intake-deny="${item.id}">Deny</button>` : ""}
    </div>
  `;
}

function renderDenialEditor(item) {
  if (!item) return "";
  return `
    <p class="override-warning">This will notify ${item.name} that the request needs to be corrected before it can be approved.</p>
    <label>Request
      <input type="text" value="${escapeHtml(item.summary)}" readonly />
    </label>
    <label>Denial Reason
      <textarea rows="5" data-denial-reason placeholder="Example: Sept 3 is full. Please choose different dates or contact intake for an override.">${escapeHtml(item.denialReason || "")}</textarea>
    </label>
    ${item.denialDraftError ? `<p class="intake-warning">${escapeHtml(item.denialDraftError)}</p>` : ""}
    <div class="button-row">
      <button class="secondary-action" type="button" data-denial-cancel>Cancel</button>
      <button class="secondary-action danger" type="button" data-intake-deny-confirm="${item.id}">Send Denial</button>
    </div>
  `;
}

function intakeItemRound(item) {
  const explicitRound = Number(item.round);
  if (Number.isFinite(explicitRound) && explicitRound > 0) return explicitRound;
  const roundMatch = String(item.summary || item.notes || "").match(/Round\s+(\d+)/i);
  if (roundMatch) return Number(roundMatch[1]);
  return 1;
}

function intakeSearchText(item) {
  return [
    item.type,
    item.status,
    item.name,
    item.initials,
    item.area,
    item.bidAs,
    item.seniority,
    item.line ? `Line ${item.line}` : "",
    item.range,
    item.summary,
    item.reviewNote,
    item.submittedAt,
    item.approvedAt,
    item.deniedAt,
    `Round ${intakeItemRound(item)}`,
  ].filter(Boolean).join(" ").toLowerCase();
}

function intakeItemMatchesFilters(item) {
  const query = intakeSearchQuery.trim().toLowerCase();
  if (query && !intakeSearchText(item).includes(query)) return false;
  if (intakeFilters.status !== "all" && item.status !== intakeFilters.status) return false;
  if (intakeFilters.type !== "all" && item.type !== intakeFilters.type) return false;
  if (intakeFilters.area !== "all" && item.area !== intakeFilters.area) return false;
  if (intakeFilters.round !== "all" && String(intakeItemRound(item)) !== intakeFilters.round) return false;
  return true;
}

function syncIntakeSearchControls() {
  const search = document.querySelector("[data-intake-search]");
  if (search && search.value !== intakeSearchQuery) search.value = intakeSearchQuery;

  document.querySelectorAll("[data-intake-filter]").forEach((select) => {
    const filterName = select.dataset.intakeFilter;
    if (filterName === "area") {
      const selected = intakeFilters.area;
      select.innerHTML = `
        <option value="all">All Areas</option>
        ${Object.values(AREA_NAME_BY_CODE).map((area) => `<option value="${area}">${area}</option>`).join("")}
      `;
      select.value = Object.values(AREA_NAME_BY_CODE).includes(selected) ? selected : "all";
      return;
    }
    if (filterName && Object.hasOwn(intakeFilters, filterName)) {
      select.value = intakeFilters[filterName];
    }
  });
}

function intakeRoundDetailItems(item, visibleItems) {
  if (!item) return [];
  const round = intakeItemRound(item);
  return visibleItems.filter((entry) =>
    entry.initials === item.initials &&
    intakeItemRound(entry) === round
  );
}

function renderIntakeDetailPanel(item, visibleItems) {
  const panel = document.querySelector("[data-intake-detail-panel]");
  if (!panel) return;
  if (!item) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }

  const round = intakeItemRound(item);
  const detailItems = intakeRoundDetailItems(item, visibleItems);
  panel.hidden = false;
  panel.innerHTML = `
    <div>
      <span class="intake-type">Round ${round} Bid Detail</span>
      <h3>${escapeHtml(item.name)} · ${escapeHtml(item.initials)}</h3>
      <p>${escapeHtml(item.area)} · Seniority #${escapeHtml(item.seniority)} · Bid as ${escapeHtml(item.bidAs)}</p>
    </div>
    <div class="intake-detail-list">
      ${detailItems.map((entry) => `
        <article>
          <span class="status ${entry.status.toLowerCase()}">${escapeHtml(entry.status)}</span>
          <strong>${escapeHtml(entry.type)}</strong>
          <p>${escapeHtml(entry.summary)}</p>
          <small>Submitted ${escapeHtml(entry.submittedAt || "not recorded")}</small>
        </article>
      `).join("")}
    </div>
  `;
}

function renderIntakeQueue() {
  const target = document.getElementById("intake-queue");
  if (!target) return;

  syncIntakeSearchControls();
  const canReview = hasIntakeAccess();
  const visibleItems = canReview
    ? intakeQueue
    : intakeQueue.filter((item) => item.area === currentUser.area && item.initials === currentUser.initials);
  const filteredItems = visibleItems.filter(intakeItemMatchesFilters);
  const activeDetailItem = visibleItems.find((item) => item.id === activeIntakeDetailId) || null;
  renderIntakeDetailPanel(activeDetailItem, visibleItems);

  target.innerHTML = filteredItems.length
    ? filteredItems.map((item) => `
      <article class="intake-card ${item.status.toLowerCase()} ${item.id === activeIntakeDetailId ? "selected" : ""}" tabindex="0" data-intake-card="${item.id}">
        <div>
          <span class="intake-type">${item.type}</span>
          <h3>${item.name} · ${item.initials}</h3>
          <p>${item.summary}</p>
          ${item.reviewNote ? `<p class="intake-warning">${escapeHtml(item.reviewNote)}</p>` : ""}
          ${item.type === "Leave" && item.status === "Pending" && leaveRdoConflicts(item).length ? `<p class="intake-warning">Cannot approve: ${formatLeaveConflictDates(leaveRdoConflicts(item))} ${leaveRdoConflicts(item).length === 1 ? "is" : "are"} the bidder's RDO.</p>` : ""}
          ${item.type === "Leave" && item.status === "Pending" && leaveApprovalConflicts(item).length ? `<p class="intake-warning">Requires override before approval: ${formatLeaveConflictDates(leaveApprovalConflicts(item))} is full.</p>` : ""}
          <div class="intake-meta">
            <span>${item.area}</span>
            <span>Seniority #${item.seniority}</span>
            <span>Bid as ${item.bidAs}</span>
            ${item.manualEntry ? `<span>Entered by ${item.enteredBy}</span>` : ""}
            <span>Submitted ${item.submittedAt}</span>
          </div>
        </div>
        <div class="intake-actions">
          <span class="status ${item.status.toLowerCase()}">${item.status}</span>
          ${item.status === "Pending" && canReview ? `
            <button class="primary-action small" type="button" data-intake-approve="${item.id}">Approve</button>
            <button class="secondary-action small danger" type="button" data-intake-deny="${item.id}">Deny</button>
          ` : ""}
          ${canReview && item.status !== "Denied" ? `<button class="secondary-action small" type="button" data-intake-edit="${item.id}">${item.status === "Pending" ? "Edit / Override" : "Admin Edit"}</button>` : ""}
          ${item.status === "Approved" ? `<small>Approved by ${item.approvedBy} · ${item.approvedAt}</small>` : ""}
          ${item.status === "Denied" ? `<small>Denied by ${item.deniedBy} · ${item.deniedAt}</small>` : ""}
        </div>
      </article>
    `).join("")
    : '<div class="empty-state">No intake submissions match the current search.</div>';

  const panel = document.getElementById("override-panel");
  const editor = document.querySelector("[data-override-editor]");
  const activeItem = intakeQueue.find((item) => item.id === activeOverrideId);
  if (panel && editor) {
    panel.hidden = !activeItem;
    editor.innerHTML = activeItem ? renderOverrideEditor(activeItem) : "";
  }

  const denialPanel = document.getElementById("denial-panel");
  const denialEditor = document.querySelector("[data-denial-editor]");
  const denialItem = intakeQueue.find((item) => item.id === activeDenialId);
  if (denialPanel && denialEditor) {
    denialPanel.hidden = !denialItem;
    denialEditor.innerHTML = denialItem ? renderDenialEditor(denialItem) : "";
  }
}

function setPage(pageName) {
  if (pageName === "intake" && !canUseIntakeView()) {
    pageName = "history";
  }
  if (pageName === "intake-schedule" && !canUseIntakeView()) {
    pageName = "dashboard";
  }
  if (pageName === "admin" && !hasSystemAdminAccess()) {
    pageName = "dashboard";
  }

  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active", page.dataset.pagePanel === pageName);
  });

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === pageName);
  });

  const title = document.getElementById("page-title");
  const titles = {
    dashboard: "Dashboard",
    seniority: "Seniority List",
    rdos: "RDO Line Bidding",
    leave: "Leave Bids",
    calendar: "Annual Calendar",
    intake: "Intake Queue",
    "intake-schedule": "Intake Schedule",
    admin: "Admin Console",
    history: "Bid History",
    profile: "My Profile",
  };
  title.textContent = titles[pageName] || "Dashboard";
  syncViewModeSwitcher(pageName);
  if (isMemberAppVisible() && ["dashboard", "leave", "calendar"].includes(pageName)) {
    renderCalendars({ includePublic: false });
    if (pageName === "leave" || pageName === "calendar") renderLeaveSlotBoard();
  }
}

function updateSelectedBidYear(year) {
  const isHistorical = Number(year) < BID_YEAR;
  displayedCalendarYear = Number(year);
  setSelectedDateYear(displayedCalendarYear);
  const label = document.getElementById("bid-year-label");
  const historyHeading = document.querySelector("[data-history-heading]");
  const historySummary = document.querySelector("[data-history-summary]");

  if (label) label.textContent = `${year} Annual Bidding`;

  if (historyHeading) {
    historyHeading.textContent = isHistorical ? `${year} Historical Bidding` : "Bid History";
  }

  if (historySummary) {
    historySummary.textContent = isHistorical
      ? `Review ${currentUser.area} bidding activity from ${year}. Bidding intake admins can review all areas.`
      : `${currentUser.area} submission timeline, saved drafts, changes, and verification events.`;
  }

  setPage(isHistorical ? "history" : "dashboard");
}

function biddingExportRows() {
  const rows = [
    ["Dataset", "Area", "Name", "Initials", "Bid As", "Status", "Detail", "Actor", "Timestamp"],
  ];

  intakeQueue.forEach((item) => {
    rows.push([
      item.type,
      item.area,
      item.name,
      item.initials,
      item.bidAs,
      item.status,
      item.summary,
      item.approvedBy || item.deniedBy || "",
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
      "Leave Queue",
      currentUser.area,
      userFullName(),
      currentUser.initials,
      currentUserBidAs(),
      bid.status,
      `Priority ${bid.priority} · ${bid.range} · ${bid.days} ${bid.days === 1 ? "day" : "days"}`,
      "",
      "",
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

function renderApp() {
  if (!isMemberAppVisible()) {
    renderPublicPage();
    return;
  }

  seniority = buildSeniority();
  renderCurrentUser();
  renderCalendars({ includePublic: false });
  syncLeaveBuilderInputs();
  syncRdoFilterControls();
  renderRdoLines();
  updateSelectedLine();
  renderLeaveRows("dashboard-leave-rows");
  renderLeaveRows("leave-page-rows");
  renderLeaveDraftQueue();
  renderLeaveAllowanceSummary();
  renderRoundRuleSummary();
  renderRuleEditors();
  renderLeaveDatePicker();
  renderLeaveBucketCards();
  renderLeaveSlotBoard();
  renderSeniority();
  renderIntakeSchedule();
  renderHistory();
  renderIntakeQueue();
  renderManualBidEntry();
  renderAdminConsole();
  renderHelpSummary();
  renderHelpPanel();
  renderAlerts();
  updateBidWindow();
}

function logOut() {
  supabaseClient()?.auth.signOut();
  clearSupabaseAccountState();
  selectedViewArea = null;
  document.querySelector(".app-shell")?.setAttribute("hidden", "");
  document.querySelector("[data-help-menu]")?.setAttribute("hidden", "");
  document.querySelector(".login-screen")?.removeAttribute("hidden");
  const loginToggle = document.querySelector("[data-public-login-toggle]");
  if (loginToggle) loginToggle.textContent = "Login";
  renderPublicPage();
}

document.addEventListener("click", async (event) => {
  primeAlertSound();

  if (event.target.closest("[data-add-approval-rule]")) {
    saveApprovalRuleFromInput();
    return;
  }

  const approvalRuleEdit = event.target.closest("[data-approval-rule-edit]");
  if (approvalRuleEdit) {
    editApprovalRule(Number(approvalRuleEdit.dataset.approvalRuleEdit));
    return;
  }

  const approvalRuleRemove = event.target.closest("[data-approval-rule-remove]");
  if (approvalRuleRemove) {
    removeApprovalRule(Number(approvalRuleRemove.dataset.approvalRuleRemove));
    return;
  }

  const roundRuleSave = event.target.closest("[data-save-round-rule]");
  if (roundRuleSave) {
    saveRoundRule(Number(roundRuleSave.dataset.saveRoundRule));
    return;
  }

  const bidWindowToggle = event.target.closest("[data-bid-window-enforcement-toggle]");
  if (bidWindowToggle) {
    await setBidWindowEnforcement(bidWindowToggle.checked);
    return;
  }

  const publicLoginToggle = event.target.closest("[data-public-login-toggle]");
  const publicLoginMenu = document.querySelector("[data-public-login-menu]");
  if (publicLoginToggle && publicLoginMenu) {
    if (supabaseState.authUserId) {
      showLoggedInApp();
      return;
    }
    const shouldOpen = publicLoginMenu.hidden;
    publicLoginMenu.hidden = !shouldOpen;
    publicLoginToggle.setAttribute("aria-expanded", String(shouldOpen));
    return;
  }

  if (event.target.closest("[data-public-home]")) {
    showPublicHome();
    return;
  }

  const saveProfileButton = event.target.closest("[data-save-profile]");
  if (saveProfileButton) {
    void saveProfile();
    return;
  }

  const cancelProfileButton = event.target.closest("[data-cancel-profile]");
  if (cancelProfileButton) {
    resetProfileForm();
    return;
  }

  if (event.target.closest("[data-leave-slot-close]") || event.target.matches("[data-leave-slot-modal]")) {
    closeLeaveSlotModal();
    return;
  }

  if (event.target.closest("[data-log-out]")) {
    logOut();
    return;
  }

  if (publicLoginMenu && !publicLoginMenu.hidden && !event.target.closest(".public-login")) {
    publicLoginMenu.hidden = true;
    document.querySelector("[data-public-login-toggle]")?.setAttribute("aria-expanded", "false");
  }

  const leaveRangeInput = event.target.closest("[data-leave-range-input]");
  if (leaveRangeInput) {
    syncLeavePickerMonthToRange();
    setLeavePickerOpen(true);
    return;
  }

  const leavePickerMonthButton = event.target.closest("[data-leave-picker-month]");
  if (leavePickerMonthButton) {
    const direction = leavePickerMonthButton.dataset.leavePickerMonth === "next" ? 1 : -1;
    const nextMonth = new Date(leavePickerYear, leavePickerMonthIndex + direction, 1);
    leavePickerYear = nextMonth.getFullYear();
    leavePickerMonthIndex = nextMonth.getMonth();
    renderLeaveDatePicker();
    return;
  }

  const leavePickerDateButton = event.target.closest("[data-leave-picker-date]");
  if (leavePickerDateButton) {
    const previousPreviewKeys = leaveRangePreviewActive ? leaveBuilderDateKeys() : [];
    selectedLeaveDateKey = leavePickerDateButton.dataset.leavePickerDate;
    selectLeaveBuilderDate(selectedLeaveDateKey);
    syncMemberCalendarSelection(previousPreviewKeys);
    renderLeaveDatePicker();
    return;
  }

  if (leavePickerOpen && !event.target.closest(".date-range-picker")) {
    setLeavePickerOpen(false);
  }

  const publicButton = event.target.closest("[data-public-area]");
  if (publicButton && !event.target.closest(".app-shell")) {
    renderPublicPage(publicButton.dataset.publicArea, publicButton.dataset.publicSection || "Calendar");
    return;
  }

  const accountToggle = event.target.closest("[data-account-toggle]");
  const accountMenu = document.querySelector("[data-account-menu]");
  const alertToggle = event.target.closest("[data-alert-toggle]");
  const alertMenu = document.querySelector("[data-alert-menu]");
  const helpToggle = event.target.closest("[data-help-toggle]");
  const helpMenu = document.querySelector("[data-help-menu]");

  if (helpToggle) {
    openHelpPanel();
    return;
  }

  if (event.target.closest("[data-help-close]")) {
    closeHelpPanel();
    return;
  }

  const helpThreadButton = event.target.closest("[data-help-thread-open]");
  if (helpThreadButton) {
    setPage("intake");
    openHelpPanel(helpThreadButton.dataset.helpThreadOpen);
    return;
  }

  if (event.target.closest("[data-help-send]")) {
    await sendHelpMessage();
    return;
  }

  if (event.target.closest("[data-help-resolve]")) {
    await resolveHelpThread();
    return;
  }

  if (alertToggle && alertMenu) {
    const shouldOpen = alertMenu.hidden;
    alertMenu.hidden = !shouldOpen;
    alertToggle.setAttribute("aria-expanded", String(shouldOpen));
    if (shouldOpen) {
      accountMenu?.setAttribute("hidden", "");
      document.querySelector("[data-account-toggle]")?.setAttribute("aria-expanded", "false");
      helpMenu?.setAttribute("hidden", "");
    }
    return;
  }

  if (event.target.closest("[data-alert-close]") && alertMenu) {
    alertMenu.hidden = true;
    document.querySelector("[data-alert-toggle]")?.setAttribute("aria-expanded", "false");
    return;
  }

  const alertItem = event.target.closest("[data-alert-list] article[data-page]");
  if (alertItem) {
    alertMenu?.setAttribute("hidden", "");
    document.querySelector("[data-alert-toggle]")?.setAttribute("aria-expanded", "false");
    if (alertItem.dataset.helpThread) {
      setPage(alertItem.dataset.page);
      openHelpPanel(alertItem.dataset.helpThread);
      return;
    }
    setPage(alertItem.dataset.page);
    return;
  }

  if (accountToggle && accountMenu) {
    const shouldOpen = accountMenu.hidden;
    accountMenu.hidden = !shouldOpen;
    accountToggle.setAttribute("aria-expanded", String(shouldOpen));
    if (shouldOpen) {
      alertMenu?.setAttribute("hidden", "");
      document.querySelector("[data-alert-toggle]")?.setAttribute("aria-expanded", "false");
      helpMenu?.setAttribute("hidden", "");
    }
    return;
  }

  if (event.target.closest("[data-account-close]") && accountMenu) {
    accountMenu.hidden = true;
    document.querySelector("[data-account-toggle]")?.setAttribute("aria-expanded", "false");
    return;
  }

  if (accountMenu && !accountMenu.hidden && !event.target.closest("[data-account-menu]")) {
    accountMenu.hidden = true;
    document.querySelector("[data-account-toggle]")?.setAttribute("aria-expanded", "false");
  }

  if (alertMenu && !alertMenu.hidden && !event.target.closest("[data-alert-menu]")) {
    alertMenu.hidden = true;
    document.querySelector("[data-alert-toggle]")?.setAttribute("aria-expanded", "false");
  }

  if (helpMenu && !helpMenu.hidden && !event.target.closest("[data-help-menu]")) {
    helpMenu.hidden = true;
  }

  const bidWindowDownload = event.target.closest("[data-download-bid-windows]");
  if (bidWindowDownload) {
    downloadBidWindowsIcs(bidWindowDownload.dataset.downloadBidWindows);
    return;
  }

  if (event.target.closest("[data-add-leave-request]")) {
    addOrUpdateLeaveSubmission();
    return;
  }

  if (event.target.closest("[data-preview-leave-request]")) {
    previewLeaveSubmission();
    return;
  }

  const removeDraft = event.target.closest("[data-remove-leave-draft]");
  if (removeDraft) {
    removeLeaveDraft(removeDraft.dataset.removeLeaveDraft);
    return;
  }

  if (event.target.closest("[data-submit-leave-batch]")) {
    await submitLeaveDraftBatch();
    return;
  }

  if (event.target.closest("[data-export-xlsx]")) {
    downloadBiddingXlsx();
    return;
  }

  if (event.target.closest("[data-export-google-sheet]")) {
    downloadBiddingCsv();
    return;
  }

  if (event.target.closest("[data-add-intake-schedule]")) {
    addIntakeScheduleFromForm();
    return;
  }

  if (event.target.closest("[data-admin-add-intake-schedule]")) {
    addAdminScheduleFromForm();
    return;
  }

  const scheduleViewButton = event.target.closest("[data-schedule-calendar-view]");
  if (scheduleViewButton) {
    scheduleCalendarView = scheduleViewButton.dataset.scheduleCalendarView || "month";
    renderIntakeSchedule();
    return;
  }

  const schedulePeriodButton = event.target.closest("[data-schedule-period-action]");
  if (schedulePeriodButton) {
    moveSchedulePeriod(schedulePeriodButton.dataset.schedulePeriodAction === "next" ? 1 : -1);
    return;
  }

  if (event.target.closest("[data-add-intake-team-member]")) {
    addSelectedBueToIntakeTeam();
    return;
  }

  const removeIntakeTeamMember = event.target.closest("[data-remove-intake-team-member]");
  if (removeIntakeTeamMember) {
    removeBueFromIntakeTeam(removeIntakeTeamMember.dataset.removeIntakeTeamMember);
    return;
  }

  if (event.target.closest("[data-roster-new]")) {
    resetRosterForm();
    return;
  }

  if (event.target.closest("[data-apply-bulk-roster]")) {
    applyBulkRosterChanges();
    return;
  }

  const editRosterButton = event.target.closest("[data-edit-roster-bue]");
  if (editRosterButton) {
    editRosterEntryByIndex(editRosterButton.dataset.editRosterBue);
    return;
  }

  const deleteRosterButton = event.target.closest("[data-delete-roster-bue]");
  if (deleteRosterButton) {
    deleteRosterEntryByIndex(deleteRosterButton.dataset.deleteRosterBue);
    return;
  }

  const viewModeButton = event.target.closest("[data-view-mode]");
  if (viewModeButton) {
    setPage(pageForViewMode(viewModeButton.dataset.viewMode));
    return;
  }

  const seniorityViewButton = event.target.closest("[data-seniority-view]");
  if (seniorityViewButton) {
    seniorityViewMode = seniorityViewButton.dataset.seniorityView === "list" ? "list" : "cards";
    renderSeniority();
    return;
  }

  const manualBidSubmit = event.target.closest("[data-manual-bid-submit]");
  if (manualBidSubmit) {
    const panel = manualBidSubmit.closest("[data-manual-bid-panel]");
    if (panel) submitManualBidEntry(panel);
    return;
  }

  const intakeApprove = event.target.closest("[data-intake-approve]");
  if (intakeApprove) {
    approveIntakeItem(intakeApprove.dataset.intakeApprove);
    return;
  }

  const intakeDeny = event.target.closest("[data-intake-deny]");
  if (intakeDeny) {
    activeDenialId = intakeDeny.dataset.intakeDeny;
    activeOverrideId = null;
    renderIntakeQueue();
    return;
  }

  const intakeDenyConfirm = event.target.closest("[data-intake-deny-confirm]");
  if (intakeDenyConfirm) {
    denyIntakeItem(intakeDenyConfirm.dataset.intakeDenyConfirm);
    return;
  }

  if (event.target.closest("[data-denial-cancel]")) {
    activeDenialId = null;
    renderIntakeQueue();
    return;
  }

  const intakeEdit = event.target.closest("[data-intake-edit]");
  if (intakeEdit) {
    activeOverrideId = intakeEdit.dataset.intakeEdit;
    activeDenialId = null;
    renderIntakeQueue();
    return;
  }

  const intakeSaveOverride = event.target.closest("[data-intake-save-override]");
  if (intakeSaveOverride) {
    saveIntakeOverride(intakeSaveOverride.dataset.intakeSaveOverride);
    return;
  }

  const intakeCard = event.target.closest("[data-intake-card]");
  if (intakeCard) {
    activeIntakeDetailId = intakeCard.dataset.intakeCard;
    renderIntakeQueue();
    return;
  }

  const fatigueButton = event.target.closest("[data-fatigue-group]");
  if (fatigueButton && !fatigueButton.disabled) {
    selectedFatigueGroup = fatigueButton.dataset.fatigueGroup;
    renderRdoLines();
    updateSelectedLine();
    return;
  }

  const midButton = event.target.closest("[data-mid-choice]");
  if (midButton && !midButton.disabled) {
    selectedMidPreference = midButton.dataset.midChoice;
    renderRdoLines();
    updateSelectedLine();
    return;
  }

  const awsButton = event.target.closest("[data-aws-choice]");
  if (awsButton && !awsButton.disabled) {
    selectedAwsPreference = awsButton.dataset.awsChoice;
    renderRdoLines();
    updateSelectedLine();
    return;
  }

  const fourTenButton = event.target.closest("[data-four-ten-choice]");
  if (fourTenButton && !fourTenButton.disabled) {
    updateLineFourTenStatus(fourTenButton.dataset.fourTenChoice);
    return;
  }

  const flexButton = event.target.closest("[data-flex-choice]");
  if (flexButton && !flexButton.disabled) {
    if (flexButton.dataset.flexChoice === "No" && selectedFlexPreference !== "No" && !confirmFlexNo()) {
      updateSelectedLine();
      return;
    }
    selectedFlexPreference = flexButton.dataset.flexChoice;
    renderRdoLines();
    updateSelectedLine();
    return;
  }

  const selectLineButton = event.target.closest("[data-select-line]");
  if (selectLineButton && !selectLineButton.hidden) {
    const line = rdoLinesForArea(currentUser.area).find((item) => item.line === selectedLineId);
    if (line && line.status !== "Taken") {
      void addOrUpdateRdoSubmission();
    }
    return;
  }

  const row = event.target.closest("[data-line-id]");
  if (row && !row.classList.contains("occupied-row")) {
    selectedLineId = row.dataset.lineId;
    renderRdoLines();
    updateSelectedLine();
    renderCalendars({ includePublic: false });
    renderLeaveSlotBoard();
    return;
  }

  const leaveDateButton = event.target.closest("[data-leave-date]");
  if (leaveDateButton) {
    const previousPreviewKeys = leaveRangePreviewActive ? leaveBuilderDateKeys() : [];
    selectedLeaveDateKey = leaveDateButton.dataset.leaveDate;
    const isAppCalendar = Boolean(event.target.closest(".app-shell"));
    if (isAppCalendar) {
      selectLeaveBuilderDate(selectedLeaveDateKey);
    }
    syncMemberCalendarSelection(previousPreviewKeys);
    if (!isAppCalendar) return;
    syncLeaveBuilderInputs();
    renderLeaveDatePicker();
    openLeaveSlotModal();
    return;
  }

  const calendarModeButton = event.target.closest("[data-calendar-mode]");
  if (calendarModeButton) {
    calendarMode = calendarModeButton.dataset.calendarMode;
    renderVisibleCalendars();
    return;
  }

  const calendarLayoutButton = event.target.closest("[data-calendar-layout]");
  if (calendarLayoutButton) {
    const scope = calendarLayoutButton.dataset.calendarScope;
    if (scope && Object.hasOwn(calendarLayouts, scope)) {
      calendarLayouts[scope] = calendarLayoutButton.dataset.calendarLayout === "full" ? "full" : "minimal";
      renderVisibleCalendars();
    }
    return;
  }

  const calendarYearButton = event.target.closest("[data-calendar-year-action]");
  if (calendarYearButton) {
    const action = calendarYearButton.dataset.calendarYearAction;
    if (action === "next") displayedCalendarYear += 1;
    if (action === "previous") displayedCalendarYear -= 1;
    if (action === "today") displayedCalendarYear = BID_YEAR;
    setSelectedDateYear(displayedCalendarYear);
    renderVisibleCalendars();
    if (isMemberAppVisible()) renderLeaveSlotBoard();
    return;
  }

  const trigger = event.target.closest("[data-page]");
  if (!trigger) return;
  setPage(trigger.dataset.page);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeLeaveSlotModal();
  }

  if (event.key === "Enter" && event.target.closest("[data-approval-rule-input]")) {
    event.preventDefault();
    saveApprovalRuleFromInput();
    return;
  }

  const approvalRuleHandle = event.target.closest("[data-approval-rule-drag-handle]");
  if (approvalRuleHandle && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    event.preventDefault();
    const currentIndex = Number(approvalRuleHandle.dataset.approvalRuleDragHandle);
    const nextIndex = event.key === "ArrowUp" ? currentIndex - 1 : currentIndex + 1;
    if (reorderApprovalRule(currentIndex, nextIndex)) {
      document.querySelector(`[data-approval-rule-drag-handle="${nextIndex}"]`)?.focus();
    }
    return;
  }

  if ((event.key === "Enter" || event.key === " ") && event.target.closest("[data-intake-card]")) {
    event.preventDefault();
    activeIntakeDetailId = event.target.closest("[data-intake-card]").dataset.intakeCard;
    renderIntakeQueue();
  }
});

document.querySelector("[data-bid-year-select]")?.addEventListener("change", (event) => {
  updateSelectedBidYear(event.target.value);
});

document.querySelector("[data-email-login-form]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = document.querySelector("[data-email-login-input]")?.value.trim();
  const password = document.querySelector("[data-email-password-input]")?.value || "";
  if (!email) {
    setAuthStatus("Enter your email address first.", "error");
    return;
  }
  if (!password) {
    setAuthStatus("Sending login link...");
    sendSupabaseLoginLink(email);
    return;
  }
  setAuthStatus("Signing in...");
  loginWithSupabasePassword(email, password);
});

document.querySelector("[data-send-login-link]")?.addEventListener("click", () => {
  const email = document.querySelector("[data-email-login-input]")?.value.trim();
  if (!email) {
    setAuthStatus("Enter your email address first.", "error");
    return;
  }
  setAuthStatus("Sending login link...");
  sendSupabaseLoginLink(email);
});

document.querySelector("[data-reset-login-password]")?.addEventListener("click", () => {
  const email = document.querySelector("[data-email-login-input]")?.value.trim();
  if (!email) {
    setAuthStatus("Enter your email address first.", "error");
    return;
  }
  setAuthStatus("Sending password email...");
  sendSupabasePasswordReset(email);
});

document.querySelector("[data-account-email-form]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  updateSupabaseAccountEmail();
});

document.querySelector("[data-account-password-form]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  updateSupabaseAccountPassword();
});

document.querySelector("[data-roster-form]")?.addEventListener("submit", saveRosterEntry);
document.querySelector("[data-slot-capacity-form]")?.addEventListener("submit", saveSlotCapacity);

document.addEventListener("dragstart", startRosterRowDrag);
document.addEventListener("dragstart", startApprovalRuleDrag);
document.addEventListener("dragover", moveRosterRowDuringDrag);
document.addEventListener("dragover", moveApprovalRuleDuringDrag);
document.addEventListener("drop", dropRosterRow);
document.addEventListener("drop", dropApprovalRule);
document.addEventListener("dragend", finishRosterRowDrag);
document.addEventListener("dragend", finishApprovalRuleDrag);
document.addEventListener("mousedown", startRosterColumnResize);
document.addEventListener("mousemove", resizeRosterColumn);
document.addEventListener("mouseup", finishRosterColumnResize);

document.addEventListener("input", (event) => {
  const manualPanel = event.target.closest("[data-manual-bid-panel]");
  const manualLeaveDateField = event.target.closest("[data-manual-leave-start], [data-manual-leave-end]");
  if (manualPanel && manualLeaveDateField) {
    renderManualBidPanel(manualPanel);
    return;
  }

  const intakeSearch = event.target.closest("[data-intake-search]");
  if (intakeSearch) {
    intakeSearchQuery = intakeSearch.value;
    renderIntakeQueue();
    return;
  }

  const publicFilter = event.target.closest("[data-public-rdo-filter]");
  if (publicFilter?.dataset.publicRdoFilter === "search") {
    publicRdoFilters.search = publicFilter.value;
    updatePublicRdoResults();
    return;
  }

  const filter = event.target.closest("[data-rdo-filter]");
  if (!filter || filter.dataset.rdoFilter !== "search") return;
  rdoFilters.search = filter.value;
  renderRdoLines();
});

document.addEventListener("change", async (event) => {
  const bidWindowTestRoundSelect = event.target.closest("[data-bid-window-test-round]");
  if (bidWindowTestRoundSelect) {
    await setBidWindowTestRound(bidWindowTestRoundSelect.value);
    return;
  }

  if (event.target.closest("[data-slot-capacity-area], [data-slot-capacity-start], [data-slot-capacity-end]")) {
    syncSlotCapacityForm();
    setSlotCapacityStatus("");
    return;
  }

  const intakeFilter = event.target.closest("[data-intake-filter]");
  if (intakeFilter) {
    const filterName = intakeFilter.dataset.intakeFilter;
    if (filterName && Object.hasOwn(intakeFilters, filterName)) {
      intakeFilters[filterName] = intakeFilter.value;
      renderIntakeQueue();
    }
    return;
  }

  const publicRdoFilter = event.target.closest("[data-public-rdo-filter]");
  if (publicRdoFilter) {
    const filterName = publicRdoFilter.dataset.publicRdoFilter;
    if (filterName === "open") publicRdoFilters.openOnly = publicRdoFilter.checked;
    if (filterName === "mid") publicRdoFilters.mid = publicRdoFilter.value;
    if (filterName === "fourTen") publicRdoFilters.fourTen = publicRdoFilter.value;
    updatePublicRdoResults();
    return;
  }

  const rosterAreaFilter = event.target.closest("[data-roster-area-filter]");
  if (rosterAreaFilter) {
    resetRosterForm();
    renderRosterManager();
    return;
  }

  const rosterAreaInput = event.target.closest("[data-roster-area]");
  if (rosterAreaInput) {
    syncRosterBidAsSelect(rosterAreaInput.value);
    if (!document.querySelector("[data-roster-edit-initials]")?.value) {
      const rankInput = document.querySelector("[data-roster-rank]");
      if (rankInput) rankInput.value = activeRosterEntries(rosterAreaInput.value).length + 1;
    }
    return;
  }

  const bulkRosterAreaInput = event.target.closest("[data-bulk-area]");
  if (bulkRosterAreaInput) {
    const row = bulkRosterAreaInput.closest("[data-roster-row]");
    if (row) syncBulkRosterBidAsSelect(row);
    return;
  }

  const manualPanel = event.target.closest("[data-manual-bid-panel]");
  const manualFlexField = event.target.closest("[data-manual-flex]");
  if (manualPanel && manualFlexField && manualFlexField.value === "No" && !confirmFlexNo()) {
    manualFlexField.value = "Yes";
    return;
  }

  const manualReactiveField = event.target.closest("[data-manual-bid-controller], [data-manual-bid-type], [data-manual-bid-area], [data-manual-rdo-line], [data-manual-fatigue-override], [data-manual-leave-start], [data-manual-leave-end], [data-manual-leave-round]");
  if (manualPanel && manualReactiveField) {
    renderManualBidPanel(manualPanel);
    return;
  }

  const rdoFilter = event.target.closest("[data-rdo-filter]");
  if (rdoFilter) {
    const filterName = rdoFilter.dataset.rdoFilter;
    if (filterName === "open") rdoFilters.openOnly = rdoFilter.checked;
    if (filterName === "mid") rdoFilters.mid = rdoFilter.value;
    if (filterName === "fourTen") rdoFilters.fourTen = rdoFilter.value;
    renderRdoLines();
    return;
  }

  const viewAreaSelect = event.target.closest("[data-view-area-select]");
  if (!viewAreaSelect) return;
  selectedViewArea = viewAreaSelect.value || currentUser.area;
  renderApp();
});

resetSupabaseBackedData();
renderPublicPage();
initializeSupabaseAuth().finally(() => loadSupabaseReferenceData()).then(() => {
  if (isMemberAppVisible()) {
    renderApp();
  } else {
    renderPublicPage();
  }
});
setInterval(updateBidWindow, 1000);
window.NATCA_BIDDING_READY = true;
