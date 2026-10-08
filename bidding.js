let leaveReadCache = null;

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
// BID_YEAR is the selected view; the active year is controlled independently by admins.
let BID_YEAR = 2027;
let activeBidYear = null;
let bidYearCatalog = [];
let bidYearCatalogLoaded = false;
let bidYearCatalogError = "";
const ANNUAL_LEAVE_ALLOWANCE_DAYS = 36;
const LEAVE_SLOT_HOURS_PER_DAY = 8;
const CWS_LEAVE_HOURS_PER_DAY = 10;
const DEFAULT_BUE_LEAVE_SLOT_ALLOWANCE = ANNUAL_LEAVE_ALLOWANCE_DAYS * LEAVE_SLOT_HOURS_PER_DAY;
const FATIGUE_GROUP_ROTATION = ["C", "A", "B"];
const NO_FATIGUE_PREFERENCE = "No preference";
let BID_LEAVE_YEAR_START_KEY = dateKey(BID_YEAR, 1, 10);
let FATIGUE_WEEK_ANCHOR_UTC = Date.UTC(BID_YEAR, 0, 10);
const WEEK_IN_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const ROUND_VALIDATION_DURATION_MS = 60 * 60 * 60 * 1000;
let BID_LEAVE_YEAR_END_KEY = dateKey(BID_YEAR + 1, 1, 8);
const DEFAULT_ROUND_RULES = {
  1: {
    label: "1 or 2 weeks",
    detail: "Pick individual dates within up to 2 seven-day bid weeks. Dates between selections may be skipped.",
  },
  2: {
    label: "8 or 10 days",
    detail: "Pick individual dates, up to 10 days with two RDOs or 8 days with three RDOs. Dates do not need to be continuous.",
  },
  3: {
    label: "8 or 10 days",
    detail: "Pick individual dates, up to 10 days with two RDOs or 8 days with three RDOs. Dates do not need to be continuous.",
  },
  4: {
    label: "4 or 5 days",
    detail: "Pick individual dates, up to 5 days with two RDOs or 4 days with three RDOs. Dates do not need to be continuous. Prior holiday and in-lieu bids return to the allowance.",
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
const MANUAL_AFTER_WINDOW_RULE = "After a BUE's personal window closes, intake or an administrator may enter the bid manually only while that same round remains open.";
const LATE_BID_MESSAGE = "Your scheduled bid window has closed. You must call or text the Bidding Office at 661-434-1004 to complete your bid.";
const BID_OFFICE_PHONE_DISPLAY = "661-434-1004";
const CLOSED_ROUND_RULE = "Once the round is closed, no BUE, intake user, or administrator may enter a bid for that round.";
const DEFAULT_APPROVAL_RULES = [
  "Approve applies the BUE initials automatically.",
  "Filled leave days require an explicit override before approval.",
  "Overrides require an intake user and are logged.",
  "GL bidders do not populate public floor templates.",
  "Developmentals bid against developmental slots.",
  "BUEs may not bid before the start of their Bid Window.",
  MANUAL_AFTER_WINDOW_RULE,
  CLOSED_ROUND_RULE,
  "BUEs may not make changes once they have bid and their window is closed. Changes are only allowed during the change period.",
];
const APPROVAL_RULES_STORAGE_KEY = "natca-zla-approval-rules";
const ROUND_RULES_STORAGE_KEY = "natca-zla-round-rules";
const MANUAL_INTAKE_PANEL_STORAGE_KEY = "natca-zla-manual-intake-panels";
const CALENDAR_WORKFORCE_SESSION_KEY_PREFIX = "natca-zla-calendar-workforce";

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

function clearStoredJsonValue(key) {
  try {
    window.localStorage?.removeItem(key);
  } catch (_error) {
    // A blocked browser store does not affect database-backed settings.
  }
}

const storedApprovalRules = storedJsonValue(APPROVAL_RULES_STORAGE_KEY, null);
const storedRoundRules = storedJsonValue(ROUND_RULES_STORAGE_KEY, null);
let roundRules = {
  ...DEFAULT_ROUND_RULES,
  ...normalizeRoundRules(storedRoundRules),
};
let roundRulesDatabaseComplete = false;
let approvalRules = Array.isArray(storedApprovalRules) ? storedApprovalRules : [...DEFAULT_APPROVAL_RULES];
let enforceBidWindows = true;
let bidWindowTestRound = null;
let pilotOpenRounds = [];
let selectedPilotRound = null;
let pilotRoundRefreshPending = false;
let bidWindowSettingsFallbackMessage = "";
let pilotState = {
  available: false,
  database: false,
  enabled: false,
  allowed: true,
  name: "Pilot",
  memberIds: [],
  lastResetAt: null,
};
const ghostBidderIds = new Set();
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
let senioritySearchQuery = "";
let intakeTeamCandidateQuery = "";
let selectedIntakeTeamCandidateInitials = "";
let alertAudioContext = null;
let lastAudibleAlertCount = null;
let bidWindowUiStateKey = "";
let bidWindowCountdownTargets = [];
let leaveDraftQueue = [];
let leaveRangeStartKey = dateKey(BID_YEAR, 4, 8);
let leaveRangeEndKey = dateKey(BID_YEAR, 4, 9);
let leaveRangeSelectionComplete = true;
let leaveRangePreviewActive = false;
const selectedLeaveDates = new Set();
let leavePickerOpen = false;
let leavePickerYear = BID_YEAR;
let leavePickerMonthIndex = 3;
let leaveManagementPendingId = "";
let leaveReplacementRequestId = "";
let bidChangeRows = [];
let bidChangeRound = 0;
let bidChangeWeek = null;
let bidChangeReturnFocus = null;
const prototypeEmails = [];
const INTAKE_SCHEDULE_AREA = "All Areas";
const intakeTeamInitials = new Set(["OC"]);
const intakeSchedules = [];
const intakeCalendarMarks = new Map();
const INTAKE_CALENDAR_MARK_LABELS = {
  holiday: "Holiday",
  natca_validation: "NATCA Validation",
  faa_validation: "FAA Validation",
};

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
  dev: 4,
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
const calendarWorkforceOverrides = new Map();
const calendarLayouts = {
  public: "minimal",
  dashboard: "minimal",
  leave: "minimal",
  member: "minimal",
};
let displayedCalendarYear = BID_YEAR;
let displayedCalendarMonth = new Date().getFullYear() === BID_YEAR ? new Date().getMonth() : 0;
const annualMobileCalendars = new Set();
let calendarRenderRevision = 0;
let pendingPageCalendarFrame = 0;
let publicRdoPresentation = "table";
let publicBidTimePresentation = "cards";
let scheduleCalendarView = "month";
let scheduleActiveDate = new Date();
let editingIntakeScheduleId = "";
let intakeScheduleMutationPending = false;
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
const DEFAULT_PUBLIC_AREA = "FAQ";
const DEFAULT_PUBLIC_SECTION = "Calendar";
const publicState = {
  area: DEFAULT_PUBLIC_AREA,
  section: DEFAULT_PUBLIC_SECTION,
};
const publicFaqContent = {
  entries: [],
  documents: [],
};

const ZLA_AREAS = ["Area A", "Area B", "Area C", "Area D", "Area E", "Area F", "TMU"];
const LETTERED_AREA_BID_ROLES = ["CPC", "GL", "R-DEV", "D-DEV", "NB"];
const TMU_BID_ROLES = ["TMC", "DEV", "GL", "NB"];
const ADMIN_PROFILE_BID_ROLE = "ADM";
const NON_BIDDING_EMPLOYEE_BID_ROLE = "NB";

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
  intakeSchedulesError: "",
  rdoLinesLoadState: "idle",
  placeholdersCleared: false,
  referenceDataLoaded: false,
  faqLoadState: "idle",
  bidTimesLoadState: "idle",
  leaveSlotsLoadState: "idle",
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
  return /column .* does not exist|relation .* does not exist|Could not find .* column|Could not find the table|schema cache|PGRST204|PGRST205/i.test(error?.message || "");
}

function isMissingRdoLineDisplayOrder(error) {
  return /display_order/i.test(error?.message || "") && isMissingSupabaseColumn(error);
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

const FATIGUE_GROUPS = ["A", "B", "C"];

function fatiguePoolForBidRole(bidAs, area) {
  const role = normalizeBidRoleForArea(bidAs, area);
  if (["CPC", "TMC"].includes(role)) return "CPC";
  if (["R-DEV", "D-DEV", "DEV"].includes(role)) return "DEV";
  return null;
}

function isDevelopmentalBidRole(bidAs, area) {
  return ["R-DEV", "D-DEV", "DEV"].includes(normalizeBidRoleForArea(bidAs, area));
}

function rdoPreferenceForBidRole(bidAs, area, preference) {
  return isDevelopmentalBidRole(bidAs, area) ? "No" : preference;
}

function fatiguePoolForLine(line) {
  return isCpcLine(line) ? "CPC" : "DEV";
}

function fatigueRdoSetForLine(line) {
  if (isCpcLine(line)) return String(line.pattern || "").trim().toUpperCase();

  const rdoDays = (line.week || [])
    .map((value, index) => String(value || "").trim().toUpperCase() === "RDO" ? index : null)
    .filter((index) => index !== null);
  return rdoDays.length ? rdoDays.join("/") : String(line.pattern || "").trim().toUpperCase();
}

function fatiguePoolLines(area, pool) {
  return rdoLinesForArea(area).filter((item) => fatiguePoolForLine(item) === pool);
}

function fatiguePoolRosterCount(area, pool, poolLines) {
  const rosterCount = senioritySource.filter((entry) =>
    seniorityEntryActive(entry) &&
    seniorityEntryArea(entry) === area &&
    fatiguePoolForBidRole(entry[2], area) === pool
  ).length;
  return rosterCount || poolLines.length;
}

function fatigueGroupLimit(usedByGroup, total, group) {
  const base = Math.floor(total / FATIGUE_GROUPS.length);
  const remainder = total % FATIGUE_GROUPS.length;
  if (!remainder) return base;
  if ((usedByGroup[group] || 0) > base) return base + 1;
  const claimedExtras = FATIGUE_GROUPS.filter((name) => (usedByGroup[name] || 0) > base).length;
  return base + (claimedExtras < remainder ? 1 : 0);
}

function fatigueGroupCanAccept(usedByGroup, total, group) {
  if (Object.values(usedByGroup).reduce((sum, value) => sum + value, 0) >= total) return false;
  const next = { ...usedByGroup, [group]: (usedByGroup[group] || 0) + 1 };
  const base = Math.floor(total / FATIGUE_GROUPS.length);
  const remainder = total % FATIGUE_GROUPS.length;
  const ceiling = base + (remainder ? 1 : 0);
  return next[group] <= ceiling && FATIGUE_GROUPS.filter((name) => (next[name] || 0) > base).length <= remainder;
}

function fatigueCapacityForLine(line, candidateLineId = selectedLineId, candidateGroup = selectedFatigueGroup) {
  const area = line.area || currentUser.area || "Area A";
  const pool = fatiguePoolForLine(line);
  const areaLines = fatiguePoolLines(area, pool);
  const rdoSet = fatigueRdoSetForLine(line);
  const crewLines = areaLines.filter((item) => fatigueRdoSetForLine(item) === rdoSet);
  const areaTotal = fatiguePoolRosterCount(area, pool, areaLines);
  const crewTotal = crewLines.length;
  const baseAreaUsed = Object.fromEntries(FATIGUE_GROUPS.map((group) => [group, areaLines.filter((item) =>
    item.line !== candidateLineId && item.status === "Taken" && item.group === group
  ).length]));
  const baseCrewUsed = Object.fromEntries(FATIGUE_GROUPS.map((group) => [group, crewLines.filter((item) =>
    item.line !== candidateLineId && item.status === "Taken" && item.group === group
  ).length]));
  const displayedAreaUsed = { ...baseAreaUsed };
  const displayedCrewUsed = { ...baseCrewUsed };
  if (FATIGUE_GROUPS.includes(candidateGroup)) {
    displayedAreaUsed[candidateGroup] += 1;
    displayedCrewUsed[candidateGroup] += 1;
  }

  return FATIGUE_GROUPS.map((group) => {
    const areaUsed = displayedAreaUsed[group];
    const crewUsed = displayedCrewUsed[group];

    return {
      group,
      areaUsed,
      areaMax: fatigueGroupLimit(displayedAreaUsed, areaTotal, group),
      crewUsed,
      crewMax: fatigueGroupLimit(displayedCrewUsed, crewTotal, group),
      available:
        fatigueGroupCanAccept(baseAreaUsed, areaTotal, group) &&
        fatigueGroupCanAccept(baseCrewUsed, crewTotal, group),
    };
  });
}

function isCpcLine(line) {
  return line.lineType !== "DEV" && !/DEV/i.test(line.pattern);
}

function rdoLineMatchesBidRole(line, bidAs, area) {
  if (!line) return false;
  const role = normalizeBidRoleForArea(bidAs, area);
  const cpcLine = isCpcLine(line);
  const pattern = String(line.pattern || "").trim().toUpperCase();

  // GL is the only role that may cross between CPC/TMC and developmental
  // lines. Intake verifies the selected side before approving the bid.
  if (role === "GL") return true;
  if (area === "TMU") {
    if (role === "TMC") return cpcLine;
    if (role === "DEV") return !cpcLine;
    return false;
  }
  if (role === "CPC") return cpcLine;
  if (role === "R-DEV") return !cpcLine && pattern === "R-DEV";
  if (role === "D-DEV") return !cpcLine && pattern === "D-DEV";
  return false;
}

function rdoLinesForBidder(bidAs, area) {
  return rdoLinesForArea(area).filter((line) => rdoLineMatchesBidRole(line, bidAs, area));
}

function isGroupAvailable(item) {
  return item.available;
}

function canChooseGroup(item, isSelected) {
  return item.available || isSelected;
}

function fatigueGroupIsAvailableForLine(line, group, candidateLineId = line?.line) {
  if (!line || !FATIGUE_GROUPS.includes(group)) return false;
  const capacity = fatigueCapacityForLine(line, candidateLineId, "").find((item) => item.group === group);
  return Boolean(capacity && isGroupAvailable(capacity));
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

function awsPreferenceForLine(line, preference = selectedAwsPreference) {
  return lineFourTenValue(line) === "Yes" ? "Yes" : preference;
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
  year: "numeric",
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
const bidWindowBuilderBlackoutDates = new Set(BID_OFFICE_CLOSED_DATE_KEYS);
let bidWindowBuilderPreview = null;
let bidWindowBuilderSaving = false;

function roundDateBlocksForArea(area = currentViewArea()) {
  return cachedLeaveRead(JSON.stringify(["roundDateBlocksForArea", area]), () => roundDateBlocksForAreaUncached(area));
}

function roundDateBlocksForAreaUncached(area = currentViewArea()) {
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
  if (!window?.start) return "";
  const start = bidWindowDateParts(window.start);
  return `${start.weekday}, ${start.month}/${start.day} · ${start.hour}${start.minute}`;
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

function bidWindowIcsDateTime(date) {
  const parts = bidWindowDateParts(date);
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}00`;
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
  // Missing or failed database reads must never invent a published bid time
  // or open a bidding window using the old October 1 prototype schedule.
  return databaseBidWindowForRankRound(area, rank, roundNumber);
}

function currentUserSeniorityRank(area = currentUser.area) {
  if (!bidRoleParticipatesInBidding(currentUserBidAs())) return null;
  if (area === currentUser.area && Number.isFinite(currentUser.seniorityRank)) {
    return currentUser.seniorityRank;
  }

  const currentEntryIndex = activeRosterEntries(area).findIndex(seniorityEntryMatchesCurrentUser);
  return currentEntryIndex >= 0 ? currentEntryIndex + 1 : null;
}

function currentUserBidderCount(area = currentUser.area) {
  if (!bidRoleParticipatesInBidding(currentUserBidAs())) return activeRosterEntries(area).length;
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
  return cachedLeaveRead(JSON.stringify(["roundWindows", roundNumber, area]), () => roundWindowsUncached(roundNumber, area));
}

function roundWindowsUncached(roundNumber, area = currentViewArea()) {
  return activeRosterEntries(area)
    .map((_, index) => bidWindowForRankRound(index + 1, roundNumber, area))
    .filter(Boolean);
}

function allAreaRoundWindows(roundNumber) {
  return cachedLeaveRead(JSON.stringify(["allAreaRoundWindows", roundNumber]), () => (
    ZLA_AREAS.flatMap((area) => roundWindows(roundNumber, area))
  ));
}

function globalBidRoundBounds(round) {
  const windows = allAreaRoundWindows(round);
  if (!windows.length) return null;
  return {
    round,
    startsAt: windows.reduce((earliest, window) => window.start < earliest ? window.start : earliest, windows[0].start),
    endsAt: windows.reduce((latest, window) => window.end > latest ? window.end : latest, windows[0].end),
  };
}

function globalBidRoundSchedule() {
  const roundCount = Math.max(...ZLA_AREAS.map((area) => roundDateBlocksForArea(area)[0]?.length || 0));
  return Array.from({ length: roundCount }, (_, index) => globalBidRoundBounds(index + 1)).filter(Boolean);
}

function areaBidRoundState(date = new Date(), area = currentViewArea()) {
  const schedule = globalBidRoundSchedule();
  // A round stays open through gaps and overnight until the final ZLA window ends.
  const openRound = schedule.find(({ startsAt, endsAt }) => date >= startsAt && date < endsAt);
  if (openRound) {
    const activeWindow = roundWindows(openRound.round, area)
      .find((window) => date >= window.start && date < window.end);
    return { phase: "open", ...openRound, activeRank: activeWindow?.rank ?? null };
  }

  // An earlier round's validation must never hide a newly opened round.
  for (const { round, endsAt } of schedule) {
    const validationEndsAt = new Date(endsAt.getTime() + ROUND_VALIDATION_DURATION_MS);
    if (date >= endsAt && date < validationEndsAt) {
      return { phase: "validation", round, validationEndsAt };
    }
  }
  return null;
}

function openAreaBidRound(date = new Date(), _area = currentViewArea()) {
  return globalBidRoundSchedule()
    .find(({ startsAt, endsAt }) => date >= startsAt && date < endsAt)?.round ?? null;
}

function downloadBidWindowsIcs(rank = null) {
  const requestedRank = Number(rank);
  const hasRequestedRank = rank !== null && rank !== undefined && rank !== "" && Number.isFinite(requestedRank);
  const person = hasRequestedRank
    ? seniority.find((item) => item.rank === requestedRank)
    : seniority.find(personMatchesCurrentUser) || buildSeniority(currentUser.area).find(personMatchesCurrentUser);
  if (!person) return;

  const stamp = icsTimestamp();
  const owner = person.initials || currentUser.initials;
  const events = person.rounds
    .map((roundLabel, index) => {
      const roundNumber = index + 1;
      const window = bidWindowForRankRound(person.rank, roundNumber, person.area);
      if (!window) return "";
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
        `DTSTART;TZID=America/Los_Angeles:${bidWindowIcsDateTime(window.start)}`,
        `DTEND;TZID=America/Los_Angeles:${bidWindowIcsDateTime(window.end)}`,
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

function buildIntakeScheduleIcs(schedules) {
  const stamp = icsTimestamp();
  const owner = currentUser.initials.toLowerCase();
  const events = schedules.map((schedule) => [
    "BEGIN:VEVENT",
    `UID:natca-zla-intake-${BID_YEAR}-${owner}-${schedule.id}@zlabidding.local`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsTimestamp(schedule.start)}`,
    `DTEND:${icsTimestamp(schedule.end)}`,
    "SUMMARY:NATCA ZLA Intake Shift",
    `DESCRIPTION:${escapeIcsText(`Intake assignment · ${schedule.area}`)}`,
    `LOCATION:${escapeIcsText("2555 E. Ave P, Palmdale, Ca 93550")}`,
    "END:VEVENT",
  ].join("\r\n"));

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NATCA ZLA//Intake Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(`NATCA ZLA ${BID_YEAR} Intake - ${currentUser.initials}`)}`,
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}

function downloadIntakeScheduleIcs(scheduleId = "") {
  const mySchedules = intakeSchedules.filter((schedule) => schedule.initials === currentUser?.initials);
  const schedules = scheduleId ? mySchedules.filter((schedule) => schedule.id === scheduleId) : mySchedules;
  if (!schedules.length) return;

  const blob = new Blob([buildIntakeScheduleIcs(schedules)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = scheduleId
    ? `natca-zla-${currentUser.initials.toLowerCase()}-intake-${dateKeyFromDate(schedules[0].start)}.ics`
    : `natca-zla-${currentUser.initials.toLowerCase()}-${BID_YEAR}-intake-schedule.ics`;
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

function bidRoleParticipatesInBidding(bidAs) {
  return ![ADMIN_PROFILE_BID_ROLE, NON_BIDDING_EMPLOYEE_BID_ROLE].includes(String(bidAs || "").trim().toUpperCase());
}

function bidRoleKeepsLeaveAllowance(bidAs) {
  return String(bidAs || "").trim().toUpperCase() !== ADMIN_PROFILE_BID_ROLE;
}

function seniorityEntryIsRosterPerson(entry) {
  return normalizeBidRoleForArea(entry?.[2], seniorityEntryArea(entry)) !== ADMIN_PROFILE_BID_ROLE;
}

function seniorityEntryParticipatesInBidding(entry) {
  return bidRoleParticipatesInBidding(normalizeBidRoleForArea(entry?.[2], seniorityEntryArea(entry)));
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
  return cachedLeaveRead(JSON.stringify(["activeRosterEntries", area]), () => activeRosterEntriesUncached(area));
}

function activeRosterEntriesUncached(area = null) {
  return senioritySource.filter((entry) =>
    seniorityEntryActive(entry) &&
    seniorityEntryParticipatesInBidding(entry) &&
    (!area || seniorityEntryArea(entry) === area)
  );
}

function rosterEntryToPerson(entry, rank = null, options = {}) {
  const [lastName, firstName, bidAs, initials] = entry;
  const area = seniorityEntryArea(entry);
  const normalizedBidAs = normalizeBidRoleForArea(bidAs, area);
  const participatesInBidding = bidRoleParticipatesInBidding(normalizedBidAs);
  const rosterRank = activeRosterEntries(seniorityEntryArea(entry)).findIndex((item) => item === entry) + 1;
  const resolvedRank = participatesInBidding
    ? (Number.isFinite(rank) ? rank : rosterRank || null)
    : null;
  const shouldUseFallbackInitials = options.fallbackInitials !== false;
  return {
    profileId: seniorityEntryProfileId(entry),
    rank: resolvedRank,
    firstName,
    lastName,
    bidAs: normalizedBidAs,
    initials: initials || (shouldUseFallbackInitials ? fallbackInitials(firstName, lastName) : ""),
    area,
    email: seniorityEntryEmail(entry),
    phone: seniorityEntryPhone(entry),
    active: seniorityEntryActive(entry),
    leaveSlotAllowance: seniorityEntryLeaveSlotAllowance(entry),
    profileId: seniorityEntryProfileId(entry),
    ghostBidder: ghostBidderIds.has(seniorityEntryProfileId(entry)),
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
        const window = bidWindowForRankRound(rank, roundIndex + 1, area);
        return window ? bidWindowScheduleLabel(window) : "";
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
let intakeEditorReturnFocus = null;
let intakeLeaveRemovalPendingId = null;
let memberRdoPresentation = "table";
let intakeSearchQuery = "";
let intakeSearchEmployeeInitials = "";
const intakeBidderSelection = {
  initials: "",
  profileId: "",
  record: null,
  detail: "",
  loading: false,
  error: "",
  generation: 0,
};
const intakeFilters = {
  status: "all",
  type: "all",
  area: "all",
  round: "all",
};
let intakeSort = "approved";
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

function pendingCurrentUserRdoRequest() {
  return intakeQueue.find((item) =>
    item.type === "RDO Line" &&
    item.initials === currentUser.initials &&
    item.status === "Pending"
  );
}

function pendingCurrentUserLeaveRequests(round = null) {
  return intakeQueue.filter((item) =>
    item.type === "Leave" &&
    item.initials === currentUser.initials &&
    item.status === "Pending" &&
    (round === null || leaveRoundForItem(item) === round)
  );
}

function latestCurrentUserDeniedRdoRequest() {
  const latestRequest = intakeQueue.find((item) =>
    item.type === "RDO Line" &&
    item.initials === currentUser.initials &&
    item.area === currentUser.area
  );
  return latestRequest?.status === "Denied" ? latestRequest : null;
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
  return isConfirmedHelpUser() && (!pilotState.database || (pilotState.enabled && pilotState.allowed));
}

function pilotSubmissionErrorMessage() {
  if (!pilotState.database || (pilotState.enabled && pilotState.allowed)) return "";
  return pilotState.enabled
    ? "Your account is not included in the current bidding pilot."
    : "Practice bidding is currently turned off by an administrator.";
}

function isAuthorizedPilotBidder() {
  return pilotState.database && pilotState.enabled && pilotState.allowed;
}

function normalizeBidWindowTestRound(value) {
  const round = Number(value);
  return Number.isInteger(round) && round >= 1 && round <= 6 ? round : null;
}

function activeTestBidRound() {
  return pilotState.database && isAuthorizedPilotBidder()
    ? (pilotOpenRounds.includes(selectedPilotRound) ? selectedPilotRound : pilotOpenRounds[0] || null)
    : null;
}

function bidWindowLockIsBypassed() {
  if (pilotState.database) return isAuthorizedPilotBidder() && Boolean(activeTestBidRound());
  return false;
}

function currentUserBidWindowStatus(date = new Date()) {
  const window = pilotState.database ? (activeTestBidRound() ? { round: activeTestBidRound() } : null) : currentUserBidWindow(date);
  const inHomeArea = isViewingHomeArea();
  return {
    window,
    isOpen: Boolean(!selectedBidYearErrorMessage() && inHomeArea && (bidWindowLockIsBypassed() || (window && date >= window.start && date < window.end))),
  };
}

function bidWindowErrorMessage(actionLabel = "Bids", date = new Date()) {
  const yearError = selectedBidYearErrorMessage();
  if (yearError) return yearError;
  const pilotError = pilotSubmissionErrorMessage();
  if (pilotError) return pilotError;
  if (pilotState.database && !activeTestBidRound()) return "All pilot bidding rounds are turned off by an administrator.";
  const { window, isOpen } = currentUserBidWindowStatus(date);
  if (isOpen) return "";
  if (!isViewingHomeArea()) return `${actionLabel} can only be submitted from your home area view.`;

  if (!pilotState.database) {
    const rank = currentUserSeniorityRank(currentUser.area);
    const activeRound = areaBidRoundState(date, currentUser.area)?.round;
    const activeRoundWindow = Number.isFinite(rank) && activeRound
      ? bidWindowForRankRound(rank, activeRound, currentUser.area)
      : null;
    if (activeRoundWindow && date >= activeRoundWindow.end) return LATE_BID_MESSAGE;

    if (!window) {
      const roundCount = roundDateBlocksForArea(currentUser.area)[0]?.length || 0;
      const hasClosedWindow = Number.isFinite(rank) && Array.from(
        { length: roundCount },
        (_, index) => bidWindowForRankRound(rank, index + 1, currentUser.area)
      ).some((scheduledWindow) => scheduledWindow && date >= scheduledWindow.end);
      return hasClosedWindow
        ? LATE_BID_MESSAGE
        : `${actionLabel} can only be submitted during your allotted bid window.`;
    }
  }

  if (!window) return `${actionLabel} can only be submitted during your allotted bid window.`;
  if (date < window.start) return `${actionLabel} can only be submitted during your allotted bid window. Your Round ${window.round} window opens ${formatDateTime(window.start)}.`;
  return LATE_BID_MESSAGE;
}

function leaveBidWindowErrorMessage(date = new Date()) {
  return bidWindowErrorMessage("Leave bids", date);
}

function editableLeaveRound(date = new Date()) {
  const { window, isOpen } = currentUserBidWindowStatus(date);
  return isOpen ? Number(window?.round || 0) || null : null;
}

function syncLeaveBidWindowControls(date = new Date()) {
  const windowError = leaveBidWindowErrorMessage(date);
  const disabled = Boolean(windowError);

  document.querySelectorAll("[data-add-leave-request], [data-preview-leave-request], [data-leave-range-input]").forEach((control) => {
    control.disabled = disabled;
    control.title = windowError;
  });

  const addMoreButton = document.querySelector("[data-add-more-leave-dates]");
  if (addMoreButton) {
    const constraintError = addMoreButton.dataset.constraintError || "";
    const addMoreError = windowError || constraintError;
    addMoreButton.disabled = Boolean(addMoreError) || Boolean(leaveManagementPendingId);
    addMoreButton.title = addMoreError;
  }

  if (disabled && !document.querySelector("[data-leave-date-picker]")?.hidden) {
    setLeavePickerOpen(false);
  }
}

function rdoChangeWindowErrorMessage(date = new Date()) {
  const yearError = selectedBidYearErrorMessage();
  if (yearError) return yearError;
  const hasApprovedRdo = currentUserRdoRequest()?.status === "Approved"
    || rdoLines.some((line) => line.status === "Taken" && line.cpc === currentUser.initials && lineForArea(line, currentUser.area));
  if (!hasApprovedRdo) return "";
  // Pilot rounds use the administrator's open-round controls instead of the
  // production schedule, just like initial RDO and leave submissions.
  if (pilotState.database) {
    return isViewingHomeArea() && bidWindowLockIsBypassed() && activeTestBidRound() === 1
      ? ""
      : "RDO changes are only allowed while your pilot Round 1 is open in your home area.";
  }
  const window = bidWindowForRankRound(currentUserSeniorityRank(currentUser.area), 1, currentUser.area);
  const closesAt = window ? Math.min(window.end.getTime(), window.start.getTime() + 2 * 60 * 60 * 1000) : 0;
  if (!isViewingHomeArea()
      || !window || date < window.start || date.getTime() >= closesAt) {
    return "RDO changes are only allowed during your own two-hour Round 1 bid window. Changes are closed outside that window and in Rounds 2–4.";
  }
  return "";
}

function rdoBidWindowErrorMessage(date = new Date()) {
  if (pendingCurrentUserRdoRequest()) {
    return "Your RDO bid is awaiting an intake decision. You can submit another change after it is approved or denied.";
  }
  return rdoChangeWindowErrorMessage(date) || bidWindowErrorMessage("RDO bids", date);
}

async function setBidWindowEnforcement(enabled) {
  if (!hasSystemAdminAccess()) return;
  if (!enabled) {
    enforceBidWindows = true;
    syncBidWindowTestingControls();
    window.alert("Assigned bid windows are required and cannot be disabled.");
    return;
  }
  enforceBidWindows = true;
  syncBidWindowTestingControls();

  try {
    await saveSupabaseBidWindowEnforcement(enforceBidWindows);
    bidWindowSettingsFallbackMessage = "";
  } catch (error) {
    syncBidWindowTestingControls();
    window.alert(error.message || "Bid-window testing mode could not be saved.");
    return;
  }

  logHistory(
    "All Areas",
    "Bid-window lock confirmed",
    `${currentUser.initials} confirmed that BUEs must submit inside their assigned bid windows.`
  );
  renderApp();
}

function syncBidWindowTestingControls() {
  document.querySelectorAll("[data-bid-window-enforcement-toggle]").forEach((input) => {
    input.checked = true;
    input.disabled = true;
  });

  document.querySelectorAll("[data-bid-window-test-round]").forEach((select) => {
    select.value = "";
    select.disabled = true;
  });

  setText("[data-bid-window-enforcement-state]", pilotState.database ? "Pilot Round Controls" : "Strict Windows Required");
  setText(
    "[data-bid-window-enforcement-copy]",
    pilotState.database ? "Pilot rounds are controlled below. Enabled rounds accept authorized practice bids without scheduled hours." : bidWindowSettingsFallbackMessage || "BUEs can submit only during their assigned bid window. This cannot be bypassed."
  );
}

function selectedBidYearErrorMessage() {
  if (!bidYearCatalogLoaded) return bidYearCatalogError || "Checking the active bid year. Please wait before bidding.";
  return BID_YEAR !== activeBidYear
    ? `${BID_YEAR} is view-only. Select the active bid year (${activeBidYear}) to bid or make changes.`
    : "";
}

function navigateToBidYear(year) {
  const url = new URL(window.location.href);
  url.searchParams.set("bidYear", String(year));
  // Reload to discard drafts, selections, and cached records from the previous year.
  syncNavigationUrl(url);
  window.location.assign(url.href);
}

function syncBidYearControls() {
  const options = bidYearCatalog.map((year) =>
    `<option value="${year.bid_year}">${year.bid_year}${year.is_active ? " · Current year" : " · View-only"}</option>`
  ).join("");
  document.querySelectorAll("[data-bid-year-select]").forEach((select) => {
    select.innerHTML = options;
    select.value = String(BID_YEAR);
    select.disabled = !bidYearCatalogLoaded;
  });
  const adminSelect = document.querySelector("[data-active-bid-year-select]");
  if (adminSelect) {
    const adminOptions = bidYearCatalog.filter((year) => year.status === "open").map((year) =>
      `<option value="${year.bid_year}">${year.bid_year}</option>`
    ).join("");
    if (adminSelect.innerHTML !== adminOptions || adminSelect.dataset.activeYear !== String(activeBidYear)) {
      adminSelect.innerHTML = adminOptions;
      adminSelect.value = String(activeBidYear);
      adminSelect.dataset.activeYear = String(activeBidYear);
    }
    adminSelect.disabled = !bidYearCatalogLoaded;
  }
  setText("[data-active-bid-year-label]", activeBidYear || "Checking…");
  document.querySelectorAll(".round-rule-subheader").forEach((element) => {
    element.textContent = element.textContent.replace(/\b20\d{2} accrued leave/, `${BID_YEAR} accrued leave`);
  });
  setText("#bid-year-label", `${BID_YEAR} Annual Bidding${BID_YEAR !== activeBidYear && bidYearCatalogLoaded ? " · View-only" : ""}`);
  const banner = document.querySelector("[data-bid-year-notice]");
  if (banner) {
    banner.hidden = !selectedBidYearErrorMessage();
    banner.textContent = selectedBidYearErrorMessage();
  }
  const heading = document.querySelector("[data-history-heading]");
  if (heading) heading.textContent = BID_YEAR !== activeBidYear ? `${BID_YEAR} Historical Bidding` : "Bid History";
}

async function loadBidYearCatalog(client) {
  bidYearCatalogError = "";
  try {
    let { data, error } = await readReferenceData("bid year catalog", () => client.rpc("read_bid_year_catalog"));
    if (error && (error.code === "PGRST202" || /Could not find the function.*read_bid_year_catalog/i.test(error.message || ""))) {
      // Older installations have no catalog RPC. Only a single open year is
      // unambiguous; never guess the active year in a multi-year database.
      const result = await client.from("bid_years").select("bid_year,status").limit(2);
      if (result.error) throw result.error;
      if (result.data?.length !== 1 || result.data[0].status !== "open") {
        throw new Error("The active bid year must be configured by a system administrator.");
      }
      data = [{ ...result.data[0], is_active: true }];
      error = null;
    }
    if (error) throw error;
    bidYearCatalog = data || [];
    activeBidYear = bidYearCatalog.find((year) => year.is_active)?.bid_year || null;
    if (!activeBidYear) throw new Error("No active bid year is configured. Contact a system administrator.");
    const url = new URL(window.location.href);
    const requested = url.searchParams.get("bidYear");
    const year = requested === null ? activeBidYear : Number(requested);
    if (!bidYearCatalog.some((entry) => entry.bid_year === year)) {
      throw new Error("The selected bid year is not configured. Remove the bidYear parameter to return to the current year.");
    }
    if (year !== BID_YEAR) {
      BID_YEAR = year;
      BID_LEAVE_YEAR_START_KEY = dateKey(year, 1, 10);
      BID_LEAVE_YEAR_END_KEY = dateKey(year + 1, 1, 8);
      FATIGUE_WEEK_ANCHOR_UTC = Date.UTC(year, 0, 10);
      displayedCalendarYear = year;
      displayedCalendarMonth = 0;
      leavePickerYear = year;
      leavePickerMonthIndex = 0;
      leaveRangeStartKey = BID_LEAVE_YEAR_START_KEY;
      leaveRangeEndKey = BID_LEAVE_YEAR_START_KEY;
      selectedLeaveDateKey = BID_LEAVE_YEAR_START_KEY;
    }
    // Pin this view so a later refresh cannot silently move an in-progress bid.
    if (requested === null) {
      url.searchParams.set("bidYear", String(year));
      syncNavigationUrl(url);
    }
    bidYearCatalogLoaded = true;
    syncBidYearControls();
  } catch (error) {
    bidYearCatalogLoaded = false;
    bidYearCatalogError = "The active bid year could not be verified. Profile and navigation are still available. Refresh to retry or contact a system administrator.";
    syncBidYearControls();
    throw error;
  }
}

let bidYearRefreshPending = false;
async function refreshActiveBidYear() {
  if (bidYearRefreshPending || document.visibilityState !== "visible") return;
  const client = supabaseClient();
  if (!client) return;
  bidYearRefreshPending = true;
  try {
    const previous = activeBidYear;
    const wasLoaded = bidYearCatalogLoaded;
    await loadBidYearCatalog(client);
    if (!wasLoaded || previous !== activeBidYear) renderApp();
  } catch (error) {
    console.warn(`Active bid year could not refresh: ${error.message || error}`);
  } finally {
    bidYearRefreshPending = false;
  }
}

async function saveActiveBidYear() {
  if (!hasSystemAdminAccess()) return;
  const select = document.querySelector("[data-active-bid-year-select]");
  const button = document.querySelector("[data-save-active-bid-year]");
  const status = document.querySelector("[data-active-bid-year-status]");
  if (!select || !button || !status) return;
  const requestedYear = Number(select.value);
  button.disabled = true;
  status.textContent = "Saving active bid year…";
  showActionFeedback(status.textContent, "info");
  try {
    const { error } = await supabaseClient().rpc("set_active_bid_year", { requested_bid_year: requestedYear });
    if (error) throw error;
    await loadBidYearCatalog(supabaseClient());
    renderApp();
    status.textContent = `${activeBidYear} is now the active bid year. You are still viewing ${BID_YEAR}.`;
    showActionFeedback(status.textContent, "success");
  } catch (error) {
    status.textContent = error.message || "The active bid year could not be saved.";
    showActionFeedback(status.textContent, "error");
  } finally {
    button.disabled = false;
  }
}

function applyBidYearSettings(settings) {
  if (!settings || typeof settings !== "object") return;
  enforceBidWindows = true;
  bidWindowTestRound = normalizeBidWindowTestRound(settings.test_bid_round);
  bidWindowSettingsFallbackMessage = "";
}

function applyPilotSettings(settings) {
  if (!settings || typeof settings !== "object") return;
  pilotState = {
    available: true,
    database: Boolean(settings.pilot_database),
    enabled: Boolean(settings.pilot_enabled),
    allowed: settings.pilot_allowed !== false,
    name: settings.pilot_name || "Pilot",
    memberIds: Array.isArray(settings.pilot_member_ids) ? settings.pilot_member_ids : [],
    lastResetAt: settings.pilot_last_reset_at || null,
  };
}

function pilotInitialsForMemberIds() {
  const ids = new Set(pilotState.memberIds);
  return senioritySource
    .filter((entry) => ids.has(seniorityEntryProfileId(entry)))
    .map((entry) => entry[3])
    .filter(Boolean)
    .join(", ");
}

async function refreshPilotRounds() {
  if (!pilotState.database || !supabaseState.authUserId || pilotRoundRefreshPending) return;
  pilotRoundRefreshPending = true;
  const previousState = JSON.stringify([pilotOpenRounds, pilotState]);
  try {
    const [rounds, access] = await Promise.all([
      supabaseClient().rpc("read_pilot_rounds", { requested_bid_year: BID_YEAR }),
      supabaseClient().rpc("read_pilot_settings", { requested_bid_year: BID_YEAR }),
    ]);
    const { data, error } = rounds;
    if (!access.error && access.data) applyPilotSettings(Array.isArray(access.data) ? access.data[0] : access.data);
    else pilotState.enabled = false;
    pilotOpenRounds = !error && Array.isArray(data) ? data.map(Number).filter((round) => normalizeBidWindowTestRound(round)) : [];
    if (JSON.stringify([pilotOpenRounds, pilotState]) !== previousState) {
      syncPilotControls();
      renderApp();
    }
  } catch {
    pilotOpenRounds = [];
    syncPilotControls();
    updateBidWindow(true);
  } finally {
    pilotRoundRefreshPending = false;
  }
}

async function setPilotRound(round, enabled) {
  if (!hasSystemAdminAccess() || !pilotState.database) return;
  const { data, error } = await supabaseClient().rpc("set_pilot_round", {
    requested_bid_year: BID_YEAR, requested_round: round, should_enable: enabled,
  });
  if (error) {
    window.alert(error.message || "Pilot round could not be changed.");
    syncPilotControls();
    return;
  }
  pilotOpenRounds = data || [];
  syncPilotControls();
  renderApp();
  showActionFeedback(`Pilot Round ${round} ${enabled ? "opened" : "closed"}.`, "success");
}

let pilotBidderResetPending = false;

function syncPilotControls() {
  const environment = window.NATCA_SUPABASE_CONFIG?.environment || "production";
  const banner = document.querySelector("[data-pilot-environment-banner]");
  if (banner) banner.hidden = environment !== "pilot" && !pilotState.database;

  document.querySelectorAll("[data-pilot-admin-card]").forEach((card) => {
    card.hidden = !hasSystemAdminAccess();
  });
  document.querySelectorAll("[data-pilot-round-toggle]").forEach((toggle) => {
    toggle.checked = pilotOpenRounds.includes(Number(toggle.dataset.pilotRoundToggle));
    toggle.disabled = !pilotState.database;
  });
  document.querySelectorAll("[data-pilot-round-picker]").forEach((select) => {
    select.closest("[data-pilot-round-picker-row]").hidden = !pilotState.database || !isConfirmedHelpUser();
    select.innerHTML = pilotOpenRounds.length
      ? pilotOpenRounds.map((round) => `<option value="${round}">Round ${round}</option>`).join("")
      : '<option value="">All rounds off</option>';
    select.value = String(activeTestBidRound() || "");
    select.disabled = !isAuthorizedPilotBidder() || !pilotOpenRounds.length;
  });
  const toggle = document.querySelector("[data-pilot-enabled-toggle]");
  const initials = document.querySelector("[data-pilot-member-initials]");
  if (toggle) {
    toggle.checked = pilotState.enabled;
    toggle.disabled = !pilotState.database;
  }
  if (initials) {
    if (document.activeElement !== initials) initials.value = pilotInitialsForMemberIds();
    initials.disabled = !pilotState.database;
  }
  document.querySelectorAll("[data-save-pilot-settings], [data-reset-pilot-data]").forEach((button) => {
    button.disabled = !pilotState.database;
  });
  const resetBidder = document.querySelector("[data-pilot-reset-bidder]");
  const allowedMembers = senioritySource.filter((entry) => pilotState.memberIds.includes(seniorityEntryProfileId(entry)));
  if (resetBidder) {
    const selectedId = resetBidder.value;
    resetBidder.innerHTML = allowedMembers.length
      ? allowedMembers.map((entry) => `<option value="${escapeHtml(seniorityEntryProfileId(entry))}">${escapeHtml(`${entry[3]} · ${entry[1]} ${entry[0]} · ${entry[4]}`)}</option>`).join("")
      : '<option value="">No allowed bidders — save pilot access first</option>';
    if (allowedMembers.some((entry) => seniorityEntryProfileId(entry) === selectedId)) resetBidder.value = selectedId;
  }
  document.querySelectorAll("[data-pilot-reset-bidder], [data-pilot-reset-round], [data-reset-pilot-bidder]").forEach((control) => {
    control.disabled = !hasSystemAdminAccess() || !pilotState.database || !allowedMembers.length || pilotBidderResetPending;
  });
  setText("[data-pilot-status]", !pilotState.database ? "Pilot unavailable" : pilotState.enabled ? "Pilot on" : "Pilot off");
  setText(
    "[data-pilot-status-copy]",
    !pilotState.available
      ? "Install database/pilot_mode.sql in the isolated pilot database."
      : !pilotState.database
      ? "Reset and pilot controls are locked because this database is not marked as a pilot database."
      : pilotState.enabled
      ? `${pilotState.name} is accepting practice bids from ${pilotState.memberIds.length} selected BUE${pilotState.memberIds.length === 1 ? "" : "s"}.`
      : `${pilotState.name} is paused. Selected BUEs cannot submit practice bids.`
  );
}

async function savePilotSettings() {
  if (!hasSystemAdminAccess() || !pilotState.database) return;
  const initialsInput = document.querySelector("[data-pilot-member-initials]");
  const requestedInitials = String(initialsInput?.value || "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const byInitials = new Map(senioritySource.map((entry) => [String(entry[3] || "").toUpperCase(), seniorityEntryProfileId(entry)]));
  const unknown = requestedInitials.filter((initials) => !byInitials.get(initials));
  if (unknown.length) {
    window.alert(`These initials were not found in the active roster: ${unknown.join(", ")}.`);
    return;
  }
  const client = supabaseClient();
  const { data, error } = await client.rpc("set_pilot_mode", {
    requested_bid_year: BID_YEAR,
    should_enable: Boolean(document.querySelector("[data-pilot-enabled-toggle]")?.checked),
    requested_pilot_member_ids: [...new Set(requestedInitials.map((initials) => byInitials.get(initials)))],
    requested_pilot_name: pilotState.name,
  });
  if (error) {
    window.alert(error.message || "Pilot access could not be saved.");
    return;
  }
  applyPilotSettings(Array.isArray(data) ? data[0] : data);
  syncPilotControls();
  renderApp();
  showActionFeedback("Pilot settings saved.", "success");
}

async function resetPilotData() {
  if (!hasSystemAdminAccess() || !pilotState.database) return;
  if (!window.confirm("Reset all practice bids, decisions, assignments, help messages, and audit history for this pilot year? Tester accounts and the roster will be kept.")) return;
  const { data, error } = await supabaseClient().rpc("reset_pilot_data", { requested_bid_year: BID_YEAR });
  if (error) {
    window.alert(error.message || "Pilot data could not be reset.");
    return;
  }
  applyPilotSettings(Array.isArray(data) ? data[0] : data);
  supabaseState.placeholdersCleared = false;
  await loadSupabaseReferenceData();
  renderApp();
  showActionFeedback("Pilot bids reset.", "success");
  window.alert("Practice data was reset. Tester accounts, roster, schedules, and pilot access were kept.");
}

async function resetPilotBidderRound() {
  if (!hasSystemAdminAccess() || !pilotState.database || pilotBidderResetPending) return;
  const bidderId = document.querySelector("[data-pilot-reset-bidder]")?.value;
  const round = Number(document.querySelector("[data-pilot-reset-round]")?.value);
  const entry = senioritySource.find((person) => seniorityEntryProfileId(person) === bidderId);
  if (!entry || !pilotState.memberIds.includes(bidderId) || !Number.isInteger(round) || round < 1 || round > 6) return;
  const label = `${entry[3]} (${entry[1]} ${entry[0]})`;
  const scope = round === 1 ? "the RDO bid and ALL leave rounds" : `leave bids in Round ${round} only`;
  if (!window.confirm(`Reset ${scope} for ${label}? Their bids and review decisions in this scope will be removed so they can test again. Pilot access and enabled rounds will be kept.`)) return;
  pilotBidderResetPending = true;
  syncPilotControls();
  setText("[data-pilot-reset-status]", `Resetting ${label}…`);
  let resetSaved = false;
  try {
    const { error } = await supabaseClient().rpc("reset_pilot_bidder_round", {
      requested_bid_year: BID_YEAR, requested_bidder_id: bidderId, requested_round: round,
    });
    if (error) throw error;
    resetSaved = true;
    supabaseState.placeholdersCleared = false;
    await loadSupabaseReferenceData();
    renderApp();
    showActionFeedback(`${label}: Round ${round} reset.`, "success");
    setText("[data-pilot-reset-status]", round === 1
      ? `${label}: RDO bid and all leave rounds reset. They can restart with Round 1.`
      : `${label}: Round ${round} reset. They can test that round again.`);
  } catch (error) {
    showActionFeedback(resetSaved ? "Reset saved, but the page could not refresh. Reload to see the updated bids." : error.message || "This bidder’s round could not be reset.", resetSaved ? "success" : "error");
    setText("[data-pilot-reset-status]", resetSaved
      ? "Reset saved, but the page could not refresh. Reload to see the updated bids."
      : error.message || "This bidder's round could not be reset.");
  } finally {
    pilotBidderResetPending = false;
    syncPilotControls();
  }
}

async function saveSupabaseBidWindowTestingSettings() {
  const client = supabaseClient();
  if (!client || !supabaseState.connected) {
    throw new Error("Bid-window settings could not reach the database. Check the connection and try again.");
  }

  const { error } = await client.rpc("set_bid_window_testing_settings", {
    requested_bid_year: BID_YEAR,
    should_enforce: true,
    test_round: null,
  });

  if (error) {
    if (isMissingSupabaseRoutine(error)) {
      throw new Error("Shared bid-window settings are not installed in Supabase.");
    }
    throw error;
  }

  return true;
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
  const developmentalBidder = isDevelopmentalBidRole(currentUserBidAs(), currentUser.area);
  if (!line || line.status === "Taken") return;
  if (!rdoLineMatchesBidRole(line, currentUserBidAs(), currentUser.area)) {
    alert(`Line ${line.line} is not eligible for your ${currentUserBidAs()} bid role.`);
    renderRdoLines();
    updateSelectedLine();
    return;
  }
  if (!selectedFatigueGroup) {
    alert("Choose a fatigue group or No preference before submitting this RDO bid.");
    return;
  }
  if (
    selectedFatigueGroup !== NO_FATIGUE_PREFERENCE &&
    !fatigueGroupIsAvailableForLine(line, selectedFatigueGroup)
  ) {
    alert(`Fatigue Group ${selectedFatigueGroup} is now full for this area or RDO set. Choose another group.`);
    updateSelectedLine();
    return;
  }
  if (!developmentalBidder && !isForcedMid(line) && !selectedMidPreference) {
    alert("Choose Yes or No for Mid before submitting this RDO bid.");
    return;
  }
  const awsPreference = rdoPreferenceForBidRole(
    currentUserBidAs(),
    currentUser.area,
    awsPreferenceForLine(line)
  );
  if (!awsPreference) {
    alert("Choose Yes or No for AWS before submitting this RDO bid.");
    return;
  }
  if (!selectedFlexPreference) {
    alert("Choose Yes or No for Flex before submitting this RDO bid.");
    return;
  }

  const existing = currentUserRdoRequest();
  const round = currentRoundNumber();
  const ghostBid = Boolean(currentUser.ghostBidder);
  const requestedFatigueGroup = selectedFatigueGroup === NO_FATIGUE_PREFERENCE ? "" : selectedFatigueGroup;
  const fatigueGroupSummary = requestedFatigueGroup || NO_FATIGUE_PREFERENCE;
  const request = {
    id: existing?.id || `rdo-${currentUser.initials.toLowerCase()}-${Date.now()}`,
    type: "RDO Line",
    ghostBid,
    area: currentUser.area,
    name: userFullName(),
    initials: currentUser.initials,
    bidAs: currentUserBidAs(),
    seniority: currentUser.seniorityRank,
    status: "Pending",
    round,
    submittedAt: formatDateTime(new Date()),
    submittedBy: currentUser.initials,
    submittedByRole: submissionRoleLabel(currentUser.role),
    approvedBy: "",
    approvedAt: "",
    line: line.line,
    fatigueGroup: requestedFatigueGroup,
    flex: selectedFlexPreference,
    aws: awsPreference,
    mid: rdoPreferenceForBidRole(currentUserBidAs(), currentUser.area, selectedMidValue(line)),
    summary: `Round ${round} · ${ghostBid ? "Ghost Line" : "Line"} ${line.line} · Group ${fatigueGroupSummary} · Flex ${selectedFlexPreference} · AWS ${awsPreference} · Mid ${rdoPreferenceForBidRole(currentUserBidAs(), currentUser.area, selectedMidValue(line))}`,
  };

  const isChange = Boolean(existing) && rdoBidValuesChanged(existing, request);
  if (isChange) {
    request.isChange = true;
    request.changeSource = "bidder";
    request.originalBid = existing.originalBid || rdoBidSnapshotFromIntakeItem(existing);
  }
  if (isChange && pendingCurrentUserLeaveRequests(1).length) {
    alert("Your Round 1 leave dates are awaiting an intake decision. Wait until they are approved or denied before changing your RDO bid.");
    return;
  }
  if (isChange && !window.confirm(
    rdoBidChangeConfirmation(currentUser, request, request.originalBid) +
    "\n\nAll approved Round 1 leave dates will expire, and you will have to bid your two weeks of leave again. Pending RDO or leave requests must be approved or denied before you can make this change."
  )) return;

  try {
    const saved = await saveSupabaseRdoRequest(request);
    if (saved) await loadSupabaseReferenceData();
  } catch (error) {
    alert(error.message || "Your RDO request could not be saved. Please try again before submitting leave.");
    return;
  }

  if (!supabaseState.connected) {
    if (isChange) {
      [...intakeQueue, ...leaveBids].forEach((item) => {
        if (item.type === "RDO Line") return;
        if ((!item.initials || item.initials === currentUser.initials)
          && leaveRoundForItem(item) === 1
          && item.status === "Approved") item.status = "Expired";
      });
    }
    if (isChange) {
      rdoLines.forEach((entry) => {
        if (lineForArea(entry, currentUser.area) && entry.cpc === currentUser.initials) {
          entry.cpc = "";
          entry.status = "Open";
        }
      });
    }
    if (existing) Object.assign(existing, request);
    else intakeQueue.unshift(request);
  }

  logHistory(currentUser.area, "RDO bid submitted", `${currentUser.initials} submitted ${request.summary}. Intake approval is still required before the line is populated.`);
  renderApp();
  showActionFeedback("RDO bid submitted and sent to intake review.", "success");
}

function controllerName(person) {
  return `${person.firstName} ${person.lastName}`;
}

function manualBidControllerMatches(person, query) {
  if (!query) return true;
  const searchable = `${person.rank} ${person.firstName} ${person.lastName} ${person.initials} ${person.area} ${person.bidAs}`.toLowerCase();
  return searchable.includes(query.toLowerCase());
}

function manualBidControllerRoster() {
  return bueRoster().filter((person) => bidRoleParticipatesInBidding(person.bidAs));
}

function manualBidControllerOptions(selectedInitials, query = "") {
  const roster = manualBidControllerRoster();
  const matches = roster.filter((person) => manualBidControllerMatches(person, query));
  const selectedPerson = roster.find((person) => person.initials === selectedInitials);
  const visiblePeople = selectedPerson && !matches.includes(selectedPerson)
    ? [selectedPerson, ...matches]
    : matches;
  return visiblePeople.map((person) => {
    const selected = person.initials === selectedInitials ? " selected" : "";
    const label = `#${person.rank} ${person.firstName} ${person.lastName} · ${person.initials} · ${person.area} · ${person.bidAs}${person.ghostBidder ? " · Ghost Bidder" : ""}`;
    return `<option value="${escapeHtml(person.initials)}"${selected}>${escapeHtml(label)}</option>`;
  }).join("");
}

function manualBidControllerResults(query) {
  if (!query) return "";
  return manualBidControllerRoster()
    .filter((person) => manualBidControllerMatches(person, query))
    .map((person) => {
      const name = controllerName(person);
      const details = `#${person.rank} · ${person.initials} · ${person.area}`;
      return `
        <button type="button" role="option" data-manual-controller-result="${escapeHtml(person.initials)}">
          <strong>${escapeHtml(name)}</strong>
          <span>${escapeHtml(details)}</span>
        </button>
      `;
    }).join("");
}

function manualBidAreaOptions(selectedArea) {
  return Object.values(AREA_NAME_BY_CODE).map((area) => {
    const selected = area === selectedArea ? " selected" : "";
    return `<option value="${area}"${selected}>${area}</option>`;
  }).join("");
}

function manualBidSelectedPerson(selectedInitials) {
  const roster = manualBidControllerRoster();
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

let manualLeaveControllerInitials = "";

function selectManualLeaveController(initials) {
  manualLeaveControllerInitials = initials;
  const leavePanel = document.querySelector(".manual-leave-request-card[data-manual-bid-panel]");
  if (!leavePanel) return;
  const leaveController = leavePanel.querySelector("[data-manual-bid-controller]");
  if (leaveController) leaveController.value = initials;
  const leaveSearch = leavePanel.querySelector("[data-manual-controller-search]");
  if (leaveSearch) leaveSearch.value = "";
  renderManualBidPanel(leavePanel);
}

let actionFeedbackTimer;
const pendingUiActions = new Set();

function showActionFeedback(message, status = "info") {
  if (!message) return;
  let notice = document.querySelector("[data-action-feedback]");
  if (!notice) {
    notice = document.createElement("div");
    notice.dataset.actionFeedback = "";
    notice.className = "action-feedback";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    notice.setAttribute("aria-atomic", "true");
    document.body.appendChild(notice);
  }
  clearTimeout(actionFeedbackTimer);
  notice.textContent = message;
  notice.dataset.status = status;
  notice.hidden = false;
  if (status !== "info" || !pendingUiActions.size) actionFeedbackTimer = setTimeout(() => { notice.hidden = true; }, status === "error" ? 12000 : 7000);
}

async function runUiAction(key, button, label, action) {
  if (pendingUiActions.has(key)) return;
  pendingUiActions.add(key);
  const originalLabel = button?.tagName === "BUTTON" ? button.textContent : null;
  const wasDisabled = button?.disabled;
  if (button) {
    button.disabled = true;
    if (originalLabel !== null) button.textContent = label;
    button.setAttribute("aria-busy", "true");
  }
  showActionFeedback(label);
  try {
    // Let the browser paint feedback before expensive synchronous rendering.
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    await action();
  } catch (error) {
    showActionFeedback(error.message || "The action could not finish. Please try again.", "error");
  } finally {
    pendingUiActions.delete(key);
    if (button) {
      if (originalLabel !== null && button.textContent === label) button.textContent = originalLabel;
      button.disabled = wasDisabled || button.dataset?.awaitingRdoDecision === "true";
      button.removeAttribute("aria-busy");
    }
    const notice = document.querySelector("[data-action-feedback]");
    if (notice?.dataset.status === "info") {
      if (notice.textContent === label) notice.hidden = true;
      actionFeedbackTimer = setTimeout(() => { notice.hidden = true; }, 7000);
    }
  }
}

function bindUiActionForm(selector, key, label, action) {
  document.querySelector(selector)?.addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter || form.querySelector("button[type='submit']");
    void runUiAction(key, button, label, () => action({
      currentTarget: form,
      target: form,
      preventDefault() {},
    }));
  });
}

function setManualBidStatus(panel, message, status = "info") {
  showActionFeedback(message, status);
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

function defaultManualLeaveEndDate(panel) {
  const startInput = panel.querySelector("[data-manual-leave-start]");
  const endInput = panel.querySelector("[data-manual-leave-end]");
  if (startInput?.value && endInput) endInput.value = startInput.value;
}

function manualLeaveRangeValue(panel) {
  return panel.querySelector("[data-manual-leave-range]")?.value.trim() || manualLeaveRangeFromDateInputs(panel);
}

function manualFatigueGroupIsAvailable(line, group, allowOverride = false) {
  if (!line) return false;
  if (!group) return true;
  if (allowOverride) return true;
  const capacity = fatigueCapacityForLine(line, null, "").find((item) => item.group === group);
  return Boolean(capacity && isGroupAvailable(capacity));
}

function manualFatigueGroupOptions(line, selectedGroup, allowOverride = false) {
  if (!line) return "";

  const groupOptions = fatigueCapacityForLine(line, null, "").map((item) => {
    const isSelected = item.group === selectedGroup;
    const isAvailable = isGroupAvailable(item);
    const isSelectable = isAvailable || allowOverride;
    const label = `Group ${item.group}`;
    const capacity = `Area ${item.areaUsed}/${item.areaMax}, RDO set ${item.crewUsed}/${item.crewMax}`;
    const suffix = isAvailable ? "" : allowOverride ? " - Full, override" : " - Full";
    return `<option class="${isAvailable ? "" : "manual-fatigue-group-full"}" value="${item.group}"${isSelected ? " selected" : ""}${isSelectable ? "" : " disabled"}>${label}${suffix} (${capacity})</option>`;
  }).join("");
  return `<option value=""${selectedGroup ? "" : " selected"}>No preference — assign later</option>${groupOptions}`;
}

function fatigueGroupPreferenceLabel(group) {
  return group ? `Group ${group}` : "No preference";
}

function rdoBidPreferenceLabel(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  const normalized = String(value ?? "").trim();
  if (normalized.toLowerCase() === "true") return "Yes";
  if (normalized.toLowerCase() === "false") return "No";
  if (normalized.toUpperCase() === "BID") return "Bid Line";
  return normalized || "—";
}

function rdoBidSnapshotFromIntakeItem(item) {
  if (!item) return null;
  return {
    submissionId: item.supabaseSubmissionId || "",
    line: item.line || "",
    fatigueGroup: item.fatigueGroup || "",
    flex: item.flex,
    aws: item.aws,
    mid: item.mid,
    round: intakeItemRound(item),
    status: String(item.status || "").toLowerCase(),
    submittedAt: item.submittedAt || "",
    reviewedAt: item.approvedAt || "",
  };
}

function rdoBidValuesChanged(original, requested) {
  if (!original || !requested) return false;
  return String(original.line ?? "") !== String(requested.line ?? "")
    || String(original.fatigueGroup ?? "") !== String(requested.fatigueGroup ?? "")
    || rdoBidPreferenceLabel(original.flex) !== rdoBidPreferenceLabel(requested.flex)
    || rdoBidPreferenceLabel(original.aws) !== rdoBidPreferenceLabel(requested.aws)
    || rdoBidPreferenceLabel(original.mid) !== rdoBidPreferenceLabel(requested.mid);
}

function rdoBidSnapshotSummary(snapshot) {
  if (!snapshot) return "Original bid unavailable";
  const line = snapshot.line || snapshot.rdo_line_code || "—";
  const group = snapshot.fatigueGroup ?? snapshot.fatigue_group ?? "";
  return `Line ${line} · ${fatigueGroupPreferenceLabel(group)} · Flex ${rdoBidPreferenceLabel(snapshot.flex)} · AWS ${rdoBidPreferenceLabel(snapshot.aws)} · Mid ${rdoBidPreferenceLabel(snapshot.mid)}`;
}

function rdoBidChangeConfirmation(person, requested, originalBid) {
  const name = controllerName(person).trim() || person.initials || "this employee";
  return `Confirm RDO bid change for ${name} · ${person.initials} · ${person.area}.\n\nOriginal: ${rdoBidSnapshotSummary(originalBid)}\nRequested: ${rdoBidSnapshotSummary(requested)}`;
}

function rdoLineOptionLabel(line) {
  const status = line.status === "Taken"
    ? ` · ${line.cpc || "Taken"} · unavailable`
    : " · Open";
  return `Line ${line.line} · ${line.pattern}${status}`;
}

function renderManualBidPanel(panel) {
  return withLeaveReadCache(() => renderManualBidPanelWithCache(panel));
}

function updateManualLeaveDays(panel) {
  return withLeaveReadCache(() => {
    const daysInput = panel.querySelector("[data-manual-leave-days]");
    if (!daysInput?.hasAttribute("data-manual-leave-days-auto")) return;
    const range = manualLeaveRangeFromDateInputs(panel);
    const initials = panel.querySelector("[data-manual-bid-controller]")?.value || currentUser.initials;
    const round = Number(panel.querySelector("[data-manual-leave-round]")?.value || currentRoundNumber());
    daysInput.value = range ? chargeableLeaveDatesForInitials(range, initials, round).length : "";
  });
}

function renderManualBidPanelWithCache(panel) {
  const leavePanel = panel.classList.contains("manual-leave-request-card");
  const values = {
    controller: panel.querySelector("[data-manual-bid-controller]")?.value || (leavePanel && manualLeaveControllerInitials) || currentUser.initials,
    type: panel.querySelector("[data-manual-bid-type]")?.value || "RDO Line",
    area: panel.querySelector("[data-manual-bid-area]")?.value || currentViewArea(),
    line: panel.querySelector("[data-manual-rdo-line]")?.value || selectedLineId,
    fatigueGroup: panel.querySelector("[data-manual-fatigue-group]")
      ? panel.querySelector("[data-manual-fatigue-group]").value
      : selectedFatigueGroup || "A",
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
  const openRound = openAreaBidRound(new Date(), lockedArea);
  const submitButton = panel.querySelector("[data-manual-bid-submit]");
  if (submitButton) {
    submitButton.disabled = !openRound;
    submitButton.title = openRound ? `Enter a Round ${openRound} bid.` : "No bidding round is currently open across ZLA.";
  }

  const controllerSearch = panel.querySelector("[data-manual-controller-search]");
  const controllerQuery = controllerSearch?.value.trim() || "";
  const controllerSelect = panel.querySelector("[data-manual-bid-controller]");
  if (controllerSelect) {
    const roster = manualBidControllerRoster();
    const matchCount = roster.filter((person) => manualBidControllerMatches(person, controllerQuery)).length;
    controllerSelect.innerHTML = manualBidControllerOptions(values.controller, controllerQuery);
    controllerSelect.value = roster.some((person) => person.initials === values.controller) ? values.controller : roster[0]?.initials || "";
    const searchResults = panel.querySelector("[data-manual-controller-results]");
    if (searchResults) {
      searchResults.innerHTML = manualBidControllerResults(controllerQuery);
      searchResults.hidden = !controllerQuery || matchCount === 0;
    }
    const searchStatus = panel.querySelector("[data-manual-controller-search-status]");
    if (searchStatus) {
      searchStatus.textContent = controllerQuery
        ? `${matchCount} ${matchCount === 1 ? "match" : "matches"}${matchCount === 0 ? "; current selection remains available" : "; select a controller below"}`
        : `${roster.length} active controllers`;
    }
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

  if (!isLeave) {
    const lineSelect = panel.querySelector("[data-manual-rdo-line]");
    const area = areaSelect?.value || lockedArea;
    const areaLines = rdoLinesForBidder(selectedPerson.bidAs, area);
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
    const developmentalBidder = isDevelopmentalBidRole(selectedPerson.bidAs, area);
    const fatigueSelect = panel.querySelector("[data-manual-fatigue-group]");
    if (fatigueSelect) {
      const requestedGroup = ["", "A", "B", "C"].includes(values.fatigueGroup) ? values.fatigueGroup : "A";
      const availableGroups = selectedLine
        ? fatigueCapacityForLine(selectedLine, null, "")
          .filter((item) => values.fatigueOverride || isGroupAvailable(item))
          .map((item) => item.group)
        : [];
      const resolvedGroup = requestedGroup === "" ? "" : availableGroups.includes(requestedGroup) ? requestedGroup : availableGroups[0] || "";
      fatigueSelect.innerHTML = manualFatigueGroupOptions(selectedLine, resolvedGroup, values.fatigueOverride);
      fatigueSelect.value = resolvedGroup;
      fatigueSelect.disabled = !selectedLine;
      fatigueSelect.title = selectedLine ? "Choose a group or leave the preference unassigned." : "Choose an RDO line first.";
      const fatigueOverrideInput = panel.querySelector("[data-manual-fatigue-override]");
      if (fatigueOverrideInput) {
        const canOverride = ["intake", "admin"].includes(currentUser?.role);
        fatigueOverrideInput.checked = canOverride && resolvedGroup ? values.fatigueOverride : false;
        fatigueOverrideInput.disabled = !canOverride || !resolvedGroup;
        fatigueOverrideInput.title = resolvedGroup ? "" : "An override only applies to a selected fatigue group.";
      }
    }
    const midSelect = panel.querySelector("[data-manual-mid]");
    if (midSelect) {
      if (developmentalBidder) {
        midSelect.innerHTML = '<option value="No">No — DEV does not work Mid</option>';
        midSelect.value = "No";
        midSelect.disabled = true;
      } else if (selectedLine && isMidLineByDesign(selectedLine)) {
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
    if (awsSelect) {
      if (developmentalBidder) {
        awsSelect.innerHTML = '<option value="No">No — DEV does not work AWS</option>';
        awsSelect.value = "No";
        awsSelect.disabled = true;
      } else {
        awsSelect.innerHTML = '<option value="Yes">Yes</option><option value="No">No</option>';
        awsSelect.value = values.aws === "Yes" ? "Yes" : "No";
        awsSelect.disabled = false;
      }
    }

  }

  const rangeInput = panel.querySelector("[data-manual-leave-range]");
  if (rangeInput) rangeInput.value = values.range;
  const startInput = panel.querySelector("[data-manual-leave-start]");
  if (startInput) startInput.value = values.leaveStart;
  const endInput = panel.querySelector("[data-manual-leave-end]");
  if (endInput) endInput.value = values.leaveEnd;
  const daysInput = panel.querySelector("[data-manual-leave-days]");
  const roundSelect = panel.querySelector("[data-manual-leave-round]");
  if (roundSelect) {
    Array.from(roundSelect.options).forEach((option) => {
      option.disabled = !openRound || Number(option.value) !== openRound;
    });
    roundSelect.value = openRound ? String(openRound) : "";
    roundSelect.disabled = !openRound;
    roundSelect.title = openRound ? `Only Round ${openRound} is currently open.` : "No bidding round is currently open across ZLA.";
  }
  if (daysInput) {
    const resolvedRound = Number(roundSelect?.value || values.round || currentRoundNumber());
    const dateInputRange = manualLeaveRangeFromDateInputs(panel);
    const autoDays = dateInputRange ? chargeableLeaveDatesForInitials(dateInputRange, controllerSelect?.value || values.controller, resolvedRound).length : "";
    daysInput.value = daysInput.hasAttribute("data-manual-leave-days-auto") ? autoDays : values.days;
  }
  const notesInput = panel.querySelector("[data-manual-leave-notes]");
  if (notesInput) notesInput.value = values.notes;
  renderManualLeaveBatch(panel);
}

function renderManualBidEntry() {
  const userId = supabaseState.authUserId || currentUser?.supabaseProfileId;
  if (userId) {
    const preferenceKey = `${MANUAL_INTAKE_PANEL_STORAGE_KEY}:${userId}`;
    const preferences = storedJsonValue(preferenceKey, {});
    document.querySelectorAll("[data-manual-intake-toggle]").forEach((button) => {
      if (button.dataset.preferenceKey === preferenceKey) return;
      const panelName = button.dataset.manualIntakeToggle;
      const open = preferences?.[panelName] !== false;
      button.dataset.preferenceKey = preferenceKey;
      button.setAttribute("aria-expanded", String(open));
      document.querySelector(`[data-manual-intake-content="${panelName}"]`).hidden = !open;
    });
  }
  document.querySelectorAll("[data-manual-bid-panel]").forEach(renderManualBidPanel);
}

async function submitManualRdoBid(panel, person, area) {
  const openRound = openAreaBidRound(new Date(), area);
  if (!openRound) {
    setManualBidStatus(panel, "No bidding round is currently open across ZLA.", "error");
    return;
  }
  const lineId = panel.querySelector("[data-manual-rdo-line]")?.value;
  const line = rdoLinesForArea(area).find((item) => item.line === lineId);
  if (!line) {
    setManualBidStatus(panel, "Choose an RDO line before adding this bid.", "error");
    return;
  }
  if (!rdoLineMatchesBidRole(line, person.bidAs, area)) {
    setManualBidStatus(panel, `Line ${line.line} is not eligible for ${person.initials}'s ${person.bidAs} bid role.`, "error");
    renderManualBidPanel(panel);
    return;
  }
  if (line.status === "Taken") {
    setManualBidStatus(panel, `Line ${line.line} has already been bid and cannot be selected here.`, "error");
    return;
  }

  const fatigueGroup = panel.querySelector("[data-manual-fatigue-group]")?.value ?? "A";
  const hasFatiguePreference = Boolean(fatigueGroup);
  const fatigueOverride = hasFatiguePreference && Boolean(panel.querySelector("[data-manual-fatigue-override]")?.checked);
  const fatigueGroupClosed = hasFatiguePreference && !manualFatigueGroupIsAvailable(line, fatigueGroup);
  if (hasFatiguePreference && !manualFatigueGroupIsAvailable(line, fatigueGroup, fatigueOverride)) {
    setManualBidStatus(panel, `Group ${fatigueGroup} is full for Line ${line.line}. Choose an available fatigue group before adding this bid.`, "error");
    return;
  }
  const usedFatigueOverride = fatigueOverride && fatigueGroupClosed;
  const flex = panel.querySelector("[data-manual-flex]")?.value || "Yes";
  const aws = rdoPreferenceForBidRole(person.bidAs, area, panel.querySelector("[data-manual-aws]")?.value || "No");
  const mid = rdoPreferenceForBidRole(
    person.bidAs,
    area,
    isMidLineByDesign(line) ? "BID" : panel.querySelector("[data-manual-mid]")?.value || "No"
  );
  const submittedAt = formatDateTime(new Date());
  const ghostBid = Boolean(person.ghostBidder);
  const existing = intakeQueue.find((item) =>
    item.type === "RDO Line" &&
    item.initials === person.initials &&
    ["Pending", "Approved"].includes(item.status)
  );
  const request = {
    id: existing?.id || `manual-rdo-${person.initials.toLowerCase()}-${Date.now()}`,
    type: "RDO Line",
    ghostBid,
    area,
    name: controllerName(person),
    initials: person.initials,
    bidAs: person.bidAs,
    seniority: person.rank,
    status: "Pending",
    round: openRound,
    submittedAt,
    approvedBy: "",
    approvedAt: "",
    manualEntry: true,
    enteredBy: currentUser.initials,
    submittedBy: currentUser.initials,
    submittedByRole: submissionRoleLabel(currentUser.role),
    line: line.line,
    fatigueGroup,
    fatigueOverride: usedFatigueOverride,
    reviewNote: usedFatigueOverride ? `Fatigue override: Group ${fatigueGroup} was full or closed when entered by ${currentUser.initials}.` : "",
    flex,
    aws,
    mid,
    summary: `${ghostBid ? "Ghost Line" : "Line"} ${line.line} · ${fatigueGroupPreferenceLabel(fatigueGroup)} · Flex ${flex} · AWS ${aws} · Mid ${mid}${usedFatigueOverride ? " · Fatigue override" : ""}`,
  };

  const isChange = Boolean(existing) && rdoBidValuesChanged(existing, request);
  if (isChange) {
    request.isChange = true;
    request.changeSource = "intake";
    request.changeEnteredBy = currentUser.initials;
    request.originalBid = existing.originalBid || rdoBidSnapshotFromIntakeItem(existing);
    if (!window.confirm(rdoBidChangeConfirmation(person, request, request.originalBid))) {
      setManualBidStatus(panel, "RDO bid change canceled. Nothing was submitted.");
      return;
    }
  }

  try {
    setManualBidStatus(panel, `Saving ${person.initials}'s RDO bid to Supabase...`);
    const savedSubmission = await saveSupabaseManualRdoRequest(request, person, area);
    if (savedSubmission?.submission_id) request.supabaseSubmissionId = savedSubmission.submission_id;
  } catch (error) {
    setManualBidStatus(panel, error.message || "The manual RDO bid could not be saved. Try again.", "error");
    return;
  }

  if (existing) {
    Object.assign(existing, request);
  } else {
    intakeQueue.unshift(request);
  }

  delete panel.dataset.approvalRefreshDirty;
  logHistory(area, "Manual RDO bid entered", `${currentUser.initials} entered ${request.summary} for ${person.initials}. Intake approval is still required before the line is populated.`);
  activeOverrideId = null;
  activeDenialId = null;
  selectManualLeaveController(person.initials);
  renderApp();
  setManualBidStatus(panel, `${person.initials}'s RDO bid was saved to Supabase and added to the intake queue.`, "success");
}

function manualLeaveValidationMessage({ person, round, days, weekKeys, requestedRanges }) {
  if (round === 1) {
    const usedWeeks = roundOneWeekKeySetForItems([
      ...leaveRoundUsageForInitials(person.initials, 1),
      ...requestedRanges.map((keys) => ({ dateKeys: keys, round })),
    ]);

    if (usedWeeks.size > roundOneWeekLimit()) {
      return `Round 1 can include up to ${roundOneWeekLimit()} bid weeks for ${person.initials}. This request counts as ${weekKeys.length} and would bring ${person.initials} to ${usedWeeks.size}.`;
    }
    return "";
  }

  const roundLimit = leaveDayLimitForRound(round, person.initials);
  const alreadyBidDays = leaveRoundUsageForInitials(person.initials, round)
    .reduce((total, item) => total + leaveItemChargedDays(item), 0);
  const projectedDays = alreadyBidDays + days;
  if (projectedDays > roundLimit) {
    return `Round ${round} can include up to ${roundLimit} charged days for ${person.initials}. This would bring ${person.initials} to ${projectedDays}.`;
  }

  return "";
}

let manualLeaveBatch = { key: "", entries: [] };

function manualLeaveBatchKey(person, area, round) {
  return `${BID_YEAR}:${person.initials}:${area}:${round}`;
}

function renderManualLeaveBatch(panel) {
  const batch = panel.querySelector("[data-manual-leave-batch]");
  if (!batch) return;
  const person = manualBidPerson(panel);
  const area = panel.querySelector("[data-manual-bid-area]")?.value || currentViewArea();
  const round = Number(panel.querySelector("[data-manual-leave-round]")?.value || 0);
  if (manualLeaveBatch.entries.length && manualLeaveBatch.key !== manualLeaveBatchKey(person, area, round)) {
    manualLeaveBatch = { key: "", entries: [] };
  }
  batch.hidden = !manualLeaveBatch.entries.length;
  const summary = batch.querySelector("[data-manual-leave-batch-summary]");
  if (summary) summary.textContent = `${manualLeaveBatch.entries.length} selections · ${manualLeaveBatch.entries.reduce((total, entry) => total + entry.days, 0)} charged days`;
  const list = batch.querySelector("[data-manual-leave-batch-list]");
  if (list) list.innerHTML = manualLeaveBatch.entries.map((entry, index) => `
    <div class="manual-leave-batch-row">
      <span>${escapeHtml(entry.range)} · ${entry.days} ${entry.days === 1 ? "day" : "days"}${entry.notes ? ` · ${escapeHtml(entry.notes)}` : ""}</span>
      <button class="secondary-action small" type="button" data-manual-leave-remove="${index}" aria-label="Remove ${escapeHtml(entry.range)} from batch">Remove</button>
    </div>
  `).join("");
  const submit = panel.querySelector("[data-manual-bid-submit]");
  if (submit) submit.textContent = manualLeaveBatch.entries.length ? `Submit batch (${manualLeaveBatch.entries.length})` : "Submit Requested Leave Dates";
}

function prepareManualLeaveEntries(panel, person, area, entries) {
  const round = Number(panel.querySelector("[data-manual-leave-round]")?.value || currentRoundNumber());
  const openRound = openAreaBidRound(new Date(), area);
  if (!openRound) throw new Error("No bidding round is currently open across ZLA.");
  if (round !== openRound) throw new Error(`Round ${round} is closed. Only Round ${openRound} is open across ZLA.`);
  if (round > 4) throw new Error("Leave bids are only available in Rounds 1 through 4.");
  const selected = entries.map((entry) => {
    const dateKeys = datesInLeaveRange(entry.range);
    if (!dateKeys.length) throw new Error("Select a start and end date before adding to the batch.");
    if (invalidLeaveYearDateKeys(dateKeys).length) throw new Error(`Leave bids must stay between Jan 10, ${BID_YEAR} and Jan 8, ${BID_YEAR + 1}.`);
    const requestedDates = leaveSlotDateKeys(dateKeys, person.initials);
    const days = chargeableLeaveDatesForInitials(entry.range, person.initials, round).length;
    if (!days) throw new Error("A selection must include a chargeable leave day after RDOs are removed.");
    return { ...entry, dateKeys, requestedDates, days };
  });
  const rawDateKeys = selected.flatMap((entry) => entry.dateKeys);
  if (new Set(rawDateKeys).size !== rawDateKeys.length) throw new Error("Batch selections cannot overlap. Remove the repeated dates first.");
  const allDateKeys = selected.flatMap((entry) => entry.requestedDates);
  if (new Set(allDateKeys).size !== allDateKeys.length) throw new Error("Batch selections cannot overlap. Remove the repeated dates first.");
  const requestedRanges = selected.flatMap((entry) => contiguousLeaveDateRanges(entry.requestedDates));
  const chargedDays = selected.reduce((total, entry) => total + entry.days, 0);
  const weekKeys = round === 1 ? roundOneWeekKeysForDateKeys(allDateKeys) : [];
  const weekUnits = weekKeys.length;
  const validationMessage = manualLeaveValidationMessage({
    person,
    round,
    days: chargedDays,
    weekKeys,
    requestedRanges,
  });
  if (validationMessage) throw new Error(validationMessage);

  const capacityMessage = person.ghostBidder ? "" : leaveAreaCapacityMessage(area, person.bidAs, [{
    area,
    bidAs: person.bidAs,
    initials: person.initials,
  }]);
  if (capacityMessage) throw new Error(capacityMessage);

  const submittedAt = formatDateTime(new Date());
  const request = {
    id: `manual-leave-${person.initials.toLowerCase()}-${Date.now()}`,
    type: "Leave",
    ghostBid: Boolean(person.ghostBidder),
    area,
    name: controllerName(person),
    initials: person.initials,
    bidAs: person.bidAs,
    seniority: person.rank,
    status: "Pending",
    submittedAt,
    manualEntry: true,
    enteredBy: currentUser.initials,
    submittedBy: currentUser.initials,
    submittedByRole: submissionRoleLabel(currentUser.role),
    range: selected.map((entry) => entry.range).join(", "),
    days: chargedDays,
    round,
    weekUnits,
    weekKeys,
    summary: `${person.ghostBidder ? "Ghost Leave · " : person.bidAs === "GL" ? "GL Bid · " : ""}${selected.map((entry) => entry.range).join(", ")} · ${chargedDays} ${chargedDays === 1 ? "day" : "days"}${weekUnits ? ` · ${weekUnits} bid week${weekUnits === 1 ? "" : "s"}` : ""}`,
  };
  const requests = selected.flatMap((entry) => contiguousLeaveDateRanges(entry.requestedDates).map((keys) => {
    const segmentRange = formatLeaveRangeFromKeys(keys);
    const segmentDays = chargeableLeaveDateKeys(keys, person.initials, round).length;
    const segmentWeekKeys = round === 1 ? roundOneWeekKeysForDateKeys(keys) : [];
    return {
      ...request,
      id: request.id,
      range: segmentRange,
      dateKeys: keys,
      startDateKey: keys[0],
      endDateKey: keys[keys.length - 1],
      days: segmentDays,
      weekUnits: segmentWeekKeys.length,
      weekKeys: segmentWeekKeys,
      summary: `${person.ghostBidder ? "Ghost Leave · " : person.bidAs === "GL" ? "GL Bid · " : ""}${segmentRange} · ${segmentDays} ${segmentDays === 1 ? "day" : "days"}`,
      notes: entry.notes,
    };
  }));
  requests.forEach((item, index) => { item.id = `${request.id}-${index + 1}`; });
  return { request, requests, chargedDays, round };
}

function addManualLeaveToBatch(panel) {
  const person = manualBidPerson(panel);
  const area = panel.querySelector("[data-manual-bid-area]")?.value || currentViewArea();
  const round = Number(panel.querySelector("[data-manual-leave-round]")?.value || 0);
  const key = manualLeaveBatchKey(person, area, round);
  const entry = { range: manualLeaveRangeValue(panel), notes: panel.querySelector("[data-manual-leave-notes]")?.value.trim() || "" };
  try {
    if (manualLeaveBatch.entries.length && manualLeaveBatch.key !== key) throw new Error("The controller, area, year, or round changed. Start a new batch.");
    const prepared = prepareManualLeaveEntries(panel, person, area, [...manualLeaveBatch.entries, entry]);
    manualLeaveBatch = { key, entries: [...manualLeaveBatch.entries, { ...entry, days: prepared.chargedDays - manualLeaveBatch.entries.reduce((total, item) => total + item.days, 0) }] };
    panel.querySelector("[data-manual-leave-start]").value = "";
    panel.querySelector("[data-manual-leave-end]").value = "";
    panel.querySelector("[data-manual-leave-days]").value = "";
    panel.querySelector("[data-manual-leave-notes]").value = "";
    renderManualLeaveBatch(panel);
    setManualBidStatus(panel, "Date selection added to batch.", "success");
  } catch (error) {
    setManualBidStatus(panel, error.message, "error");
  }
}

async function submitManualLeaveBid(panel, person, area) {
  const round = Number(panel.querySelector("[data-manual-leave-round]")?.value || 0);
  const key = manualLeaveBatchKey(person, area, round);
  if (manualLeaveBatch.entries.length && manualLeaveBatch.key !== key) {
    setManualBidStatus(panel, "The controller, area, year, or round changed. Start a new batch.", "error");
    return;
  }
  const entries = manualLeaveBatch.entries.length
    ? manualLeaveBatch.entries
    : [{ range: manualLeaveRangeValue(panel), notes: panel.querySelector("[data-manual-leave-notes]")?.value.trim() || "" }];
  let prepared;
  try {
    prepared = prepareManualLeaveEntries(panel, person, area, entries);
  } catch (error) {
    setManualBidStatus(panel, error.message, "error");
    return;
  }
  const { request, requests } = prepared;

  try {
    setManualBidStatus(panel, `Saving ${person.initials}'s leave bid to Supabase...`);
    const savedBatch = await saveSupabaseManualLeaveRequest(requests, person, area);
    requests.forEach((item, index) => {
      item.supabaseSubmissionId = savedBatch.submission_ids[index];
    });
  } catch (error) {
    setManualBidStatus(panel, error.message || "The manual leave bid could not be saved. Try again.", "error");
    return;
  }

  // Read the saved requests rather than displaying client estimates. The database
  // applies the approved RDO and supplies the batch key used by week grouping.
  await refreshBiddingAfterIntakeDecision();

  delete panel.dataset.approvalRefreshDirty;
  logHistory(area, "Manual leave bid entered", `${currentUser.initials} entered ${request.range} for ${person.initials}. Intake approval is required before leave slots are populated.`);
  manualLeaveBatch = { key: "", entries: [] };
  activeOverrideId = null;
  activeDenialId = null;
  renderApp();
  setManualBidStatus(panel, `${person.initials}'s leave bid was saved to Supabase and added to the intake queue.`, "success");
}

async function submitManualBidEntry(panel) {
  if (panel.dataset.manualBidSubmitting === "true") return;
  if (!(hasIntakeAccess() || hasSystemAdminAccess())) {
    setManualBidStatus(panel, "Manual bid entry requires intake or admin access.", "error");
    return;
  }

  const person = manualBidPerson(panel);
  const area = panel.querySelector("[data-manual-bid-area]")?.value || currentViewArea();
  const type = panel.querySelector("[data-manual-bid-type]")?.value || "RDO Line";
  const submitButton = panel.querySelector("[data-manual-bid-submit]");
  panel.dataset.manualBidSubmitting = "true";
  if (submitButton) submitButton.disabled = true;
  try {
    if (type === "Leave") {
      await submitManualLeaveBid(panel, person, area);
      return;
    }
    await submitManualRdoBid(panel, person, area);
  } finally {
    if (panel.isConnected) {
      delete panel.dataset.manualBidSubmitting;
      if (submitButton) submitButton.disabled = false;
    }
  }
}

function setLeaveBuilderStatus(message, status = "info") {
  showActionFeedback(message, status);
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

function usesIndividualLeaveDateSelection() {
  const round = currentRoundNumber();
  return round >= 1 && round <= 6 && !leaveReplacementRequestId;
}

function leaveBuilderDateKeys() {
  if (usesIndividualLeaveDateSelection()) {
    return [...selectedLeaveDates].sort();
  }
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

function formatIndividualLeaveDates(keys) {
  const sortedKeys = [...new Set(keys)].sort();
  if (!sortedKeys.length) return "";
  const years = new Set(sortedKeys.map((key) => dateFromKey(key).getFullYear()));
  const showYearOnEachDate = years.size > 1;
  const labels = sortedKeys.map((key) => dateFromKey(key).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(showYearOnEachDate ? { year: "numeric" } : {}),
  }));
  return showYearOnEachDate
    ? labels.join(", ")
    : `${labels.join(", ")}, ${[...years][0]}`;
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
    expired: "Expired",
  };
  return labels[normalized] || "Pending";
}

function databaseStatusFromUi(status) {
  return String(status || "Pending").toLowerCase();
}

function syncLeaveBuilderInputs() {
  const keys = leaveBuilderDateKeys();
  const rangeInput = document.querySelector("[data-leave-range-input]");
  const selectionLabel = document.querySelector("[data-leave-selection-label]");
  const chargeableDays = chargeableLeaveDateKeys(keys, currentUser.initials, currentRoundNumber()).length;

  if (selectionLabel) selectionLabel.textContent = usesIndividualLeaveDateSelection() ? "Dates" : "Date Range";
  if (rangeInput) {
    rangeInput.value = usesIndividualLeaveDateSelection()
      ? formatIndividualLeaveDates(keys)
      : formatLeaveRangeFromKeys(keys);
    rangeInput.placeholder = usesIndividualLeaveDateSelection()
      ? "Select individual dates"
      : "Select a date range";
  }
  setLeaveDaysInput(keys.length ? chargeableDays : NaN);
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
  if (usesIndividualLeaveDateSelection()) return selectedLeaveDates.has(key);
  return key === leaveRangeStartKey || key === leaveRangeEndKey;
}

function isLeavePreviewRangeDate(key) {
  return leaveRangePreviewActive && isLeaveBuilderRangeDate(key);
}

function previouslyBidLeaveDateKeys() {
  const dates = new Set();
  activeLeaveItemsForInitials(currentUser.initials).forEach((item) => {
    if (leaveReplacementRequestId && submittedLeaveItemKey(item) === leaveReplacementRequestId) return;
    leaveDateKeysForItem(item).forEach((key) => dates.add(key));
  });
  return dates;
}

function selectLeaveBuilderDate(key) {
  if (previouslyBidLeaveDateKeys().has(key)) {
    setLeaveBuilderStatus(`${formatCalendarDate(key)} is already in your submitted leave bids and cannot be selected again.`, "error");
    return false;
  }

  if (isRdoDateForInitials(key, currentUser.initials)) {
    setLeaveBuilderStatus(`${formatCalendarDate(key)} is an RDO on your submitted line and cannot be selected for leave.`, "error");
    return false;
  }

  if (usesIndividualLeaveDateSelection()) {
    const round = currentRoundNumber();
    const nextDates = new Set(selectedLeaveDates);
    if (nextDates.has(key)) {
      nextDates.delete(key);
    } else {
      nextDates.add(key);
      if (round === 1) {
        const projectedWeeks = roundOneProjectedWeekCount([...nextDates]);
        if (projectedWeeks > roundOneWeekLimit()) {
          setLeaveBuilderStatus(`That date would create a third Round 1 bid week. Choose a date within either of your two seven-day bid weeks.`, "error");
          return false;
        }
      } else {
        const committedRoundDays = leaveRoundUsageForInitials(currentUser.initials, round)
          .reduce((total, item) => total + leaveItemChargedDays(item), 0);
        const draftRoundDays = leaveDraftQueue
          .filter((item) => leaveRoundForItem(item) === round)
          .reduce((total, item) => total + leaveItemChargedDays(item), 0);
        const selectedDays = chargeableLeaveDateKeys([...nextDates], currentUser.initials, round).length;
        const projectedDays = committedRoundDays + draftRoundDays + selectedDays;
        const roundLimit = leaveDayLimitForRound(round);
        if (projectedDays > roundLimit) {
          setLeaveBuilderStatus(`Round ${round} can include up to ${roundLimit} charged days. You already have ${committedRoundDays + draftRoundDays} staged or submitted.`, "error");
          return false;
        }
      }
    }

    selectedLeaveDates.clear();
    nextDates.forEach((dateKeyValue) => selectedLeaveDates.add(dateKeyValue));
    const keys = [...selectedLeaveDates].sort();
    leaveRangeStartKey = keys[0] || key;
    leaveRangeEndKey = keys[keys.length - 1] || key;
    leaveRangeSelectionComplete = keys.length > 0;
    leaveRangePreviewActive = false;
    selectedLeaveDateKey = key;
    syncLeaveBuilderInputs();
    syncLeavePickerMonthToRange();

    if (!keys.length) {
      setLeaveBuilderStatus(round === 1
        ? "Select each Round 1 leave date individually. Dates may be skipped within a seven-day bid week."
        : `Select each Round ${round} leave date individually. Dates do not need to be continuous.`, "info");
      return true;
    }

    if (round === 1) {
      const projectedWeeks = roundOneProjectedWeekCount(keys);
      setLeaveBuilderStatus(`${keys.length} ${keys.length === 1 ? "date" : "dates"} selected across ${projectedWeeks} of ${roundOneWeekLimit()} bid weeks. Select a date again to remove it.`, "success");
    } else {
      const chargedDays = chargeableLeaveDateKeys(keys, currentUser.initials, round).length;
      setLeaveBuilderStatus(`${chargedDays} of ${leaveDayLimitForRound(round)} Round ${round} days selected. Dates do not need to be continuous. Select a date again to remove it.`, "success");
    }
    return true;
  }

  selectedLeaveDateKey = key;
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
    const weekUnits = isRoundOneLeaveRound() ? roundOneProjectedWeekCount(range) : 0;
    const roundOneNote = isRoundOneLeaveRound()
      ? `${weekUnits} of ${roundOneWeekLimit()} bid weeks after this selection, ${chargeableDays} chargeable ${chargeableDays === 1 ? "day" : "days"}`
      : `${chargeableDays} ${chargeableDays === 1 ? "day" : "days"}`;
    setLeaveBuilderStatus(`${range} selected: ${roundOneNote}.`, "success");
  } else {
    const roundOneNote = isRoundOneLeaveRound()
      ? ` This would use ${roundOneProjectedWeekCount(range)} of ${roundOneWeekLimit()} bid weeks and ${chargeableDays} chargeable ${chargeableDays === 1 ? "day" : "days"}.`
      : "";
    setLeaveBuilderStatus(`${range} selected.${roundOneNote} Select another date to expand the range.`, "info");
  }

  return true;
}

function renderLeaveDatePicker() {
  const picker = document.querySelector("[data-leave-date-picker]");
  if (!picker) return;

  picker.hidden = !leavePickerOpen;
  if (!leavePickerOpen) return;

  const firstDay = new Date(leavePickerYear, leavePickerMonthIndex, 1).getDay();
  const daysInMonth = new Date(leavePickerYear, leavePickerMonthIndex + 1, 0).getDate();
  const selectedKeys = new Set(leaveBuilderDateKeys());
  const previouslyBidDates = previouslyBidLeaveDateKeys();
  const cells = [];

  dayNames.forEach((day) => cells.push(`<span class="picker-dow">${day[0]}</span>`));
  for (let index = 0; index < firstDay; index += 1) cells.push("<span></span>");

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = dateKey(leavePickerYear, leavePickerMonthIndex + 1, day);
    const isInRange = selectedKeys.has(key);
    const isEdge = isLeaveBuilderRangeEdge(key);
    const isOutsideLeaveYear = !isBidLeaveYearDate(key);
    const isRdo = isRdoDateForInitials(key, currentUser.initials);
    const isAlreadyBid = previouslyBidDates.has(key);
    const isUnavailable = isOutsideLeaveYear || isRdo || isAlreadyBid;
    const unavailableLabel = isAlreadyBid
      ? ": already submitted for leave; cannot be selected again"
      : isRdo
      ? ": RDO on your submitted line; leave bidding unavailable"
      : isOutsideLeaveYear
        ? ": leave bidding unavailable"
        : "";
    cells.push(`
      <button class="${isInRange ? "in-range" : ""} ${isEdge ? "range-edge" : ""} ${isRdo ? "rdo" : ""} ${isUnavailable ? "unavailable" : ""}" type="button" ${isUnavailable ? "disabled" : `data-leave-picker-date="${key}"`} aria-label="${monthNames[leavePickerMonthIndex]} ${day}, ${leavePickerYear}${unavailableLabel}">
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
  return leaveDayLimitForRound(round);
}

function leaveDayLimitForRound(round, initials = currentUser.initials) {
  if (round >= 2 && round <= 6) {
    const line = submittedRdoLineForInitials(initials);
    if (round >= 4) return rdoWeekdaysForLine(line).size === 3 ? 4 : 5;
    return rdoWeekdaysForLine(line).size === 3 ? 8 : 10;
  }
  return 5;
}

function currentRoundNumber() {
  return latestAreaRound();
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

  sortedKeys.forEach((key) => {
    const date = dateFromKey(key);
    const covered = periodKeys.some((startKey) => {
      const start = dateFromKey(startKey);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return date >= start && date <= end;
    });
    if (!covered) {
      periodKeys.push(key);
    }
  });

  return periodKeys.sort();
}

function leaveDateKeysForItem(item) {
  if (Array.isArray(item?.dateKeys)) return [...new Set(item.dateKeys)].sort();
  return datesInLeaveRange(item?.range || "");
}

function roundOneWeekKeySetForItems(items = []) {
  const roundOneItems = items.filter(isRoundOneLeaveItem);
  const dateKeys = roundOneItems.flatMap(leaveDateKeysForItem);
  return new Set(roundOneWeekKeysForDateKeys(dateKeys));
}

function roundOneProjectedWeekCount(selection) {
  const committedItems = leaveRoundUsageForInitials(currentUser.initials, 1).filter((item) =>
    submittedLeaveItemKey(item) !== leaveReplacementRequestId
  );
  const selectionItem = Array.isArray(selection)
    ? { dateKeys: selection, round: 1 }
    : { range: selection, round: 1 };
  return roundOneWeekKeySetForItems([
    ...committedItems,
    ...leaveDraftQueue,
    selectionItem,
  ]).size;
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

function sortLeaveDraftQueueByDate() {
  leaveDraftQueue.sort((left, right) => {
    const leftKey = leaveDateKeysForItem(left)[0] || "";
    const rightKey = leaveDateKeysForItem(right)[0] || "";
    return leftKey.localeCompare(rightKey) || String(left.id || "").localeCompare(String(right.id || ""));
  });
}

function isRoundOneLeaveItem(item) {
  return item?.round === 1 || Number(item?.weekUnits || 0) > 0;
}

function chargeableLeaveDateKeys(keys, initials = currentUser.initials, round = currentRoundNumber()) {
  return keys.filter((key) =>
    !isRdoDateForInitials(key, initials) && (round <= 3 || !isHolidayDate(key, initials))
  );
}

function chargeableLeaveDatesForInitials(range, initials = currentUser.initials, round = currentRoundNumber()) {
  return chargeableLeaveDateKeys(datesInLeaveRange(range), initials, round);
}

function leaveSlotDateKeys(keys, initials = currentUser.initials) {
  // Slot occupancy is separate from charged leave hours.
  return keys.filter((key) => !isRdoDateForInitials(key, initials));
}

function leaveSlotDatesForInitials(range, initials = currentUser.initials) {
  return leaveSlotDateKeys(datesInLeaveRange(range), initials);
}

function leaveRdoDatesForInitials(range, initials = currentUser.initials) {
  return datesInLeaveRange(range).filter((key) => isRdoDateForInitials(key, initials));
}

function contiguousLeaveDateRanges(keys) {
  return keys.reduce((ranges, key) => {
    const last = ranges[ranges.length - 1];
    if (last && addDaysToDateKey(last[last.length - 1], 1) === key) last.push(key);
    else ranges.push([key]);
    return ranges;
  }, []);
}

function setLeaveDaysInput(days) {
  const daysInput = document.querySelector("[data-leave-days-input]");
  if (daysInput) daysInput.value = Number.isFinite(days) ? String(days) : "";
}

function leaveApprovalDates(item) {
  return leaveSlotDatesForInitials(item.range, item.initials);
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

function matchesRemovedLeaveDates(dateKeys, round) {
  if (!dateKeys.length) return false;
  return leaveBids.some((item) => {
    if (item.status !== "Cancelled" || leaveRoundForItem(item) !== round) return false;
    if (item.initials && item.initials !== currentUser.initials) return false;
    const removedKeys = datesInLeaveRange(item.range);
    return removedKeys[0] === dateKeys[0]
      && removedKeys[removedKeys.length - 1] === dateKeys[dateKeys.length - 1];
  });
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

function isGhostLeaveItem(item) {
  if (item?.ghostBid) return true;
  const initials = String(item?.initials || "").trim().toUpperCase();
  const person = initials ? bueByInitials(initials) : null;
  return Boolean(person?.ghostBidder || (!initials && currentUser.ghostBidder));
}

function isAreaLeaveBalanceExemptPerson(person) {
  return Boolean(person?.ghostBidder || person?.bidAs === "GL");
}

function isAreaLeaveBalanceExemptItem(item) {
  return isGhostLeaveItem(item) || leaveItemBidAs(item) === "GL";
}

function isGlLeaveItem(item) {
  return leaveItemBidAs(item) === "GL";
}

function leaveSlotUnitsForItem() {
  return 1;
}

function leaveBidDayAllowanceForPerson(person) {
  const allowanceHours = normalizeLeaveSlotAllowance(person?.leaveSlotAllowance);
  const hoursPerDay = leaveHoursPerDayForInitials(person?.initials);
  return Math.ceil(estimatedLeaveDaysFromHours(allowanceHours, hoursPerDay));
}

function areaLeaveSlotBudget(area = currentViewArea(), bucket = "cpc") {
  return bueRoster()
    .filter((person) => !isAreaLeaveBalanceExemptPerson(person) && person.area === area && leaveSlotBucketForBidAs(person.bidAs) === bucket)
    .reduce((total, person) => total + leaveBidDayAllowanceForPerson(person), 0);
}

function areaCommittedLeaveItems() {
  const byRequest = new Map();
  // Intake contains the area's saved bids; leaveBids contains personal/local bids.
  // Process intake last so saved status replaces a stale personal copy.
  [...leaveBids, ...intakeQueue.filter((item) => item.type === "Leave")].forEach((item) => {
    const round = leaveRoundForItem(item);
    const initials = String(item.initials || currentUser.initials).trim().toUpperCase();
    const key = JSON.stringify([leaveItemArea(item), initials, round, leaveDateKeysForItem(item)]);
    byRequest.set(key, { ...item, initials, round });
  });
  return [...byRequest.values()].filter((item) => ["Approved", "Pending"].includes(item.status));
}

function areaLeaveSlotUsed(area = currentViewArea(), bucket = "cpc", extraItems = []) {
  return [...areaCommittedLeaveItems(), ...extraItems]
    .filter((item) => !isAreaLeaveBalanceExemptItem(item) && leaveItemArea(item) === area && leaveSlotBucketForBidAs(leaveItemBidAs(item)) === bucket)
    .reduce((total, item) => total + leaveSlotUnitsForItem(item), 0);
}

function leaveItemAreaUsedDays(item) {
  // Area capacity counts every bid workday, including holidays and in-lieu days.
  // Personal charged days and later-round holiday credits are separate.
  return leaveSlotDateKeys(leaveDateKeysForItem(item), item.initials || currentUser.initials).length;
}

function areaLeaveSlotUsedDays(area = currentViewArea(), bucket = "cpc", extraItems = []) {
  return [...areaCommittedLeaveItems(), ...extraItems]
    .filter((item) => !isAreaLeaveBalanceExemptItem(item) && leaveItemArea(item) === area && leaveSlotBucketForBidAs(leaveItemBidAs(item)) === bucket)
    .reduce((total, item) => total + leaveItemAreaUsedDays(item), 0);
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

function formatRoundedUpLeaveDaysLabel(days) {
  const value = Number(days);
  const roundedDays = Number.isFinite(value) ? Math.ceil(value) : 0;
  const label = Math.abs(roundedDays) === 1 ? "day" : "days";
  return `${roundedDays.toLocaleString("en-US")} ${label}`;
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

function leaveHoursPerDayForLine(line) {
  return line && lineFourTenValue(line) === "Yes" ? CWS_LEAVE_HOURS_PER_DAY : LEAVE_SLOT_HOURS_PER_DAY;
}

function leaveHoursPerDayForInitials(initials = currentUser.initials) {
  return leaveHoursPerDayForLine(submittedRdoLineForInitials(initials));
}

function currentUserLeaveAllowanceHours() {
  return normalizeLeaveSlotAllowance(currentUser.leaveSlotAllowance);
}

function currentUserBaseLeaveAllowanceDays() {
  return Math.ceil(estimatedLeaveDaysFromHours(currentUserLeaveAllowanceHours(), leaveHoursPerDayForInitials()));
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
  return withLeaveReadCache(() => leaveAreaCapacityMessageWithCache(area, bidAs, extraItems));
}

function leaveAreaCapacityMessageWithCache(area, bidAs, extraItems = []) {
  const bucket = leaveSlotBucketForBidAs(bidAs);
  if (!bucket) return "";
  const total = areaLeaveSlotBudget(area, bucket);
  const used = areaLeaveSlotUsedDays(area, bucket);
  const projectedUsed = bidAs === "GL" ? used : areaLeaveSlotUsedDays(area, bucket, extraItems);
  if (bidAs === "GL" ? used < total : projectedUsed <= total) return "";

  const label = bucket === "dev" ? "DEV" : "CPC";
  return `${area} ${label} leave balance is exhausted (${formatRoundedUpLeaveDays(used)} used of ${formatRoundedUpLeaveDays(total)} estimated days). No additional leave bids can be submitted in that bucket.`;
}

function leaveItemChargedDays(item) {
  const days = Number(item.days);
  if (Number.isFinite(days) && days > 0) return days;
  return chargeableLeaveDateKeys(leaveDateKeysForItem(item), item.initials || currentUser.initials, leaveRoundForItem(item)).length;
}

function leaveHolidayDateSet(items) {
  return items.reduce((holidays, item) => {
    const round = leaveRoundForItem(item);
    chargeableLeaveDateKeys(leaveDateKeysForItem(item), item.initials || currentUser.initials, round).forEach((key) => {
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

function leaveAllowanceHoursForRound(round) {
  return currentUserBaseLeaveAllowanceDays() * leaveHoursPerDayForInitials()
    + leaveHolidayCreditsForRound(round) * leaveHoursPerDayForInitials();
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
    dateKeys: leaveBuilderDateKeys(),
    initials: currentUser.initials,
    bidAs: currentUserBidAs(),
    round: currentRoundNumber(),
  };
}

function leaveDisplayDatesForItem(item, initials = currentUser.initials) {
  return chargeableLeaveDateKeys(
    leaveDateKeysForItem(item),
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

function addVisibleGlBid(visible, item, fallbackInitials = currentUser.initials) {
  if (!isGlLeaveItem(item)) return;
  const initials = String(item?.initials || fallbackInitials || "").trim().toUpperCase();
  if (!initials) return;
  const status = item?.status || "Pending";
  const glBids = visible.glBids || [];
  if (!glBids.some((bid) => bid.initials === initials && bid.status === status)) {
    glBids.push({ initials, status, label: "GL Bid" });
  }
  visible.glBids = glBids;
}

function ghostLeaveBidsForDate(key, area) {
  const bids = new Map();
  const items = area === currentUser.area ? [...leaveBids, ...intakeQueue] : intakeQueue;
  items.forEach((item) => {
    if ((item.area || currentUser.area) !== area) return;
    if (item.type && item.type !== "Leave") return;
    if (!["Pending", "Approved"].includes(item.status) || !isGhostLeaveItem(item)) return;
    const initials = String(item.initials || currentUser.initials || "").trim().toUpperCase();
    if (!initials || !leaveSlotDatesForInitials(item.range, initials).includes(key)) return;
    // A submitted bid can appear in both the member list and intake queue.
    if (!bids.has(initials) || item.status === "Approved") {
      bids.set(initials, { initials, status: item.status });
    }
  });
  return [...bids.values()];
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
    glBids: [...(details.glBids || [])],
  };
  const showCurrentUserOverlay = includePrivateOverlays && area === currentUser.area;
  const previewItem = activeLeavePreviewItem();
  if (showCurrentUserOverlay && !currentUser.ghostBidder && previewItem && leaveSlotDateKeys(leaveDateKeysForItem(previewItem), currentUser.initials).includes(key)) {
    if (isGlLeaveItem(previewItem)) addVisibleGlBid(visible, previewItem);
    else showInitialsInVisibleSlot(visible, leaveSlotBucketForBidAs(previewItem.bidAs), currentUser.initials);
  }

  leaveBids.forEach((item) => {
    if (!showCurrentUserOverlay) return;
    if (isGhostLeaveItem(item)) return;
    if (!["Pending", "Approved"].includes(item.status)) return;
    if (!leaveSlotDatesForInitials(item.range, currentUser.initials).includes(key)) return;
    if (isGlLeaveItem(item)) addVisibleGlBid(visible, item);
    else showInitialsInVisibleSlot(visible, leaveSlotBucketForBidAs(item.bidAs || currentUserBidAs()), currentUser.initials);
  });

  leaveDraftQueue.forEach((item) => {
    if (!showCurrentUserOverlay) return;
    if (isGhostLeaveItem(item)) return;
    if (!leaveSlotDateKeys(leaveDateKeysForItem(item), currentUser.initials).includes(key)) return;
    if (isGlLeaveItem(item)) addVisibleGlBid(visible, item);
    else showInitialsInVisibleSlot(visible, leaveSlotBucketForBidAs(item.bidAs || currentUserBidAs()), currentUser.initials);
  });

  intakeQueue.forEach((item) => {
    if (item.area !== area) return;
    if (item.type !== "Leave" || !["Pending", "Approved"].includes(item.status)) return;
    if (isGhostLeaveItem(item)) return;
    if (!leaveSlotDatesForInitials(item.range, item.initials).includes(key)) return;
    if (isGlLeaveItem(item)) addVisibleGlBid(visible, item, item.initials);
    else showInitialsInVisibleSlot(visible, leaveSlotBucketForBidAs(item.bidAs), item.initials);
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
  const windowError = leaveBidWindowErrorMessage();
  if (windowError) {
    setLeaveBuilderStatus(windowError, "error");
    return;
  }
  if (leaveReplacementRequestId) {
    void replaceSubmittedLeaveRequest();
    return;
  }

  const { range: rangeValue, notes } = leaveBuilderValues();
  const round = currentRoundNumber();
  const isRoundOne = round === 1;
  const individualDates = usesIndividualLeaveDateSelection();
  const dateKeys = individualDates ? leaveBuilderDateKeys() : datesInLeaveRange(rangeValue);
  const selectionDisplay = individualDates ? formatIndividualLeaveDates(dateKeys) : rangeValue;
  if (!dateKeys.length) {
    setLeaveBuilderStatus(individualDates
      ? `Select at least one individual Round ${round} leave date.`
      : "Use a range like Jun 9 - Jun 13, 2027 or a single day like Jun 9, 2027.", "error");
    return;
  }

  if (invalidLeaveYearDateKeys(dateKeys).length) {
    setLeaveBuilderStatus("Leave bids must stay between Jan 10, 2027 and Jan 8, 2028.", "error");
    return;
  }

  if (matchesRemovedLeaveDates(dateKeys, round)) {
    setLeaveBuilderStatus(`These are the same dates you removed in Round ${round}. Choose different dates before adding a new batch.`, "error");
    return;
  }

  const chargeableDates = chargeableLeaveDateKeys(dateKeys, currentUser.initials, round);
  const rdoDates = dateKeys.filter((key) => isRdoDateForInitials(key, currentUser.initials));
  if (round > 1 && rdoDates.length) {
    setLeaveBuilderStatus(`Round ${round} cannot include RDO dates: ${formatLeaveConflictDates(rdoDates)}. Choose different dates.`, "error");
    return;
  }
  const chargedDays = chargeableDates.length;
  setLeaveDaysInput(chargedDays);
  if (chargedDays <= 0) {
    setLeaveBuilderStatus("That selection does not include any chargeable leave days after RDOs are removed.", "error");
    return;
  }
  const weekKeys = isRoundOne ? roundOneWeekKeysForDateKeys(dateKeys) : [];
  const weekUnits = weekKeys.length;

  if (isRoundOne) {
    const existingItems = [
      ...leaveRoundUsageForInitials(currentUser.initials, 1),
      ...leaveDraftQueue,
    ];
    const existingWeekKeys = roundOneWeekKeySetForItems(existingItems);
    const combinedWeekKeys = roundOneWeekKeySetForItems([...existingItems, { dateKeys, round }]);
    const combinedWeeks = combinedWeekKeys.size;
    if (combinedWeeks > roundOneWeekLimit()) {
      setLeaveBuilderStatus(`Round 1 can include up to ${roundOneWeekLimit()} bid weeks. This would use ${combinedWeeks}.`, "error");
      return;
    }
    var newRoundOneWeeks = [...combinedWeekKeys].filter((key) => !existingWeekKeys.has(key)).length;
  } else {
    const committedRoundDays = leaveRoundUsageForInitials(currentUser.initials, round)
      .reduce((total, item) => total + leaveItemChargedDays(item), 0);
    const currentTotal = committedRoundDays + leaveDraftTotalDays();
    if (currentTotal + chargedDays > currentRoundLeaveLimit()) {
      setLeaveBuilderStatus(`Round ${round} can include up to ${currentRoundLeaveLimit()} total days. This batch would be ${currentTotal + chargedDays}.`, "error");
      return;
    }

  }

  const projectedChargedDays = leaveProjectedChargedDays([{ dateKeys, range: selectionDisplay, days: chargedDays, round, weekUnits, weekKeys }]);
  const allowanceLimit = leaveAllowanceLimitForRound(round);
  if (projectedChargedDays > allowanceLimit) {
    const credits = leaveHolidayCreditsForRound(round);
    const creditText = credits ? ` including ${credits} holiday ${credits === 1 ? "credit" : "credits"}` : "";
    setLeaveBuilderStatus(`This would exceed the ${formatLeaveDaysLabel(allowanceLimit)} leave allowance${creditText} for Round ${round}.`, "error");
    return;
  }

  const capacityMessage = currentUser.ghostBidder ? "" : leaveAreaCapacityMessage(currentUser.area, currentUserBidAs(), [
    ...leaveDraftQueue,
    { area: currentUser.area, bidAs: currentUserBidAs(), initials: currentUser.initials, days: chargedDays },
  ]);
  if (capacityMessage) {
    setLeaveBuilderStatus(capacityMessage, "error");
    return;
  }

  const activeDateKeys = new Set(activeLeaveItemsForInitials(currentUser.initials).flatMap(leaveDateKeysForItem));
  const alreadyBidDates = dateKeys.filter((key) => activeDateKeys.has(key));
  if (alreadyBidDates.length) {
    setLeaveBuilderStatus(`You already bid ${formatLeaveConflictDates(alreadyBidDates)}. Select different dates.`, "error");
    return;
  }

  const draftDates = leaveDraftDateSet();
  const duplicateDraftDates = dateKeys.filter((key) => draftDates.has(key));
  if (duplicateDraftDates.length) {
    setLeaveBuilderStatus(`${formatLeaveConflictDates(duplicateDraftDates)} ${duplicateDraftDates.length === 1 ? "is" : "are"} already in your preview batch.`, "error");
    return;
  }

  const previousPreviewKeys = leaveRangePreviewActive ? leaveBuilderDateKeys() : [];
  const draftId = `draft-leave-${currentUser.initials.toLowerCase()}-${Date.now()}`;
  const newDrafts = individualDates
    ? dateKeys.map((key, index) => ({
        id: `${draftId}-${index}`,
        range: formatLeaveRangeFromKeys([key]),
        dateKeys: [key],
        days: chargeableLeaveDateKeys([key], currentUser.initials, round).length,
        notes,
        round,
        weekUnits: 0,
        weekKeys: [],
      }))
    : [{
        id: draftId,
        range: rangeValue,
        dateKeys,
        days: chargedDays,
        notes,
        round,
        weekUnits,
        weekKeys,
      }];
  leaveDraftQueue.push(...newDrafts);
  sortLeaveDraftQueueByDate();
  const leaveNotesInput = document.querySelector("[data-leave-notes-input]");
  if (leaveNotesInput) leaveNotesInput.value = "";
  leaveRangeSelectionComplete = true;
  leaveRangePreviewActive = false;
  if (individualDates) {
    selectedLeaveDates.clear();
    leaveRangeSelectionComplete = false;
    syncLeaveBuilderInputs();
  }

  refreshLeaveDraftUi([
    ...previousPreviewKeys,
    ...newDrafts.flatMap((draft) => leaveDisplayDatesForItem(draft, currentUser.initials)),
  ]);
  const roundOneSuffix = isRoundOne
    ? newRoundOneWeeks
      ? ` using ${newRoundOneWeeks} new bid ${newRoundOneWeeks === 1 ? "week" : "weeks"} and charging ${chargedDays} ${chargedDays === 1 ? "day" : "days"}`
      : ` inside an existing bid week, charging ${chargedDays} ${chargedDays === 1 ? "day" : "days"}`
    : "";
  const rdoSuffix = rdoDates.length ? ` ${formatLeaveConflictDates(rdoDates)} ${rdoDates.length === 1 ? "was" : "were"} removed as RDO ${rdoDates.length === 1 ? "date" : "dates"}.` : "";
  setLeaveBuilderStatus(`${selectionDisplay} added to the preview batch${roundOneSuffix}.${rdoSuffix} Submit the batch when everything looks right.`, "success");
}

function previewLeaveSubmission() {
  const windowError = leaveBidWindowErrorMessage();
  if (windowError) {
    setLeaveBuilderStatus(windowError, "error");
    return;
  }

  const { range: rangeValue } = leaveBuilderValues();
  const round = currentRoundNumber();
  const individualDates = usesIndividualLeaveDateSelection();
  const dateKeys = individualDates ? leaveBuilderDateKeys() : datesInLeaveRange(rangeValue);
  const previousPreviewKeys = leaveRangePreviewActive ? leaveBuilderDateKeys() : [];

  if (!dateKeys.length) {
    setLeaveBuilderStatus(individualDates
      ? `Select at least one individual Round ${round} leave date before previewing.`
      : "Enter a date range before previewing leave.", "error");
    return;
  }

  if (invalidLeaveYearDateKeys(dateKeys).length) {
    setLeaveBuilderStatus("Leave bids must stay between Jan 10, 2027 and Jan 8, 2028.", "error");
    return;
  }

  if (matchesRemovedLeaveDates(dateKeys, round)) {
    setLeaveBuilderStatus(`These are the same dates you removed in Round ${round}. Choose different dates before previewing a new batch.`, "error");
    return;
  }
  if (matchesCurrentReplacementDates(dateKeys)) {
    setLeaveBuilderStatus("Those are the same dates as your existing bid. Choose different dates and try again.", "error");
    return;
  }

  const chargeableDates = chargeableLeaveDateKeys(dateKeys, currentUser.initials, round);
  const rdoDates = dateKeys.filter((key) => isRdoDateForInitials(key, currentUser.initials));
  if (round > 1 && rdoDates.length) {
    setLeaveBuilderStatus(`Round ${round} cannot include RDO dates: ${formatLeaveConflictDates(rdoDates)}. Choose different dates.`, "error");
    return;
  }
  setLeaveDaysInput(chargeableDates.length);
  if (chargeableDates.length <= 0) {
    setLeaveBuilderStatus("That selection does not include any chargeable leave days after RDOs are removed.", "error");
    return;
  }
  const weekUnits = round === 1 ? roundOneProjectedWeekCount(dateKeys) : 0;

  if (round === 1 && weekUnits > roundOneWeekLimit()) {
    setLeaveBuilderStatus(`Round 1 can include up to ${roundOneWeekLimit()} bid weeks. This selection would use ${weekUnits}.`, "error");
    return;
  }

  const previewYear = dateFromKey(dateKeys[0]).getFullYear();
  const calendarYearChanged = displayedCalendarYear !== previewYear;
  leaveRangePreviewActive = true;
  selectedLeaveDateKey = dateKeys[0];
  displayedCalendarYear = previewYear;
  if (calendarYearChanged) {
    renderCalendars({ includePublic: false });
  } else {
    syncMemberCalendarSelection([...previousPreviewKeys, ...dateKeys]);
  }
  renderLeaveSlotBoard();
  const rdoSuffix = rdoDates.length ? ` ${formatLeaveConflictDates(rdoDates)} ${rdoDates.length === 1 ? "is" : "are"} removed as RDO ${rdoDates.length === 1 ? "date" : "dates"}.` : "";
  const previewMessage = round === 1
    ? `This selection would use ${weekUnits} of ${roundOneWeekLimit()} Round 1 bid ${weekUnits === 1 ? "week" : "weeks"} with ${chargeableDates.length} chargeable ${chargeableDates.length === 1 ? "day" : "days"}.${rdoSuffix}`
    : `Previewing ${chargeableDates.length} individually selected ${chargeableDates.length === 1 ? "day" : "days"}.${rdoSuffix} Use Add to Batch when you want to stage them.`;
  setLeaveBuilderStatus(previewMessage, "info");
}

function removeLeaveDraft(id) {
  const removedDraft = leaveDraftQueue.find((item) => item.id === id);
  leaveDraftQueue = leaveDraftQueue.filter((item) => item.id !== id);
  sortLeaveDraftQueueByDate();
  refreshLeaveDraftUi(removedDraft ? leaveDisplayDatesForItem(removedDraft, currentUser.initials) : []);
  setLeaveBuilderStatus("Removed from the preview batch.", "info");
}

function refreshLeaveDraftUi(affectedDateKeys = []) {
  return withLeaveReadCache(() => refreshLeaveDraftUiWithCache(affectedDateKeys));
}

function refreshLeaveDraftUiWithCache(affectedDateKeys = []) {
  syncMemberCalendarSelection(affectedDateKeys);
  renderLeaveDraftQueue();
  renderLeaveAllowanceSummary();
}

function leaveDraftPreSubmissionMessage(drafts = leaveDraftQueue) {
  return withLeaveReadCache(() => leaveDraftPreSubmissionMessageWithCache(drafts));
}

function leaveDraftPreSubmissionMessageWithCache(drafts = leaveDraftQueue) {
  const requestedDates = new Map();
  const overlappingDates = new Set();

  for (const draft of drafts) {
    const round = Number(draft.round || currentRoundNumber());
    const rdoDates = leaveDateKeysForItem(draft).filter((key) => isRdoDateForInitials(key, currentUser.initials));
    if (round > 1 && rdoDates.length) {
      return `Round ${round} cannot include RDO dates: ${formatLeaveConflictDates(rdoDates)}. Remove those dates before submitting.`;
    }
  }

  drafts.forEach((draft) => {
    leaveDateKeysForItem(draft).forEach((key) => {
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
    leaveDateKeysForItem(item).forEach((key) => {
      const requestedRound = requestedDates.get(key);
      if (requestedRound && priorRound <= requestedRound) previousRoundDates.add(key);
    });
  });
  if (previousRoundDates.size) {
    return `You already bid these dates: ${formatLeaveConflictDates([...previousRoundDates].sort())}. Each date may be bid only once.`;
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

  const repeatedDraft = leaveDraftQueue.find((draft) =>
    matchesRemovedLeaveDates(datesInLeaveRange(draft.range), draft.round)
  );
  if (repeatedDraft) {
    setLeaveBuilderStatus(`The batch includes ${repeatedDraft.range}, which you already removed in this round. Choose different dates and try again.`, "error");
    return;
  }

  const preSubmissionMessage = leaveDraftPreSubmissionMessage();
  if (preSubmissionMessage) {
    setLeaveBuilderStatus(preSubmissionMessage, "error");
    return;
  }

  const capacityMessage = currentUser.ghostBidder ? "" : leaveAreaCapacityMessage(
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
  const newRequests = leaveDraftQueue.map((draft, index) => ({
    id: `leave-${currentUser.initials.toLowerCase()}-${Date.now()}-${draft.id}`,
    type: "Leave",
    ghostBid: Boolean(currentUser.ghostBidder),
    area: currentUser.area,
    name: userFullName(),
    initials: currentUser.initials,
    bidAs: currentUserBidAs(),
    seniority: currentUser.seniorityRank,
    priority: startingPriority + index,
    status: "Pending",
    submittedAt,
    submittedBy: currentUser.initials,
    submittedByRole: submissionRoleLabel(currentUser.role),
    batchId,
    submissionBatchKey: batchId,
    range: draft.range,
    days: draft.days,
    round: draft.round,
    weekUnits: draft.weekUnits || 0,
    weekKeys: draft.weekKeys || [],
    summary: `${currentUser.ghostBidder ? "Ghost Leave · " : currentUserBidAs() === "GL" ? "GL Bid · " : ""}${draft.range} · ${draft.days} ${draft.days === 1 ? "day" : "days"}${draft.weekUnits ? ` · ${draft.weekUnits} bid week` : ""}`,
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
        ghostBid: request.ghostBid,
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

function bidTypeLabel(item) {
  if (item?.type === "RDO Line" && item.ghostBid) return "Ghost Line";
  if (item?.type === "RDO Line" && item.bidAs === "GL") return "GL RDO";
  if (item?.type === "Leave" && item.ghostBid) return "Ghost Leave";
  if (item?.type === "Leave" && isGlLeaveItem(item)) return "GL Bid";
  return item?.type || "Bid";
}

function bidEmailDetail(item) {
  if (item.type === "RDO Line") {
    return `${item.ghostBid ? "Ghost Line" : "RDO Line"} ${item.line}, Fatigue: ${fatigueGroupPreferenceLabel(item.fatigueGroup)}, Flex: ${item.flex}, AWS: ${item.aws}, Mid: ${item.mid}.`;
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

function queueBidVerifiedEmail(item) {
  const round = bidRound(item);
  const subject = `Bid approved for ${item.initials} Round ${round} ${BID_YEAR}`;
  const detail = (item.members || [item]).map((member) => `${bidTypeLabel(member)} bid details: ${bidEmailDetail(member)}`).join("\n");
  const approvedAt = item.approvedAt || formatDateTime(new Date());
  queueNotificationEmail(
    bidRecipientEmail(item),
    subject,
    `Your submitted bid has been approved for Round ${round}.\n\n${detail}\n\nApproved at: ${approvedAt}\n\n${BID_OFFICE_CONTACT}`,
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
  const detail = (item.members || [item]).map((member) => `${bidTypeLabel(member)} bid details: ${bidEmailDetail(member)}`).join("\n");
  const reason = item.denialReason ? `\n\nReason: ${item.denialReason}` : "";
  queueNotificationEmail(
    bidRecipientEmail(item),
    `Bid denied for ${item.initials} Round ${round} ${BID_YEAR}`,
    `Your submitted bid was not approved for Round ${round}.\n\n${detail}${reason}\n\nPlease use the messaging system on the website, or text the Bidding Office at (661) 434-1004.`,
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
  item.appliedLine = item.bidAs === "GL" || item.ghostBid ? null : item.line;
  syncApprovedRdoItem(item);
  reconcilePendingLeaveForRdo(item.initials, item.area);
  logHistory(
    item.area,
    "RDO bid approved",
    item.bidAs === "GL" || item.ghostBid
      ? `${currentUser.initials} approved ${item.initials}'s Ghost Line bid for ${item.summary}. The source line remains available to later bidders.`
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
  if (!line || item.bidAs === "GL" || item.ghostBid) return;

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
  refreshLeaveItemCharge(item);

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
  item.reviewNote = item.ghostBid
    ? "Ghost leave approved. These dates do not count against area capacity."
    : item.leaveCapacityOverride ? `Approved with override for ${formatLeaveConflictDates(conflicts)}.` : "";
  logHistory(item.area, "Leave bid approved", item.ghostBid
    ? `${currentUser.initials} approved ${item.initials}'s ghost leave request for ${item.range}. No area leave slots were consumed.`
    : `${currentUser.initials} approved ${item.initials}'s leave request for ${item.range}. Leave slots were updated by the system.`);
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

function defaultCalendarWorkforce(scope) {
  if ((scope !== "dashboard" && scope !== "leave") || !currentUser || currentUser.role === "admin" || currentUser.systemAdmin) return "cpc";
  return leaveSlotBucketForBidAs(currentUserBidAs()) === "dev" ? "dev" : "cpc";
}

function calendarWorkforceStorageKey(scope) {
  if (scope === "public") return `${CALENDAR_WORKFORCE_SESSION_KEY_PREFIX}:public`;
  const identity = currentUser?.supabaseProfileId || currentUser?.initials || "anonymous";
  return `${CALENDAR_WORKFORCE_SESSION_KEY_PREFIX}:${scope}:${identity}`;
}

function calendarWorkforceForScope(scope) {
  if (scope !== "public" && scope !== "dashboard" && scope !== "leave") return null;
  const storageKey = calendarWorkforceStorageKey(scope);
  const currentOverride = calendarWorkforceOverrides.get(storageKey);
  if (currentOverride === "cpc" || currentOverride === "dev") return currentOverride;

  try {
    const stored = window.sessionStorage?.getItem(storageKey);
    if (stored === "cpc" || stored === "dev") {
      calendarWorkforceOverrides.set(storageKey, stored);
      return stored;
    }
  } catch (_error) {
    // The automatic default still works when browser storage is unavailable.
  }

  return defaultCalendarWorkforce(scope);
}

function setCalendarWorkforceForScope(scope, workforce) {
  if ((scope !== "public" && scope !== "dashboard" && scope !== "leave") || (workforce !== "cpc" && workforce !== "dev")) return;
  const storageKey = calendarWorkforceStorageKey(scope);
  calendarWorkforceOverrides.set(storageKey, workforce);

  try {
    window.sessionStorage?.setItem(storageKey, workforce);
  } catch (_error) {
    // Keep the current render usable even when browser storage is unavailable.
  }
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
  if (item.ghostBid) return;
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
  if (item.type !== "Leave" || item.ghostBid) return [];
  const bucket = leaveApprovalBucket(item);

  return leaveApprovalDates(item).filter((key) => {
    const details = leaveSlotsForDate(key, item.area || currentUser.area);
    const values = details[bucket] || [];
    return (bucket === "cpc" && fullLeaveDates.has(key)) || (leaveSlotOpenCountForDetails(details, bucket) === 0 && !values.includes(item.initials));
  });
}

function leaveRdoConflicts(item) {
  if (item.type !== "Leave") return [];
  return [];
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
    const originalLine = item.line;
    const originalGroup = item.fatigueGroup;
    item.line = editor.querySelector("[data-override-line]")?.value || item.line;
    item.fatigueGroup = editor.querySelector("[data-override-group]")?.value ?? item.fatigueGroup;
    if (item.line !== originalLine || item.fatigueGroup !== originalGroup) item.fatigueOverride = false;
    item.flex = editor.querySelector("[data-override-flex]")?.value || item.flex;
    item.aws = rdoPreferenceForBidRole(item.bidAs, item.area, editor.querySelector("[data-override-aws]")?.value || item.aws);
    item.mid = rdoPreferenceForBidRole(item.bidAs, item.area, editor.querySelector("[data-override-mid]")?.value || item.mid);
    item.summary = `${item.ghostBid ? "Ghost Line" : "Line"} ${item.line} · ${fatigueGroupPreferenceLabel(item.fatigueGroup)} · Flex ${item.flex} · AWS ${item.aws} · Mid ${item.mid}`;
    return;
  }

  item.range = editor.querySelector("[data-override-range]")?.value || item.range;
  item.days = Number(editor.querySelector("[data-override-days]")?.value || item.days);
  item.leaveCapacityOverride = Boolean(editor.querySelector("[data-override-capacity]")?.checked);
  item.summary = `${item.ghostBid ? "Ghost Leave · " : isGlLeaveItem(item) ? "GL Bid · " : ""}${item.range} · ${item.days} days`;
}

async function supabaseSubmissionIdForIntakeItem(item) {
  if (item.supabaseSubmissionId) return item.supabaseSubmissionId;
  const { data, error } = await supabaseClient().rpc("read_bidding_state", {
    requested_bid_year: BID_YEAR,
  });
  if (error) throw error;
  return intakeSubmissionIdFromBiddingState(item, data?.submissions || []);
}

// Review decisions change bid state and inventory, not FAQs, roster or settings.
// Keep existing data visible and commit the new snapshot only after all reads pass.
async function refreshBiddingAfterIntakeDecision({ expectedDecisionRevision = null } = {}) {
  const client = supabaseClient();
  if (!client || !supabaseState.bidYearId || supabaseState.loading) {
    await loadSupabaseReferenceData();
    return;
  }
  const userId = supabaseState.authUserId;
  const year = BID_YEAR;
  supabaseState.loading = true;
  let refreshFailed = false;
  let refreshError = null;
  try {
    const [bidding, leave, slots, lines, gl, windows, areas] = await Promise.all([
      readReferenceData("bidding state", () => client.rpc("read_bidding_state", { requested_bid_year: year })),
      readReferenceData("leave requests", () => client.rpc("read_leave_intake_queue", { queue_bid_year: year })),
      readReferenceData("leave slots", () => loadPublishedLeaveSlots(client)),
      readReferenceData("RDO lines", () => loadRdoLines(client, supabaseState.bidYearId)),
      readReferenceData("GL assignments", () => loadPublishedGlRdoAssignments(client)),
      readReferenceData("bid windows", () => loadPublishedBidWindows(client, supabaseState.bidYearId)),
      readReferenceData("areas", () => client.from("areas").select("id,name")),
    ]);
    for (const result of [bidding, leave, slots, lines, windows, areas]) {
      if (result.error) throw result.error;
    }
    if (gl.error && !isMissingSupabaseRoutine(gl.error)) throw gl.error;
    const submissions = bidding.data?.submissions || [];
    const leaveRows = attachSubmissionIdsToLeaveRequests(
      await attachLeaveRequestWeekBuckets(client, leave.data || []), submissions
    );
    if (supabaseState.authUserId !== userId || BID_YEAR !== year) return;
    if (expectedDecisionRevision !== null
      && (expectedDecisionRevision !== intakeDecisionRevision || intakeDecisionPending || hasActiveIntakeEditing())) return;
    const areaById = new Map((areas.data || []).map((area) => [area.id, area.name]));
    intakeQueue = intakeQueue.filter((item) => !item.supabaseSubmissionId && !item.supabaseRequestId);
    for (let index = leaveBids.length - 1; index >= 0; index--) {
      if (leaveBids[index].supabaseRequestId) leaveBids.splice(index, 1);
    }
    upsertRdoLinesFromDatabase(lines.data || [], areaById);
    if (!gl.error) applyGlRdoAssignments(gl.data || []);
    upsertRdoSubmissionsFromDatabase(submissions.filter((row) => biddingStateSubmissionType(row) === "RDO Line"
      && ["pending", "approved", "denied"].includes(String(row.status || "").toLowerCase())), areaById);
    upsertLeaveRequestsFromDatabase(leaveRows, areaById);
    applyLeaveSlotScheduleFromDatabase(supabaseRows(slots), areaById);
    applyBidWindowsFromDatabase(supabaseRows(windows));
    intakeBidderSelection.record = null;
    intakeBidderSelection.loading = false;
    intakeBidderSelection.error = "";
    intakeBidderSelection.generation += 1;
    supabaseState.placeholdersCleared = true;
    liveDataSnapshots.clear();
    supabaseState.loadedAt = new Date();
    lastAlertDatabaseSnapshot = "";
    calendarRenderRevision += 1;
  } catch (error) {
    refreshFailed = true;
    refreshError = error;
    console.warn("Bid review refresh failed; reloading reference data:", error.message || error);
  } finally {
    supabaseState.loading = false;
  }
  if (refreshFailed && expectedDecisionRevision !== null) throw refreshError;
  if (refreshFailed && supabaseState.authUserId === userId && BID_YEAR === year) await loadSupabaseReferenceData();
}

async function persistIntakeDecision(item, decision, denialReason = "") {
  if (!supabaseState.connected) {
    throw new Error("This intake decision could not reach the database. Check the connection and try again.");
  }
  const submissionId = await supabaseSubmissionIdForIntakeItem(item);
  if (!submissionId) throw new Error("The saved intake submission could not be found. Reload the queue and try again.");
  const overridePayload = item.type === "RDO Line"
    ? {
        line: item.line,
        fatigueGroup: item.fatigueGroup,
        fatigueOverride: Boolean(item.fatigueOverride),
        flex: item.flex === true || item.flex === "Yes",
        aws: item.aws === true || item.aws === "Yes",
        mid: item.mid,
        glLineTypeVerified: item.bidAs !== "GL" || Boolean(item.glLineTypeVerified),
      }
    : { leaveCapacityOverride: Boolean(item.leaveCapacityOverride) };
  const { error } = await supabaseClient().rpc("review_bidding_submission", {
    submission_to_review: submissionId,
    decision,
    denial_reason_text: denialReason || null,
    override_payload: overridePayload,
  });
  if (error) throw error;
  item.supabaseSubmissionId = submissionId;
  return true;
}

let intakeDecisionPending = false;
let intakeDecisionRevision = 0;
let intakeDecisionRefreshTimer = null;
let intakeDecisionRefreshRunning = false;

function hasActiveIntakeEditing() {
  if (activeOverrideId || activeDenialId || bidderEditor.busy) return true;
  const focused = document.activeElement;
  if (focused?.matches("input, textarea, select") && focused.closest(".app-shell")
    && !focused.closest("[hidden]") && focused.closest(".page.active")) return true;
  return [...document.querySelectorAll("[data-manual-bid-panel], [data-bidder-editor-form]")]
    .some((panel) => panel.closest(".page.active") && !panel.closest("[hidden]")
      && (panel.dataset.approvalRefreshDirty === "true" || panel.dataset.manualBidSubmitting === "true"));
}

function markIntakeEditing(event) {
  const panel = event.target.closest("[data-manual-bid-panel], [data-bidder-editor-form]");
  if (panel) panel.dataset.approvalRefreshDirty = "true";
}

document.addEventListener("input", markIntakeEditing, true);
document.addEventListener("change", markIntakeEditing, true);

function scheduleIntakeDecisionRefresh(delay = 350) {
  clearTimeout(intakeDecisionRefreshTimer);
  intakeDecisionRefreshTimer = setTimeout(() => {
    intakeDecisionRefreshTimer = null;
    void refreshIdleIntakeDecisions();
  }, delay);
}

async function refreshIdleIntakeDecisions() {
  if (intakeDecisionRefreshRunning) return;
  if (intakeDecisionPending || supabaseState.loading || hasActiveIntakeEditing()) {
    scheduleIntakeDecisionRefresh(1000);
    return;
  }
  const revision = intakeDecisionRevision;
  const userId = supabaseState.authUserId;
  const year = BID_YEAR;
  intakeDecisionRefreshRunning = true;
  try {
    await refreshBiddingAfterIntakeDecision({ expectedDecisionRevision: revision });
    if (supabaseState.authUserId !== userId || BID_YEAR !== year) return;
    if (intakeDecisionPending || intakeDecisionRevision !== revision || hasActiveIntakeEditing()) {
      scheduleIntakeDecisionRefresh(1000);
      return;
    }
    renderApp();
  } catch (error) {
    console.warn("Approval saved; background refresh unavailable:", error.message || error);
  } finally {
    intakeDecisionRefreshRunning = false;
  }
}

function updateConfirmedIntakeDecision(item, decision, reason = "") {
  intakeDecisionRevision += 1;
  const status = decision === "approved" ? "Approved" : "Denied";
  item.status = status;
  if (decision === "approved") item.approvedAt = formatDateTime(new Date());
  for (const member of item.members || [item]) {
    member.status = status;
    if (decision === "approved") member.approvedAt = item.approvedAt;
    if (reason) member.denialReason = reason;
    if (member.type === "Leave") {
      const bid = leaveBidForItem(member);
      if (bid) bid.status = status;
    }
  }
  // Clear the pending notification before inventory reads or email delivery finish.
  renderAlerts();
}

async function runIntakeDecision(action, id) {
  if (intakeDecisionPending) return;
  intakeDecisionPending = true;
  const buttons = [...document.querySelectorAll("[data-intake-approve], [data-intake-deny-confirm]")]
    .filter((button) => !button.disabled);
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const item = intakeReviewItemById(id);
    await action(id);
    if (item && ["Approved", "Denied"].includes(item.status)) {
      showActionFeedback(`${item.initials}'s bid ${item.status.toLowerCase()}.`, "success");
    } else {
      const note = intakeGroupReviewState.get(id)?.reviewNote || item?.reviewNote;
      if (note) showActionFeedback(note, "error");
    }
  } finally {
    intakeDecisionPending = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function approveIntakeItem(id) {
  const item = intakeReviewItemById(id);
  if (!item || item.status !== "Pending") return;
  if (item.members) {
    try { await reviewIntakeLeaveGroup(item, "approved"); }
    catch (error) {
      intakeGroupReviewState.set(id, { reviewNote: error.message || "This week or batch could not be approved." });
      renderIntakeQueue();
    }
    return;
  }
  if (activeOverrideId === id) captureIntakeOverrideFields(item);
  if (item.type === "RDO Line" && item.bidAs === "GL") {
    const verification = activeOverrideId === id
      ? document.querySelector("[data-gl-line-type-verification]")
      : null;
    if (!verification?.checked) {
      const line = rdoLines.find((entry) => entry.line === item.line && lineForArea(entry, item.area));
      const category = line && isCpcLine(line) ? (item.area === "TMU" ? "TMC" : "CPC") : "DEV";
      item.reviewNote = `Verify that this GL is bidding as ${category}, then approve from the review panel.`;
      activeOverrideId = id;
      activeDenialId = null;
      renderApp();
      setPage("intake");
      return;
    }
    item.glLineTypeVerified = true;
  }
  if (item.type === "RDO Line" && item.bidAs !== "GL" && !item.ghostBid && item.fatigueGroup && !["A", "B", "C"].includes(item.fatigueGroup)) {
    item.reviewNote = "Choose fatigue group A, B, C, or No preference before approving this bid.";
    activeOverrideId = id;
    renderApp();
    setPage("intake");
    return;
  }
  if (item.type === "RDO Line" && item.bidAs !== "GL" && !item.ghostBid && item.fatigueGroup) {
    const line = rdoLines.find((entry) => entry.line === item.line && lineForArea(entry, item.area));
    if (!item.fatigueOverride && !fatigueGroupIsAvailableForLine(line, item.fatigueGroup)) {
      item.reviewNote = `Fatigue Group ${item.fatigueGroup} is full for this area or RDO set. Assign an available group before approving this bid.`;
      activeOverrideId = id;
      renderApp();
      setPage("intake");
      return;
    }
  }
  let persisted = false;
  try {
    persisted = await persistIntakeDecision(item, "approved");
  } catch (error) {
    item.reviewNote = error.message || "This approval could not be saved.";
    renderApp();
    setPage("intake");
    return;
  }
  if (persisted) {
    updateConfirmedIntakeDecision(item, "approved");
    queueBidVerifiedEmail(item);
    activeOverrideId = null;
    activeDenialId = null;
    scheduleIntakeDecisionRefresh();
    renderIntakeQueue();
    setPage("intake");
    return;
  }
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

async function denyIntakeItem(id) {
  const item = intakeReviewItemById(id);
  if (!item || item.status !== "Pending") return;

  const reason = document.querySelector("[data-denial-reason]")?.value.trim() || "";
  if (!reason) {
    item.denialDraftError = "Enter a denial reason before sending this back to the BUE.";
    if (item.members) intakeGroupReviewState.set(id, { denialDraftError: item.denialDraftError });
    activeDenialId = id;
    activeOverrideId = null;
    renderApp();
    setPage("intake");
    return;
  }

  if (item.members) {
    try { await reviewIntakeLeaveGroup(item, "denied", reason); }
    catch (error) {
      intakeGroupReviewState.set(id, { denialDraftError: error.message || "This week or batch could not be denied." });
      renderIntakeQueue();
    }
    return;
  }
  let persisted = false;
  try {
    persisted = await persistIntakeDecision(item, "denied", reason);
  } catch (error) {
    item.denialDraftError = error.message || "This denial could not be saved.";
    renderApp();
    setPage("intake");
    return;
  }
  if (persisted) {
    item.denialReason = reason;
    updateConfirmedIntakeDecision(item, "denied", reason);
    queueBidDeniedEmail(item);
    activeDenialId = null;
    activeOverrideId = null;
    scheduleIntakeDecisionRefresh();
    renderIntakeQueue();
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

  logHistory(item.area, `${bidTypeLabel(item)} denied`, `${currentUser.initials} denied ${item.initials}'s ${bidTypeLabel(item)} request. Reason: ${reason}`);
  queueBidDeniedEmail(item);
  activeDenialId = null;
  activeOverrideId = null;
  renderApp();
  setPage("intake");
}

async function saveSupabaseApprovedLeaveEdit(item) {
  if (!intakeLeaveRoundIsOpen(item)) throw new Error(`Round ${intakeItemRound(item)} is closed. Approved leave dates can no longer be edited.`);
  const client = supabaseClient();
  if (!client) throw new Error("Supabase is not configured on this page.");
  if (!item?.supabaseRequestId) throw new Error("This approved leave request has not been saved to Supabase.");

  const dateKeys = datesInLeaveRange(item.range);
  if (!dateKeys.length) throw new Error("Choose a valid replacement date range.");

  const { data, error } = await client.rpc("replace_approved_leave_request_dates", {
    requested_leave_request_id: item.supabaseRequestId,
    requested_start_date: dateKeys[0],
    requested_end_date: dateKeys[dateKeys.length - 1],
    allow_capacity_override: Boolean(item.leaveCapacityOverride),
  });
  if (error) {
    if (isMissingSupabaseRoutine(error)) {
      throw new Error("Approved-date replacement is not installed. Run database/admin_leave_request_edit.sql in Supabase.");
    }
    throw error;
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (result?.charged_days !== undefined) {
    item.days = Number(result.charged_days);
    item.summary = `${item.range} · ${item.days} ${item.days === 1 ? "day" : "days"}`;
  }

  await refreshBiddingAfterIntakeDecision();
  return true;
}

async function removeApprovedLeaveBid(id) {
  const item = intakeReviewItemById(id);
  if (!item || item.type !== "Leave" || item.status !== "Approved" || !hasIntakeAccess()) return;
  if (!intakeLeaveRoundIsOpen(item)) {
    const reviewNote = `Round ${intakeItemRound(item)} is closed. This bid can no longer be removed.`;
    item.reviewNote = reviewNote;
    showActionFeedback(reviewNote, "error");
    if (item.members) intakeGroupReviewState.set(item.id, { reviewNote });
    renderIntakeQueue();
    return;
  }

  const requests = item.members || [item];
  const requestIds = requests.map((request) => request.supabaseRequestId).filter(Boolean);
  if (requestIds.length !== requests.length) {
    const reviewNote = "One or more leave dates are not linked to saved database records. Reload the queue before removing this bid.";
    item.reviewNote = reviewNote;
    showActionFeedback(reviewNote, "error");
    if (item.members) intakeGroupReviewState.set(item.id, { reviewNote });
    renderIntakeQueue();
    return;
  }

  const dateCount = item.dateKeys?.length || requests.reduce((total, request) => total + leaveDateKeysForItem(request).length, 0);
  const description = item.members
    ? `${dateCount} selected ${dateCount === 1 ? "date" : "dates"}`
    : item.range;
  if (!window.confirm(
    `Remove ${description} from ${item.initials}'s pre-approved leave slots?\n\n` +
    "The bid will be marked Cancelled and remain visible in history, but it will no longer reserve leave capacity."
  )) return;

  intakeLeaveRemovalPendingId = id;
  renderIntakeQueue();
  try {
    const client = supabaseClient();
    if (!client || !supabaseState.connected) {
      throw new Error("The leave bid could not reach the database. Check the connection and try again.");
    }
    const { error } = await client.rpc("admin_cancel_leave_requests", {
      requested_leave_request_ids: requestIds,
    });
    if (error) {
      if (isMissingSupabaseRoutine(error)) {
        throw new Error("Admin leave removal is not installed. Run the latest Supabase migration, then try again.");
      }
      throw error;
    }

    logHistory(
      item.area,
      "Approved leave bid removed",
      `${currentUser.initials} removed ${item.initials}'s ${description} from pre-approved leave slots. The cancelled bid remains in history.`
    );
    showActionFeedback("Approved leave bid removed.", "success");
    intakeLeaveRemovalPendingId = null;
    if (item.members) intakeGroupReviewState.delete(item.id);
    activeOverrideId = null;
    activeDenialId = null;
    supabaseState.placeholdersCleared = false;
    await refreshBiddingAfterIntakeDecision();
    renderApp();
    setPage("intake");
  } catch (error) {
    intakeLeaveRemovalPendingId = null;
    const reviewNote = error.message || "The approved leave bid could not be removed.";
    item.reviewNote = reviewNote;
    showActionFeedback(reviewNote, "error");
    if (item.members) intakeGroupReviewState.set(item.id, { reviewNote });
    renderApp();
    setPage("intake");
  }
}

async function saveSupabasePendingRdoEdit(item) {
  const client = supabaseClient();
  if (!client) throw new Error("Supabase is not configured on this page.");
  if (!item?.supabaseSubmissionId) throw new Error("This pending RDO bid has not been saved to Supabase.");

  const { error } = await client.rpc("update_pending_rdo_submission", {
    submission_to_update: item.supabaseSubmissionId,
    requested_line_code: item.line,
    requested_fatigue_group: item.fatigueGroup || null,
    requested_flex: item.flex === true || item.flex === "Yes",
    requested_aws: item.aws === true || item.aws === "Yes",
    requested_mid: item.mid,
  });
  if (error) {
    if (isMissingSupabaseRoutine(error)) {
      throw new Error("Pending RDO editing is not installed. Run database/transactional_bidding.sql in Supabase.");
    }
    throw error;
  }
  return true;
}

async function saveSupabaseApprovedRdoEdit(item) {
  const client = supabaseClient();
  if (!client || !supabaseState.connected) throw new Error("The RDO edit could not reach the database. Check the connection and try again.");
  let bidderId = item.bidderId;
  // Older read_bidding_state routines return initials and area without a bidder ID.
  if (!bidderId) {
    if (!item.initials || !item.area) throw new Error("The saved bidder could not be identified. Reload the queue before editing.");
    const { data: results, error: lookupError } = await client.rpc("read_admin_bidder_editor", {
      requested_bid_year: BID_YEAR, search_text: item.initials,
    });
    if (lookupError) throw lookupError;
    const matches = (results?.bidders || []).filter(person =>
      String(person.initials || "").trim().toUpperCase() === String(item.initials).trim().toUpperCase()
      && person.area === item.area);
    if (matches.length !== 1) throw new Error("The saved bidder could not be uniquely identified. Reload the queue before editing.");
    bidderId = matches[0].id;
  }
  const { data: record, error: readError } = await client.rpc("read_admin_bidder_editor", {
    requested_bid_year: BID_YEAR, target_bidder_id: bidderId,
  });
  if (readError) throw readError;
  const line = record.lines.find(entry => entry.line_code === item.line);
  if (!line) throw new Error("This RDO line is not eligible for the bidder.");
  if (record.snapshot.rdo?.id !== item.supabaseSubmissionId || record.snapshot.rdo?.status !== "approved") {
    throw new Error("This RDO bid has changed. Reload the queue and edit the latest approved bid.");
  }
  const { data, error } = await client.rpc("edit_admin_bidder", {
    requested_bid_year: BID_YEAR, target_bidder_id: bidderId,
    expected_snapshot: record.snapshot,
    changes: {
      rdo: { line_id: line.id, fatigue_group: item.fatigueGroup,
        flex: item.flex === true || item.flex === "Yes", aws: item.aws === true || item.aws === "Yes",
        mid: item.mid, gl_line_type_verified: item.bidAs !== "GL"
          || Boolean(document.querySelector("[data-gl-line-type-verification]")?.checked) },
      leave: record.snapshot.leave.map(row => ({ id: row.id,
        start_date: row.requested_start_date, end_date: row.requested_end_date })),
    },
    validate_only: false,
  });
  if (error) throw error;
  if (!data?.valid || !data?.saved) throw new Error((data?.errors || ["The database did not confirm the RDO save."]).join("\n"));
}

async function saveIntakeOverride(id) {
  const item = intakeQueue.find((entry) => entry.id === id);
  if (!item) return;
  if (item.type === "RDO Line" && !hasIntakeAccess()) {
    item.reviewNote = "Active intake access is required to edit RDO bids.";
    showActionFeedback(item.reviewNote, "error");
    activeOverrideId = null;
    renderIntakeQueue();
    return;
  }
  if (item.type === "Leave" && !intakeLeaveRoundIsOpen(item)) {
    item.reviewNote = `Round ${intakeItemRound(item)} is closed. Leave dates can no longer be edited.`;
    showActionFeedback(item.reviewNote, "error");
    activeOverrideId = null;
    renderIntakeQueue();
    return;
  }

  if (item.type === "RDO Line" && !supabaseState.connected) {
    item.reviewNote = "The RDO edit could not reach the database. Check the connection and try again.";
    showActionFeedback(item.reviewNote, "error");
    renderIntakeQueue();
    return;
  }

  const original = item.summary;
  const originalLine = item.line;
  const originalRange = item.range;
  const originalDays = item.days;
  const originalCapacityOverride = item.leaveCapacityOverride;
  const originalFatigueGroup = item.fatigueGroup;
  const originalFlex = item.flex;
  const originalAws = item.aws;
  const originalMid = item.mid;
  captureIntakeOverrideFields(item);

  if (item.status === "Pending" && item.type === "RDO Line" && supabaseState.connected) {
    try {
      await saveSupabasePendingRdoEdit(item);
      logHistory(
        item.area,
        "Intake override saved",
        `${currentUser.initials} edited ${item.initials}'s ${bidTypeLabel(item)} request from "${original}" to "${item.summary}".`
      );
      showActionFeedback("Bid changes saved.", "success");
      activeOverrideId = null;
      activeDenialId = null;
      supabaseState.placeholdersCleared = false;
      await refreshBiddingAfterIntakeDecision();
      renderApp();
      setPage("intake");
      return;
    } catch (error) {
      item.line = originalLine;
      item.fatigueGroup = originalFatigueGroup;
      item.flex = originalFlex;
      item.aws = originalAws;
      item.mid = originalMid;
      item.summary = original;
      item.reviewNote = error.message || "The pending RDO changes could not be saved.";
      showActionFeedback(item.reviewNote, "error");
      activeOverrideId = id;
      renderApp();
      setPage("intake");
      return;
    }
  }

  if (item.status === "Approved" && item.type === "RDO Line") {
    try {
      await saveSupabaseApprovedRdoEdit(item);
      showActionFeedback("Bid changes saved.", "success");
      activeOverrideId = null;
      activeDenialId = null;
      supabaseState.placeholdersCleared = false;
      await refreshBiddingAfterIntakeDecision();
      renderApp();
      setPage("intake");
    } catch (error) {
      item.line = originalLine;
      item.fatigueGroup = originalFatigueGroup;
      item.flex = originalFlex;
      item.aws = originalAws;
      item.mid = originalMid;
      item.summary = original;
      item.reviewNote = error.message || "The approved RDO changes could not be saved.";
      showActionFeedback(item.reviewNote, "error");
      activeOverrideId = id;
      renderApp();
      setPage("intake");
    }
    return;
  }

  if (item.status === "Approved" && item.type === "Leave" && supabaseState.connected && !item.supabaseRequestId) {
    item.range = originalRange;
    item.days = originalDays;
    item.leaveCapacityOverride = originalCapacityOverride;
    item.summary = original;
    item.reviewNote = "This approved leave request has not been saved to Supabase, so its dates cannot be replaced durably.";
    showActionFeedback(item.reviewNote, "error");
    activeOverrideId = id;
    renderApp();
    setPage("intake");
    return;
  }

  if (item.status === "Approved" && item.type === "Leave" && item.supabaseRequestId) {
    try {
      item.reviewNote = "Saving replacement dates...";
      showActionFeedback(item.reviewNote, "info");
      renderIntakeQueue();
      await saveSupabaseApprovedLeaveEdit(item);
      logHistory(
        item.area,
        "Approved leave dates replaced",
        `${currentUser.initials} replaced ${item.initials}'s approved leave dates from "${originalRange}" to "${item.range}".`
      );
      showActionFeedback("Bid changes saved.", "success");
      activeOverrideId = null;
      activeDenialId = null;
      renderApp();
      setPage("intake");
      return;
    } catch (error) {
      item.range = originalRange;
      item.days = originalDays;
      item.leaveCapacityOverride = originalCapacityOverride;
      item.summary = original;
      item.reviewNote = error.message || "The approved leave dates could not be replaced.";
      showActionFeedback(item.reviewNote, "error");
      activeOverrideId = id;
      renderApp();
      setPage("intake");
      return;
    }
  }

  if (item.status === "Approved") {
    if (item.type === "RDO Line") {
      if (item.bidAs !== "GL" && !item.ghostBid && originalLine !== item.line) {
        const oldLine = rdoLines.find((entry) => entry.line === originalLine && lineForArea(entry, item.area));
        if (oldLine?.cpc === item.initials) {
          oldLine.cpc = "";
          oldLine.status = "Open";
        }
      }
      syncApprovedRdoItem(item);
      item.appliedLine = item.bidAs === "GL" || item.ghostBid ? null : item.line;
    }
    if (item.type === "Leave") {
      removeInitialsFromLeaveRange(originalRange, item.initials);
      syncApprovedLeaveItem(item);
    }
  }

  logHistory(
    item.area,
    item.status === "Approved" ? "Admin override applied" : "Intake override saved",
    `${currentUser.initials} edited ${item.initials}'s ${bidTypeLabel(item)} request from "${original}" to "${item.summary}".`
  );
  showActionFeedback("Bid changes saved.", "success");
  activeDenialId = null;
  renderApp();
  setPage("intake");
}

function rdoRequestAwaitingApproval() {
  const latestRequest = intakeQueue.find((item) =>
    item.type === "RDO Line" &&
    item.initials === currentUser.initials &&
    item.area === currentUser.area &&
    ["Pending", "Approved", "Denied"].includes(item.status)
  );
  return Boolean(latestRequest && latestRequest.status !== "Approved");
}


function selectedRdoWeekdays() {
  if (rdoRequestAwaitingApproval()) return new Set();
  const submittedLine = submittedRdoLineForInitials(currentUser.initials);
  const eligibleLines = rdoLinesForBidder(currentUserBidAs(), currentUser.area);
  const line = submittedLine || eligibleLines.find((item) => item.line === selectedLineId) || eligibleLines[0] || null;
  return rdoWeekdaysForLine(line);
}


function rdoWeekdaysForLine(line) {
  if (!line) return new Set();
  return new Set(line.week.map((value, index) => (value === "RDO" ? index : null)).filter((index) => index !== null));
}

function leaveDateConflictsWithRdoLine(key, line) {
  return Boolean(line) && rdoWeekdaysForLine(line).has(dateFromKey(key).getDay());
}

function reconcileUnsubmittedLeaveForRdoLine(line) {
  if (!line) return 0;

  let removedDates = 0;
  const nextDrafts = [];

  leaveDraftQueue.forEach((item) => {
    const dateKeys = leaveDateKeysForItem(item);
    const conflictingDates = dateKeys.filter((key) => leaveDateConflictsWithRdoLine(key, line));
    if (!conflictingDates.length) {
      nextDrafts.push(item);
      return;
    }
    removedDates += conflictingDates.length;
  });
  leaveDraftQueue = nextDrafts;

  let removedSelectedDate = false;
  [...selectedLeaveDates].forEach((key) => {
    if (!leaveDateConflictsWithRdoLine(key, line)) return;
    selectedLeaveDates.delete(key);
    removedSelectedDate = true;
    removedDates += 1;
  });
  if (removedSelectedDate) leaveRangePreviewActive = false;

  if (leaveRangePreviewActive) {
    const previewKeys = leaveBuilderDateKeys();
    if (previewKeys.some((key) => leaveDateConflictsWithRdoLine(key, line))) {
      leaveRangePreviewActive = false;
      removedDates += previewKeys.filter((key) => leaveDateConflictsWithRdoLine(key, line)).length;
    }
  }

  if (!removedDates) return 0;

  const remainingSelection = [...selectedLeaveDates].sort();
  if (remainingSelection.length) {
    leaveRangeStartKey = remainingSelection[0];
    leaveRangeEndKey = remainingSelection[remainingSelection.length - 1];
    leaveRangeSelectionComplete = true;
  } else if (usesIndividualLeaveDateSelection()) {
    leaveRangeSelectionComplete = false;
  }

  syncLeaveBuilderInputs();
  renderLeaveDatePicker();
  renderLeaveDraftQueue();
  renderLeaveAllowanceSummary();
  setLeaveBuilderStatus(
    `${removedDates} unsubmitted leave ${removedDates === 1 ? "date was" : "dates were"} removed because ${removedDates === 1 ? "it is" : "they are"} an RDO on Line ${line.line}.`,
    "info"
  );
  return removedDates;
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
  const line = submittedRdoLineForInitials(initials) || rdoLineForInitials(initials);
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

// Share derived read data only during one synchronous operation. Always discard
// it before returning so edits, RDO changes, and database refreshes remain fresh.

function withLeaveReadCache(read) {
  if (leaveReadCache) return read();
  leaveReadCache = new Map();
  try { return read(); }
  finally { leaveReadCache = null; }
}

function cachedLeaveRead(key, read) {
  if (!leaveReadCache) return read();
  if (!leaveReadCache.has(key)) leaveReadCache.set(key, read());
  return leaveReadCache.get(key);
}

function makeCalendarRenderContext({ area, showRdo, showPersonalLeave, deferSlotTooltip, publicReadOnly = false, slotBucket = null }) {
  return {
    area,
    mode: calendarMode,
    slotBucket,
    showRdo,
    showPersonalLeave,
    deferSlotTooltip,
    publicReadOnly,
    rdoWeekdays: showRdo ? selectedRdoWeekdays() : new Set(),
    draftDates: showPersonalLeave ? leaveDraftDateSet() : new Set(),
    previewDates: showPersonalLeave && leaveRangePreviewActive ? new Set(leaveBuilderDateKeys()) : new Set(),
    builderDates: showPersonalLeave && usesIndividualLeaveDateSelection() && !leaveRangePreviewActive
      ? new Set(leaveBuilderDateKeys())
      : new Set(),
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

function syncMobileCalendarControls(target) {
  let controls = document.querySelector(`[data-mobile-calendar="${target.id}"]`);
  if (!controls) {
    controls = document.createElement("div");
    controls.className = "mobile-calendar-controls";
    controls.dataset.mobileCalendar = target.id;
    controls.innerHTML = `
      <div class="mobile-month-navigation">
        <button type="button" data-mobile-month-step="-1" aria-label="Previous month">‹</button>
        <label><span class="visually-hidden">Month</span><select data-mobile-month aria-label="Calendar month">${monthNames.map((name, index) => `<option value="${index}">${name}</option>`).join("")}</select></label>
        <button type="button" data-mobile-month-step="1" aria-label="Next month">›</button>
      </div>
      <div class="mobile-calendar-actions"><button type="button" data-mobile-calendar-annual aria-pressed="false">Show full year</button><button type="button" data-calendar-year-action="today">Bid year</button></div>`;
    target.before(controls);
  }
  controls.querySelectorAll("[data-mobile-month] option").forEach((option, index) => { option.textContent = `${monthNames[index]} ${displayedCalendarYear}`; });
  controls.querySelector("[data-mobile-month]").value = String(displayedCalendarMonth);
  const annual = annualMobileCalendars.has(target.id);
  const toggle = controls.querySelector("[data-mobile-calendar-annual]");
  toggle.setAttribute("aria-pressed", String(annual));
  toggle.textContent = annual ? "Show one month" : "Show full year";
}

function syncMobileCalendarMonths(target) {
  target.classList.toggle("mobile-single-month", !annualMobileCalendars.has(target.id));
  target.querySelectorAll("[data-calendar-month]").forEach((month) => {
    month.classList.toggle("mobile-current-month", Number(month.dataset.calendarMonth) === displayedCalendarMonth && Number(month.dataset.calendarYear) === displayedCalendarYear);
  });
}

function initializeMobilePublicNavigation() {
  const login = document.querySelector(".public-login");
  const slot = document.querySelector(".mobile-login-slot");
  if (!login || !slot) return;
  const placeholder = document.createComment("Desktop login position");
  login.before(placeholder);
  const query = window.matchMedia("(max-width: 720px)");
  const relocate = () => {
    if (query.matches) slot.append(login);
    else placeholder.after(login);
  };
  query.addEventListener("change", relocate);
  relocate();

  const calendarQuery = window.matchMedia("(max-width: 900px)");
  calendarQuery.addEventListener("change", () => renderVisibleCalendars());
}

function openPublicDateSheet(button) {
  return withLeaveReadCache(() => openPublicDateSheetWithCache(button));
}

function openPublicDateSheetWithCache(button) {
  const key = button.dataset.publicLeaveDate;
  // A day popup needs only this date, not formatted records for the whole year.
  const slotMap = leaveSlotMapUncached(publicState.area, key);
  const details = visibleLeaveSlotDetailsFromMap(key, publicState.area, slotMap, { includePrivateOverlays: false });
  const sheet = document.querySelector("[data-public-date-sheet]");
  document.getElementById("public-date-title").textContent = `${formatCalendarDate(key)}, ${dateFromKey(key).getFullYear()}`;
  if (!leaveSlotDataIsLoaded(details)) {
    sheet.querySelector("[data-public-date-content]").innerHTML = `<p role="status">${escapeHtml(leaveSlotLoadingMessage())}</p>`;
    sheet.showModal();
    return;
  }
  const holiday = calendarHolidayKind(key, { area: publicState.area, showRdo: false, showPersonalLeave: false });
  sheet.querySelector("[data-public-date-content]").innerHTML = `
    <p>${escapeHtml(publicState.area)} · Read-only availability</p>
    ${holiday ? `<p>${escapeHtml(holiday.label)}</p>` : ""}
    ${["cpc", "dev"].map((bucket) => {
      const name = bucket === "cpc" ? "CPC" : "Developmental";
      const capacity = leaveSlotCapacityForDetails(details, bucket);
      return `<section><h3>${name} · ${leaveSlotOpenCountForDetails(details, bucket)} open</h3>
        ${capacity ? Array.from({length: capacity}, (_, index) => `<div class="slot-row"><span>${name} ${index + 1}</span><b>${escapeHtml(details[bucket][index] || "Open")}</b></div>`).join("") : "<p>No slots available.</p>"}</section>`;
    }).join("")}
    ${(details.glBids || []).length ? `<section class="gl-bid-detail"><h3>GL Bids · no slots used</h3>${details.glBids.map((bid) => `<div class="slot-row gl-bid-row"><span>GL Bid</span><b aria-label="${escapeHtml(`${bid.initials} · GL Bid${bid.status ? ` · ${bid.status}` : ""}`)}">${escapeHtml(bid.initials)}</b></div>`).join("")}</section>` : ""}
    ${details.unavailable ? '<p>This day is unavailable for additional bidding.</p>' : ""}`;
  sheet.showModal();
}

function makeCalendar(targetId, { reuseCurrent = false } = {}) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const isPublicCalendar = targetId === "public-calendar";
  const ownerPage = target.closest(".page");
  if (!isPublicCalendar && ownerPage && !ownerPage.classList.contains("active")) return;
  if (
    reuseCurrent &&
    target.childElementCount > 0 &&
    Number(target.dataset.calendarRevision) === calendarRenderRevision
  ) {
    return;
  }
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
  const slotBucket = calendarWorkforceForScope(calendarScope);
  const deferSlotTooltip = window.matchMedia("(max-width: 900px)").matches && !expandedSlots;
  const renderKey = [
    displayedCalendarYear,
    calendarMode,
    area,
    showRdo,
    showPersonalLeave,
    deferSlotTooltip,
    expandedSlots,
    slotBucket,
  ].join("|");
  const monthIndexes = monthNames.map((_, index) => index);

  syncMobileCalendarControls(target);
  target.classList.remove("month-view", "week-view");
  target.classList.toggle("expanded-slots-calendar", expandedSlots);

  if (reuseCurrent) {
    const reusableCalendar = [...document.querySelectorAll(".app-shell .year-calendar[id]")].find(
      (calendar) =>
        calendar !== target &&
        calendar.childElementCount > 0 &&
        Number(calendar.dataset.calendarRevision) === calendarRenderRevision &&
        calendar.dataset.calendarRenderKey === renderKey
    );
    if (reusableCalendar) {
      target.replaceChildren(...[...reusableCalendar.childNodes].map((node) => node.cloneNode(true)));
      syncMobileCalendarMonths(target);
      target.dataset.calendarRevision = String(calendarRenderRevision);
      target.dataset.calendarRenderKey = renderKey;
      return;
    }
  }

  const context = makeCalendarRenderContext({
    area,
    showRdo,
    showPersonalLeave,
    deferSlotTooltip,
    publicReadOnly: isPublicCalendar,
    slotBucket,
  });

  target.innerHTML = monthIndexes
    .map((monthIndex) => renderMonthCard(monthIndex, displayedCalendarYear, {
      showRdo,
      showPersonalLeave,
      area,
      deferSlotTooltip,
      expandedSlots,
      context,
    }))
    .join("") + renderLeaveYearContinuation(displayedCalendarYear, {
      showRdo,
      showPersonalLeave,
      area,
      deferSlotTooltip,
      expandedSlots,
      context,
    });
  syncMobileCalendarMonths(target);
  target.dataset.calendarRevision = String(calendarRenderRevision);
  target.dataset.calendarRenderKey = renderKey;
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
    <article class="month-card" data-calendar-month="${monthIndex}" data-calendar-year="${year}">
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
  const isPreviewLeave = showVacationLayer && showPersonalLeave && isInsideLeaveYear && (
    context ? context.previewDates.has(key) : isLeavePreviewRangeDate(key)
  );
  const isDraftLeave = isPreviewLeave || (
    showVacationLayer && showPersonalLeave && canShowLeaveState && (
      context ? context.draftDates.has(key) : isDraftLeaveDate(key)
    )
  );
  const isBuilderDate = showVacationLayer && showPersonalLeave && canShowLeaveState && (
    context ? context.builderDates.has(key) : usesIndividualLeaveDateSelection() && !leaveRangePreviewActive && isLeaveBuilderRangeDate(key)
  );
  const holidayKind = !isInsideLeaveYear || !showVacationLayer ? null : context ? cachedCalendarHolidayKind(key, context, options) : calendarHolidayKind(key, options);
  const baseSlotDetails = context ? cachedBaseLeaveSlotDetails(key, context) : null;
  const detailArea = context?.area || options.area || currentUser.area;
  const availabilityBucket = context?.slotBucket || options.slotBucket || "cpc";
  const slotDataLoaded = leaveSlotDataIsLoaded(baseSlotDetails || leaveSlotsForDate(key, detailArea));
  const hasOneTmuSlotLeft = showVacationLayer && isInsideLeaveYear && detailArea === "TMU" && slotDataLoaded
    && leaveSlotOpenCountForDetails(baseSlotDetails || leaveSlotsForDate(key, detailArea), availabilityBucket) === 1;
  const isClosed = canShowLeaveState && slotDataLoaded && (
    baseSlotDetails
      ? leaveSlotOpenCountForDetails(baseSlotDetails, availabilityBucket) === 0 || (availabilityBucket === "cpc" && detailArea === "Area A" && fullLeaveDates.has(key))
      : isLeaveSlotsFull(key, options.area, availabilityBucket)
  );
  const expandedSlots = Boolean(options.expandedSlots);
  const hasDetail = isInsideLeaveYear && (showVacationLayer || expandedSlots);
  const visibleSlotDetails = hasDetail
    ? context ? cachedVisibleLeaveSlotDetails(key, context) : visibleLeaveSlotDetails(key, options.area)
    : null;
  const glBids = visibleSlotDetails?.glBids || [];
  const hasGlBid = glBids.length > 0;
  const isSelected = canShowLeaveState && key === selectedLeaveDateKey;
  const slotTooltip = hasDetail && !options.deferSlotTooltip
    ? quickLeaveSlotTooltip(key, holidayKind, options.area, visibleSlotDetails, expandedSlots)
    : "";
  const className = [
    holidayKind?.className || "",
    isPreviousLeaveYear ? "previous-leave-year-day" : "",
    isAfterLeaveYear ? "after-leave-year-day" : "",
    isBuilderDate ? "builder-range-day builder-range-edge" : "",
    isDraftLeave ? "draft-leave-day" : "",
    isPendingLeave ? "pending-leave-day" : "",
    isApprovedLeave ? "leave-day" : "",
    isRdo ? "rdo-day" : "",
    isClosed ? "closed-day" : "",
    hasOneTmuSlotLeft ? "tmu-one-slot-left" : "",
    hasGlBid ? "has-gl-bid" : "",
    fatigueClass ? `fatigue-week fatigue-${fatigueClass}` : "",
    nextFatigueClass ? `fatigue-split fatigue-to-${nextFatigueClass}` : "",
    hasDetail ? "has-slot-detail" : "",
    expandedSlots ? "slot-expanded-day" : "",
    isSelected ? "selected-date" : "",
  ].filter(Boolean).join(" ");
  const fatigueStatus = nextFatigueGroup
    ? `Group ${fatigueGroup} / Group ${nextFatigueGroup} transition fatigue day`
    : `Group ${fatigueGroup} fatigue week`;
  const workforceLabel = availabilityBucket === "dev" ? "DEV" : "CPC";
  const glBidStatus = hasGlBid ? `; GL Bid: ${glBids.map((bid) => bid.initials).join(", ")} (no slot used)` : "";
  const vacationStatus = `${holidayKind?.label || (!slotDataLoaded ? leaveSlotLoadingMessage() : isRdo ? "RDO - leave bidding unavailable" : isClosed ? `${workforceLabel} leave slots filled` : `${workforceLabel} leave slots available; view CPC and DEV slots`)}${glBidStatus}`;
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
    : hasDetail ? "" : 'aria-disabled="true"';

  return `
    <button class="${className}" type="button" data-calendar-date="${key}" ${leaveDateAttribute} ${fatigueAttribute} ${nextFatigueAttribute} aria-label="${monthNames[monthIndex]} ${day}, ${year}: ${ariaStatus}">
      ${isFatigueWeekStart ? `<i class="fatigue-week-dot" aria-hidden="true"></i>` : ""}
      ${expandedSlots ? `
        <span class="expanded-day-heading">
          <span class="date-number" data-day-number="${day}">${label}</span>
          ${hasGlBid ? `<span class="gl-bid-marker" title="GL Bid · no slot used" aria-label="GL Bid">*</span>` : ""}
        </span>
      ` : `<span class="date-number">${label}</span>${hasGlBid ? `<span class="gl-bid-marker" title="GL Bid · no slot used" aria-label="GL Bid">*</span>` : ""}`}
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
  document.querySelectorAll("[data-calendar-workforce]").forEach((button) => {
    const scope = button.dataset.calendarScope;
    const isActive = calendarWorkforceForScope(scope) === button.dataset.calendarWorkforce;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  document.querySelectorAll("[data-calendar-layout-description]").forEach((description) => {
    const scope = description.dataset.calendarLayoutDescription;
    const workforce = calendarWorkforceForScope(scope);
    description.textContent = calendarLayouts[scope] === "full"
      ? "Every CPC and developmental slot is shown directly on each date."
      : workforce ? "Select a date to view its CPC and developmental slots." : "Select a date to view its slots.";
  });
}

function renderCalendars({ includePublic = true, includeMember = true, reuseCurrent = false } = {}) {
  return withLeaveReadCache(() => renderCalendarsWithCache({ includePublic, includeMember, reuseCurrent }));
}

function renderCalendarsWithCache({ includePublic = true, includeMember = true, reuseCurrent = false } = {}) {
  if (!reuseCurrent) calendarRenderRevision += 1;
  updateCalendarViewControls();
  updateCalendarYearLabels();
  if (includePublic) makeCalendar("public-calendar", { reuseCurrent });
  if (includeMember) {
    makeCalendar("dashboard-calendar", { reuseCurrent });
    makeCalendar("leave-calendar", { reuseCurrent });
    makeCalendar("full-calendar", { reuseCurrent });
  }
}

function memberCalendarForPage(pageName) {
  const calendarIds = {
    dashboard: "dashboard-calendar",
    leave: "leave-calendar",
    calendar: "full-calendar",
  };
  const calendarId = calendarIds[pageName];
  return calendarId ? document.getElementById(calendarId) : null;
}

function memberPageCalendarNeedsRender(pageName) {
  const calendar = memberCalendarForPage(pageName);
  return Boolean(
    calendar && (
      calendar.childElementCount === 0 ||
      Number(calendar.dataset.calendarRevision) !== calendarRenderRevision
    )
  );
}

function renderMemberCalendarForPage(pageName, { defer = false } = {}) {
  if (pendingPageCalendarFrame) {
    window.cancelAnimationFrame(pendingPageCalendarFrame);
    pendingPageCalendarFrame = 0;
  }

  const render = () => {
    pendingPageCalendarFrame = 0;
    if (document.querySelector(".page.active")?.dataset.pagePanel !== pageName) return;
    renderCalendars({ includePublic: false, reuseCurrent: true });
    memberCalendarForPage(pageName)?.removeAttribute("aria-busy");
  };

  if (defer) {
    memberCalendarForPage(pageName)?.setAttribute("aria-busy", "true");
    pendingPageCalendarFrame = window.requestAnimationFrame(() => {
      pendingPageCalendarFrame = window.requestAnimationFrame(render);
    });
    return;
  }

  render();
}

function refreshMemberCalendarDates(dateKeys = [], { includeInactive = false } = {}) {
  return withLeaveReadCache(() => refreshMemberCalendarDatesWithCache(dateKeys, { includeInactive }));
}

function refreshMemberCalendarDatesWithCache(dateKeys = [], { includeInactive = false } = {}) {
  const uniqueKeys = [...new Set(dateKeys)].filter(Boolean);
  if (!uniqueKeys.length) return;

  document.querySelectorAll(".app-shell .year-calendar[id]").forEach((calendar) => {
    if (!calendar.childElementCount) return;
    const ownerPage = calendar.closest(".page");
    if (!includeInactive && ownerPage && !ownerPage.classList.contains("active")) return;

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
      slotBucket: calendarWorkforceForScope(scope),
    });

    uniqueKeys.forEach((key) => {
      const button = calendar.querySelector(`[data-calendar-date="${key}"]`);
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

function refreshMemberCalendarRdoPattern(previousWeekdays = new Set()) {
  const nextWeekdays = selectedRdoWeekdays();
  const changedWeekdays = new Set(
    [...previousWeekdays, ...nextWeekdays].filter(
      (weekday) => previousWeekdays.has(weekday) !== nextWeekdays.has(weekday)
    )
  );
  if (!changedWeekdays.size) return;

  const affectedDateKeys = new Set();
  document.querySelectorAll(".app-shell .year-calendar [data-calendar-date]").forEach((button) => {
    const key = button.dataset.calendarDate;
    if (key && changedWeekdays.has(dateFromKey(key).getDay())) affectedDateKeys.add(key);
  });
  refreshMemberCalendarDates([...affectedDateKeys], { includeInactive: true });
}

function syncMemberCalendarSelection(previousPreviewKeys = []) {
  refreshMemberCalendarDates(previousPreviewKeys);

  const draftDates = leaveDraftDateSet();
  const previewDates = leaveRangePreviewActive ? new Set(leaveBuilderDateKeys()) : new Set();
  const builderDates = usesIndividualLeaveDateSelection() && !leaveRangePreviewActive
    ? new Set(leaveBuilderDateKeys())
    : new Set();
  document.querySelectorAll(".app-shell [data-calendar-date]").forEach((button) => {
    const key = button.dataset.calendarDate;
    button.classList.toggle("selected-date", key === selectedLeaveDateKey && !button.classList.contains("rdo-day"));
    button.classList.toggle("draft-leave-day", draftDates.has(key) || previewDates.has(key));
    button.classList.toggle("builder-range-day", builderDates.has(key));
    button.classList.toggle("builder-range-edge", builderDates.has(key));
  });
}

function leaveSlotMap(area = currentUser.area) {
  return cachedLeaveRead(JSON.stringify(["leaveSlotMap", area]), () => leaveSlotMapUncached(area));
}

function leaveSlotMapUncached(area = currentUser.area, onlyDate = null) {
  const entries = {};

  leaveSlotWeeks.forEach((week) => {
    week.days.forEach((day) => {
      if (onlyDate && day.date !== onlyDate) return;
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
    if (onlyDate && date !== onlyDate) return;
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

  return {
    ...details,
    area: details.area || area,
    cpc: details.cpc || [],
    dev: details.dev || [],
    glBids: details.glBids || [],
    holiday: details.holiday || isHolidayDate(key),
    holidayInLieu,
  };
}

function leaveSlotsForDate(key, area = currentUser.area) {
  return leaveSlotsForDateFromMap(key, area);
}

function leaveSlotDataIsLoaded(details) {
  return ["cpcCapacity", "devCapacity", "cpcOpen", "devOpen"].every((field) => (
    details?.[field] !== null && details?.[field] !== undefined
    && Number.isFinite(Number(details[field])) && Number(details[field]) >= 0
  ));
}

function leaveSlotLoadingMessage() {
  return supabaseState.leaveSlotsLoadState === "loading"
    || (supabaseState.leaveSlotsLoadState === "idle" && !supabaseState.referenceDataLoaded)
    ? "Loading leave slots…"
    : "Leave slots could not be loaded. Refresh to try again.";
}

function leaveSlotCapacityForDetails(details, bucket) {
  const configuredCapacity = Number(details?.[`${bucket}Capacity`]);
  if (Number.isFinite(configuredCapacity) && configuredCapacity >= 0) return configuredCapacity;
  return 0;
}

function standardLeaveSlotCapacity(area, bucket) {
  if (area === "TMU") return 2;
  return leaveSlotCapacity[bucket];
}

function leaveSlotCapacityOverrideKey(area, key) {
  return `${area}|${key}`;
}

function leaveSlotOpenCountForDetails(details, bucket) {
  const configuredOpenCount = Number(details?.[`${bucket}Open`]);
  if (Number.isFinite(configuredOpenCount) && configuredOpenCount >= 0) return configuredOpenCount;
  return Math.max(0, leaveSlotCapacityForDetails(details, bucket) - (details?.[bucket] || []).length);
}

function hasLeaveSlotDetails(key, area = currentUser.area) {
  return Boolean(leaveSlotMap(area)[key]) || isHolidayDate(key) || (area === "Area A" && fullLeaveDates.has(key));
}

function isLeaveSlotsFull(key, area = currentUser.area, bucket = "cpc") {
  const details = leaveSlotsForDate(key, area);
  return leaveSlotDataIsLoaded(details) && (leaveSlotOpenCountForDetails(details, bucket) === 0 || (bucket === "cpc" && area === "Area A" && fullLeaveDates.has(key)));
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
  if (!leaveSlotDataIsLoaded(details)) {
    return `<span class="leave-date-tooltip slot-summary${persistent ? " permanent-slot-summary" : ""}"><span>${escapeHtml(leaveSlotLoadingMessage())}</span></span>`;
  }
  const cpcCapacity = leaveSlotCapacityForDetails(details, "cpc");
  const devCapacity = leaveSlotCapacityForDetails(details, "dev");
  const cpcSlots = Array.from({ length: cpcCapacity }, (_, index) => details.cpc[index] || "");
  const devSlots = Array.from({ length: devCapacity }, (_, index) => details.dev[index] || "");
  const glBids = details.glBids || [];
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
    <span class="leave-date-tooltip slot-summary${details.area === "TMU" || area === "TMU" ? " tmu-slot-summary" : ""}${persistent ? " permanent-slot-summary" : ""}" role="${persistent ? "group" : "tooltip"}"${persistent ? ` aria-label="Leave slots for ${formatCalendarDate(key)}"` : ""}>
      ${persistent ? "" : `<strong>${formatCalendarDate(key)}</strong>`}
      ${holidayKind && !persistent ? `<span class="tooltip-date-kind ${holidayKind.badgeClass}">${holidayKind.label}</span>` : ""}
      <span class="tooltip-slot-rows">
        <span class="tooltip-slot-heading">CPC</span>
        ${cpcSlots.map((value, index) => renderSlotRow("C", value, index)).join("")}
        <span class="tooltip-slot-rule"></span>
        <span class="tooltip-slot-heading">DEV</span>
        ${devSlots.map((value, index) => renderSlotRow("D", value, index)).join("")}
        ${glBids.length ? `<span class="tooltip-slot-rule"></span><span class="tooltip-slot-heading gl-bid-heading">GL Bids · no slot used</span>${glBids.map((bid) => `
          <span class="tooltip-slot-row gl-bid-row filled">
            <span class="tooltip-slot-name">GL Bid</span>
            <b class="tooltip-slot-value" aria-label="${escapeHtml(`${bid.initials} · GL Bid${bid.status ? ` · ${bid.status}` : ""}`)}">${escapeHtml(bid.initials)}</b>
          </span>`).join("")}` : ""}
      </span>
    </span>
  `;
}

function renderLeaveSlotBoard(options = {}) {
  return withLeaveReadCache(() => renderLeaveSlotBoardWithCache(options));
}

function renderLeaveSlotBoardWithCache({ key = selectedLeaveDateKey, area = currentViewArea(), inspectOnly = false } = {}) {
  const target = document.getElementById("leave-slot-board");
  if (!target) return;

  const details = inspectOnly
    ? visibleLeaveSlotDetailsFromMap(key, area, leaveSlotMap(area), { includePrivateOverlays: false })
    : leaveSlotsForDate(key, area);
  if (!leaveSlotDataIsLoaded(details)) {
    target.innerHTML = `<article class="leave-day-detail"><h3>${escapeHtml(details.label)}</h3><p role="status">${escapeHtml(leaveSlotLoadingMessage())}</p></article>`;
    return;
  }
  const ghostBids = inspectOnly ? ghostLeaveBidsForDate(key, area) : [];
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
        ${details.holidayInLieu ? `<span><b>Holiday In-Lieu</b> ${holidayInLieuIsProvisional() ? "provisional—pending RDO approval" : "observed for your RDO line"}</span>` : ""}
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
      ${inspectOnly && (details.glBids || []).length ? `<section class="daily-slot-card gl-bid-detail" aria-label="GL bids, no slots used">
        <h4>GL bids · no slots used</h4>
        ${details.glBids.map((bid) => `<div class="slot-row"><span>GL Bid · ${escapeHtml(bid.status || "Pending")}</span><b>${escapeHtml(bid.initials)}</b></div>`).join("")}
      </section>` : ""}
      ${ghostBids.length ? `<section class="daily-slot-card ghost-bid-detail" aria-label="Ghost bids, no slots used">
        <h4>Ghost bids · no slots used</h4>
        ${ghostBids.map((bid) => `<div class="slot-row"><span>Ghost Bid · ${escapeHtml(bid.status)}</span><b>${escapeHtml(bid.initials)}</b></div>`).join("")}
      </section>` : ""}
      ${details.unavailable ? '<p class="unavailable-note">This day is blocked or manually unavailable for additional bidding.</p>' : ""}
    </article>
  `;
}

let leaveSlotReturnFocus = null;

function openLeaveSlotModal(options = {}) {
  renderLeaveSlotBoard(options);
  const modal = document.querySelector("[data-leave-slot-modal]");
  if (!modal) return;
  leaveSlotReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modal.hidden = false;
  document.body.classList.add("modal-open");
  window.requestAnimationFrame(() => modal.querySelector("[data-leave-slot-close]")?.focus());
}

function closeLeaveSlotModal() {
  const modal = document.querySelector("[data-leave-slot-modal]");
  if (!modal) return;
  const wasOpen = !modal.hidden;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  if (wasOpen && leaveSlotReturnFocus?.isConnected) leaveSlotReturnFocus.focus();
  leaveSlotReturnFocus = null;
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
  return cachedLeaveRead(JSON.stringify(["legalHolidayDatesForYear", year]), () => legalHolidayDatesForYearUncached(year));
}

function legalHolidayDatesForYearUncached(year) {
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
  const line = submittedRdoLineForInitials(initials) || rdoLineForInitials(initials);
  const rdoWeekdays = [...rdoWeekdaysForLine(line)].sort((a, b) => a - b);
  return rdoWeekdays[0];
}

function isRdoWeekdayForInitials(weekday, initials = currentUser.initials) {
  const line = submittedRdoLineForInitials(initials) || rdoLineForInitials(initials);
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
  return cachedLeaveRead(JSON.stringify(["federalHolidayDatesForYear", year, initials]), () => federalHolidayDatesForYearUncached(year, initials));
}

function federalHolidayDatesForYearUncached(year, initials = currentUser.initials) {
  const holidays = new Set();
  const inLieuDates = holidayInLieuDatesForYear(year, initials);
  inLieuDates.forEach((key) => holidays.add(key));

  legalHolidayDatesForYear(year).forEach((key) => {
    if (!isRdoWeekdayForInitials(dateFromKey(key).getDay(), initials)) holidays.add(key);
  });

  return holidays;
}

function holidayInLieuDatesForYear(year, initials = currentUser.initials) {
  return cachedLeaveRead(JSON.stringify(["holidayInLieuDatesForYear", year, initials]), () => holidayInLieuDatesForYearUncached(year, initials));
}

function holidayInLieuDatesForYearUncached(year, initials = currentUser.initials) {
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

function holidayInLieuIsProvisional(initials = currentUser.initials) {
  const normalized = String(initials || "").trim().toUpperCase();
  const request = intakeQueue.find((item) =>
    item.type === "RDO Line" &&
    item.initials === normalized &&
    ["Pending", "Approved"].includes(item.status)
  );
  return request?.status === "Pending" && Boolean(submittedRdoLineForInitials(normalized));
}

function calendarHolidayKind(key, options = {}) {
  const isPublicCalendar = options.showRdo === false && options.showPersonalLeave === false;

  if (isPublicCalendar) {
    return isLegalHolidayDate(key)
      ? { label: "Holiday", className: "holiday-day", badgeClass: "holiday" }
      : null;
  }

  if (isHolidayInLieuDate(key)) {
    return {
      label: holidayInLieuIsProvisional() ? "Holiday In-Lieu (provisional—pending RDO approval)" : "Holiday In-Lieu",
      className: "holiday-in-lieu-day",
      badgeClass: "in-lieu",
    };
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

function replaceBrowserHistory(targetWindow, url) {
  try {
    // Keep the receiver attached, including when updating a containing frame.
    const history = targetWindow.history;
    history.replaceState.call(history, history.state, "", url);
    return true;
  } catch {
    // URL cleanup/navigation bookkeeping must not interrupt authentication.
    return false;
  }
}

function adoptParentSupabaseAuthHash() {
  if (window.self === window.top || window.location.hash) return;

  let parentUrl;
  try {
    parentUrl = new URL(window.top.location.href);
  } catch {
    return;
  }

  const authParams = new URLSearchParams(parentUrl.hash.slice(1));
  const isSupabaseAuthResponse = authParams.has("access_token")
    || authParams.has("error_description");
  if (!isSupabaseAuthResponse) return;

  const adopted = replaceBrowserHistory(
    window,
    `${window.location.pathname}${window.location.search}${parentUrl.hash}`
  );
  if (!adopted) return;

  parentUrl.hash = "";
  replaceBrowserHistory(window.top, parentUrl.toString());
}

function supabaseClient() {
  const config = window.NATCA_SUPABASE_CONFIG;
  if (!config?.url || !config?.publishableKey || !window.supabase?.createClient) return null;
  if (!supabaseState.client) {
    adoptParentSupabaseAuthHash();
    supabaseState.client = window.supabase.createClient(config.url, config.publishableKey, {
      global: { fetch: fetchWithLiveUpdateTracking },
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
  if (status === "error" && !isMemberAppVisible()) {
    // Failed sign-in must leave its explanation visible in the login popup.
    const loginMenu = document.querySelector("[data-public-login-menu]");
    if (loginMenu) loginMenu.hidden = false;
    document.querySelector("[data-public-login-toggle]")?.setAttribute("aria-expanded", "true");
  }
}

const supportedEmailTokenTypes = new Set([
  "email",
  "signup",
  "magiclink",
  "recovery",
  "invite",
  "email_change",
]);

function pendingSupabaseEmailToken() {
  const url = new URL(window.location.href);
  const tokenHash = url.searchParams.get("token_hash");
  if (!tokenHash) return null;

  const type = url.searchParams.get("type") || "email";
  return {
    tokenHash,
    type,
    valid: supportedEmailTokenTypes.has(type),
  };
}

function clearSupabaseEmailTokenFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("token_hash");
  url.searchParams.delete("type");
  replaceBrowserHistory(window, url.toString());
}

function showPendingSupabaseEmailConfirmation(client, pendingToken) {
  const confirmButton = document.querySelector("[data-confirm-email-token]");
  const loginMenu = document.querySelector("[data-public-login-menu]");
  const loginToggle = document.querySelector("[data-public-login-toggle]");

  if (loginMenu) loginMenu.hidden = false;
  loginToggle?.setAttribute("aria-expanded", "true");
  clearSupabaseEmailTokenFromUrl();

  if (!confirmButton || !pendingToken.valid) {
    setAuthStatus("This email confirmation link is invalid. Request a new login link.", "error");
    return false;
  }

  confirmButton.hidden = false;
  setAuthStatus(
    "Your email is ready to confirm. Select the button below to finish signing in.",
    "info"
  );

  confirmButton.addEventListener("click", async () => {
    confirmButton.disabled = true;
    setAuthStatus("Confirming your email…", "info");

    let error;
    try {
      ({ error } = await client.auth.verifyOtp({
        token_hash: pendingToken.tokenHash,
        type: pendingToken.type,
      }));
    } catch (requestError) {
      confirmButton.disabled = false;
      setAuthStatus(friendlyAuthFailure(requestError), "error");
      return;
    }

    if (error) {
      confirmButton.hidden = true;
      setAuthStatus(
        "This confirmation link is invalid or expired. Request a new login link.",
        "error"
      );
      return;
    }

    confirmButton.hidden = true;
    setAuthStatus("Email confirmed. Signing you in…", "success");
    await restoreSupabaseSession();
  });

  return true;
}

function friendlyAuthFailure(error) {
  const message = error?.message || String(error || "");
  if (error?.code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return "The email or password is incorrect. Try again, or use Set or reset password.";
  }
  if (/load failed|failed to fetch|network/i.test(message)) {
    return "Login could not reach Supabase. Check your connection and try again.";
  }
  return message || "That login did not work.";
}

function requestedPublicView() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("page") !== "public") return null;
  const area = params.get("area");
  const section = params.get("section");
  return {
    area: [...ZLA_AREAS, "FAQ", "Previous Years"].includes(area) ? area : DEFAULT_PUBLIC_AREA,
    section: ["Calendar", "RDO", "Bid Time"].includes(section) ? section : DEFAULT_PUBLIC_SECTION,
  };
}

function syncPublicPageUrl(area, section) {
  const url = new URL(window.location.href);
  url.searchParams.set("page", "public");
  url.searchParams.set("area", area);
  url.searchParams.set("section", section);
  url.searchParams.delete("member");
  syncNavigationUrl(url);
}

function requestedLandingPage() {
  const requestedPage = new URLSearchParams(window.location.search).get("page");
  return ["dashboard", "seniority", "rdos", "leave", "calendar", "history", "profile", "intake", "intake-schedule", "admin", "admin-tools"].includes(requestedPage) ? requestedPage : "";
}

function defaultLandingPageForRole() {
  if (hasSystemAdminAccess()) return "admin";
  if (canUseIntakeView()) return "intake";
  return "dashboard";
}

function intendedLandingPage(requestedPage = requestedLandingPage()) {
  const defaultPage = defaultLandingPageForRole();
  if (requestedPage === "admin" || requestedPage === "admin-tools") {
    return hasSystemAdminAccess() ? requestedPage : defaultPage;
  }
  if (requestedPage === "intake") return canUseIntakeView() ? requestedPage : defaultPage;
  if (requestedPage === "intake-schedule") return canViewIntakeSchedule() ? requestedPage : defaultPage;
  if (["dashboard", "seniority", "rdos", "leave", "calendar", "history", "profile"].includes(requestedPage)) return requestedPage;
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
  bidderEditor.generation += 1;
  bidderEditor.record = null;
  bidderEditor.person = null;
  bidderEditor.results = [];
  bidderEditor.validated = '';
  clearTimeout(bidderEditorSearchTimer);
  document.querySelector('[data-bidder-editor-form]')?.replaceChildren();
  document.querySelector('[data-bidder-editor-results]')?.replaceChildren();
  supabaseState.authEmail = "";
  supabaseState.authUserId = "";
  stopLiveAlertUpdates();
  supabaseState.pendingAuthEmail = "";
  syncAccountFields();
}

function syncSupabaseAccountStateFromSession(session) {
  supabaseState.authEmail = session.user?.email || "";
  supabaseState.authUserId = session.user?.id || "";
  supabaseState.pendingAuthEmail = session.user?.new_email || "";
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
        : "You can set a first password, change an existing password, or request a login email change."
      : "Login email and password changes are available after signing in with Supabase."
  );

  document.querySelectorAll("[data-account-email]").forEach((input) => {
    input.disabled = !hasSession;
    input.placeholder = hasSession ? "new.email@example.com" : "";
  });
  document.querySelectorAll("[data-account-current-password], [data-account-password], [data-account-password-confirm]").forEach((input) => {
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

  syncSupabaseAccountStateFromSession(data.session);
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
  document.querySelectorAll("[data-account-current-password], [data-account-password], [data-account-password-confirm]").forEach((input) => {
    input.value = "";
  });
}

function friendlyAccountPasswordFailure(error) {
  const code = error?.code || "";
  if (code === "current_password_required") {
    return "Enter your current password above, then choose a different new password. If you do not know it, use Set or reset password on the login screen.";
  }
  if (code === "current_password_mismatch") {
    return "The current password is incorrect. Try again or use Set or reset password on the login screen.";
  }
  if (code === "same_password") {
    return "That is already your password. Choose a different new password.";
  }
  if (code === "reauthentication_needed") {
    return "For security, request a fresh Set or reset password email from the login screen before changing this password.";
  }
  return error?.message || "Password could not be updated.";
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
    ghostBidder: false,
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
  startLiveAlertUpdates();
  document.documentElement.classList.remove("member-boot-pending");
}

function showPublicHome(area = DEFAULT_PUBLIC_AREA, section = DEFAULT_PUBLIC_SECTION) {
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
  renderPublicPage(area, section, { persistNavigation: true });
  document.documentElement.classList.remove("member-boot-pending");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function initializeSupabaseAuth() {
  const client = supabaseClient();
  if (!client || supabaseState.authInitialized) return;

  supabaseState.authInitialized = true;
  client.auth.onAuthStateChange((event, session) => {
    if (session && ["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"].includes(event)) {
      const isKnownSession = Boolean(
        supabaseState.authUserId && supabaseState.authUserId === session.user?.id
      );
      syncSupabaseAccountStateFromSession(session);

      // Supabase can emit SIGNED_IN again when an authenticated tab regains focus.
      // Refresh the stored credentials without rebuilding the app, changing pages,
      // or resetting the visitor's scroll position.
      if (event === "TOKEN_REFRESHED" || (event === "SIGNED_IN" && isKnownSession)) return;

      restoreSupabaseSession();
    }
    if (event === "SIGNED_OUT") {
      clearSupabaseAccountState();
      currentUser = null;
      showPublicHome();
      setAuthStatus("Signed out. Sign in again to manage intake shifts.", "info");
    }
  });

  const pendingToken = pendingSupabaseEmailToken();
  if (pendingToken) {
    showPendingSupabaseEmailConfirmation(client, pendingToken);
    return false;
  }

  return restoreSupabaseSession();
}

async function restoreSupabaseSession(page = requestedLandingPage()) {
  if (supabaseState.authRestorePromise) return supabaseState.authRestorePromise;

  supabaseState.authRestorePromise = (async () => {
    const startupStarted = Date.now();
    const session = await measureDashboardStartupStep("session restoration", refreshSupabaseAccountState);
    if (!session) return false;

    try {
      const profile = await measureDashboardStartupStep("member profile", claimSupabaseProfile);
      if (!profile) {
        await rejectUnmatchedSupabaseLogin();
        return false;
      }
      currentUser = profile;
      setAuthStatus("Signed in.", "success");
      await measureDashboardStartupStep("essential bidding data", loadSupabaseReferenceData);
      const renderStarted = Date.now();
      if (requestedPublicView()) showPublicHome(publicState.area, publicState.section);
      else showLoggedInApp(page);
      recordReferenceLoadDiagnostic({ section: "dashboard rendering", elapsedMs: Date.now() - renderStarted });
      recordReferenceLoadDiagnostic({ section: "dashboard ready", elapsedMs: Date.now() - startupStarted });
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

let loginLinkRequestPending = false;

async function sendSupabaseLoginLink(email) {
  if (loginLinkRequestPending) return;
  loginLinkRequestPending = true;
  const buttons = document.querySelectorAll("[data-send-login-link], [data-email-login-form] button[type='submit']");
  buttons.forEach((button) => { button.disabled = true; });
  setAuthStatus("Sending login link...");

  try {
    const client = supabaseClient();
    if (!client) {
      setAuthStatus("Login is not configured yet.", "error");
      return;
    }

    if (window.NATCA_SUPABASE_CONFIG?.environment !== "pilot") {
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
      setAuthStatus(friendlyAuthFailure(error), "error");
      return;
    }

    setAuthStatus("Login link requested. Check your inbox and spam folder. If you request another link, use the newest email.", "success");
  } catch (error) {
    setAuthStatus(friendlyAuthFailure(error), "error");
  } finally {
    loginLinkRequestPending = false;
    buttons.forEach((button) => { button.disabled = false; });
    // Keep the request result visible even if auth initialization closed the menu.
    const loginMenu = document.querySelector("[data-public-login-menu]");
    if (loginMenu && !isMemberAppVisible()) {
      loginMenu.hidden = false;
      document.querySelector("[data-public-login-toggle]")?.setAttribute("aria-expanded", "true");
    }
  }
}

async function sendSupabasePasswordReset(email) {
  const client = supabaseClient();
  if (!client) {
    setAuthStatus("Login is not configured yet.", "error");
    return;
  }

  if (window.NATCA_SUPABASE_CONFIG?.environment !== "pilot") {
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

async function saveSupabaseProfile(values) {
  const client = supabaseClient();
  if (!client || !currentUser.supabaseProfileId) {
    setProfileFormStatus("Profile changes could not reach the database. Sign in and try again.", "error");
    return false;
  }
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
    return false;
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
  await saveSupabaseProfile(values);
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

  const currentPassword = document.querySelector("[data-account-current-password]")?.value || "";
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
  const passwordUpdate = currentPassword
    ? { password, current_password: currentPassword }
    : { password };
  const { error } = await supabaseClient().auth.updateUser(passwordUpdate);
  if (error) {
    setAccountFormStatus(friendlyAccountPasswordFailure(error), "error");
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
  const leftOrder = Number(left.displayOrder);
  const rightOrder = Number(right.displayOrder);
  const leftHasOrder = Number.isFinite(leftOrder) && leftOrder > 0;
  const rightHasOrder = Number.isFinite(rightOrder) && rightOrder > 0;
  if (leftHasOrder && rightHasOrder && leftOrder !== rightOrder) return leftOrder - rightOrder;
  if (leftHasOrder !== rightHasOrder) return leftHasOrder ? -1 : 1;

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
      id: row.id,
      area,
      pattern: row.pattern,
      line: row.line_code,
      displayOrder: row.display_order,
      lineType: row.line_type,
      cpc: row.assigned_initials || row.bidders?.initials || (row.assigned_bidder_id === currentUser?.supabaseProfileId ? currentUser.initials : ""),
      week: days.length === 7 ? days : Array.from({ length: 7 }, () => ""),
      group: row.fatigue_group || "",
      mid: row.mid || "",
      aws: typeof row.aws === "boolean" ? (row.aws ? "Yes" : "No") : "",
      fourTen: row.four_ten ? "Yes" : "No",
      flex: typeof row.flex === "boolean" ? (row.flex ? "Yes" : "No") : "",
      status: row.status === "taken" ? "Taken" : row.status === "locked" ? "Taken" : "Open",
      glBids: [],
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

function applyGlRdoAssignments(rows) {
  rdoLines.forEach((line) => {
    line.glBids = [];
  });

  (rows || []).forEach((row) => {
    const line = rdoLines.find((candidate) => (
      (row.rdo_line_id && candidate.id === row.rdo_line_id)
      || (candidate.line === row.line_code && candidate.area === row.area_name)
    ));
    const initials = String(row.initials || "").trim().toUpperCase();
    if (!line || !initials || line.glBids.some((bid) => bid.initials === initials)) return;
    line.glBids.push({
      initials,
      status: uiStatusFromDatabase(row.status || "pending"),
      ghostBid: Boolean(row.ghost_bid),
    });
  });

  rdoLines.forEach((line) => {
    line.glBids.sort((left, right) => left.initials.localeCompare(right.initials));
  });
}

function supabaseRdoSubmissionToIntakeItem(row, areaById = new Map()) {
  const bidder = row.bidders || row;
  const payload = row.payload || {};
  const line = payload.rdo_line_code || payload.line || row.line || "";
  const area = row.area || row.areas?.name || areaById.get(row.area_id || bidder.area_id) || (bidder.initials === currentUser.initials ? currentUser.area : "Area A");
  const fatigueGroup = payload.fatigue_group || payload.fatigueGroup || "";
  const flex = payload.flex ?? "";
  const aws = payload.aws ?? "";
  const mid = payload.mid || "";
  const round = Number(row.round_number || row.round || currentRoundNumber());
  const ghostBid = Boolean(row.is_ghost_bid || payload.ghostBid);
  const isChange = Boolean(row.isChange || row.is_change || payload.isChange);
  const originalBid = row.originalBid || row.original_bid || payload.originalBid || null;
  const changeSource = row.changeSource || row.change_source || payload.changeSource || "";
  const changeEnteredBy = row.changeEnteredBy || row.change_entered_by || "";

  return {
    id: `supabase-rdo-${row.id}`,
    supabaseSubmissionId: row.id,
    bidderId: row.bidderId || row.bidder_id || bidder.profile_id || (row.bidders ? bidder.id : ""),
    type: "RDO Line",
    ghostBid,
    isChange,
    originalBid,
    originalSubmissionId: row.supersedesSubmissionId || row.supersedes_submission_id || "",
    changeSource,
    changeEnteredBy,
    manualEntry: changeSource === "intake",
    enteredBy: changeEnteredBy,
    area,
    name: controllerName({
      firstName: bidder.first_name || "",
      lastName: bidder.last_name || "",
    }).trim() || row.name || bidder.initials || "",
    initials: bidder.initials || "",
    bidAs: normalizeBidRoleForArea(bidder.bid_role || row.bidAs || payload.bid_as || "CPC", area),
    seniority: bidder.seniority_rank || row.seniority,
    status: uiStatusFromDatabase(row.status),
    submittedAt: row.submittedAt || (row.submitted_at ? formatDateTime(new Date(row.submitted_at)) : formatDateTime(new Date(row.created_at))),
    submittedBy: row.submittedBy || row.payload?.submittedBy || "",
    submittedByRole: row.submittedByRole || row.payload?.submittedByRole || "",
    approvedBy: row.reviewedBy || "",
    deniedBy: row.reviewedBy || "",
    approvedAt: row.reviewedAt && String(row.status).toLowerCase() === "approved" ? formatDateTime(new Date(row.reviewedAt)) : row.reviewed_at && row.status === "approved" ? formatDateTime(new Date(row.reviewed_at)) : "",
    deniedAt: row.reviewedAt && String(row.status).toLowerCase() === "denied" ? formatDateTime(new Date(row.reviewedAt)) : row.reviewed_at && row.status === "denied" ? formatDateTime(new Date(row.reviewed_at)) : "",
    denialReason: row.denialReason || row.denial_reason || "",
    round,
    line,
    fatigueGroup,
    fatigueOverride: payload.fatigueOverride === true,
    flex,
    aws,
    mid,
    summary: payload.summary || `Round ${round} · ${ghostBid ? "Ghost Line" : "Line"} ${line} · ${fatigueGroupPreferenceLabel(fatigueGroup)} · Flex ${flex} · AWS ${aws} · Mid ${mid}`,
  };
}

function upsertRdoSubmissionsFromDatabase(rows, areaById) {
  const items = (rows || []).map((row) => supabaseRdoSubmissionToIntakeItem(row, areaById));
  inferRdoBidChanges(items);
  const ids = new Set(items.map((item) => item.supabaseSubmissionId));
  intakeQueue = intakeQueue.filter((item) => !item.supabaseSubmissionId || !ids.has(item.supabaseSubmissionId));
  intakeQueue.unshift(...items);
}

function inferRdoBidChanges(items) {
  items.forEach((item, itemIndex) => {
    if (item.originalBid || (!item.isChange && !["Pending", "Approved"].includes(item.status))) return;
    const sameBidder = (candidate) => candidate.type === "RDO Line" && (item.bidderId && candidate.bidderId
      ? item.bidderId === candidate.bidderId
      : item.initials === candidate.initials && item.area === candidate.area);
    const linkedOriginal = item.originalSubmissionId
      ? items.find((candidate) => candidate !== item && sameBidder(candidate)
        && candidate.supabaseSubmissionId === item.originalSubmissionId)
      : null;
    const itemTime = Date.parse(item.submittedAt || "");
    const original = linkedOriginal || items
      .filter((candidate, candidateIndex) => {
        if (candidate === item || candidate.status !== "Approved" || !sameBidder(candidate)) return false;
        const candidateTime = Date.parse(candidate.submittedAt || "");
        const submittedEarlier = Number.isFinite(itemTime) && Number.isFinite(candidateTime)
          ? candidateTime < itemTime
          : candidateIndex > itemIndex;
        return submittedEarlier && rdoBidValuesChanged(candidate, item);
      })
      .sort((left, right) => Date.parse(right.submittedAt || "") - Date.parse(left.submittedAt || ""))[0];
    if (!original) return;

    item.isChange = true;
    item.originalBid = rdoBidSnapshotFromIntakeItem(original);
    item.originalSubmissionId = original.supabaseSubmissionId || "";
    item.changeInferred = true;
  });
}

function biddingStateSubmissionType(row) {
  const type = String(row.type || row.submission_type || "").toLowerCase();
  return type === "rdo" || type === "rdo line" ? "RDO Line" : "Leave";
}

function intakeSubmissionIdFromBiddingState(item, submissions = []) {
  const itemType = item.type === "RDO Line" ? "RDO Line" : "Leave";
  const pending = submissions.filter((row) => (
    biddingStateSubmissionType(row) === itemType
    && String(row.status || "").toLowerCase() === "pending"
  ));

  if (item.supabaseRequestId) {
    const exactRequest = pending.find((row) => (
      String(row.requestId || row.leave_request_id || "") === String(item.supabaseRequestId)
    ));
    if (exactRequest?.id) return exactRequest.id;
  }

  const candidates = pending.filter((row) => {
    const payload = row.payload || {};
    const sameBidder = String(row.initials || row.bidders?.initials || "").toUpperCase()
      === String(item.initials || "").toUpperCase();
    const sameRound = Number(row.round || row.round_number || 0) === Number(item.round || 0);
    if (!sameBidder || !sameRound) return false;

    if (itemType === "RDO Line") {
      const line = payload.rdo_line_code || payload.line || row.line || "";
      return String(line) === String(item.line || "");
    }

    const dateKeys = datesInLeaveRange(item.range);
    const startDate = payload.start_date || payload.startDate || "";
    const endDate = payload.end_date || payload.endDate || "";
    return dateKeys.length > 0
      && startDate === dateKeys[0]
      && endDate === dateKeys[dateKeys.length - 1];
  });

  return candidates.length === 1 ? candidates[0].id : "";
}

function attachSubmissionIdsToLeaveRequests(rows, submissions) {
  return (rows || []).map((row) => {
    const item = supabaseLeaveRequestToIntakeItem(row);
    const submission = (submissions || []).find((entry) =>
      String(entry.requestId || entry.leave_request_id || "") === String(row.id)
    );
    return {
      ...row,
      reviewedBy: submission?.reviewedBy || row.reviewedBy || "",
      submittedBy: submission?.payload?.submittedBy || row.submittedBy || "",
      submittedByRole: submission?.payload?.submittedByRole || row.submittedByRole || "",
      submission_id: intakeSubmissionIdFromBiddingState(item, submissions),
    };
  });
}

function applyLeaveSlotScheduleFromDatabase(rows, areaById) {
  Object.keys(extraLeaveSlotData).forEach((key) => delete extraLeaveSlotData[key]);

  rows.forEach((row) => {
    const area = areaNameForRow(row, areaById);
    const date = row.slot_date;
    if (!area || !date) return;

    const cpcCapacity = Math.max(0, Number(row.cpc_capacity) || 0);
    const devCapacity = Math.max(0, Number(row.dev_capacity) || 0);
    extraLeaveSlotData[extraLeaveSlotStorageKey(date, area)] = {
      area,
      date,
      label: formatCalendarDate(date),
      cpc: Array.isArray(row.cpc_initials) ? row.cpc_initials.filter(Boolean) : [],
      dev: Array.isArray(row.dev_initials) ? row.dev_initials.filter(Boolean) : [],
      glBids: Array.isArray(row.gl_bids)
        ? row.gl_bids.map((bid) => ({
          initials: String(bid?.initials || "").trim().toUpperCase(),
          status: uiStatusFromDatabase(bid?.status || "pending"),
          label: "GL Bid",
        })).filter((bid) => bid.initials)
        : [],
      cpcCapacity,
      devCapacity,
      cpcOpen: Math.min(cpcCapacity, Math.max(0, Number(row.cpc_open) || 0)),
      devOpen: Math.min(devCapacity, Math.max(0, Number(row.dev_open) || 0)),
      unavailable: Boolean(row.unavailable),
    };
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
  const ghostBid = Boolean(row.is_ghost_bid);
  const bidAs = normalizeBidRoleForArea(bidder.bid_role || "CPC", area);

  return {
    id: `supabase-leave-${row.id}`,
    supabaseRequestId: row.id,
    submissionBatchKey: row.submitted_at || row.created_at || row.id,
    supabaseSubmissionId: row.submission_id || "",
    bidderId: row.bidder_id || bidder.id || "",
    type: "Leave",
    ghostBid,
    area,
    name: controllerName({
      firstName: bidder.first_name,
      lastName: bidder.last_name,
      initials: bidder.initials,
    }),
    initials: bidder.initials || "",
    bidAs,
    seniority: bidder.seniority_rank,
    priority: Number(row.priority || 0),
    status: uiStatusFromDatabase(row.status),
    submittedAt: row.submitted_at ? formatDateTime(new Date(row.submitted_at)) : formatDateTime(new Date(row.created_at)),
    submittedBy: row.submittedBy || row.payload?.submittedBy || "",
    submittedByRole: row.submittedByRole || row.payload?.submittedByRole || "",
    approvedBy: row.reviewedBy || "",
    deniedBy: row.reviewedBy || "",
    approvedAt: row.reviewed_at && row.status === "approved" ? formatDateTime(new Date(row.reviewed_at)) : "",
    deniedAt: row.reviewed_at && row.status === "denied" ? formatDateTime(new Date(row.reviewed_at)) : "",
    cancelledAt: row.reviewed_at && row.status === "cancelled" ? formatDateTime(new Date(row.reviewed_at)) : "",
    denialReason: row.denial_reason || "",
    range,
    days,
    round,
    weekUnits: weekKeys.length,
    weekKeys,
    weekBucketStarts: row.weekBucketStarts || [],
    notes: row.notes || "",
    summary: `${ghostBid ? "Ghost Leave · " : bidAs === "GL" ? "GL Bid · " : ""}${range} · ${days} ${days === 1 ? "day" : "days"}${weekKeys.length ? ` · ${weekKeys.length} bid week${weekKeys.length === 1 ? "" : "s"}` : ""}`,
  };
}

async function attachLeaveRequestWeekBuckets(client, rows = []) {
  const requestIds = rows
    .filter((row) => Number(row.round_number) === 1 && ["pending", "approved"].includes(row.status))
    .map((row) => row.id);
  const startsByRequest = new Map();

  const batches = [];
  for (let index = 0; index < requestIds.length; index += 100) {
    batches.push(client.from("leave_request_week_buckets")
      .select("leave_request_id,bucket_start_date")
      .in("leave_request_id", requestIds.slice(index, index + 100)));
  }
  const results = await Promise.all(batches);
  for (const { data, error } of results) {
    if (error) {
      console.warn(`Round 1 week buckets could not be loaded: ${error.message || error}`);
      return rows;
    }
    (data || []).forEach((bucket) => {
      const starts = startsByRequest.get(bucket.leave_request_id) || [];
      starts.push(bucket.bucket_start_date);
      startsByRequest.set(bucket.leave_request_id, starts);
    });
  }

  return rows.map((row) => ({ ...row, weekBucketStarts: startsByRequest.get(row.id) || [] }));
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
      ghostBid: item.ghostBid,
      weekBucketStarts: item.weekBucketStarts,
      denialReason: item.denialReason,
      approvedBy: item.approvedBy,
      approvedAt: item.approvedAt,
      deniedBy: item.deniedBy,
      deniedAt: item.deniedAt,
      submittedBy: item.submittedBy,
      submittedAt: item.submittedAt,
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
  publicFaqContent.entries = [];
  publicFaqContent.documents = [];
  intakeSchedules.splice(0, intakeSchedules.length);
  intakeCalendarMarks.clear();
  intakeTeamInitials.clear();
  holidayOverrides.clear();
  fullLeaveDates.clear();
  ghostBidderIds.clear();
  intakeBidderSelection.record = null;
  intakeBidderSelection.error = "";
  intakeBidderSelection.loading = false;
  intakeBidderSelection.generation += 1;
  if (currentUser) currentUser.ghostBidder = false;
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
    row.role || "controller",
  ];
}

function seniorityEntryProfileId(entry) {
  return entry?.[9] || "";
}

function seniorityEntryAppRole(entry) {
  return entry?.[10] || "controller";
}

function applyRosterFromDatabase(rows, areaById = new Map()) {
  senioritySource.splice(0, senioritySource.length);
  intakeTeamInitials.clear();
  (rows || []).forEach((row) => {
    const entry = bidderRowToSeniorityEntry(row, areaById);
    senioritySource.push(entry);
    if (["intake", "admin"].includes(seniorityEntryAppRole(entry)) && entry[3]) {
      intakeTeamInitials.add(entry[3]);
    }
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
        role: seniorityEntryAppRole(currentEntry),
        roleLabel: seniorityEntryAppRole(currentEntry) === "admin" ? "Bidding Admin" : seniorityEntryAppRole(currentEntry) === "intake" ? "Bidding Intake" : "BUE Controller",
        systemAdmin: seniorityEntryAppRole(currentEntry) === "admin",
        seniorityRank: person.rank,
        leaveSlotAllowance: person.leaveSlotAllowance,
      };
      selectedViewArea = person.area;
    }
  }

  seniority = buildSeniority();
}

function applyGhostBiddingStatus(rows = []) {
  ghostBidderIds.clear();
  rows.forEach((row) => {
    if (row.is_ghost_bidder && row.bidder_id) ghostBidderIds.add(row.bidder_id);
  });
  if (currentUser?.supabaseProfileId) {
    currentUser.ghostBidder = ghostBidderIds.has(currentUser.supabaseProfileId);
  }
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

  (rows || []).forEach((row) => {
    const bidder = row.bidders || {};
    const initials = bidder.initials || row.initials || "";
    if (!initials) return;

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

function loadIntakeSchedules(client) {
  if (!supabaseState.authUserId || !canViewIntakeSchedule()) return Promise.resolve({ data: [], error: null });
  return client.rpc("read_intake_schedules", { requested_bid_year: BID_YEAR });
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

async function saveSupabaseRdoRequest(request, options = {}) {
  const yearError = selectedBidYearErrorMessage();
  if (yearError) throw new Error(yearError);
  const client = supabaseClient();
  if (!client || !currentUser.supabaseProfileId) {
    throw new Error("The RDO bid could not reach the database. Sign in and try again.");
  }
  const { data, error } = await client.rpc("submit_rdo_bid", {
    requested_bid_year: BID_YEAR,
    requested_line_code: request.line,
    requested_fatigue_group: request.fatigueGroup || null,
    requested_flex: request.flex === true || request.flex === "Yes",
    requested_aws: request.aws === true || request.aws === "Yes",
    requested_mid: request.mid,
    requested_round: request.round,
    target_initials: options.targetInitials || null,
    target_area_name: options.targetArea || null,
    manual_entry: Boolean(options.manualEntry),
  });
  if (error) throw error;
  return data;
}

async function saveSupabaseManualRdoRequest(request, person, area) {
  if (request.fatigueOverride && !["intake", "admin"].includes(currentUser?.role)) {
    throw new Error("Only intake and admin users may override fatigue capacity.");
  }
  const yearError = selectedBidYearErrorMessage();
  if (yearError) throw new Error(yearError);
  const client = supabaseClient();
  if (!client || !currentUser.supabaseProfileId) {
    throw new Error("The manual RDO bid could not reach the database. Sign in and try again.");
  }
  const { data, error } = await client.rpc(request.fatigueOverride ? "submit_manual_rdo_fatigue_override" : "submit_rdo_bid", {
    requested_bid_year: BID_YEAR,
    requested_line_code: request.line,
    requested_fatigue_group: request.fatigueGroup || null,
    requested_flex: request.flex === true || request.flex === "Yes",
    requested_aws: request.aws === true || request.aws === "Yes",
    requested_mid: request.mid,
    requested_round: request.round,
    target_initials: person.initials,
    target_area_name: area,
    manual_entry: true,
  });
  if (error) throw error;
  if (!data?.submission_id) throw new Error("Supabase did not return the saved manual RDO submission.");
  return data;
}

async function saveSupabaseManualLeaveRequest(requests, person, area, notes = "") {
  const yearError = selectedBidYearErrorMessage();
  if (yearError) throw new Error(yearError);
  const client = supabaseClient();
  if (!client || !currentUser.supabaseProfileId) {
    throw new Error("The manual leave bid could not reach the database. Sign in and try again.");
  }
  const targetRdoLine = rdoLineForInitials(person.initials);
  const requestedItems = requests.map((request) => ({
    start_date: request.startDateKey,
    end_date: request.endDateKey,
    round: request.round,
    rdo_line_code: targetRdoLine?.line || null,
    fatigue_group: targetRdoLine?.group || null,
    flex: targetRdoLine?.flex || null,
    aws: targetRdoLine?.aws || null,
    mid: targetRdoLine?.mid || null,
    notes: request.notes || notes,
  }));
  const { data, error } = await client.rpc("submit_leave_bid_batch", {
    requested_bid_year: BID_YEAR,
    requested_items: requestedItems,
    target_initials: person.initials,
    target_area_name: area,
    manual_entry: true,
  });
  if (error) throw error;
  if (!Array.isArray(data?.submission_ids) || data.submission_ids.length !== requests.length) {
    throw new Error("Supabase did not return the saved manual leave submission.");
  }
  return data;
}

async function saveSupabaseLeaveRequests(newRequests, draftsByRange, options = {}) {
  const yearError = selectedBidYearErrorMessage();
  if (yearError) throw new Error(yearError);
  const client = supabaseClient();
  if (!client || !currentUser.supabaseProfileId) {
    throw new Error("The leave bid could not reach the database. Sign in and try again.");
  }
  const targetInitials = options.targetInitials || currentUser.initials;
  const rdoRequest = intakeQueue.find((item) =>
    item.type === "RDO Line" &&
    item.initials === targetInitials &&
    ["Pending", "Approved"].includes(item.status)
  );
  const rdoLine = rdoLineForInitials(targetInitials);

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
    target_initials: options.targetInitials || null,
    target_area_name: options.targetArea || null,
    manual_entry: Boolean(options.manualEntry),
  });
  if (error) throw error;

  const { data: savedRequests, error: refreshError } = await client.rpc("read_leave_intake_queue", {
    queue_bid_year: BID_YEAR,
  });
  if (refreshError) {
    console.warn(`Leave batch was saved, but the intake queue could not be refreshed. ${refreshError.message || refreshError}`);
  } else {
    upsertLeaveRequestsFromDatabase(await attachLeaveRequestWeekBuckets(client, savedRequests || []), new Map());
  }

  return true;
}

async function loadPublishedBidWindows(client, bidYearId) {
  const publicResult = await client.rpc("read_public_bid_windows", { requested_bid_year: BID_YEAR });
  if (!publicResult.error || !supabaseState.authUserId) return publicResult;

  // Keep signed-in installations working while the public read migration is being applied.
  return client
    .from("bid_windows")
    .select("bidder_id,round_number,opens_at,closes_at,status")
    .eq("bid_year_id", bidYearId);
}

async function loadPublishedLeaveSlots(client) {
  return client.rpc("read_public_leave_slots", { requested_bid_year: BID_YEAR });
}

async function loadPublishedGlRdoAssignments(client) {
  return client.rpc("read_public_gl_rdo_assignments", { requested_bid_year: BID_YEAR });
}

async function loadPublicPilotCalendar() {
  const client = supabaseClient();
  if (!client) return;
  supabaseState.loading = true;
  try {
    await loadBidYearCatalog(client);
    const result = await readReferenceData("pilot leave slots", () => loadPublishedLeaveSlots(client));
    if (result.error) throw result.error;
    applyLeaveSlotScheduleFromDatabase(supabaseRows(result), new Map());
    calendarRenderRevision += 1;
  } catch (error) {
    console.warn(`Public leave slots could not load: ${error.message || error}`);
  } finally {
    supabaseState.loading = false;
    supabaseState.referenceDataLoaded = true;
  }
}

async function loadRdoLines(client, bidYearId) {
  const orderedResult = await client
    .from("rdo_lines")
    .select("id,area_id,line_code,display_order,line_type,pattern,fatigue_group,mid,aws,four_ten,flex,status,assigned_bidder_id,assigned_initials,rdo_line_days(weekday,shift_code)")
    .eq("bid_year_id", bidYearId);

  if (!isMissingRdoLineDisplayOrder(orderedResult.error)) return orderedResult;

  // Keep existing schedules visible while the bid-line editor migration is pending.
  return client
    .from("rdo_lines")
    .select("id,area_id,line_code,line_type,pattern,fatigue_group,mid,aws,four_ten,flex,status,assigned_bidder_id,assigned_initials,rdo_line_days(weekday,shift_code)")
    .eq("bid_year_id", bidYearId);
}

// Only use this helper for reads: mutations must never be replayed automatically.
const referenceLoadDiagnostics = [];
function recordReferenceLoadDiagnostic(diagnostic) {
  referenceLoadDiagnostics.push(diagnostic);
  if (referenceLoadDiagnostics.length > 100) referenceLoadDiagnostics.shift();
  window.NATCA_REFERENCE_LOAD_DIAGNOSTICS = referenceLoadDiagnostics;
  // Keep timings readable in remote browser logs without exposing response data.
  const message = `Bidding load timing ${JSON.stringify(diagnostic)}`;
  if (diagnostic.code) console.warn(message);
  else console.info(message);
}

async function measureDashboardStartupStep(section, operation) {
  const started = Date.now();
  try {
    return await operation();
  } finally {
    recordReferenceLoadDiagnostic({ section, elapsedMs: Date.now() - started });
  }
}

async function readReferenceData(label, request) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const started = Date.now();
    const controller = new AbortController();
    let timer;
    let result;
    try {
      const pending = request();
      if (typeof pending?.abortSignal === "function") pending.abortSignal(controller.signal);
      result = await Promise.race([
        pending,
        new Promise((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve({ data: null, error: { code: "READ_TIMEOUT" }, status: 0 });
          }, 15000);
        }),
      ]);
    } catch (error) {
      result = { data: null, error, status: 0 };
    } finally {
      clearTimeout(timer);
    }
    const status = Number(result.status || 0);
    const code = String(result.error?.code || "");
    if (!result?.error) {
      recordReferenceLoadDiagnostic({ section: label, attempt, status, code, elapsedMs: Date.now() - started, at: new Date().toISOString(), retrying: false });
      return result;
    }
    const transient = status === 408 || status === 429 || status >= 500
      || code === "READ_TIMEOUT" || code === "57014"
      || (!status && /Failed to fetch|NetworkError|network|timeout|AbortError/i.test(`${result.error.name || ""} ${result.error.message || ""}`));
    // Deliberately exclude response bodies, URLs, tokens, and bidder details.
    const diagnostic = { section: label, attempt, status, code, elapsedMs: Date.now() - started, at: new Date().toISOString(), retrying: transient && attempt < 3 };
    recordReferenceLoadDiagnostic(diagnostic);
    if (!transient || attempt === 3) return result;
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250)));
  }
}

function refreshPublicReferenceSection() {
  // The public page is hidden behind the boot screen during member restoration.
  if (supabaseState.authUserId && supabaseState.authRestorePromise) return;
  if (!isMemberAppVisible()) renderPublicPage();
}

function loadBackgroundHelpThreads() {
  const userId = supabaseState.authUserId;
  const year = BID_YEAR;
  void readReferenceData("help threads", () => loadSupabaseHelpThreads().then((loaded) => (
    loaded ? { data: null, error: null } : { data: null, error: { code: "HELP_UNAVAILABLE" } }
  ))).then(() => {
    if (supabaseState.authUserId !== userId || BID_YEAR !== year) return;
    if (isMemberAppVisible()) {
      renderHelpSummary();
      renderHelpPanel();
      renderAlerts();
    }
  });
}

async function loadSupabaseReferenceData() {
  const client = supabaseClient();
  if (!client) {
    resetSupabaseBackedData();
    supabaseState.rdoLinesLoadState = "error";
    supabaseState.enabled = false;
    supabaseState.connected = false;
    supabaseState.faqLoadState = "error";
    supabaseState.bidTimesLoadState = "error";
    supabaseState.leaveSlotsLoadState = "error";
    supabaseState.referenceDataLoaded = true;
    supabaseState.message = "Supabase is not configured. No bidding data was loaded.";
    return;
  }
  if (supabaseState.loading) return;
  resetSupabaseBackedData();
  liveDataSnapshots.clear();

  supabaseState.enabled = true;
  supabaseState.loading = true;
  supabaseState.intakeSchedulesError = "";
  supabaseState.rdoLinesLoadState = "loading";
  supabaseState.message = "Loading bidding data from Supabase...";

  supabaseState.faqLoadState = "loading";
  supabaseState.bidTimesLoadState = "loading";
  supabaseState.leaveSlotsLoadState = "loading";
  const rosterRequest = readReferenceData("roster", () => client.rpc("read_bidding_roster"));
  const faqReads = Promise.all([
    readReferenceData("FAQ entries", () => client.from("faq_entries").select("question,answer,display_order").eq("published", true).order("display_order").order("created_at")),
    readReferenceData("MOU documents", () => client.from("mou_documents").select("title,description,file_url,display_order").eq("published", true).order("display_order").order("created_at")),
  ]).then(([entries, documents]) => {
    if (!entries.error) publicFaqContent.entries = entries.data || [];
    if (!documents.error) publicFaqContent.documents = documents.data || [];
    supabaseState.faqLoadState = entries.error || documents.error ? "error" : "loaded";
    refreshPublicReferenceSection();
    return [entries, documents];
  });
  try {
    // Area definitions do not depend on which year the catalog selects.
    const areasRequest = readReferenceData("areas", () => client.from("areas").select("id,code,name,display_order").order("display_order"));
    await loadBidYearCatalog(client);
    const [bidYearResult, areasResult] = await Promise.all([
      readReferenceData("bid year", () => client
        .from("bid_years")
        .select("id,bid_year,annual_leave_allowance_days")
        .eq("bid_year", BID_YEAR)
        .single()),
      areasRequest,
    ]);
    const requiredError = [bidYearResult, areasResult].find((result) => result.error)?.error;
    if (requiredError) throw requiredError;

    const bidYear = bidYearResult.data;
    supabaseState.bidYearId = bidYear.id;
    const areaById = new Map((areasResult.data || []).map((area) => [area.id, area.name]));
    let rosterResult;
    const rosterReady = rosterRequest.then((result) => {
      rosterResult = result;
      if (!result.error) applyRosterFromDatabase(result.data || [], areaById);
      return result;
    });

    const [
      holidaysResult,
      rdoLinesResult,
      glRdoAssignmentsResult,
      biddingStateResult,
      leaveSlotsResult,
      leaveRequestsResult,
      ghostStatusResult,
      intakeSchedulesResult,
      intakeCalendarMarksResult,
      shiftPresetsResult,
      bidYearSettingsResult,
      roundRulesResult,
      approvalRulesResult,
      pilotSettingsResult,
      bidWindowsResult,
      _rosterLoaded,
    ] = await Promise.all([
      readReferenceData("holidays", () => client.from("holidays").select("holiday_date,name,is_observed").eq("bid_year_id", bidYear.id)),
      readReferenceData("RDO lines", () => loadRdoLines(client, bidYear.id)).then((result) => {
        supabaseState.rdoLinesLoadState = result.error ? "error" : "loaded";
        if (!result.error) upsertRdoLinesFromDatabase(result.data || [], areaById);
        refreshPublicReferenceSection();
        return result;
      }),
      readReferenceData("GL assignments", () => loadPublishedGlRdoAssignments(client)),
      readReferenceData("bidding state", () => supabaseState.authUserId ? client.rpc("read_bidding_state", { requested_bid_year: BID_YEAR }) : Promise.resolve({ data: { submissions: [] }, error: null })),
      readReferenceData("leave slots", () => loadPublishedLeaveSlots(client)).then((result) => {
        supabaseState.leaveSlotsLoadState = result.error ? "error" : "loaded";
        if (!result.error) {
          applyLeaveSlotScheduleFromDatabase(supabaseRows(result), areaById);
          calendarRenderRevision += 1;
        }
        refreshPublicReferenceSection();
        return result;
      }),
      readReferenceData("leave requests", () => supabaseState.authUserId ? client.rpc("read_leave_intake_queue", { queue_bid_year: BID_YEAR }) : Promise.resolve({ data: [], error: null })),
      readReferenceData("ghost status", () => supabaseState.authUserId ? client.rpc("read_ghost_bidding_status", { requested_bid_year: BID_YEAR }) : Promise.resolve({ data: [], error: null })),
      readReferenceData("intake schedules", () => loadIntakeSchedules(client)),
      readReferenceData("calendar marks", () => supabaseState.authUserId
        ? client.from("intake_calendar_marks").select("marked_date,kind").eq("bid_year", BID_YEAR)
        : Promise.resolve({ data: [], error: null })),
      readReferenceData("shift presets", () => hasIntakeAccess() ? client.rpc("read_intake_shift_presets") : Promise.resolve({ data: null, error: null })),
      readReferenceData("year settings", () => client.rpc("read_bid_year_settings", { requested_bid_year: BID_YEAR })),
      readReferenceData("round rules", () => client.rpc("read_round_rules", { requested_bid_year: BID_YEAR })),
      readReferenceData("approval rules", () => client.rpc("read_approval_rules", { requested_bid_year: BID_YEAR })),
      readReferenceData("pilot settings", () => supabaseState.authUserId
        ? client.rpc("read_pilot_settings", { requested_bid_year: BID_YEAR })
        : Promise.resolve({ data: null, error: null })),
      Promise.all([readReferenceData("bid windows", () => loadPublishedBidWindows(client, bidYear.id)), rosterReady]).then(([result]) => {
        supabaseState.bidTimesLoadState = result.error || rosterResult.error ? "error" : "loaded";
        if (!result.error) applyBidWindowsFromDatabase(supabaseRows(result));
        refreshPublicReferenceSection();
        return result;
      }),
      rosterReady,
    ]);

    const loadWarnings = [
      supabaseLoadWarning("roster", rosterResult),
      supabaseLoadWarning("holidays", holidaysResult),
      supabaseLoadWarning("RDO lines", rdoLinesResult),
      isMissingSupabaseRoutine(glRdoAssignmentsResult.error) ? null : supabaseLoadWarning("GL RDO assignments", glRdoAssignmentsResult),
      supabaseLoadWarning("intake submissions", biddingStateResult),
      supabaseLoadWarning("leave slots", leaveSlotsResult),
      supabaseLoadWarning("leave requests", leaveRequestsResult),
      isMissingSupabaseRoutine(ghostStatusResult.error) ? null : supabaseLoadWarning("ghost bidding status", ghostStatusResult),
      supabaseLoadWarning("intake schedules", intakeSchedulesResult),
      supabaseLoadWarning("intake calendar days", intakeCalendarMarksResult),
      isMissingSupabaseRoutine(shiftPresetsResult.error) ? null : supabaseLoadWarning("intake shift presets", shiftPresetsResult),
      isMissingSupabaseRoutine(bidYearSettingsResult.error) ? null : supabaseLoadWarning("bid year settings", bidYearSettingsResult),
      isMissingSupabaseRoutine(roundRulesResult.error) ? null : supabaseLoadWarning("round rules", roundRulesResult),
      isMissingSupabaseRoutine(approvalRulesResult.error) ? null : supabaseLoadWarning("approval rules", approvalRulesResult),
      isMissingSupabaseRoutine(pilotSettingsResult.error) ? null : supabaseLoadWarning("pilot settings", pilotSettingsResult),
      isMissingSupabaseRoutine(bidWindowsResult.error) ? null : supabaseLoadWarning("bid windows", bidWindowsResult),
    ].filter(Boolean);

    supabaseRows(holidaysResult).forEach((holiday) => {
      if (holiday.holiday_date) holidayOverrides.add(holiday.holiday_date);
    });

    if (!glRdoAssignmentsResult.error) applyGlRdoAssignments(supabaseRows(glRdoAssignmentsResult));
    const biddingStateSubmissions = biddingStateResult.error
      ? []
      : biddingStateResult.data?.submissions || [];
    const rdoSubmissionRows = biddingStateSubmissions.filter((row) => (
      biddingStateSubmissionType(row) === "RDO Line"
      && ["pending", "approved", "denied"].includes(String(row.status || "").toLowerCase())
    ));
    if (!biddingStateResult.error) upsertRdoSubmissionsFromDatabase(rdoSubmissionRows, areaById);
    if (!leaveRequestsResult.error) {
      upsertLeaveRequestsFromDatabase(
        attachSubmissionIdsToLeaveRequests(
          await attachLeaveRequestWeekBuckets(client, leaveRequestsResult.data || []),
          biddingStateSubmissions
        ),
        areaById
      );
    }
    if (!ghostStatusResult.error) applyGhostBiddingStatus(ghostStatusResult.data || []);
    supabaseState.intakeSchedulesError = intakeSchedulesResult.error?.message || "";
    if (!intakeSchedulesResult.error) applyIntakeSchedulesFromDatabase(intakeSchedulesResult.data || [], areaById);
    if (!intakeCalendarMarksResult.error) {
      intakeCalendarMarks.clear();
      (intakeCalendarMarksResult.data || []).forEach((row) => intakeCalendarMarks.set(row.marked_date, row.kind));
    }
    if (!shiftPresetsResult.error && shiftPresetsResult.data !== null) applyIntakeShiftPresets(shiftPresetsResult.data);
    if (!bidYearSettingsResult.error) applyBidYearSettings(Array.isArray(bidYearSettingsResult.data) ? bidYearSettingsResult.data[0] : bidYearSettingsResult.data);
    if (!roundRulesResult.error && roundRulesResult.data) applyRoundRules(roundRulesResult.data);
    if (!approvalRulesResult.error && approvalRulesResult.data !== null) applyApprovalRules(approvalRulesResult.data);
    if (!pilotSettingsResult.error && pilotSettingsResult.data) {
      applyPilotSettings(Array.isArray(pilotSettingsResult.data) ? pilotSettingsResult.data[0] : pilotSettingsResult.data);
      await refreshPilotRounds();
    }
    supabaseState.connected = true;
    supabaseState.loadedAt = new Date();
    supabaseState.message = `Connected to Supabase. Loaded ${(areasResult.data || []).length} areas, ${(rosterResult.data || []).length} bidders, ${supabaseRows(bidWindowsResult).length} bid windows, ${supabaseRows(holidaysResult).length} holidays, ${supabaseRows(rdoLinesResult).length} RDO lines, ${rdoSubmissionRows.length} RDO submissions, ${supabaseRows(leaveSlotsResult).length} leave-slot days, ${supabaseRows(leaveRequestsResult).length} leave requests, ${supabaseRows(intakeSchedulesResult).length} intake schedules, ${publicFaqContent.entries.length} FAQ entries, and ${publicFaqContent.documents.length} MOU documents.`;
    if (loadWarnings.length) {
      supabaseState.message += ` Some optional data could not load: ${loadWarnings.join("; ")}`;
      console.warn(supabaseState.message);
    }
  } catch (error) {
    supabaseState.connected = false;
    if (supabaseState.rdoLinesLoadState === "loading") supabaseState.rdoLinesLoadState = "error";
    if (supabaseState.bidTimesLoadState === "loading") supabaseState.bidTimesLoadState = "error";
    if (supabaseState.leaveSlotsLoadState === "loading") supabaseState.leaveSlotsLoadState = "error";
    supabaseState.message = `Supabase data unavailable. No prototype fallback was loaded. ${error.message || error}`;
    console.warn(supabaseState.message);
  } finally {
    // FAQ content updates independently and must not delay member startup.
    void faqReads;
    supabaseState.loading = false;
    supabaseState.referenceDataLoaded = true;
    // Help has no bearing on bidding eligibility or availability. Start it after
    // essential data is applied, and refresh only help-related UI when it arrives.
    if (supabaseState.connected) loadBackgroundHelpThreads();
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
  if (!date || !Number.isFinite(date.getTime())) return "—";
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

const DEFAULT_INTAKE_SHIFT_PRESETS = [
  { id: "default-0645", startTime: "06:45", durationHours: 8 },
  { id: "default-1115", startTime: "11:15", durationHours: 8 },
];
let intakeShiftPresets = [...DEFAULT_INTAKE_SHIFT_PRESETS];
let editingShiftPresetId = "";
let shiftPresetMutationPending = false;

function formatShiftPresetTime(value) {
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
    .format(new Date(Date.UTC(2020, 0, 1, hour, minute)));
}

function renderShiftPresets() {
  const buttons = document.querySelector("[data-intake-shift-preset-buttons]");
  if (buttons) {
    buttons.innerHTML = intakeShiftPresets.map((preset) => `
      <button type="button" data-intake-shift-preset="${escapeAttribute(preset.id)}" aria-pressed="false">
        ${escapeHtml(formatShiftPresetTime(preset.startTime))}<small>${escapeHtml(String(preset.durationHours))}h</small>
      </button>
    `).join("") || '<span class="empty-state small">No base shifts yet. Enter a time and length below.</span>';
  }
  const builder = document.querySelector("[data-shift-builder]");
  if (builder) builder.hidden = !hasSystemAdminAccess();
  const list = document.querySelector("[data-shift-builder-list]");
  if (list) list.innerHTML = intakeShiftPresets.map((preset) => `
    <div class="shift-builder-row">
      <span><strong>${escapeHtml(formatShiftPresetTime(preset.startTime))}</strong><small>${escapeHtml(String(preset.durationHours))} hours</small></span>
      <div class="shift-builder-actions">
        <button type="button" class="secondary-action small" data-edit-shift-preset="${escapeAttribute(preset.id)}">Edit</button>
        <button type="button" class="secondary-action small danger-action" data-delete-shift-preset="${escapeAttribute(preset.id)}">Delete</button>
      </div>
    </div>
  `).join("") || '<p class="empty-state small">No base shifts yet.</p>';
  const form = document.querySelector("[data-shift-builder-form]");
  if (form) {
    form.querySelector("[data-save-shift-preset]").textContent = editingShiftPresetId ? "Save Shift" : "Add Shift";
    form.querySelector("[data-cancel-shift-preset]").hidden = !editingShiftPresetId;
    form.querySelectorAll("button, input").forEach((control) => { control.disabled = shiftPresetMutationPending; });
  }
  syncIntakeShiftForm(document.querySelector("[data-schedule-start]")?.closest(".schedule-form"));
}

function setShiftBuilderStatus(message, status = "info") {
  showActionFeedback(message, status);
  const target = document.querySelector("[data-shift-builder-status]");
  if (target) { target.textContent = message; target.dataset.status = status; }
}

function resetShiftPresetEditor() {
  editingShiftPresetId = "";
  document.querySelector("[data-shift-builder-form]")?.reset();
  renderShiftPresets();
}

async function saveShiftPreset(event) {
  event.preventDefault();
  if (!hasSystemAdminAccess() || shiftPresetMutationPending) return;
  const form = event.currentTarget;
  const startTime = form.querySelector("[data-shift-builder-time]").value;
  const durationHours = Number(form.querySelector("[data-shift-builder-hours]").value);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !Number.isFinite(durationHours) || durationHours < 0.25 || durationHours > 24 || durationHours * 4 % 1 !== 0) {
    setShiftBuilderStatus("Enter a start time and a length in quarter-hour increments, up to 24 hours.", "error");
    return;
  }
  if (intakeShiftPresets.some((preset) => preset.startTime === startTime && preset.id !== editingShiftPresetId)) {
    setShiftBuilderStatus("A base shift already starts at that time.", "error");
    return;
  }
  const client = supabaseClient();
  if (!client || !supabaseState.connected) { setShiftBuilderStatus("Connect to the database to save base shifts.", "error"); return; }
  shiftPresetMutationPending = true;
  renderShiftPresets();
  const wasEditing = Boolean(editingShiftPresetId);
  try {
    const { error } = await client.rpc("save_intake_shift_preset", {
      requested_id: wasEditing ? editingShiftPresetId : null,
      requested_start_time: startTime,
      requested_duration_hours: durationHours,
    });
    if (error) throw error;
    const result = await client.rpc("read_intake_shift_presets");
    if (result.error) throw result.error;
    applyIntakeShiftPresets(result.data);
    resetShiftPresetEditor();
    setShiftBuilderStatus(wasEditing ? "Base shift updated." : "Base shift added.", "success");
  } catch (error) {
    setShiftBuilderStatus(error.message || "The base shift could not be saved.", "error");
  } finally {
    shiftPresetMutationPending = false;
    renderShiftPresets();
  }
}

async function deleteShiftPreset(id) {
  if (!hasSystemAdminAccess() || shiftPresetMutationPending) return;
  const preset = intakeShiftPresets.find((item) => item.id === id);
  if (!preset || !window.confirm(`Delete the ${formatShiftPresetTime(preset.startTime)} base shift? Existing scheduled shifts will stay as they are.`)) return;
  const client = supabaseClient();
  if (!client || !supabaseState.connected) { setShiftBuilderStatus("Connect to the database to delete base shifts.", "error"); return; }
  shiftPresetMutationPending = true;
  renderShiftPresets();
  try {
    const result = await client.rpc("delete_intake_shift_preset", { requested_id: id });
    if (result.error) throw result.error;
    intakeShiftPresets = intakeShiftPresets.filter((item) => item.id !== id);
    if (editingShiftPresetId === id) resetShiftPresetEditor();
    setShiftBuilderStatus("Base shift deleted.", "success");
  } catch (error) {
    setShiftBuilderStatus(error.message || "The base shift could not be deleted.", "error");
  } finally {
    shiftPresetMutationPending = false;
    renderShiftPresets();
  }
}

function applyIntakeShiftPresets(rows) {
  intakeShiftPresets = (rows || []).map((row) => ({
    id: row.id,
    startTime: String(row.start_time).slice(0, 5),
    durationHours: Number(row.duration_hours),
  }));
  renderShiftPresets();
}

function syncIntakeShiftForm(form, options = {}) {
  if (!form) return;

  const dateInput = form.querySelector("[data-intake-shift-date]");
  const timeInput = form.querySelector("[data-intake-shift-time]");
  const durationInput = form.querySelector("[data-intake-shift-duration]");
  const startInput = form.querySelector("[data-schedule-start]");
  const endInput = form.querySelector("[data-schedule-end]");
  if (!dateInput || !timeInput || !durationInput || !startInput || !endInput) return;

  if (!dateInput.value) {
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + (options.defaultOffsetDays ?? 5));
    dateInput.value = formatDateTimeLocalValue(defaultDate).slice(0, 10);
  }
  if (!timeInput.value && intakeShiftPresets.length) timeInput.value = intakeShiftPresets[0].startTime;
  if (!durationInput.value && intakeShiftPresets.length) durationInput.value = String(intakeShiftPresets[0].durationHours);

  const durationHours = Number(durationInput.value);
  const start = new Date(`${dateInput.value}T${timeInput.value}`);
  const hasValidRange = !Number.isNaN(start.getTime()) && Number.isFinite(durationHours) && durationHours > 0 && durationHours <= 24;

  if (hasValidRange) {
    const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
    startInput.value = formatDateTimeLocalValue(start);
    endInput.value = formatDateTimeLocalValue(end);
  } else {
    startInput.value = "";
    endInput.value = "";
  }

  form.querySelectorAll("[data-intake-shift-preset]").forEach((button) => {
    const preset = intakeShiftPresets.find((item) => item.id === button.dataset.intakeShiftPreset);
    const isActive = preset?.startTime === timeInput.value && preset?.durationHours === durationHours;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function applyIntakeShiftPreset(button) {
  const form = button.closest(".schedule-form");
  if (!form) return;
  const timeInput = form.querySelector("[data-intake-shift-time]");
  const durationInput = form.querySelector("[data-intake-shift-duration]");
  const preset = intakeShiftPresets.find((item) => item.id === button.dataset.intakeShiftPreset);
  if (!preset) return;
  if (timeInput) timeInput.value = preset.startTime;
  if (durationInput) durationInput.value = String(preset.durationHours);
  syncIntakeShiftForm(form);
}

function formatDateRange(start, end) {
  const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  const timeFormatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
  return `${dateFormatter.format(start)} · ${timeFormatter.format(start)} - ${timeFormatter.format(end)}`;
}

function formatBidWindowStart(start) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
}

function latestAreaRound(date = new Date(), roundState = areaBidRoundState(date)) {
  if (activeTestBidRound()) return activeTestBidRound();
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

function escapeAttribute(value = "") {
  return escapeHtml(value).replace(/'/g, "&#39;");
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
  return "Select a date to view open slots and bidder initials. Read-only calendar.";
}

function publicInfoText(area, section) {
  if (area === "FAQ") {
    return renderPublicFaq();
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

function plainTextMarkup(text = "") {
  return String(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

const PUBLIC_RICH_TEXT_TAGS = new Set(["P", "DIV", "BR", "STRONG", "B", "EM", "I", "U", "UL", "OL", "LI", "A", "H3", "H4", "BLOCKQUOTE", "SPAN"]);
const PUBLIC_RICH_TEXT_FONT_SIZES = new Set(["0.75rem", "0.875rem", "1rem", "1.125rem", "1.25rem", "1.5rem", "2rem"]);

function safePublicRichTextColor(value = "") {
  const color = String(value).trim().toLowerCase();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^rgba?\(\s*\d{1,3}(?:\.\d+)?%?\s*,\s*\d{1,3}(?:\.\d+)?%?\s*,\s*\d{1,3}(?:\.\d+)?%?(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(color)) return color;
  return "";
}

function safePublicRichTextStyle(element) {
  if (!(element instanceof HTMLElement) || element.tagName !== "SPAN") return "";
  const declarations = [];
  const fontSize = element.style.fontSize.trim().toLowerCase();
  const color = safePublicRichTextColor(element.style.color);
  if (PUBLIC_RICH_TEXT_FONT_SIZES.has(fontSize)) declarations.push(`font-size: ${fontSize}`);
  if (color) declarations.push(`color: ${color}`);
  return declarations.join("; ");
}

function sanitizePublicRichHtml(value = "") {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(String(value), "text/html");
  Array.from(parsed.body.querySelectorAll("*")).forEach((element) => {
    if (element.tagName === "SCRIPT" || element.tagName === "STYLE") {
      element.remove();
      return;
    }

    if (!PUBLIC_RICH_TEXT_TAGS.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }

    const href = element.tagName === "A" ? (element.getAttribute("href") || "").trim() : "";
    const inlineStyle = safePublicRichTextStyle(element);
    Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name));
    if (element.tagName === "A" && /^(https?:|mailto:|tel:|\/)/i.test(href)) {
      element.setAttribute("href", href);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
    if (element.tagName === "SPAN" && inlineStyle) element.setAttribute("style", inlineStyle);
  });
  return parsed.body.innerHTML.trim();
}

function richTextMarkup(value = "") {
  const text = String(value).trim();
  if (!text) return "";
  const hasSupportedMarkup = /<\/?(?:p|div|br|strong|b|em|i|u|ol|ul|li|a|h3|h4|blockquote|span)\b/i.test(text);
  return sanitizePublicRichHtml(hasSupportedMarkup ? text : plainTextMarkup(text));
}

function renderPublicFaq() {
  const entries = publicFaqContent.entries || [];
  const documents = publicFaqContent.documents || [];

  if (!entries.length && !documents.length) {
    const message = ["idle", "loading"].includes(supabaseState.faqLoadState)
      ? "Loading the current FAQ and bidding references…"
      : supabaseState.faqLoadState === "loaded"
        ? "No FAQ items or MOU documents are published yet."
        : "The current FAQ could not be loaded. Please refresh to try again.";
    return `
      <div class="public-info-card">
        <p>${message}</p>
      </div>
    `;
  }

  return `
    <div class="public-faq-grid">
      <section class="public-faq-section" aria-labelledby="public-faq-heading">
        <div class="public-table-heading flat">
          <strong id="public-faq-heading">Frequently asked questions</strong>
          <small>${entries.length ? "Current guidance published by the ZLA bidding team." : "Questions will appear here when they are published."}</small>
        </div>
        <div class="public-faq-list">
          ${entries.map((entry) => `
            <details class="public-faq-item" open>
              <summary>${escapeHtml(entry.question)}</summary>
              <div class="public-rich-text">${richTextMarkup(entry.answer)}</div>
            </details>
          `).join("") || '<p class="public-empty-note">No FAQ items are published yet.</p>'}
        </div>
      </section>
      <section class="public-faq-section" aria-labelledby="public-mou-heading">
        <div class="public-table-heading flat">
          <strong id="public-mou-heading">MOUs and References</strong>
          <small>Click on the article to download the MOU.</small>
        </div>
        <div class="public-mou-list">
          ${documents.map((document) => `
            <article class="public-mou-link">
              <a class="public-mou-title" href="${escapeAttribute(document.file_url || "")}" target="_blank" rel="noreferrer">${escapeHtml(document.title)}</a>
              ${document.description ? `<div class="public-rich-text">${richTextMarkup(document.description)}</div>` : ""}
            </article>
          `).join("") || '<p class="public-empty-note">No MOU documents are published yet.</p>'}
        </div>
      </section>
    </div>
  `;
}

function bidAsClass(bidAs) {
  return bidAs.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

let activeRdoStickyHeaderSource = null;
let activeRdoStickyHeaderSignature = "";
let rdoStickyHeaderUpdateFrame = 0;

function rdoStickyHeaderElement() {
  let header = document.querySelector("[data-rdo-floating-header]");
  if (header) return header;

  header = document.createElement("div");
  header.className = "rdo-floating-table-header";
  header.dataset.rdoFloatingHeader = "";
  header.setAttribute("aria-hidden", "true");
  header.hidden = true;
  header.innerHTML = '<div class="rdo-floating-table-header-viewport" data-rdo-floating-header-viewport></div>';
  document.body.append(header);
  return header;
}

function rdoStickyHeaderTop() {
  const publicShell = document.querySelector(".public-shell:not([hidden])");
  const publicHeader = publicShell
    ? publicShell.querySelector(window.matchMedia("(max-width: 720px)").matches ? ".public-rail" : ".public-topbar")
    : null;
  const memberHeader = document.querySelector(".app-shell:not([hidden]) .topbar");
  const header = publicHeader || memberHeader;
  if (!header || !["fixed", "sticky"].includes(getComputedStyle(header).position)) return 0;
  return Math.max(0, Math.round(header.getBoundingClientRect().bottom));
}

function rebuildRdoStickyHeader(source, floatingHeader) {
  const sourceTable = source.querySelector("table");
  const sourceHead = sourceTable?.querySelector("thead");
  if (!sourceTable || !sourceHead) return false;

  const sourceCells = [...sourceHead.querySelectorAll("th")];
  const sourceWidth = sourceTable.getBoundingClientRect().width;
  const cellWidths = sourceCells.map((cell) => cell.getBoundingClientRect().width);
  const signature = `${sourceHead.textContent}|${sourceWidth}|${cellWidths.join(",")}`;
  if (source === activeRdoStickyHeaderSource && signature === activeRdoStickyHeaderSignature) return true;

  const table = document.createElement("table");
  table.className = sourceTable.className;
  table.style.width = `${sourceWidth}px`;
  table.style.minWidth = `${sourceWidth}px`;

  const columns = document.createElement("colgroup");
  cellWidths.forEach((width) => {
    const column = document.createElement("col");
    column.style.width = `${width}px`;
    columns.append(column);
  });
  table.append(columns, sourceHead.cloneNode(true));

  floatingHeader.querySelector("[data-rdo-floating-header-viewport]").replaceChildren(table);
  floatingHeader.dataset.surface = source.closest(".public-main") ? "public" : "member";
  activeRdoStickyHeaderSource = source;
  activeRdoStickyHeaderSignature = signature;
  return true;
}

function updateRdoStickyHeader() {
  rdoStickyHeaderUpdateFrame = 0;
  const floatingHeader = rdoStickyHeaderElement();
  const top = rdoStickyHeaderTop();
  const source = [...document.querySelectorAll(".rdo-page-table-wrap")].find((wrap) => {
    const bounds = wrap.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 && bounds.top < top && bounds.bottom > top + 38;
  });

  if (!source || !rebuildRdoStickyHeader(source, floatingHeader)) {
    floatingHeader.hidden = true;
    activeRdoStickyHeaderSource = null;
    activeRdoStickyHeaderSignature = "";
    return;
  }

  const bounds = source.getBoundingClientRect();
  floatingHeader.style.top = `${top}px`;
  floatingHeader.style.left = `${bounds.left}px`;
  floatingHeader.style.width = `${bounds.width}px`;
  floatingHeader.hidden = false;
  floatingHeader.querySelector("[data-rdo-floating-header-viewport]").scrollLeft = source.scrollLeft;
}

function scheduleRdoStickyHeaderUpdate() {
  if (rdoStickyHeaderUpdateFrame) return;
  rdoStickyHeaderUpdateFrame = window.requestAnimationFrame(updateRdoStickyHeader);
}

document.addEventListener("scroll", scheduleRdoStickyHeaderUpdate, true);
window.addEventListener("resize", () => {
  activeRdoStickyHeaderSignature = "";
  scheduleRdoStickyHeaderUpdate();
});

function publicRdoFilteredLines(area) {
  return rdoLinesForArea(area).filter((line) => rdoLineMatchesFilterSet(line, publicRdoFilters));
}

const PUBLIC_RDO_LINE_SECTIONS = ["CPC", "R-Dev", "D-Dev"];

function publicRdoLineSection(line) {
  if (line.lineType !== "DEV") return "CPC";
  return /D[-\s]?DEV/i.test(line.pattern) ? "D-Dev" : "R-Dev";
}

function rdoLineDisplayFatigueGroup(line, { previewGroup = "", pendingGroup = "" } = {}) {
  const group = line.status === "Taken" ? line.group : pendingGroup || previewGroup;
  return ["A", "B", "C"].includes(group) ? group : "";
}

function rdoFatigueGroupBadge(group) {
  return ["A", "B", "C"].includes(group)
    ? `<span class="group ${groupClass(group)}">${group}</span>`
    : "";
}

function rdoLinesLoadMessage() {
  if (supabaseState.rdoLinesLoadState === "loaded") return "";
  if (supabaseState.rdoLinesLoadState === "loading"
      || (supabaseState.rdoLinesLoadState === "idle" && !supabaseState.referenceDataLoaded)) {
    return "Loading RDO lines…";
  }
  return "RDO lines could not be loaded. Please refresh the browser to reload.";
}

function publicRdoRowsMarkup(area, lines, showPatternGroups = true) {
  const loadMessage = rdoLinesLoadMessage();
  if (loadMessage) return `<tr><td colspan="12" role="status">${escapeHtml(loadMessage)}</td></tr>`;
  if (!lines.length) return `<tr><td colspan="12">No RDO lines match those filters for ${area}.</td></tr>`;

  let lastPattern = "";
  const rows = [];

  lines.forEach((line) => {
    if (showPatternGroups && line.pattern !== lastPattern) {
      rows.push(`<tr><th colspan="12">${line.pattern}</th></tr>`);
      lastPattern = line.pattern;
    }

    const swingIndex = thirdDaySwingIndex(line.week);
    rows.push(`
      <tr class="${line.status === "Taken" ? "occupied-row" : ""}">
        <td>${line.line}</td>
        <td><b class="rdo-line-bidders">${lineBidderMarkup(line, { showOpenWhenShared: true })}</b></td>
        ${line.week.map((value, index) => `<td>${shiftCell(value, index === swingIndex)}</td>`).join("")}
        <td>${rdoFatigueGroupBadge(rdoLineDisplayFatigueGroup(line))}</td>
        <td>${rdoLineAwsReferenceCell(line)}</td>
        <td>${rdoLineMidReferenceCell(line)}</td>
      </tr>
    `);
  });

  return rows.join("");
}

function publicRdoSectionsMarkup(area, lines = publicRdoFilteredLines(area)) {
  const loadMessage = rdoLinesLoadMessage();
  if (loadMessage) return `<div class="public-rdo-empty" role="status">${escapeHtml(loadMessage)}</div>`;
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
        <div class="mobile-rdo-cards">
          ${sectionLines.map((line) => {
            const swingIndex = thirdDaySwingIndex(line.week);
            return `
              <details class="mobile-rdo-card">
                <summary>
                  <span><strong>Line ${escapeHtml(line.line)}</strong><span class="mobile-rdo-pattern">RDO: ${line.week.map((value, index) => value === "RDO" ? dayNames[index] : "").filter(Boolean).join(", ") || escapeHtml(line.pattern)}</span></span>
                  <span class="mobile-line-status">${lineStatusMarkup(line)}</span>
                  <span class="mobile-expand-label">Schedule <span aria-hidden="true">⌄</span></span>
                </summary>
                <dl class="mobile-line-week">${line.week.map((value, index) => `<div><dt>${dayNames[index]}</dt><dd>${shiftCell(value, index === swingIndex)}</dd></div>`).join("")}</dl>
                <p>Fatigue group: ${rdoFatigueGroupBadge(rdoLineDisplayFatigueGroup(line)) || "Not assigned"}</p>
                ${rdoLineAwsReferenceCell(line) ? `<p>AWS: ${rdoLineAwsReferenceCell(line)}</p>` : ""}
                ${rdoLineMidReferenceCell(line) ? `<p>Mid: ${rdoLineMidReferenceCell(line)}</p>` : ""}
              </details>
            `;
          }).join("")}
        </div>
        <div class="table-wrap rdo-page-table-wrap" tabindex="0" role="region" aria-label="${section} schedule comparison table, scroll horizontally">
          <table class="line-table public-rdo-table public-mobile-rdo-table">
            <thead>
              <tr>
                <th>Line #</th>
                <th>Bidder</th>
                ${dayNames.map((day) => `<th>${day}</th>`).join("")}
                <th>Group</th>
                <th>AWS</th>
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
      <p class="rdo-gl-legend"><span class="gl-line-bidder">*</span> GL / Ghost Bid · visible, but does not occupy the line</p>
      <div class="mobile-rdo-view" role="group" aria-label="RDO display">
        <button type="button" data-rdo-presentation="cards" aria-pressed="${publicRdoPresentation === "cards"}">Line cards</button>
        <button type="button" data-rdo-presentation="table" aria-pressed="${publicRdoPresentation === "table"}">Compare table</button>
      </div>
      <p class="mobile-table-hint" ${publicRdoPresentation === "table" ? "" : "hidden"}>Swipe the table sideways to compare schedules. Line numbers stay visible.</p>
      <div class="public-rdo-sections" data-public-rdo-sections data-presentation="${publicRdoPresentation}">
        ${publicRdoSectionsMarkup(area, lines)}
      </div>
    </section>
  `;
}

function bidTimeOpenRound(rank, area, roundCount, date = new Date()) {
  for (let round = 1; round <= roundCount; round += 1) {
    const window = bidWindowForRankRound(rank, round, area);
    if (window && date >= window.start && date < window.end) return round;
  }
  return null;
}

function bidTimeCurrentBidderDot(person) {
  const roundCount = person.rounds.length;
  const round = bidTimeOpenRound(person.rank, person.area, roundCount);
  const label = round ? `Round ${round} bid window open` : "";
  return `<i class="open-now bid-time-current-dot" data-bid-time-current-dot data-bidder-rank="${person.rank}" data-bidder-area="${escapeHtml(person.area)}" data-bidder-round-count="${roundCount}" role="img" aria-label="${label}" title="${label}"${round ? "" : " hidden"}></i>`;
}

function syncBidTimeCurrentBidderDots(date = new Date()) {
  const rounds = new Map();
  document.querySelectorAll("[data-bid-time-current-dot]").forEach((dot) => {
    const { bidderArea, bidderRank, bidderRoundCount } = dot.dataset;
    const key = `${bidderArea}:${bidderRank}:${bidderRoundCount}`;
    if (!rounds.has(key)) rounds.set(key, bidTimeOpenRound(Number(bidderRank), bidderArea, Number(bidderRoundCount), date));
    const round = rounds.get(key);
    const label = round ? `Round ${round} bid window open` : "";
    dot.hidden = !round;
    dot.parentElement.classList.toggle("current-bid-time-name", Boolean(round));
    if (dot.getAttribute("aria-label") !== label) {
      dot.setAttribute("aria-label", label);
      dot.title = label;
    }
  });
}

function renderPublicBidTimeTable(area) {
  if (supabaseState.bidTimesLoadState !== "loaded") {
    const message = supabaseState.bidTimesLoadState === "error"
      ? "Bid times could not be loaded. Refresh to try again."
      : "Loading bid times…";
    return `<p role="status">${escapeHtml(message)}</p>`;
  }
  const showBidderNames = Boolean(supabaseState.authUserId);

  return `
    <div class="public-table-heading flat">
      <small>All rounds are two-hour bid windows. Times shown are bid-window start times.</small>
    </div>
    <div class="mobile-bid-time-view" role="group" aria-label="Bid time display">
      <button type="button" data-bid-time-presentation="cards" aria-pressed="${publicBidTimePresentation === "cards"}">Cards</button>
      <button type="button" data-bid-time-presentation="list" aria-pressed="${publicBidTimePresentation === "list"}">List</button>
    </div>
    <label class="mobile-bid-time-search">Find your bid times<input type="search" placeholder="${showBidderNames ? "Name or initials" : "Initials"}" aria-label="Find your bid times" data-mobile-bid-search /></label>
    <div class="public-bid-time-results" data-public-bid-time-results data-presentation="${publicBidTimePresentation}">
      <div class="mobile-bid-time-cards">
        ${seniority.map((person) => `
          <article class="mobile-bid-time-card" data-public-bid-time-card>
            <h3 data-bidder-name><span>${person.rank}.${showBidderNames ? ` ${escapeHtml(person.firstName)} ${escapeHtml(person.lastName)}` : ""} ${bidTimeCurrentBidderDot(person)}</span><span class="bid-as ${bidAsClass(person.bidAs)}">${escapeHtml(person.bidAs)}</span></h3>
            <p>${escapeHtml(person.initials)}</p>
            <dl>${person.rounds.map((round, index) => `<div><dt>Round ${index + 1}</dt><dd>${escapeHtml(publicBidTimeLabel(round) || "Not scheduled.  Please refresh the browser to reload.")}</dd></div>`).join("")}</dl>
          </article>
        `).join("")}
        ${seniority.length ? "" : "<p>No bid times are published for this area yet.</p>"}
      </div>
      <div class="table-wrap public-table-wrap flat desktop-bid-times public-bid-time-list-wrap" tabindex="0" role="region" aria-label="Bid time list, scroll horizontally">
        <table class="public-bid-time-table">
          <colgroup>
            <col class="bid-time-rank-column" />
            ${showBidderNames ? '<col class="bid-time-name-column" />' : ""}
            <col class="bid-time-initials-column" />
            <col class="bid-time-role-column" />
            ${Array.from({ length: 4 }, () => '<col class="bid-time-round-column" />').join("")}
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              ${showBidderNames ? '<th class="bid-time-name">Name</th>' : ""}
              <th class="bid-time-initials">Initials</th>
              <th>Bid As</th>
              <th class="bid-time-round">Round 1</th>
              <th class="bid-time-round">Round 2</th>
              <th class="bid-time-round">Round 3</th>
              <th class="bid-time-round">Round 4</th>
            </tr>
          </thead>
          <tbody>
            ${seniority.map((person) => `
              <tr data-public-bid-time-row>
                <td>${person.rank}</td>
                ${showBidderNames ? `<td class="bid-time-name">${escapeHtml(person.firstName)} ${escapeHtml(person.lastName)} ${bidTimeCurrentBidderDot(person)}</td>` : ""}
                <td class="bid-time-initials">${escapeHtml(person.initials)}${showBidderNames ? "" : ` ${bidTimeCurrentBidderDot(person)}`}</td>
                <td><span class="bid-as ${bidAsClass(person.bidAs)}">${escapeHtml(person.bidAs)}</span></td>
                ${person.rounds.map((round) => `<td class="bid-time-round">${escapeHtml(publicBidTimeLabel(round) || "Not scheduled.  Please refresh the browser to reload.")}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <p data-mobile-bid-empty hidden role="status">No bidders match ${showBidderNames ? "that name or those initials" : "those initials"}.</p>
    </div>
  `;
}

function updatePublicView(area = publicState.area, section = publicState.section) {
  publicState.area = area;
  publicState.section = section || "Calendar";
  const areaSelect = document.querySelector("[data-mobile-public-area]");
  if (areaSelect) areaSelect.value = ZLA_AREAS.includes(area) ? area : "";
  document.querySelectorAll(".public-nav .public-area").forEach((group) => {
    group.open = group.querySelector("[data-public-area]")?.dataset.publicArea === area;
  });
  document.querySelector(".mobile-public-menu")?.removeAttribute("open");

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
    calendarViewControls.hidden = isInfoView;
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
  return ZLA_AREAS.includes(area) ? area : currentUser?.area || "Area A";
}

function renderPublicPage(area = publicState.area, section = publicState.section, { persistNavigation = false } = {}) {
  if (persistNavigation) syncPublicPageUrl(area, section);
  syncPilotControls();
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
    const accessStart = new Date(schedule.start.getTime() - 60 * 60 * 1000);
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

function canViewIntakeSchedule() {
  return hasSystemAdminAccess()
    || Boolean(currentUser?.supabaseProfileId && intakeTeamInitials.has(currentUser.initials));
}

async function refreshIntakeScheduleMembership() {
  const client = supabaseClient();
  if (!client || !supabaseState.authUserId) return false;

  const { data, error } = await client.rpc("read_bidding_roster");
  if (error) {
    closeIntakeScheduleAfterFailedCheck();
    return false;
  }
  applyRosterFromDatabase(data || []);
  if (!canViewIntakeSchedule()) {
    closeIntakeScheduleAfterFailedCheck();
    return false;
  }

  const schedulesResult = await loadIntakeSchedules(client);
  supabaseState.intakeSchedulesError = schedulesResult.error?.message || "";
  if (schedulesResult.error) {
    closeIntakeScheduleAfterFailedCheck();
    return false;
  }
  applyIntakeSchedulesFromDatabase(schedulesResult.data || []);
  renderApp();
  return true;
}

function closeIntakeScheduleAfterFailedCheck() {
  intakeSchedules.splice(0, intakeSchedules.length);
  if (document.querySelector(".page.active")?.dataset.pagePanel === "intake-schedule") {
    setPage("dashboard");
  }
  renderApp();
}

function pageForViewMode(mode) {
  if (mode === "admin") return "admin";
  if (mode === "intake") return "intake";
  return "dashboard";
}

function viewModeForPage(pageName) {
  if (pageName === "admin" || pageName === "admin-tools") return "admin";
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
  const canOpenIntakeSchedule = canViewIntakeSchedule();
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
  setText("[data-profile-ghost-status]", currentUser.ghostBidder ? "Ghost Bidder" : "Standard Bidder");

  document.querySelectorAll(".account-pill").forEach((button) => {
    button.classList.remove("bid-as-cpc", "bid-as-gl", "bid-as-r-dev", "bid-as-d-dev");
    button.classList.add(bidAsClassName);
    button.title = `${currentUser.initials} · ${bidAs}${currentUser.ghostBidder ? " · Ghost Bidder" : ""}`;
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
  setText("[data-dashboard-rdo-line]", rdoAssignmentRequest?.line || rdoAssignmentLine?.line
    ? `${rdoAssignmentRequest?.ghostBid ? "Ghost Line" : "Line"} ${rdoAssignmentRequest?.line || rdoAssignmentLine.line}`
    : "No line selected");
  setText("[data-dashboard-rdo-summary]", rdoAssignmentRequest?.summary || "Your selected RDO line will appear after you bid.");
  renderDashboardSelectedLineCard(rdoAssignment);

  document.querySelectorAll("[data-admin-only]").forEach((element) => {
    element.hidden = !canOpenIntake;
  });

  document.querySelectorAll("[data-intake-rep-only]").forEach((element) => {
    element.hidden = !canOpenIntakeSchedule;
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

function shouldShowLateBidContact(date = new Date()) {
  return !pilotState.database
    && bidWindowErrorMessage("RDO bids", date) === LATE_BID_MESSAGE
    && !hasSubmittedRdoBid();
}

function openLateBidDialog() {
  const dialog = document.querySelector("[data-late-bid-dialog]");
  if (!dialog || dialog.open) return;
  dialog.showModal();
}

function closeLateBidDialog() {
  document.querySelector("[data-late-bid-dialog]")?.close();
}

function updateBidWindow(force = false) {
  if (!currentUser || !isMemberAppVisible()) return;
  return withLeaveReadCache(() => updateBidWindowWithCache(force));
}

function updateBidWindowWithCache(force = false) {
  const now = new Date();
  syncIntakeBidderWindowStatus(now);
  syncBidTimeCurrentBidderDots(now);
  const roundState = areaBidRoundState(now);
  const isValidationPeriod = !pilotState.database && roundState?.phase === "validation";
  const personalBidWindow = currentUserBidWindow(now);
  const testRound = activeTestBidRound();
  const currentRound = testRound || latestAreaRound(now, roundState);
  const personalRound = testRound || personalBidWindow?.round || currentRound;
  const viewingHomeArea = isViewingHomeArea();
  const isBefore = !pilotState.database && viewingHomeArea && personalBidWindow && now < personalBidWindow.start;
  const isOpen = !pilotState.database && viewingHomeArea && personalBidWindow && now >= personalBidWindow.start && now < personalBidWindow.end;
  const isTestingBypass = bidWindowLockIsBypassed();
  const canUseBidActions = !selectedBidYearErrorMessage() && viewingHomeArea && (isOpen || isTestingBypass);
  const showLateBidContact = shouldShowLateBidContact(now);
  const activeRank = roundState?.phase === "open" ? roundState.activeRank : null;
  const activePerson = seniority.find((person) => person.rank === activeRank);
  const areaRoundOpen = roundState?.phase === "open";
  const statusText = pilotState.database ? (isTestingBypass ? "Open" : "Closed") : areaRoundOpen ? "Open" : "Closed";
  const showCurrentBidder = !pilotState.database && !isOpen && !isBefore && areaRoundOpen && Boolean(activePerson);
  const clockLabel = pilotState.database ? (isTestingBypass ? `Pilot Round ${testRound} On` : "Pilot Rounds Off") : isOpen ? "Your Bid Window is Open" : "Your Bid Window is Closed";
  const countdownText = pilotState.database ? (isTestingBypass ? "No time limit" : "Closed") : isOpen
      ? formatDuration(personalBidWindow.end - now)
      : isBefore
      ? formatDuration(personalBidWindow.start - now)
      : isValidationPeriod
        ? formatDuration(roundState.validationEndsAt - now)
      : showCurrentBidder
        ? `#${activePerson.rank} / ${currentUserBidderCount(currentViewArea())}`
        : areaRoundOpen
          ? formatDuration(roundState.endsAt - now)
        : "Closed";
  const countdownLabel = pilotState.database ? "Pilot Bidding" : isOpen
      ? "Window Closes In"
      : isBefore
      ? "Next Window In"
      : isValidationPeriod
        ? "Validation Ends In"
      : showCurrentBidder
        ? "Currently Bidding"
        : areaRoundOpen
          ? "Round Closes In"
        : "Window Status";
  const currentRoundRule = roundRuleForRound(personalRound);
  const pendingRequest = pendingCurrentUserRdoRequest();
  const hasRdoBid = currentUserHasRdoRequestForLeave();
  const rdoChangeError = rdoChangeWindowErrorMessage(now);

  // The countdown changes every second; the rest of the controls only need work
  // when a bid window, round, active bidder, or rendered page state changes.
  if (force || !bidWindowCountdownTargets.length || bidWindowCountdownTargets.some((element) => !element.isConnected)) {
    bidWindowCountdownTargets = [...document.querySelectorAll("[data-bid-window-countdown]")];
  }
  bidWindowCountdownTargets.forEach((element) => {
    if (element.textContent !== countdownText) element.textContent = countdownText;
  });

  const clock = document.getElementById("bid-window-clock");
  const clockCountdown = clock?.querySelector("strong");
  if (clockCountdown && clockCountdown.textContent !== countdownText) {
    clockCountdown.textContent = countdownText;
  }

  const stateKey = JSON.stringify([
    currentViewArea(),
    currentRound,
    roundState?.phase || "closed",
    roundState?.activeRank || null,
    personalRound,
    personalBidWindow?.start?.getTime() || null,
    personalBidWindow?.end?.getTime() || null,
    viewingHomeArea,
    isBefore,
    isOpen,
    isTestingBypass,
    canUseBidActions,
    activePerson?.rank || null,
    activePerson?.initials || "",
    statusText,
    clockLabel,
    countdownLabel,
    currentRoundRule.label,
    currentRoundRule.detail,
    pendingRequest?.id || null,
    hasRdoBid,
    rdoChangeError,
    showLateBidContact,
  ]);

  if (!force && stateKey === bidWindowUiStateKey) return;
  bidWindowUiStateKey = stateKey;

  const status = document.getElementById("bid-window-status");
  if (status) {
    status.classList.toggle("closed", !areaRoundOpen);
    const copy = status.querySelector(".status-chip-copy");
    if (copy) {
      copy.querySelector("small").textContent = `Round ${currentRound}`;
      copy.querySelector("b").textContent = statusText;
    }
  }

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
  setText("[data-bid-window-countdown-label]", countdownLabel);
  setText("[data-bid-window-close]", personalBidWindow ? "Scheduled" : "Not scheduled");
  setText("[data-bid-window-range]", personalBidWindow ? formatBidWindowStart(personalBidWindow.start) : "Not scheduled");
  setText("[data-next-bid-window-round]", personalBidWindow ? `Round ${personalRound}` : isValidationPeriod ? `Round ${currentRound} Validation` : `Round ${currentRound}`);
  setText("[data-next-bid-window-rule-round]", `Round ${personalRound}`);
  setText("[data-next-bid-window-rule]", currentRoundRule.label);
  setText("[data-next-bid-window-rule-detail]", currentRoundRule.detail);
  setText(
    "[data-current-bidder]",
    isValidationPeriod
      ? `Round ${currentRound} validation period`
      : areaRoundOpen ? activePerson ? `Currently Bidding: Seniority #${activePerson.rank} (${activePerson.initials})` : `Round ${currentRound} open · No current bidder in this area` : "Closed"
  );
  setText("[data-current-round]", `Round ${currentRound}`);
  renderRoundRuleSummary(now, roundState);

  document.querySelectorAll("[data-bid-window-pill]").forEach((pill) => {
    pill.textContent = statusText;
    pill.classList.toggle("closed", !areaRoundOpen);
  });

  document.querySelectorAll(".window-action").forEach((button) => {
    const isLateBidContactAction = button.matches("[data-bid-entry-action]") && showLateBidContact;
    const disabled = !canUseBidActions && !isLateBidContactAction;
    button.disabled = disabled;
    button.dataset.lateBidContact = String(isLateBidContactAction);
    button.classList.toggle("disabled", disabled);
  });

  syncLeaveBidWindowControls(now);

  document.querySelectorAll("[data-bid-entry-action]").forEach((button) => {
    button.dataset.awaitingRdoDecision = String(Boolean(pendingRequest));
    if (pendingRequest) {
      button.disabled = true;
      button.classList.add("disabled");
      button.textContent = "Awaiting Intaker Decision";
      button.title = "Wait for intake to approve or deny this RDO bid before changing it.";
      return;
    }
    if (!isOpen && !isTestingBypass && hasRdoBid) {
      button.disabled = true;
      button.classList.add("disabled");
      button.textContent = "Bid Submitted";
      button.title = "";
      return;
    }
    if (showLateBidContact) {
      button.disabled = false;
      button.classList.remove("disabled");
      button.textContent = `Call or Text ${BID_OFFICE_PHONE_DISPLAY}`;
      button.title = "Contact the Bidding Office to complete your bid.";
      return;
    }
    if (rdoChangeError) {
      button.disabled = true;
      button.classList.add("disabled");
      button.textContent = "RDO Changes Closed";
      button.title = rdoChangeError;
      return;
    }
    button.title = "";
    if (isValidationPeriod && !isTestingBypass) {
      button.textContent = "Round Closed";
      return;
    }
    if (!isViewingHomeArea()) {
      button.textContent = "Viewing Only";
      return;
    }
    if (!isOpen && !isTestingBypass) {
      button.textContent = "Bid Closed";
      return;
    }

    button.textContent = hasRdoBid ? "Change Bid" : "Bid";
  });
}

function shiftStartMinutes(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/^[A-Z]+/, "");
  const match = normalized.match(/^(\d{1,2})(?::?(\d{2}))$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return (hours * 60) + minutes;
}

function thirdDaySwingIndex(week) {
  if (!Array.isArray(week) || week.length === 0) return -1;

  const normalizedWeek = week.map((value) => String(value || "").trim().toUpperCase());
  if (normalizedWeek.every((value) => value === "RDO")) return -1;
  if (normalizedWeek.some((value) => /^M\d/.test(value))) return -1;

  let longestRdoRun = null;
  normalizedWeek.forEach((value, index) => {
    const previousIndex = (index - 1 + normalizedWeek.length) % normalizedWeek.length;
    if (value !== "RDO" || normalizedWeek[previousIndex] === "RDO") return;

    let length = 0;
    while (length < normalizedWeek.length && normalizedWeek[(index + length) % normalizedWeek.length] === "RDO") {
      length += 1;
    }
    if (!longestRdoRun || length > longestRdoRun.length) longestRdoRun = { index, length };
  });

  if (!longestRdoRun) return -1;

  const workweekStart = (longestRdoRun.index + longestRdoRun.length) % normalizedWeek.length;
  let workedShiftCount = 0;
  for (let offset = 0; offset < normalizedWeek.length; offset += 1) {
    const index = (workweekStart + offset) % normalizedWeek.length;
    const value = normalizedWeek[index];
    if (!value || value === "RDO") continue;

    workedShiftCount += 1;
    if (workedShiftCount === 3) {
      const startMinutes = shiftStartMinutes(value);
      return startMinutes !== null && startMinutes >= (10 * 60) ? index : -1;
    }
  }

  return -1;
}

function renderWeek(targetId, week = selectedWeek) {
  const target = document.getElementById(targetId);
  if (!target) return;

  const values = Array.isArray(week[0]) ? week : dayNames.map((day, index) => [day, week[index]]);
  const swingIndex = thirdDaySwingIndex(values.map(([, value]) => value));
  target.innerHTML = values
    .map(([day, value], index) => `
      <div class="day-cell ${value === "RDO" ? "rdo" : ""} ${index === swingIndex ? "third-day-swing" : ""}">
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

function shiftCell(value, isThirdDaySwing = false) {
  const isRdo = value === "RDO";
  const special = /^[MSN]/.test(value);
  const className = `${isRdo ? "rdo-tag" : special ? "shift special" : "shift"}${isThirdDaySwing ? " third-day-swing" : ""}`;
  return `<span class="${className}"${isThirdDaySwing ? ' title="Third-day swing"' : ""}>${value}</span>`;
}

function lineOccupant(line) {
  if (line.status === "Taken") return line.cpc || "";
  if (line.status === "Selected") return line.cpc || currentUser.initials;
  return "";
}

function lineGlBids(line) {
  return Array.isArray(line?.glBids) ? line.glBids : [];
}

function lineBidderMarkup(line, { showOpenWhenShared = false } = {}) {
  const occupant = lineOccupant(line);
  const glBids = lineGlBids(line);
  const pieces = [];
  if (occupant) pieces.push(`<span>${escapeHtml(occupant)}</span>`);
  else if (showOpenWhenShared && glBids.length) pieces.push('<span class="rdo-line-open-label">Open</span>');
  glBids.forEach((bid) => {
    pieces.push(`<span class="gl-line-bidder${bid.ghostBid ? " ghost-line-bidder" : ""}" title="${bid.ghostBid ? "Ghost Bid" : "GL Bid"} · does not occupy this line">*${escapeHtml(bid.initials)}</span>`);
  });
  return pieces.join('<span class="rdo-line-bidder-separator" aria-hidden="true"> · </span>');
}

function lineStatusMarkup(line, openLabel = "Open") {
  const label = line.status === "Taken" ? "Taken" : openLabel;
  const bidders = lineBidderMarkup(line);
  return bidders
    ? `${escapeHtml(label)}<span class="rdo-line-bidder-separator" aria-hidden="true"> · </span>${bidders}`
    : escapeHtml(label);
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

function lineMidReferenceValue(line) {
  if (line.mid === "BID" || line.mid === "Yes" || line.mid === "No") return line.mid;
  return "UNSELECTED";
}

function rdoLineAwsReferenceCell(line) {
  return line.status === "Taken" && ["Yes", "No"].includes(line.aws) ? userChoiceCell(line.aws) : "";
}

function rdoLineMidReferenceCell(line) {
  const value = lineMidReferenceValue(line);
  return value === "BID" || (line.status === "Taken" && ["Yes", "No"].includes(value))
    ? userChoiceCell(value)
    : "";
}

function selectedLineStatus(line) {
  const request = selectedLineRequest(line);
  const approvedRequest = currentUserRdoRequest();
  if (request) return request.ghostBid ? "Ghost Line · Pending Review" : "Pending Review";
  if (approvedRequest?.line === line.line && approvedRequest.status === "Approved") return approvedRequest.ghostBid ? "Ghost Line · Approved" : "Approved";
  if (line.status === "Taken" && line.cpc === currentUser.initials) return "Approved";
  if (line.status === "Taken") return "Taken";
  if (line.status === "Selected") return "Selected";
  return "Open";
}

function rdoAssignmentValue(assignment, key) {
  const requestValue = assignment?.request?.[key];
  if (requestValue !== undefined && requestValue !== null && requestValue !== "") return requestValue;
  const lineValue = assignment?.line?.[key];
  if (lineValue !== undefined && lineValue !== null && lineValue !== "") return lineValue;
  return "";
}

function renderLatestRdoDenialReason() {
  const deniedRequest = latestCurrentUserDeniedRdoRequest();
  document.querySelectorAll("[data-rdo-denial-reason]").forEach((element) => {
    element.hidden = !deniedRequest;
    element.textContent = deniedRequest
      ? `Your RDO ${deniedRequest.isChange ? "change request" : "bid"}${deniedRequest.line ? ` for Line ${deniedRequest.line}` : ""} has been denied. Reason: ${deniedRequest.denialReason || "No reason was provided. Contact the Bidding Office."} Review your request and submit a revised RDO bid while your bid window is open.`
      : "";
  });
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
    element.textContent = lineCode ? `${request?.ghostBid ? "Ghost Line" : "Line"} ${lineCode}` : "No line selected";
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
    const preferences = [
      ["Flex", flex],
      ["AWS", aws],
      ["Mid", mid],
    ].filter(([, value]) => value !== undefined && value !== null && value !== "");
    const fatigueGroup = String(group || "").trim().toUpperCase();

    element.innerHTML = fatigueGroup || preferences.length
      ? `
          ${fatigueGroup ? `
            <span class="fatigue-summary-card">
              <em>Fatigue Group</em>
              <span class="fatigue-summary-segments" role="img" aria-label="Fatigue Group ${fatigueGroup} selected">
                ${FATIGUE_GROUPS.map((value) => `<strong class="fatigue-summary-segment ${groupClass(value)} ${fatigueGroup === value ? "active" : ""}" aria-hidden="true">${value}</strong>`).join("")}
              </span>
            </span>
          ` : ""}
          ${preferences.map(([label, value]) => `<span class="rdo-preference-card"><em>${label}</em><b>${rdoBidPreferenceLabel(value)}</b></span>`).join("")}
        `
      : '<span class="empty-attribute-message">RDO details will populate from the database after this user bids.</span>';
  });

  const weekTarget = document.getElementById("selected-week");
  if (weekTarget && line) {
    renderWeek("selected-week", line.week);
  } else if (weekTarget) {
    weekTarget.innerHTML = "";
  }
  renderLatestRdoDenialReason();
}

function selectedLineReadinessItems(line) {
  const existingRequest = currentUserRdoRequest();
  const requestMatchesLine = existingRequest?.line === line.line;
  const fatiguePreferenceSelected = Boolean(selectedFatigueGroup || requestMatchesLine);
  const flexPreference = selectedFlexPreference || (requestMatchesLine ? existingRequest.flex : "");
  const developmentalBidder = isDevelopmentalBidRole(currentUserBidAs(), currentUser.area);
  const awsPreference = rdoPreferenceForBidRole(
    currentUserBidAs(),
    currentUser.area,
    awsPreferenceForLine(line, selectedAwsPreference || (requestMatchesLine ? existingRequest.aws : ""))
  );
  const midPreference = rdoPreferenceForBidRole(
    currentUserBidAs(),
    currentUser.area,
    selectedMidValue(line) || (requestMatchesLine ? existingRequest.mid : "")
  );
  const lineStatus = selectedLineStatus(line);
  const selectedLineOpen = lineStatus !== "Taken";
  const preferencesComplete = Boolean(flexPreference && awsPreference && (developmentalBidder || isForcedMid(line) || midPreference));

  return [
    { label: "Selected line open", checked: selectedLineOpen },
    { label: "Fatigue preference selected", checked: fatiguePreferenceSelected },
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
      ...lineGlBids(line).map((bid) => bid.initials),
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

function isCurrentUserRdoLine(line) {
  return isViewingHomeArea() && (
    (line.status === "Taken" && line.cpc === currentUser.initials) ||
    currentUserRdoRequest()?.line === line.line
  );
}

function renderRdoLines() {
  const target = document.getElementById("rdo-line-rows");
  if (!target) return;

  const loadMessage = rdoLinesLoadMessage();
  if (loadMessage) {
    setText("[data-rdo-lines-heading]", `RDO Bid Lines - ${currentViewArea()}`);
    setText("[data-rdo-filter-count]", supabaseState.rdoLinesLoadState === "loading" ? "Loading…" : "Unavailable");
    target.innerHTML = `<tr><td colspan="12" role="status">${escapeHtml(loadMessage)}</td></tr>`;
    const mobileCards = document.querySelector("[data-member-rdo-cards]");
    if (mobileCards) mobileCards.innerHTML = `<div class="empty-state" role="status">${escapeHtml(loadMessage)}</div>`;
    return;
  }

  let lastPattern = "";
  const rows = [];
  const viewArea = currentViewArea();
  const areaLines = rdoLinesForArea(viewArea);
  const eligibleLines = rdoLinesForBidder(currentUserBidAs(), viewArea);
  if (isViewingHomeArea() && !eligibleLines.some((line) => line.line === selectedLineId)) {
    selectedLineId = eligibleLines[0]?.line || "";
  }
  setText("[data-rdo-lines-heading]", `RDO Bid Lines - ${viewArea}`);
  const filteredLines = areaLines.filter(rdoLineMatchesFilters);
  const countTarget = document.querySelector("[data-rdo-filter-count]");
  const pendingRequest = pendingCurrentUserRdoRequest();
  const bidderSelectionLocked = Boolean(pendingRequest);

  if (countTarget) {
    const lineLabel = filteredLines.length === 1 ? "line" : "lines";
    countTarget.textContent = isRdoFilterActive()
      ? `${filteredLines.length} matching ${lineLabel}`
      : `${areaLines.filter((line) => line.status !== "Taken").length} open ${lineLabel}`;
  }

  filteredLines.forEach((line) => {
    if (line.pattern !== lastPattern) {
      rows.push(`<tr><th colspan="12">${line.pattern}</th></tr>`);
      lastPattern = line.pattern;
    }

    const isSelected = line.line === selectedLineId;
    const isOccupied = line.status === "Taken";
    const canSelect = isViewingHomeArea() && !bidderSelectionLocked && !isOccupied
      && rdoLineMatchesBidRole(line, currentUserBidAs(), viewArea);
    const groupValue = rdoFatigueGroupBadge(rdoLineDisplayFatigueGroup(line, {
      previewGroup: isSelected && isViewingHomeArea() ? selectedFatigueGroup : "",
      pendingGroup: isViewingHomeArea() && pendingRequest?.line === line.line ? pendingRequest.fatigueGroup : "",
    }));
    const swingIndex = thirdDaySwingIndex(line.week);

    rows.push(`
      <tr class="${isCurrentUserRdoLine(line) ? "own-rdo-row" : ""} ${isSelected && isViewingHomeArea() ? "selected-row" : ""} ${canSelect ? "selectable-row" : "occupied-row"}" ${canSelect ? `data-line-id="${line.line}"` : ""}>
        <td>${line.line}</td>
        <td><b class="rdo-line-bidders">${lineBidderMarkup(line, { showOpenWhenShared: true })}</b></td>
        ${line.week.map((value, index) => `<td>${shiftCell(value, index === swingIndex)}</td>`).join("")}
        <td class="${groupValue ? "" : "empty-group"}">${groupValue}</td>
        <td>${rdoLineAwsReferenceCell(line)}</td>
        <td>${rdoLineMidReferenceCell(line)}</td>
      </tr>
    `);
  });

  target.innerHTML = rows.length
    ? rows.join("")
    : `<tr><td colspan="12">No RDO lines match those filters for ${viewArea}.</td></tr>`;

  const mobileCards = document.querySelector("[data-member-rdo-cards]");
  const mobileResults = document.querySelector("[data-member-rdo-results]");
  if (mobileResults) mobileResults.dataset.presentation = memberRdoPresentation;
  if (mobileCards) {
    mobileCards.innerHTML = filteredLines.length
      ? filteredLines.map((line) => {
        const isSelected = line.line === selectedLineId && isViewingHomeArea();
        const isOccupied = line.status === "Taken";
        const matchesBidRole = rdoLineMatchesBidRole(line, currentUserBidAs(), viewArea);
        const rdoDays = line.week
          .map((value, index) => value === "RDO" ? dayNames[index] : "")
          .filter(Boolean)
          .join(", ") || line.pattern;
        const status = lineStatusMarkup(line, isViewingHomeArea() && matchesBidRole ? "Open" : "View only");
        const swingIndex = thirdDaySwingIndex(line.week);
        const selectButton = !isOccupied && isViewingHomeArea() && matchesBidRole && !bidderSelectionLocked
          ? `<button class="${isSelected ? "secondary-action" : "primary-action"} small member-line-select" type="button" data-line-id="${escapeHtml(line.line)}">${isSelected ? "Selected" : `Select Line ${escapeHtml(line.line)}`}</button>`
          : "";
        return `
          <details class="mobile-rdo-card member-rdo-card ${isCurrentUserRdoLine(line) ? "own-rdo-card" : ""} ${isSelected ? "selected" : ""}" ${isSelected ? "open" : ""}>
            <summary>
              <span><strong>Line ${escapeHtml(line.line)}</strong><span class="mobile-rdo-pattern">RDO: ${escapeHtml(rdoDays)}</span></span>
              <span class="mobile-line-status">${status}</span>
              <span class="mobile-expand-label">Schedule <span aria-hidden="true">⌄</span></span>
            </summary>
            <dl class="mobile-line-week">${line.week.map((value, index) => `<div><dt>${dayNames[index]}</dt><dd>${shiftCell(value, index === swingIndex)}</dd></div>`).join("")}</dl>
            <div class="member-rdo-card-footer">${rdoLineAwsReferenceCell(line) ? `<span>AWS: ${rdoLineAwsReferenceCell(line)}</span>` : ""}${rdoLineMidReferenceCell(line) ? `<span>Mid: ${rdoLineMidReferenceCell(line)}</span>` : ""}${selectButton}</div>
          </details>
        `;
      }).join("")
      : `<div class="empty-state">No RDO lines match those filters for ${escapeHtml(viewArea)}.</div>`;
  }
}

function updateSelectedLine() {
  const viewArea = currentViewArea();
  const areaLines = isViewingHomeArea()
    ? rdoLinesForBidder(currentUserBidAs(), viewArea)
    : rdoLinesForArea(viewArea);
  const line = areaLines.find((item) => item.line === selectedLineId)
    || areaLines[0]
    || (isViewingHomeArea() ? null : rdoLines[0]);
  const dashboardAssignment = currentUserRdoAssignment();
  if (!line) {
    renderDashboardSelectedLineCard(dashboardAssignment);
    return;
  }
  const midIsBidLine = isMidLineByDesign(line);
  const developmentalBidder = isDevelopmentalBidRole(currentUserBidAs(), currentUser.area);
  const fatigueCapacity = fatigueCapacityForLine(line);
  const lineSchedule = lineScheduleLabel(line);
  const isFourTenLine = lineSchedule === "4-10";
  const pendingRequest = pendingCurrentUserRdoRequest();
  const bidderSelectionLocked = Boolean(pendingRequest);
  const lineRequest = selectedLineRequest(line);
  const displayedFatiguePreference = selectedFatigueGroup
    || (lineRequest ? (lineRequest.fatigueGroup || NO_FATIGUE_PREFERENCE) : "");

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
        : request ? request.ghostBid
          ? `Ghost Line ${line.line} is pending intake review and will not consume the source line.`
          : `Line ${line.line} is pending intake review. Wait for approval or denial before changing it.`
        : approvedRequest?.line === line.line && approvedRequest.status === "Approved"
          ? `${approvedRequest.ghostBid ? `Ghost Line ${line.line}` : `Line ${line.line}`} has been approved${approvedRequest.ghostBid ? "; the source line remains open" : ""}.`
        : pendingRequest ? `Your RDO bid is pending intake review. Wait for approval or denial before changing it.` : line.status === "Taken" ? `Line ${line.line} has been approved.` : `Line ${line.line} is currently selected.`;
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
            const isSelected = displayedFatiguePreference === item.group;
            const available = canChooseGroup(item, isSelected);
            return `
              <button class="fatigue-option ${groupClass(item.group)} ${isSelected ? "active" : ""}" type="button" data-fatigue-group="${item.group}" ${available && !bidderSelectionLocked ? "" : "disabled"} title="Area ${item.areaUsed}/${item.areaMax}, RDO set ${item.crewUsed}/${item.crewMax}">
                <strong>${item.group}</strong>
                <small>Area ${item.areaUsed}/${item.areaMax} · RDO ${item.crewUsed}/${item.crewMax}</small>
              </button>
            `;
          }).join("")}
          <button class="fatigue-option no-preference ${displayedFatiguePreference === NO_FATIGUE_PREFERENCE ? "active" : ""}" type="button" data-fatigue-group="${NO_FATIGUE_PREFERENCE}" ${bidderSelectionLocked ? "disabled" : ""} title="Leave the fatigue group blank for intake to assign later.">
            <strong>No preference</strong>
            <small>Intake assigns later</small>
          </button>
        </span>
      </span>
      <span class="flex-picker">
        <em>Flex</em>
        <span class="choice-options">
          ${["Yes", "No"].map((value) => `
            <button class="choice-option ${selectedFlexPreference === value ? "active" : ""}" type="button" data-flex-choice="${value}" ${bidderSelectionLocked ? "disabled" : ""}>
              ${value}
            </button>
          `).join("")}
        </span>
      </span>
      <span class="aws-picker">
        <em>AWS</em>
        <small>${developmentalBidder ? "Not applicable to DEV" : isFourTenLine ? "Line schedule · AWS included" : "Line schedule"}</small>
        <span class="line-mode-options">
          ${["4-10", "5-8"].map((value) => {
            const isCurrentSchedule = lineSchedule === value;
            return `
              <button class="line-mode-option locked ${isCurrentSchedule ? "active" : "schedule-unavailable"}" type="button" disabled aria-pressed="${isCurrentSchedule}">
                ${value}
              </button>
            `;
          }).join("")}
        </span>
        <span class="choice-options aws-choice-options">
          ${["Yes", "No"].map((value) => `
            <button class="choice-option ${developmentalBidder ? value === "No" ? "active" : "" : !isFourTenLine && selectedAwsPreference === value ? "active" : ""}" type="button" data-aws-choice="${value}" ${developmentalBidder || isFourTenLine || bidderSelectionLocked ? "disabled" : ""} ${developmentalBidder ? 'title="DEV bidders do not work AWS."' : isFourTenLine ? 'title="AWS is included with a 4-10 line."' : ""}>
              ${value}
            </button>
          `).join("")}
        </span>
      </span>
      <span class="mid-picker">
        <em>Mid</em>
        <span class="line-mode-options mid-line-options">
          <button class="line-mode-option mid-bid-line-option ${!developmentalBidder && midIsBidLine ? "active locked" : ""}" type="button" disabled>
            Bid Line
          </button>
        </span>
        ${developmentalBidder
          ? '<span class="mid-options"><button class="mid-option active" type="button" disabled title="DEV bidders do not work Mid.">No</button></span>'
          : midIsBidLine
          ? ""
          : `<span class="mid-options">
              ${["Yes", "No"].map((value) => `
                <button class="mid-option ${selectedMidPreference === value ? "active" : ""}" type="button" data-mid-choice="${value}" ${bidderSelectionLocked ? "disabled" : ""}>
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
          <span>RDO ${item.crewUsed}/${item.crewMax}</span>
        </button>
      `;
    }).join("");
  });
}

const bidderLeaveSort = { round: "asc", date: "asc", status: "asc", statusActive: false };

function sortedBidderLeaveBids() {
  return leaveBids.map((bid) => ({ bid, round: leaveRoundForItem(bid), date: leaveDateKeysForItem(bid)[0] || "" }))
    .sort((a, b) => {
      if (bidderLeaveSort.statusActive) {
        const statusOrder = String(a.bid.status || "").localeCompare(String(b.bid.status || ""), "en", { sensitivity: "base" })
          * (bidderLeaveSort.status === "asc" ? 1 : -1);
        if (statusOrder) return statusOrder;
      }
      const roundOrder = (a.round - b.round) * (bidderLeaveSort.round === "asc" ? 1 : -1);
      if (roundOrder) return roundOrder;
      if (!a.date || !b.date) return a.date ? -1 : b.date ? 1 : 0;
      return a.date.localeCompare(b.date) * (bidderLeaveSort.date === "asc" ? 1 : -1);
    }).map(({ bid }) => bid);
}

function syncBidderLeaveSortHeaders() {
  document.querySelectorAll("[data-bidder-leave-sort]").forEach((button) => {
    const column = button.dataset.bidderLeaveSort;
    const ascending = bidderLeaveSort[column] === "asc";
    const label = column === "round" ? "Round" : column === "date" ? "Date Range" : "Status";
    const active = column !== "status" || bidderLeaveSort.statusActive;
    button.textContent = `${label}${active ? (ascending ? " ↑" : " ↓") : " ↕"}`;
    const nextDirection = !active || !ascending ? "ascending" : "descending";
    button.setAttribute("aria-label", `${label}: ${active ? (ascending ? "ascending" : "descending") : "unsorted"}. Sort ${nextDirection}${column === "date" ? " within each round" : ""}.`);
    const primary = bidderLeaveSort.statusActive ? "status" : "round";
    button.closest("th").setAttribute("aria-sort", !active ? "none" : column === primary ? (ascending ? "ascending" : "descending") : "other");
  });
}

function renderLeaveRows(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const compact = false;

  syncBidderLeaveSortHeaders();
  target.innerHTML = sortedBidderLeaveBids()
    .map((bid) => {
      const round = leaveRoundForItem(bid);
      return compact
        ? `
        <tr>
          <td><span class="round-pill">Rd ${round}</span></td>
          <td>${bid.ghostBid ? '<span class="ghost-bid-badge">Ghost Leave</span><br>' : isGlLeaveItem(bid) ? '<span class="gl-bid-badge">GL Bid · No area slot used</span><br>' : ''}${bid.range}</td>
          <td>${bid.days}</td>
          <td><span class="status ${bid.status.toLowerCase()}">${bid.status}</span></td>
        </tr>
      `
        : `
        <tr>
          <td><span class="round-pill">Rd ${round}</span></td>
          <td>${bid.ghostBid ? '<span class="ghost-bid-badge">Ghost Leave</span><br>' : isGlLeaveItem(bid) ? '<span class="gl-bid-badge">GL Bid · No area slot used</span><br>' : ''}${bid.range}</td>
          <td>${bid.days}</td>
          <td>
            <span class="status ${bid.status.toLowerCase()}">${bid.status}</span>
            ${bid.status === "Denied" ? `<small class="bid-denial-reason">Reason: ${escapeHtml(bid.denialReason || "No reason was provided. Contact the Bidding Office.")}</small>` : ""}
          </td>
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
  const usedWeeks = roundOneWeekKeySetForItems([
    ...leaveRoundUsageForInitials(currentUser.initials, 1),
    ...leaveDraftQueue,
  ]).size;
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
          <strong>${currentUser.ghostBidder ? '<span class="ghost-bid-badge">Ghost Leave</span> ' : currentUserBidAs() === "GL" ? '<span class="gl-bid-badge">GL Bid</span> ' : ''}${escapeHtml(item.range)}</strong>
          <small>${item.weekUnits ? `${item.weekUnits} bid week · ` : ""}${item.days} ${item.days === 1 ? "day" : "days"} charged</small>
          ${item.notes ? `<em>${escapeHtml(item.notes)}</em>` : ""}
        </div>
        <button type="button" aria-label="Remove ${escapeHtml(item.range)}" data-remove-leave-draft="${item.id}">×</button>
      </article>
    `).join("")
    : '<p class="empty-state small">Add leave requests here first. Nothing is sent to intake until you submit the batch.</p>';
}

function submittedLeaveItemsForCurrentRound(date = new Date()) {
  const round = editableLeaveRound(date) || currentRoundNumber();
  const byRequest = new Map();

  leaveBids.forEach((item) => {
    if (!["Pending", "Approved"].includes(item.status)) return;
    if (leaveRoundForItem(item) !== round) return;
    if (item.initials && item.initials !== currentUser.initials) return;
    const key = item.supabaseRequestId || item.id || `${round}|${item.priority}|${item.range}`;
    byRequest.set(key, item);
  });

  return [...byRequest.values()].sort((left, right) =>
    Number(left.priority || 0) - Number(right.priority || 0)
  );
}

function submittedLeaveItemKey(item) {
  return item.supabaseRequestId || item.id || `${leaveRoundForItem(item)}|${item.priority}|${item.range}`;
}

function leaveReplacementItem() {
  return leaveReplacementRequestId
    ? submittedLeaveItemsForCurrentRound().find((item) => submittedLeaveItemKey(item) === leaveReplacementRequestId)
    : null;
}

function matchesCurrentReplacementDates(dateKeys) {
  const item = leaveReplacementItem();
  if (!item || !dateKeys.length) return false;
  const originalKeys = datesInLeaveRange(item.range);
  return dateKeys[0] === originalKeys[0]
    && dateKeys[dateKeys.length - 1] === originalKeys[originalKeys.length - 1];
}

function setSubmittedLeaveStatus(message, status = "info") {
  const target = document.querySelector("[data-submitted-leave-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

function bidChangeDateLabel(key) {
  return dateFromKey(key).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function addDaysToDateKey(key, days) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return dateKeyFromDate(date);
}

function submittedLeaveDateRows(items = submittedLeaveItemsForCurrentRound()) {
  const rows = items.flatMap((item) => leaveDateKeysForItem(item).map((oldKey) => ({
    id: `${submittedLeaveItemKey(item)}|${oldKey}`,
    itemKey: submittedLeaveItemKey(item),
    requestId: item.supabaseRequestId || "",
    notes: item.notes || "",
    oldKey,
    newKey: "",
    groupKey: "",
  })));
  const sortedRows = rows.sort((left, right) => left.oldKey.localeCompare(right.oldKey));
  if (bidChangeRound !== 1) return sortedRows;

  const storedStarts = [...new Set(items.flatMap((item) => item.weekBucketStarts || []))].sort();
  const weekStarts = storedStarts.length ? storedStarts : roundOneWeekKeysForDateKeys(sortedRows.map((row) => row.oldKey));
  return sortedRows.map((row) => ({
    ...row,
    groupKey: weekStarts.find((startKey) => {
      const endKey = addDaysToDateKey(startKey, 6);
      return row.oldKey >= startKey && row.oldKey <= endKey;
    }) || row.oldKey,
  }));
}

function setBidChangeStatus(message, status = "info") {
  const target = document.querySelector("[data-bid-change-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

function bidChangeCount() {
  if (bidChangeRound === 1) return bidChangeDraftSelection().changedRows.length;
  return bidChangeRows.filter((row) => row.newKey && row.newKey !== row.oldKey).length;
}

function bidChangeDraftSelection() {
  if (bidChangeRound === 1) {
    if (!bidChangeWeek) return { changedRows: [], affectedRequestIds: new Set(), replacementRows: [] };
    const originals = bidChangeRows.filter((row) => row.groupKey === bidChangeWeek.groupKey);
    const oldKeys = originals.map((row) => row.oldKey);
    const selected = [...bidChangeWeek.dates].sort();
    const changed = oldKeys.length !== selected.length || oldKeys.some((key) => !bidChangeWeek.dates.has(key));
    const affectedRequestIds = new Set(originals.map((row) => row.itemKey));
    // Preserve dates outside this week if a legacy request spans both weeks.
    const retained = bidChangeRows.filter((row) => affectedRequestIds.has(row.itemKey) && row.groupKey !== bidChangeWeek.groupKey)
      .map((row) => ({ ...row, newKey: row.oldKey }));
    const replacements = selected.map((key) => ({ newKey: key, oldKey: key, notes: originals[0]?.notes || '' }));
    return { changedRows: changed ? originals : [], affectedRequestIds, replacementRows: [...retained, ...replacements] };
  }
  const changedRows = bidChangeRows.filter((row) => row.newKey && row.newKey !== row.oldKey);
  const affectedRequestIds = new Set(changedRows.map((row) => row.itemKey));
  const replacementRows = bidChangeRows
    .filter((row) => affectedRequestIds.has(row.itemKey))
    .map((row) => ({ ...row, newKey: row.newKey || row.oldKey }));
  return { changedRows, affectedRequestIds, replacementRows };
}

function bidChangeRowValidationMessage(row, replacementRows, affectedRequestIds) {
  if (!row.newKey || row.newKey === row.oldKey) return "";
  if (!isBidLeaveYearDate(row.newKey)) return "Outside the bidding leave year.";
  if (bidChangeRound > 1 && isRdoDateForInitials(row.newKey, currentUser.initials)) return "This is one of your RDO dates.";
  if (replacementRows.filter((candidate) => candidate.newKey === row.newKey).length > 1) return "This date is selected more than once.";

  const overlapsAnotherBid = leaveRoundUsageForInitials(currentUser.initials, bidChangeRound)
    .filter((item) => !affectedRequestIds.has(submittedLeaveItemKey(item)))
    .some((item) => leaveDateKeysForItem(item).includes(row.newKey));
  return overlapsAnotherBid ? "You already have another active bid on this date." : "";
}

function renderBidChangeModal() {
  const modal = document.querySelector("[data-bid-change-modal]");
  const rowsTarget = document.querySelector("[data-bid-change-rows]");
  const saveButton = document.querySelector("[data-bid-change-save]");
  if (!modal || modal.hidden || !rowsTarget || !saveButton) return;

  const isRoundOne = bidChangeRound === 1;
  if (isRoundOne) { renderRoundOneBidChangeModal(rowsTarget, saveButton); return; }
  const selection = bidChangeDraftSelection();
  const validationMessage = selection.changedRows.length
    ? bidChangeValidationMessage(selection.replacementRows, selection.affectedRequestIds)
    : "";
  const groupedRows = new Map();
  bidChangeRows.forEach((row) => {
    const groupKey = isRoundOne ? row.groupKey : "individual";
    if (!groupedRows.has(groupKey)) groupedRows.set(groupKey, []);
    groupedRows.get(groupKey).push(row);
  });

  document.querySelector("[data-bid-change-round]").textContent = `Round ${bidChangeRound}`;
  document.querySelector("[data-bid-change-description]").textContent = isRoundOne
    ? "Move a submitted bid week while your Round 1 window is open. Every date in that week moves together."
    : `Change one or more submitted Round ${bidChangeRound} dates while your bid window is open.`;
  document.querySelector("[data-bid-change-guidance]").textContent = isRoundOne
    ? "Choose a new start date for each week you want to move. All dates in that week will be filled in automatically. RDOs, duplicates, the two-week limit, and other rules are checked as you choose."
    : "Enter a new date only beside the bid date you want to change. Leave a row blank to keep its current date. RDOs, duplicates, and round limits are checked immediately.";

  rowsTarget.innerHTML = [...groupedRows.entries()].map(([groupKey, rows], groupIndex) => {
    const rowMarkup = rows.map((row) => {
      const rowError = bidChangeRowValidationMessage(row, selection.replacementRows, selection.affectedRequestIds);
      return `
      <div class="bid-change-row ${row.newKey && row.newKey !== row.oldKey ? "changed" : ""} ${rowError ? "invalid" : ""}">
        <time datetime="${row.oldKey}">${escapeHtml(bidChangeDateLabel(row.oldKey))}</time>
        <span class="bid-change-arrow" aria-hidden="true">→</span>
        <span class="bid-change-field">
          <input type="date" min="${BID_YEAR}-01-10" max="${BID_YEAR + 1}-01-08" value="${row.newKey}" data-bid-change-date="${escapeHtml(row.id)}" aria-label="New date for ${escapeHtml(bidChangeDateLabel(row.oldKey))}" aria-invalid="${Boolean(rowError)}" ${isRoundOne ? "readonly tabindex=\"-1\"" : ""} />
          ${rowError ? `<small>${escapeHtml(rowError)}</small>` : ""}
        </span>
      </div>
    `;
    }).join("");
    if (!isRoundOne) return rowMarkup;
    const selectedStart = rows[0]?.newKey
      ? addDaysToDateKey(rows[0].newKey, -Math.round((dateFromKey(rows[0].oldKey) - dateFromKey(groupKey)) / 86400000))
      : "";
    return `
      <section class="bid-change-week ${rows.some((row) => bidChangeRowValidationMessage(row, selection.replacementRows, selection.affectedRequestIds)) ? "invalid" : ""}">
        <div class="bid-change-week-head">
          <div><strong>Bid week ${groupIndex + 1}</strong><small>${escapeHtml(bidChangeDateLabel(groupKey))} through ${escapeHtml(bidChangeDateLabel(addDaysToDateKey(groupKey, 6)))}</small></div>
          <label>New week begins
            <input type="date" min="${BID_YEAR}-01-10" max="${BID_YEAR + 1}-01-08" value="${selectedStart}" data-bid-change-week-start="${groupKey}" />
          </label>
        </div>
        ${rowMarkup}
      </section>
    `;
  }).join("");

  const changed = bidChangeCount();
  saveButton.disabled = !changed || Boolean(validationMessage) || Boolean(leaveManagementPendingId);
  saveButton.textContent = leaveManagementPendingId
    ? "Saving Changes…"
    : changed
      ? `Review & Save ${changed} ${changed === 1 ? "Change" : "Changes"}`
      : "Review & Save Changes";
  if (validationMessage) {
    setBidChangeStatus(validationMessage, "error");
  } else if (changed) {
    setBidChangeStatus(`${changed} ${changed === 1 ? "date is" : "dates are"} ready to save. Database availability will be confirmed when you save.`, "success");
  } else {
    setBidChangeStatus("");
  }
}

function openBidChangeModal() {
  const windowError = leaveBidWindowErrorMessage();
  const items = submittedLeaveItemsForCurrentRound();
  if (windowError) {
    setSubmittedLeaveStatus(windowError, "error");
    return;
  }
  if (!items.length) {
    setSubmittedLeaveStatus("There are no submitted bid dates to change in this round.", "error");
    return;
  }
  if (items.some((item) => item.status === "Pending")) {
    setSubmittedLeaveStatus("Your leave dates are awaiting an intake decision. Wait until they are approved or denied before changing them.", "error");
    return;
  }
  if (items.some((item) => !item.supabaseRequestId)) {
    setSubmittedLeaveStatus("Reload the saved bids before changing dates.", "error");
    return;
  }
  if (leaveDraftQueue.length) {
    setSubmittedLeaveStatus("Submit or remove the preview batch before changing submitted dates.", "error");
    return;
  }

  bidChangeRound = leaveRoundForItem(items[0]);
  bidChangeRows = submittedLeaveDateRows(items);
  bidChangeWeek = null;
  const modal = document.querySelector("[data-bid-change-modal]");
  if (!modal) return;
  bidChangeReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modal.hidden = false;
  document.body.classList.add("modal-open");
  renderBidChangeModal();
  const panel = modal.querySelector(".bid-change-modal-panel");
  if (panel) panel.scrollTop = 0;
  setBidChangeStatus("");
  window.requestAnimationFrame(() => modal.querySelector("input, [data-bid-change-close]")?.focus());
}

function closeBidChangeModal({ restoreFocus = true } = {}) {
  const modal = document.querySelector("[data-bid-change-modal]");
  if (!modal || leaveManagementPendingId) return;
  const wasOpen = !modal.hidden;
  modal.hidden = true;
  bidChangeRows = [];
  bidChangeWeek = null;
  bidChangeRound = 0;
  document.body.classList.remove("modal-open");
  if (wasOpen && restoreFocus && bidChangeReturnFocus?.isConnected) bidChangeReturnFocus.focus();
  bidChangeReturnFocus = null;
}

function selectRoundOneBidChangeWeek(groupKey) {
  if (leaveManagementPendingId) return;
  if (bidChangeWeek && bidChangeCount() && !window.confirm('Discard the unsaved changes to this week?')) return;
  bidChangeWeek = { groupKey, startKey: groupKey, dates: new Set(bidChangeRows.filter((row) => row.groupKey === groupKey).map((row) => row.oldKey).filter((key) => !isRdoDateForInitials(key, currentUser.initials))) };
  renderBidChangeModal();
}

function updateRoundOneBidChangeWeek(groupKey, newStartKey) {
  if (leaveManagementPendingId || !bidChangeWeek || groupKey !== bidChangeWeek.groupKey) return;
  bidChangeWeek.startKey = newStartKey;
  // Moving a week opens an empty calendar; no dates are selected automatically.
  bidChangeWeek.dates.clear();
  renderBidChangeModal();
}

function toggleRoundOneBidChangeDate(key) {
  if (leaveManagementPendingId || !bidChangeWeek || !bidChangeWeek.startKey) return;
  if (key < bidChangeWeek.startKey || key > addDaysToDateKey(bidChangeWeek.startKey, 6)
      || !isBidLeaveYearDate(key) || isRdoDateForInitials(key, currentUser.initials)) return;
  if (bidChangeWeek.dates.has(key)) bidChangeWeek.dates.delete(key);
  else bidChangeWeek.dates.add(key);
  renderBidChangeModal();
}

function roundOneBidChangeValidationMessage() {
  if (!bidChangeWeek || !bidChangeWeek.startKey) return 'Choose the week you want to change and its first date.';
  const keys = [...bidChangeWeek.dates].sort();
  if (!keys.length) return 'Select at least one workday for this week. Deselect dates to leave gaps.';
  if (keys.some((key) => key < bidChangeWeek.startKey || key > addDaysToDateKey(bidChangeWeek.startKey, 6))) return 'All selected dates must fit within this seven-day week.';
  if (keys.some((key) => isRdoDateForInitials(key, currentUser.initials))) return 'RDO dates cannot be selected.';
  const otherWeekStarts = [...new Set(bidChangeRows.filter((row) => row.groupKey !== bidChangeWeek.groupKey).map((row) => row.groupKey))];
  if (otherWeekStarts.some((start) => start <= addDaysToDateKey(bidChangeWeek.startKey, 6) && addDaysToDateKey(start, 6) >= bidChangeWeek.startKey)) return 'This week overlaps your other bid week. Choose a separate seven-day span.';
  return '';
}

function renderRoundOneBidChangeModal(rowsTarget, saveButton) {
  const groups = [...new Set(bidChangeRows.map((row) => row.groupKey))];
  const selection = bidChangeDraftSelection();
  const error = roundOneBidChangeValidationMessage() || (selection.changedRows.length ? bidChangeValidationMessage(selection.replacementRows, selection.affectedRequestIds) : '');
  document.querySelector('[data-bid-change-round]').textContent = 'Round 1';
  document.querySelector('[data-bid-change-description]').textContent = 'Change one complete bid week at a time. Your other week stays in place.';
  document.querySelector('[data-bid-change-guidance]').textContent = 'Choose a week, then select its workdays within a seven-day span. Click selected dates to remove them. Dates between selections may be skipped; RDOs are disabled.';
  rowsTarget.innerHTML = `<div class="bid-change-week-picker">${groups.map((group, index) => `<button type="button" class="secondary-action" data-bid-change-select-week="${group}" aria-pressed="${bidChangeWeek?.groupKey === group}" ${leaveManagementPendingId ? 'disabled' : ''}>Week ${index + 1}: ${escapeHtml(bidChangeDateLabel(group))}</button>`).join('')}</div>`;
  if (bidChangeWeek) {
    const originals = bidChangeRows.filter((row) => row.groupKey === bidChangeWeek.groupKey);
    rowsTarget.innerHTML += `<section class="bid-change-week"><p><strong>Current dates:</strong> ${originals.map((row) => escapeHtml(bidChangeDateLabel(row.oldKey))).join(', ')}</p>
      <label>Seven-day span begins <input type="date" min="${BID_YEAR}-01-10" max="${BID_YEAR + 1}-01-08" value="${bidChangeWeek.startKey}" data-bid-change-week-start="${bidChangeWeek.groupKey}" ${leaveManagementPendingId ? 'disabled' : ''}></label>
      <div class="bid-change-week-calendar">${bidChangeWeek.startKey ? Array.from({ length: 7 }, (_, i) => {
        const key = addDaysToDateKey(bidChangeWeek.startKey, i);
        const rdo = isRdoDateForInitials(key, currentUser.initials);
        const other = bidChangeRows.some((row) => row.groupKey !== bidChangeWeek.groupKey && row.oldKey === key);
        return `<button type="button" data-bid-change-toggle-date="${key}" aria-pressed="${bidChangeWeek.dates.has(key)}" ${rdo || other || !isBidLeaveYearDate(key) || leaveManagementPendingId ? 'disabled' : ''}>${escapeHtml(bidChangeDateLabel(key))}<small>${rdo ? 'RDO' : other ? 'Other bid week' : bidChangeWeek.dates.has(key) ? 'Selected' : 'Not selected'}</small></button>`;
      }).join('') : ''}</div>
      <p><strong>Replacement dates:</strong> ${[...bidChangeWeek.dates].sort().map((key) => escapeHtml(bidChangeDateLabel(key))).join(', ') || 'None selected'}</p>
      <p>${bidChangeWeek.dates.size} workdays selected. Saving replaces this entire week.</p></section>`;
  }
  saveButton.disabled = !selection.changedRows.length || Boolean(error) || Boolean(leaveManagementPendingId);
  saveButton.textContent = leaveManagementPendingId ? 'Saving Week…' : 'Review & Save Week';
  setBidChangeStatus(error || (selection.changedRows.length ? 'Review the replacement dates before saving. Availability is checked when you save.' : ''), error ? 'error' : 'info');
}

function updateIndividualBidChange(rowId, newKey) {
  bidChangeRows = bidChangeRows.map((row) => row.id === rowId ? { ...row, newKey } : row);
  renderBidChangeModal();
}

function bidChangeValidationMessage(replacementRows, affectedRequestIds) {
  if (bidChangeRound === 1) {
    const weekError = roundOneBidChangeValidationMessage();
    if (weekError) return weekError;
  }
  const newKeys = replacementRows.map((row) => row.newKey || row.oldKey);
  if (newKeys.some((key) => !isBidLeaveYearDate(key))) return "All new dates must be inside the bidding leave year.";
  if (new Set(newKeys).size !== newKeys.length) return "Two bid dates cannot be changed to the same date.";
  const rdoDates = bidChangeRound > 1 ? newKeys.filter((key) => isRdoDateForInitials(key, currentUser.initials)) : [];
  if (rdoDates.length) return `Round ${bidChangeRound} cannot include RDO dates: ${formatLeaveConflictDates(rdoDates)}.`;

  const unaffectedItems = leaveRoundUsageForInitials(currentUser.initials, bidChangeRound)
    .filter((item) => !affectedRequestIds.has(submittedLeaveItemKey(item)));
  const unaffectedKeys = unaffectedItems.flatMap(leaveDateKeysForItem);
  const collisions = newKeys.filter((key) => unaffectedKeys.includes(key));
  if (collisions.length) return `${formatLeaveConflictDates(collisions)} is already in another active bid.`;

  if (bidChangeRound === 1) {
    const weeks = roundOneWeekKeySetForItems([...unaffectedItems, { round: 1, dateKeys: newKeys }]).size;
    if (weeks > roundOneWeekLimit()) return `Round 1 can include up to ${roundOneWeekLimit()} bid weeks. These changes would use ${weeks}.`;
  } else {
    const chargedDays = unaffectedItems.reduce((total, item) => total + leaveItemChargedDays(item), 0)
      + chargeableLeaveDateKeys(newKeys, currentUser.initials, bidChangeRound).length;
    if (chargedDays > leaveDayLimitForRound(bidChangeRound)) {
      return `Round ${bidChangeRound} can include up to ${leaveDayLimitForRound(bidChangeRound)} charged days. These changes would use ${chargedDays}.`;
    }
  }

  const affectedItems = leaveRoundUsageForInitials(currentUser.initials, bidChangeRound)
    .filter((item) => affectedRequestIds.has(submittedLeaveItemKey(item)));
  const affectedChargedDays = affectedItems.reduce((total, item) => total + leaveItemChargedDays(item), 0);
  const replacementChargedDays = chargeableLeaveDateKeys(newKeys, currentUser.initials, bidChangeRound).length;
  const projectedChargedDays = leaveCommittedChargedDays() - affectedChargedDays + replacementChargedDays;
  if (projectedChargedDays > leaveAllowanceLimitForRound(bidChangeRound)) {
    return `These changes would exceed your Round ${bidChangeRound} leave allowance.`;
  }
  return "";
}

async function saveBidDateChanges() {
  if (leaveManagementPendingId) return;
  const { changedRows, affectedRequestIds, replacementRows } = bidChangeDraftSelection();
  if (!changedRows.length) {
    setBidChangeStatus("Choose at least one new date before saving.", "error");
    return;
  }

  const validationMessage = bidChangeValidationMessage(replacementRows, affectedRequestIds);
  if (validationMessage) {
    setBidChangeStatus(validationMessage, "error");
    return;
  }

  if (bidChangeRound === 1 && !window.confirm(`Replace this whole bid week with: ${[...bidChangeWeek.dates].sort().map(bidChangeDateLabel).join(', ')}? Your other week stays in place.`)) return;
  leaveManagementPendingId = "bid-date-change";
  renderBidChangeModal();
  setBidChangeStatus("Checking availability and saving all date changes…");
  try {
    const client = supabaseClient();
    if (!client) throw new Error("Supabase is not configured on this page.");
    const replacementItems = replacementRows.map((row) => ({
      start_date: row.newKey,
      end_date: row.newKey,
      round: bidChangeRound,
      notes: row.notes,
    }));
    const { error } = await client.rpc("replace_own_leave_request_batch", {
      requested_leave_request_ids: [...affectedRequestIds],
      replacement_items: replacementItems,
    });
    if (error) {
      if (/function|schema cache|replace_own_leave_request_batch/i.test(error.message || "")) {
        throw new Error("Bid-date changes are not installed yet. Run the latest database migration, then try again.");
      }
      throw error;
    }
    await loadSupabaseReferenceData();
    const changedWholeWeek = bidChangeRound === 1;
    leaveManagementPendingId = "";
    closeBidChangeModal({ restoreFocus: false });
    renderApp();
    setSubmittedLeaveStatus(changedWholeWeek ? "Your bid week was replaced and sent to intake review. Your other week was kept." : `${changedRows.length} ${changedRows.length === 1 ? "bid date was" : "bid dates were"} changed and sent to intake review.`, "success");
  } catch (error) {
    leaveManagementPendingId = "";
    renderBidChangeModal();
    setBidChangeStatus(error.message || "The bid dates could not be changed. Your current dates are still in place.", "error");
  }
}

function renderSubmittedLeaveManager() {
  const panel = document.querySelector("[data-submitted-leave-manager]");
  const list = document.querySelector("[data-submitted-leave-list]");
  const usage = document.querySelector("[data-submitted-leave-usage]");
  const roundLabel = document.querySelector("[data-submitted-leave-round]");
  const addButton = document.querySelector("[data-add-more-leave-dates]");
  const changeButton = document.querySelector("[data-change-all-submitted-leave]");
  if (!panel || !list || !usage || !roundLabel || !addButton || !changeButton) return;

  const now = new Date();
  const round = editableLeaveRound(now) || currentRoundNumber();
  const items = submittedLeaveItemsForCurrentRound(now);
  const pendingItems = items.filter((item) => item.status === "Pending");
  const pendingDecisionMessage = pendingItems.length
    ? "Your leave dates are awaiting an intake decision. Wait until they are approved or denied before changing or removing them."
    : "";
  const hasSubmittedThisRound = leaveBids.some((item) =>
    leaveRoundForItem(item) === round &&
    (!item.initials || item.initials === currentUser.initials) &&
    !["Draft", "Preview"].includes(item.status)
  );
  const addToBatchButton = document.querySelector("[data-add-leave-request]");
  if (addToBatchButton) addToBatchButton.textContent = leaveReplacementRequestId ? "Save Changed Dates" : "Add to Batch";
  panel.hidden = !hasSubmittedThisRound;
  if (!hasSubmittedThisRound) return;

  const hoursPerDay = leaveHoursPerDayForInitials();
  const maximumHours = leaveAllowanceHoursForRound(round);
  const usedHours = leaveCommittedChargedDays() * hoursPerDay;
  const remainingHours = Math.max(0, maximumHours - usedHours);
  const roundDays = items.reduce((total, item) => total + leaveItemChargedDays(item), 0);
  const roundWeeks = round === 1 ? roundOneWeekKeySetForItems(items).size : 0;
  const windowError = leaveBidWindowErrorMessage(now);
  const roundLimitReached = round !== 1 && roundDays >= leaveDayLimitForRound(round);
  const constraintError = remainingHours <= 0
    ? `You have used your ${formatEstimatedLeaveDays(maximumHours)} allotted leave hours.`
    : roundLimitReached
      ? `You have reached the Round ${round} limit.`
      : "";
  const addError = windowError || constraintError;

  roundLabel.textContent = `Round ${round}`;
  addButton.dataset.constraintError = constraintError;
  addButton.disabled = Boolean(addError) || Boolean(leaveManagementPendingId);
  addButton.title = addError;
  changeButton.disabled = Boolean(windowError) || Boolean(pendingDecisionMessage) || Boolean(leaveManagementPendingId) || !items.length || items.some((item) => !item.supabaseRequestId);
  changeButton.title = windowError || pendingDecisionMessage;
  usage.innerHTML = `
    <div><span>This round</span><strong>${round === 1 ? `${roundWeeks} / ${roundOneWeekLimit()} bid weeks` : `${roundDays} / ${leaveDayLimitForRound(round)} days`}</strong></div>
    <div><span>Allotted hours left</span><strong>${formatEstimatedLeaveDays(remainingHours)} / ${formatEstimatedLeaveDays(maximumHours)} hours</strong></div>
  `;

  list.innerHTML = items.length ? items.map((item) => {
    const itemKey = submittedLeaveItemKey(item);
    const isSaving = leaveManagementPendingId === itemKey;
    return `
      <article class="submitted-leave-item">
        <div>
          <span class="status ${item.status.toLowerCase()}">${escapeHtml(item.status)}</span>
          <strong>${escapeHtml(item.range)}</strong>
          <small>${formatEstimatedLeaveDays(leaveItemChargedDays(item) * hoursPerDay)} leave hours · Priority ${Number(item.priority || 0)}</small>
        </div>
        <button class="secondary-action danger small" type="button" data-remove-submitted-leave="${escapeHtml(itemKey)}" ${windowError || pendingDecisionMessage || leaveManagementPendingId || item.status !== "Approved" ? "disabled" : ""} title="${escapeHtml(windowError || (item.status === "Pending" ? pendingDecisionMessage : ""))}">${isSaving ? "Removing…" : item.status === "Pending" ? "Awaiting Decision" : "Remove"}</button>
      </article>
    `;
  }).join("") : '<p class="empty-state small">You do not currently have active leave dates in this round. Use Add More Dates to submit another range.</p>';

  if (windowError || pendingDecisionMessage) setSubmittedLeaveStatus(windowError || pendingDecisionMessage, "error");
}

function openLeaveBuilderForMoreDates() {
  const windowError = leaveBidWindowErrorMessage();
  if (windowError) {
    setSubmittedLeaveStatus(windowError, "error");
    return;
  }

  leaveReplacementRequestId = "";
  selectedLeaveDates.clear();
  leaveRangeSelectionComplete = false;
  leaveRangePreviewActive = false;
  syncLeaveBuilderInputs();
  renderSubmittedLeaveManager();

  const rangeInput = document.querySelector("[data-leave-range-input]");
  rangeInput?.scrollIntoView({ behavior: "smooth", block: "center" });
  rangeInput?.focus({ preventScroll: true });
  syncLeavePickerMonthToRange();
  setLeavePickerOpen(true);
  const round = currentRoundNumber();
  setLeaveBuilderStatus(round === 1
    ? "Select each additional Round 1 date individually, add the selection to the batch, and submit it before your window closes."
    : round <= 6
      ? `Select each additional Round ${round} date individually, add the selection to the batch, and submit it before your window closes.`
      : "Select another date range, add it to the batch, and submit it before your window closes.", "info");
}

function openSubmittedLeaveForReplacement(itemKey) {
  if (leaveReplacementRequestId === itemKey) {
    leaveReplacementRequestId = "";
    renderSubmittedLeaveManager();
    setSubmittedLeaveStatus("Change cancelled. Your submitted dates are still in place.", "info");
    return;
  }
  const item = submittedLeaveItemsForCurrentRound().find((entry) => submittedLeaveItemKey(entry) === itemKey);
  const windowError = leaveBidWindowErrorMessage();
  if (!item || !item.supabaseRequestId || windowError) {
    setSubmittedLeaveStatus(windowError || "This leave request cannot be changed here.", "error");
    return;
  }
  if (item.status !== "Approved") {
    setSubmittedLeaveStatus("This leave request is awaiting an intake decision. Wait until it is approved or denied before changing it.", "error");
    return;
  }
  if (leaveDraftQueue.length) {
    setSubmittedLeaveStatus("Submit or remove the preview batch before changing submitted dates.", "error");
    return;
  }

  const keys = datesInLeaveRange(item.range);
  if (!keys.length) {
    setSubmittedLeaveStatus("The saved date range could not be loaded.", "error");
    return;
  }
  leaveReplacementRequestId = itemKey;
  leaveRangeStartKey = keys[0];
  leaveRangeEndKey = keys[keys.length - 1];
  leaveRangeSelectionComplete = true;
  leaveRangePreviewActive = false;
  const notesInput = document.querySelector("[data-leave-notes-input]");
  if (notesInput) notesInput.value = item.notes || "";
  syncLeaveBuilderInputs();
  syncLeavePickerMonthToRange();
  renderSubmittedLeaveManager();
  document.querySelector("[data-leave-range-input]")?.scrollIntoView({ behavior: "smooth", block: "center" });
  setLeavePickerOpen(true);
  setLeaveBuilderStatus(`Choose replacement dates for ${item.range}, then select Save Changed Dates. The original bid stays in place if the replacement fails validation.`, "info");
}

async function replaceSubmittedLeaveRequest() {
  if (leaveManagementPendingId) return;
  const item = leaveReplacementItem();
  const windowError = leaveBidWindowErrorMessage();
  if (!item || !item.supabaseRequestId || windowError) {
    setLeaveBuilderStatus(windowError || "This leave request cannot be changed here.", "error");
    return;
  }
  if (item.status !== "Approved") {
    setLeaveBuilderStatus("This leave request is awaiting an intake decision. Wait until it is approved or denied before changing it.", "error");
    return;
  }
  const { range, notes } = leaveBuilderValues();
  const dateKeys = datesInLeaveRange(range);
  if (!dateKeys.length || invalidLeaveYearDateKeys(dateKeys).length) {
    setLeaveBuilderStatus("Choose replacement dates within the bidding leave year.", "error");
    return;
  }
  const round = leaveRoundForItem(item);
  if (matchesCurrentReplacementDates(dateKeys)) {
    setLeaveBuilderStatus("Those are the same dates as your existing bid. Choose different dates and try again.", "error");
    return;
  }
  if (matchesRemovedLeaveDates(dateKeys, round)) {
    setLeaveBuilderStatus(`These are the same dates you removed in Round ${round}. Choose different dates and try again.`, "error");
    return;
  }
  const rdoDates = leaveRdoDatesForInitials(range, currentUser.initials);
  if (round > 1 && rdoDates.length) {
    setLeaveBuilderStatus(`Round ${round} cannot include RDO dates: ${formatLeaveConflictDates(rdoDates)}. Choose different dates.`, "error");
    return;
  }
  const chargedDays = chargeableLeaveDatesForInitials(range, currentUser.initials, round).length;
  if (!chargedDays) {
    setLeaveBuilderStatus("The replacement must include at least one chargeable leave day.", "error");
    return;
  }
  const otherRoundItems = leaveRoundUsageForInitials(currentUser.initials, round)
    .filter((entry) => submittedLeaveItemKey(entry) !== leaveReplacementRequestId);
  if (round === 1) {
    const weeks = roundOneWeekKeySetForItems([...otherRoundItems, { range, round }]).size;
    if (weeks > roundOneWeekLimit()) {
      setLeaveBuilderStatus(`Round 1 can include up to ${roundOneWeekLimit()} bid weeks. This replacement would use ${weeks}.`, "error");
      return;
    }
  } else {
    const roundDays = otherRoundItems.reduce((total, entry) => total + leaveItemChargedDays(entry), chargedDays);
    if (roundDays > leaveDayLimitForRound(round)) {
      setLeaveBuilderStatus(`Round ${round} can include up to ${leaveDayLimitForRound(round)} charged days. This replacement would use ${roundDays}.`, "error");
      return;
    }
  }
  const projectedDays = leaveProjectedChargedDays() - leaveItemChargedDays(item) + chargedDays;
  if (projectedDays > leaveAllowanceLimitForRound(round)) {
    setLeaveBuilderStatus(`This replacement would exceed the Round ${round} leave allowance.`, "error");
    return;
  }

  leaveManagementPendingId = leaveReplacementRequestId;
  renderSubmittedLeaveManager();
  setLeaveBuilderStatus(`Checking replacement dates for ${item.range}…`, "info");
  try {
    const client = supabaseClient();
    if (!client) throw new Error("Supabase is not configured on this page.");
    const { error } = await client.rpc("replace_own_leave_request", {
      requested_leave_request_id: item.supabaseRequestId,
      replacement_start_date: dateKeys[0],
      replacement_end_date: dateKeys[dateKeys.length - 1],
      replacement_notes: notes,
    });
    if (error) throw error;
    await loadSupabaseReferenceData();
    leaveReplacementRequestId = "";
    leaveManagementPendingId = "";
    renderApp();
    setSubmittedLeaveStatus(`${item.range} was replaced with ${range}.`, "success");
    setLeaveBuilderStatus("Changed dates saved and sent to intake review.", "success");
  } catch (error) {
    leaveManagementPendingId = "";
    renderSubmittedLeaveManager();
    setLeaveBuilderStatus(error.message || "The leave dates could not be changed.", "error");
  }
}

async function removeSubmittedLeaveRequest(itemKey) {
  const now = new Date();
  const item = submittedLeaveItemsForCurrentRound(now).find((entry) => submittedLeaveItemKey(entry) === itemKey);
  if (!item) return;

  if (item.status !== "Approved") {
    setSubmittedLeaveStatus("This leave request is awaiting an intake decision. Wait until it is approved or denied before removing it.", "error");
    return;
  }

  const windowError = leaveBidWindowErrorMessage(now);
  if (windowError) {
    setSubmittedLeaveStatus(windowError, "error");
    return;
  }

  const openRound = editableLeaveRound(now);
  const itemRound = leaveRoundForItem(item);
  if (!openRound || itemRound !== openRound) {
    setSubmittedLeaveStatus(`Only leave ranges bid in your currently open round can be removed. Round ${itemRound} is locked.`, "error");
    return;
  }

  if (!window.confirm(`Remove ${item.range} from your Round ${itemRound} leave bid?`)) return;

  leaveManagementPendingId = itemKey;
  renderSubmittedLeaveManager();
  setSubmittedLeaveStatus(`Removing ${item.range}…`, "info");

  try {
    const client = supabaseClient();
    if (!client || !supabaseState.connected) {
      throw new Error("The leave request could not reach the database. Check the connection and try again.");
    }
    if (!item.supabaseRequestId) {
      throw new Error("This leave request is not linked to a saved database record.");
    }
    const { error } = await client.rpc("cancel_own_leave_request", {
      requested_leave_request_id: item.supabaseRequestId,
    });
    if (error) {
      if (isMissingSupabaseRoutine(error)) {
        throw new Error("Member leave editing is not installed. Run database/member_leave_request_management.sql in Supabase.");
      }
      throw error;
    }
    await loadSupabaseReferenceData();

    leaveManagementPendingId = "";
    if (leaveReplacementRequestId === itemKey) leaveReplacementRequestId = "";
    renderApp();
    setSubmittedLeaveStatus(`${item.range} was removed. You may add different or additional dates while your window remains open.`, "success");
  } catch (error) {
    leaveManagementPendingId = "";
    renderApp();
    setSubmittedLeaveStatus(error.message || "The submitted leave dates could not be removed.", "error");
  }
}

function renderLeaveAllowanceSummary() {
  const holidayCount = leaveHolidayBidCount();
  const holidayText = `${holidayCount} ${holidayCount === 1 ? "holiday" : "holidays"} bid`;
  const round = currentRoundNumber();
  const credits = leaveHolidayCreditsForRound(round);
  const totalAllowance = leaveAllowanceLimitForRound(round);
  const allowanceHours = currentUserLeaveAllowanceHours();
  const totalAllowanceHours = leaveAllowanceHoursForRound(round);
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
  setText("[data-leave-balance-heading]", `Leave Balance (${formatEstimatedLeaveDays(totalAllowanceHours)} hours / ${scheduleText})`);
  setText("[data-leave-total-allowance]", formatLeaveDaysLabel(totalAllowance));
  setText("[data-leave-left-days]", formatRoundedUpLeaveDaysLabel(leftDays));
  setText("[data-leave-bid-days]", formatLeaveDaysLabel(bidDays));
  setText("[data-leave-balance-summary]", `${formatEstimatedLeaveDays(allowanceHours)} base hours · ${credits * hoursPerDay} returned hours · ${scheduleText}`);
  setText("[data-leave-balance-holidays]", holidayText);
  setText("[data-leave-holidays-bid]", credits && round >= 4 ? `${holidayCount} (${credits} credit)` : String(holidayCount));
}

function renderRoundRuleSummary(date = new Date(), roundState = areaBidRoundState(date)) {
  const testRound = activeTestBidRound();
  const round = testRound || latestAreaRound(date, roundState);
  const rule = roundRuleForRound(round);
  const phaseDetail = pilotState.database && !testRound
    ? "Pilot bidding is turned off. An administrator must enable pilot access and a round."
    : testRound
    ? "Authorized pilot mode is using this round for practice submissions."
    : roundState?.phase === "validation"
    ? "Validation period is active. No bids may be entered."
    : roundState?.phase === "open"
      ? Number.isFinite(roundState.activeRank)
        ? `Currently bidding in ${currentViewArea()}: seniority #${roundState.activeRank}. The round remains open through the final BUE window across all areas.`
        : `Round ${roundState.round} is open across all areas through the final BUE window.`
      : "Bidding is closed until the next scheduled round window.";

  setText("[data-round-rule-heading]", `Round ${round} Rules`);
  setText("[data-round-rule-limit]", rule.label);
  setText("[data-round-rule-detail]", `${rule.detail} ${phaseDetail}`);
}

function normalizeApprovalRules(value) {
  if (!Array.isArray(value)) return null;
  return value
    .filter((rule) => typeof rule === "string")
    .map((rule) => rule.trim())
    .map((rule) => rule === "BUEs may bid after their window has closed when bidding during Intake Hours: 7a-7p Monday-Sunday, excluding holidays."
      ? MANUAL_AFTER_WINDOW_RULE
      : rule === "Once the round is closed, BUEs may not make bids or adjustments for that round."
        ? CLOSED_ROUND_RULE
        : rule)
    .filter(Boolean);
}

function applyApprovalRules(value) {
  const normalizedRules = normalizeApprovalRules(value);
  if (!normalizedRules) return;
  approvalRules = normalizedRules;
  clearStoredJsonValue(APPROVAL_RULES_STORAGE_KEY);
}

function setApprovalRuleStatus(message, status = "info") {
  showActionFeedback(message, status);
  const target = document.querySelector("[data-approval-rule-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

async function saveApprovalRules(nextRules) {
  const client = supabaseClient();
  if (!client || !supabaseState.connected) {
    throw new Error("Approval Rules could not reach the database. Check the connection and try again.");
  }

  const { data, error } = await client.rpc("set_approval_rules", {
    requested_bid_year: BID_YEAR,
    requested_rules: nextRules,
  });
  if (error) {
    if (isMissingSupabaseRoutine(error)) {
      throw new Error("Approval Rules database support is not installed yet.");
    }
    throw error;
  }

  applyApprovalRules(data);
}

async function persistApprovalRules(nextRules, successMessage) {
  setApprovalRuleStatus("Saving Approval Rules...");
  try {
    await saveApprovalRules(nextRules);
    renderApprovalRuleSummary();
    renderApprovalRuleEditor();
    setApprovalRuleStatus(successMessage, "success");
    return true;
  } catch (error) {
    setApprovalRuleStatus(error.message || "Approval Rules could not be saved.", "error");
    return false;
  }
}

function saveRoundRules() {
  if (roundRulesDatabaseComplete) clearStoredJsonValue(ROUND_RULES_STORAGE_KEY);
  else storeJsonValue(ROUND_RULES_STORAGE_KEY, roundRules);
}

function normalizeRoundRules(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(Object.entries(value).flatMap(([round, rule]) => {
    const roundNumber = Number(round);
    const label = typeof rule?.label === "string" ? rule.label.trim() : "";
    const detail = typeof rule?.detail === "string" ? rule.detail.trim() : "";
    return Number.isInteger(roundNumber) && roundNumber >= 1 && roundNumber <= 6 && label && detail
      ? [[roundNumber, { label, detail }]]
      : [];
  }));
}

function applyRoundRules(value) {
  const normalizedRules = normalizeRoundRules(value);
  const savedRoundCount = Object.keys(normalizedRules).length;
  if (!savedRoundCount) return;

  roundRules = {
    ...DEFAULT_ROUND_RULES,
    ...(savedRoundCount < Object.keys(DEFAULT_ROUND_RULES).length ? roundRules : {}),
    ...normalizedRules,
  };
  roundRulesDatabaseComplete = savedRoundCount === Object.keys(DEFAULT_ROUND_RULES).length;
  saveRoundRules();
}

function setRoundRuleStatus(message, status = "info") {
  showActionFeedback(message, status);
  const target = document.querySelector("[data-round-rule-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

async function saveSupabaseRoundRule(round, label, detail) {
  const client = supabaseClient();
  if (!client || !supabaseState.connected) {
    throw new Error("Round Rules could not reach the database. Check the connection and try again.");
  }

  const { data, error } = await client.rpc("set_round_rule", {
    requested_bid_year: BID_YEAR,
    requested_round: round,
    rule_label: label,
    rule_detail: detail,
  });
  if (error) {
    if (isMissingSupabaseRoutine(error)) {
      throw new Error("Round Rules database support is not installed yet.");
    }
    throw error;
  }

  applyRoundRules(data);
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

async function saveRoundRule(round) {
  const labelInput = document.querySelector(`[data-round-rule-label="${round}"]`);
  const detailInput = document.querySelector(`[data-round-rule-detail="${round}"]`);
  if (!labelInput || !detailInput) return;

  const label = labelInput.value.trim();
  const detail = detailInput.value.trim();
  if (!label || !detail) {
    setRoundRuleStatus("Enter both a limit and a rule before saving.", "error");
    return;
  }

  const saveButton = document.querySelector(`[data-save-round-rule="${round}"]`);
  if (saveButton) saveButton.disabled = true;
  setRoundRuleStatus(`Saving Round ${round}...`);

  try {
    await saveSupabaseRoundRule(round, label, detail);
    renderRoundRuleSummary();
    renderRoundRuleSummaryList();
    renderRoundRuleEditor();
    setRoundRuleStatus(`Round ${round} saved to Supabase.`, "success");
  } catch (error) {
    if (saveButton) saveButton.disabled = false;
    setRoundRuleStatus(error.message || `Round ${round} could not be saved.`, "error");
  }
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

async function saveApprovalRuleFromInput() {
  const input = document.querySelector("[data-approval-rule-input]");
  if (!input) return;

  const value = input.value.trim();
  if (!value) return;

  const editingIndex = Number(input.dataset.editingIndex);
  const nextRules = [...approvalRules];
  if (Number.isInteger(editingIndex) && approvalRules[editingIndex]) {
    nextRules[editingIndex] = value;
  } else {
    nextRules.push(value);
  }

  if (await persistApprovalRules(nextRules, "Approval Rules saved to Supabase.")) {
    resetApprovalRuleInput();
    renderApprovalRuleEditor();
  }
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

async function reorderApprovalRule(fromIndex, toIndex) {
  if (
    fromIndex === toIndex ||
    !approvalRules[fromIndex] ||
    toIndex < 0 ||
    toIndex >= approvalRules.length
  ) {
    return false;
  }

  const nextRules = [...approvalRules];
  const [rule] = nextRules.splice(fromIndex, 1);
  nextRules.splice(toIndex, 0, rule);
  const saved = await persistApprovalRules(nextRules, "Approval Rule order saved to Supabase.");
  if (saved) resetApprovalRuleInput();
  return saved;
}

async function removeApprovalRule(index) {
  if (!approvalRules[index]) return;
  const nextRules = approvalRules.filter((_, ruleIndex) => ruleIndex !== index);
  if (await persistApprovalRules(nextRules, "Approval Rule removed from Supabase.")) {
    resetApprovalRuleInput();
    renderApprovalRuleEditor();
  }
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

async function dropApprovalRule(event) {
  if (draggedApprovalRuleIndex === null) return;
  const list = event.target.closest("[data-approval-rule-list]");
  if (!list) return;

  event.preventDefault();
  const nextOrder = [...list.querySelectorAll("[data-approval-rule-index]")]
    .map((item) => Number(item.dataset.approvalRuleIndex))
    .filter((index) => Number.isInteger(index) && approvalRules[index]);
  if (nextOrder.length === approvalRules.length) {
    await persistApprovalRules(
      nextOrder.map((index) => approvalRules[index]),
      "Approval Rule order saved to Supabase."
    );
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
  const { cpcTotal: cpcTotalDays, devTotal: devTotalDays } = areaLeaveBucketTotals();
  const cpcUsedDays = areaLeaveSlotUsedDays(currentViewArea(), "cpc");
  const devUsedDays = areaLeaveSlotUsedDays(currentViewArea(), "dev");
  const cpcLeft = Math.max(0, cpcTotalDays - cpcUsedDays);
  const devLeft = Math.max(0, devTotalDays - devUsedDays);

  setText("[data-cpc-leave-remaining]", formatRoundedUpLeaveDays(cpcLeft));
  setText("[data-dev-leave-remaining]", formatRoundedUpLeaveDays(devLeft));
  setText("[data-cpc-leave-detail]", `${formatRoundedUpLeaveDays(cpcUsedDays)} used of ${formatRoundedUpLeaveDays(cpcTotalDays)} estimated days`);
  setText("[data-dev-leave-detail]", `${formatRoundedUpLeaveDays(devUsedDays)} used of ${formatRoundedUpLeaveDays(devTotalDays)} estimated days`);
}

function setIntakeTeamStatus(message, status = "info") {
  showActionFeedback(message, status);
  const target = document.querySelector("[data-intake-team-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

function bueRoster() {
  return cachedLeaveRead("roster", () => bueRosterUncached());
}

function bueRosterUncached() {
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
    profileId: currentUser.supabaseProfileId || "",
    ghostBidder: Boolean(currentUser.ghostBidder),
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
  return cachedLeaveRead(JSON.stringify(["bueByInitials", initials]), () => bueByInitialsUncached(initials));
}

function bueByInitialsUncached(initials) {
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

function availableIntakeTeamCandidates() {
  return bueRoster().filter((person) => !intakeTeamInitials.has(person.initials));
}

function intakeTeamCandidateMatches(person, query) {
  if (!query) return true;
  const rank = Number.isFinite(person.rank) ? person.rank : person.seniorityRank;
  const searchable = [
    rank,
    Number.isFinite(rank) ? `#${rank}` : "",
    Number.isFinite(rank) ? `seniority ${rank}` : "",
    person.firstName,
    person.lastName,
    person.initials,
    person.area,
    person.bidAs,
    person.email,
  ].filter(Boolean).join(" ").toLowerCase();
  return searchable.includes(query.toLowerCase());
}

function renderIntakeTeamCandidateSearch() {
  const input = document.querySelector("[data-intake-team-candidate-search]");
  const results = document.querySelector("[data-intake-team-candidate-results]");
  const status = document.querySelector("[data-intake-team-candidate-status]");
  const addButton = document.querySelector("[data-add-intake-team-member]");
  if (!input || !results || !status || !addButton) return;

  const availablePeople = availableIntakeTeamCandidates();
  const selectedPerson = availablePeople.find((person) => person.initials === selectedIntakeTeamCandidateInitials);
  if (selectedIntakeTeamCandidateInitials && !selectedPerson) selectedIntakeTeamCandidateInitials = "";

  if (selectedPerson) {
    input.value = personScheduleLabel(selectedPerson);
    input.setAttribute("aria-expanded", "false");
    results.innerHTML = "";
    results.hidden = true;
    status.textContent = `Selected ${personDisplayName(selectedPerson)} (${selectedPerson.initials}).`;
    addButton.disabled = false;
    return;
  }

  input.value = intakeTeamCandidateQuery;
  addButton.disabled = true;
  const query = intakeTeamCandidateQuery.trim();
  const matches = query
    ? availablePeople.filter((person) => intakeTeamCandidateMatches(person, query))
    : [];
  const visibleMatches = matches.slice(0, 40);

  results.innerHTML = visibleMatches.map((person) => {
    const rank = Number.isFinite(person.rank) ? `Seniority #${person.rank}` : "Unranked";
    return `
      <button id="intake-team-candidate-${escapeHtml(person.initials)}" type="button" role="option" data-intake-team-candidate-result="${escapeHtml(person.initials)}">
        <strong>${escapeHtml(personDisplayName(person))} · ${escapeHtml(person.initials)}</strong>
        <span>${escapeHtml(person.area)} · ${escapeHtml(rank)} · ${escapeHtml(person.bidAs || "CPC")}</span>
      </button>
    `;
  }).join("");
  results.hidden = !query || visibleMatches.length === 0;
  input.setAttribute("aria-expanded", String(!results.hidden));

  if (!availablePeople.length) {
    status.textContent = "All rostered BUEs are already on the intake team.";
  } else if (!query) {
    status.textContent = `Search ${availablePeople.length} available employees.`;
  } else if (!matches.length) {
    status.textContent = "No available employees match that search.";
  } else if (matches.length > visibleMatches.length) {
    status.textContent = `${matches.length} matches; showing the first ${visibleMatches.length}. Keep typing to narrow the list.`;
  } else {
    status.textContent = `${matches.length} ${matches.length === 1 ? "match" : "matches"}. Select an employee below.`;
  }
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
  const teamPeople = intakeTeamMembers();
  renderIntakeTeamCandidateSearch();
  renderRosterSelect("[data-schedule-rep]", teamPeople, teamPeople[0]?.initials || "");
}

async function saveIntakeTeamMember(initials, enabled) {
  const client = supabaseClient();
  if (!client || !supabaseState.connected) {
    throw new Error("The intake team could not reach the database. Check the connection and try again.");
  }
  const { error } = await client.rpc("set_intake_team_member", {
    requested_initials: initials,
    should_enable: enabled,
  });
  if (error) throw error;
  supabaseState.placeholdersCleared = false;
  await loadSupabaseReferenceData();
}

async function addSelectedBueToIntakeTeam() {
  if (!hasSystemAdminAccess()) return;
  const initials = selectedIntakeTeamCandidateInitials;
  const person = bueByInitials(initials);
  if (!person) {
    setIntakeTeamStatus("Choose a BUE to add to the intake team.", "error");
    return;
  }

  setIntakeTeamStatus(`Adding ${personDisplayName(person)} to the intake team...`);
  try {
    await saveIntakeTeamMember(person.initials, true);
    logHistory("All Areas", "Intake team updated", `${currentUser.initials} added ${person.initials} to the intake team.`);
    intakeTeamCandidateQuery = "";
    selectedIntakeTeamCandidateInitials = "";
    renderApp();
    setIntakeTeamStatus(`${personDisplayName(person)} is now available for intake scheduling and saved to Supabase.`, "success");
  } catch (error) {
    setIntakeTeamStatus(error.message || "The intake team could not be updated.", "error");
  }
}

async function removeBueFromIntakeTeam(initials) {
  if (!hasSystemAdminAccess()) return;
  const person = bueByInitials(initials);
  if (!person || person.initials === currentUser.initials) {
    setIntakeTeamStatus("That intake team member cannot be removed here.", "error");
    return;
  }

  setIntakeTeamStatus(`Removing ${personDisplayName(person)} from the intake team...`);
  try {
    await saveIntakeTeamMember(person.initials, false);
    logHistory("All Areas", "Intake team updated", `${currentUser.initials} removed ${person.initials} from the intake team.`);
    renderApp();
    setIntakeTeamStatus(`${personDisplayName(person)} was removed from future intake scheduling choices in Supabase.`, "success");
  } catch (error) {
    setIntakeTeamStatus(error.message || "The intake team could not be updated.", "error");
  }
}

function setRosterStatus(message, status = "info") {
  showActionFeedback(message, status);
  const target = document.querySelector("[data-roster-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

function selectedRosterArea() {
  return document.querySelector("[data-roster-area-filter]")?.value || currentViewArea();
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
    areas.forEach(area => params.append("area", area));
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

document.addEventListener("submit", event => {
  if (!event.target.matches("[data-bid-time-export-form]")) return;
  event.preventDefault();
  const form = event.target;
  void runUiAction("bid-times-export", event.submitter || form.querySelector("[data-export-bid-times]"), "Exporting bid times…", () => exportBidTimes(form));
});

document.addEventListener("change", event => {
  const form = event.target.closest("[data-bid-time-export-form]");
  if (!form) return;
  const all = form.querySelector("[data-bid-time-export-all]");
  const areas = Array.from(form.querySelectorAll('[name="export-area"]'));
  if (event.target === all) areas.forEach(input => { input.checked = all.checked; });
  all.checked = areas.every(input => input.checked);
  all.indeterminate = !all.checked && areas.some(input => input.checked);
});

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

function syncRosterDeleteSelectedButton() {
  const button = document.querySelector("[data-roster-delete-selected]");
  const editIndex = Number(document.querySelector("[data-roster-edit-index]")?.value);
  if (!button) return;
  button.disabled = !findRosterEntryByIndex(editIndex);
}

function syncRosterParticipationFields() {
  const bidAs = document.querySelector("[data-roster-bid-as]")?.value || "";
  const participatesInBidding = bidRoleParticipatesInBidding(bidAs);
  const keepsLeaveAllowance = bidRoleKeepsLeaveAllowance(bidAs);
  const rankInput = document.querySelector("[data-roster-rank]");
  const leaveSlotsInput = document.querySelector("[data-roster-leave-slots]");
  if (rankInput) {
    if (!participatesInBidding) rankInput.value = "";
    rankInput.disabled = !participatesInBidding;
  }
  if (leaveSlotsInput) {
    if (!keepsLeaveAllowance) leaveSlotsInput.value = "0";
    leaveSlotsInput.disabled = !keepsLeaveAllowance;
  }
}

function syncBulkRosterBidAsSelect(row, selectedBidAs) {
  const area = row.querySelector("[data-bulk-area]")?.value || selectedRosterArea();
  const select = row.querySelector("[data-bulk-bid-as]");
  if (!select) return;
  const selectedRole = normalizeBidRoleForArea(selectedBidAs || select.value, area);
  select.innerHTML = rosterBidAsOptions(selectedRole, area);
  select.value = validBidRoleForArea(selectedRole, area) ? selectedRole : defaultBidRoleForArea(area);
  syncBulkRosterParticipationFields(row);
}

function syncBulkRosterParticipationFields(row) {
  const bidAs = row.querySelector("[data-bulk-bid-as]")?.value || "";
  const participatesInBidding = bidRoleParticipatesInBidding(bidAs);
  const keepsLeaveAllowance = bidRoleKeepsLeaveAllowance(bidAs);
  const rankInput = row.querySelector("[data-bulk-rank]");
  const leaveSlotsInput = row.querySelector("[data-bulk-leave-slots]");
  if (rankInput && !participatesInBidding) rankInput.value = "";
  if (leaveSlotsInput) {
    if (!keepsLeaveAllowance) leaveSlotsInput.value = "0";
    leaveSlotsInput.disabled = !keepsLeaveAllowance;
  }
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
  syncRosterParticipationFields();
  syncRosterDeleteSelectedButton();
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
    rank: bidRoleParticipatesInBidding(person.bidAs) && Number.isFinite(person.rank) ? person.rank : "",
    bidAs: person.bidAs,
    leaveSlotAllowance: person.leaveSlotAllowance,
  });
  setRosterStatus(`Editing ${personDisplayName(person)}.`);
}

function rosterFormValues(form = document.querySelector("[data-roster-form]")) {
  const value = (selector) => form?.querySelector(selector)?.value.trim() || "";
  const area = value("[data-roster-area]") || selectedRosterArea();
  const bidAs = normalizeBidRoleForArea(value("[data-roster-bid-as]") || defaultBidRoleForArea(area), area);
  const rank = Number(value("[data-roster-rank]"));
  const editIndex = value("[data-roster-edit-index]");
  const participatesInBidding = bidRoleParticipatesInBidding(bidAs);
  return {
    editInitials: value("[data-roster-edit-initials]").toUpperCase(),
    firstName: value("[data-roster-first-name]"),
    lastName: value("[data-roster-last-name]"),
    initials: value("[data-roster-initials]").toUpperCase(),
    email: value("[data-roster-email]").toLowerCase(),
    phone: value("[data-roster-phone]"),
    area,
    rank: participatesInBidding && Number.isFinite(rank) ? rank : null,
    bidAs,
    leaveSlotAllowance: bidRoleKeepsLeaveAllowance(bidAs) ? normalizeLeaveSlotAllowance(value("[data-roster-leave-slots]")) : 0,
    editIndex: editIndex ? Number(editIndex) : null,
    active: true,
  };
}

function supabaseRosterPayload(values) {
  return {
    profile_id: values.profileId || null,
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
  if (/admin_save_bidder_roster_(entry|rows)|function .*not found|Could not find/i.test(message)) {
    return "The roster was not saved because the Supabase roster helper is not installed.";
  }
  if (/Authentication is required|JWT|not authenticated|session/i.test(message)) {
    return "The roster was not saved. Sign in with a Supabase admin account and try again.";
  }
  if (/Admin access is required/i.test(message)) {
    return "The roster was not saved because the signed-in Supabase account is not marked as an admin.";
  }
  return `Supabase did not save the roster: ${message || "unknown error"}`;
}

async function saveSupabaseRosterEntry(values) {
  const client = supabaseClient();
  if (!client) {
    return {
      saved: false,
      message: "The roster was not saved because Supabase is not configured on this page.",
    };
  }

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError || !sessionData?.session) {
    return {
      saved: false,
      message: "The roster was not saved. Sign in with a Supabase admin account and try again.",
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
      message: "The roster was not saved because Supabase is not configured on this page.",
    };
  }

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError || !sessionData?.session) {
    return {
      saved: false,
      message: "The roster was not saved. Sign in with a Supabase admin account and try again.",
    };
  }

  const rosterRows = rows.map((row) => supabaseRosterPayload({
    ...row,
    originalArea: row.originalArea || row.area,
    originalInitials: row.originalInitials || row.initials,
  }));

  const { data, error } = await client.rpc("admin_save_bidder_roster_rows", { roster_rows: rosterRows });
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

  return {
    saved: true,
    bidWindowsReassigned: Number(data?.bid_windows_reassigned || 0),
  };
}

async function deactivateSupabaseRosterEntry(person) {
  const client = supabaseClient();
  if (!client) {
    return {
      saved: false,
      message: "Supabase is not configured on this page yet, so the BUE was not deleted.",
    };
  }

  if (!person.profileId) {
    return {
      saved: false,
      message: "Could not identify this BUE in Supabase. Refresh the roster and try again.",
    };
  }

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError || !sessionData?.session) {
    return {
      saved: false,
      message: "Sign in with a Supabase admin account before deleting a BUE.",
    };
  }

  const { data, error } = await client.rpc("admin_deactivate_bidder_roster_entry", {
    target_bidder_id: person.profileId,
  });
  if (error) {
    const message = /admin_deactivate_bidder_roster_entry|function .*not found|Could not find/i.test(error.message || "")
      ? "The bidder-delete database helper is not installed for this Supabase project."
      : error.message || "Supabase could not delete this BUE.";
    return { saved: false, message };
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result || result.profile_id !== person.profileId || result.active !== false) {
    return {
      saved: false,
      message: "Supabase did not confirm that this BUE was removed from the active roster.",
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
    senioritySource
      .filter((entry) => seniorityEntryArea(entry) === area && seniorityEntryActive(entry) && seniorityEntryIsRosterPerson(entry))
      .map((entry) => {
        const person = rosterEntryToPerson(entry, null, { fallbackInitials: false });
        const override = entryOverrides.get(entry) || {};
        return {
          profileId: person.profileId,
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

  const form = event.currentTarget;
  if (form.contains(document.activeElement)) document.activeElement.blur();
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  const values = rosterFormValues(form);
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
  if (bidRoleParticipatesInBidding(values.bidAs) && (!Number.isFinite(values.rank) || values.rank < 1)) {
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
  const rankDetail = Number.isFinite(values.rank) ? ` at seniority #${values.rank}` : "";
  renderApp();
  editRosterEntryByIndex(senioritySource.indexOf(entry));
  setRosterStatus(`${values.firstName} ${values.lastName} saved in the working roster. Syncing to Supabase...`, "info");
  const supabaseSave = await saveSupabaseRosterRows(rosterSyncRowsForAreas(
    new Set([originalArea, values.area]),
    new Map([[entry, { originalArea, originalInitials }]])
  ));
  await loadSupabaseReferenceData();
  renderApp();
  if (supabaseSave.saved) {
    logHistory("All Areas", existingEntry ? "BUE roster amended" : "BUE added", `${currentUser.initials} saved ${values.firstName} ${values.lastName} (${values.initials}) in ${values.area}${rankDetail}.`);
  }
  setRosterStatus(
    supabaseSave.saved
      ? `${values.firstName} ${values.lastName} saved to Supabase.${supabaseSave.bidWindowsReassigned ? ` ${supabaseSave.bidWindowsReassigned} bid-time assignments were updated by seniority.` : ""}`
      : supabaseSave.message,
    supabaseSave.saved ? "success" : "error"
  );
}

function deleteRosterEntry(initials) {
  const entry = findRosterEntryByInitials(initials);
  return deleteRosterEntryByIndex(senioritySource.indexOf(entry));
}

async function deleteRosterEntryByIndex(index) {
  if (!hasSystemAdminAccess()) return;
  const entry = findRosterEntryByIndex(index);
  if (!entry) return;
  const person = rosterEntryToPerson(entry);
  if (person.initials === currentUser.initials) {
    setRosterStatus("You cannot delete the account you are currently using.", "error");
    return;
  }
  const confirmation = window.prompt(`Type ${person.initials} to delete ${personDisplayName(person)} from the roster.`);
  if (confirmation === null) return;
  if (confirmation.trim().toUpperCase() !== person.initials) {
    setRosterStatus(`Delete canceled. Type ${person.initials} to confirm this BUE delete.`, "error");
    return;
  }

  setRosterStatus(`Deleting ${personDisplayName(person)} from Supabase...`, "info");
  const supabaseSave = await deactivateSupabaseRosterEntry(person);
  if (!supabaseSave.saved) {
    setRosterStatus(supabaseSave.message, "error");
    return;
  }

  senioritySource.splice(senioritySource.indexOf(entry), 1);
  intakeTeamInitials.delete(person.initials);
  for (let index = intakeSchedules.length - 1; index >= 0; index -= 1) {
    if (intakeSchedules[index].initials === person.initials) intakeSchedules.splice(index, 1);
  }
  logHistory("All Areas", "BUE deleted", `${currentUser.initials} deleted ${person.initials} from the working roster.`);
  resetRosterForm();
  renderApp();
  setRosterStatus(`${personDisplayName(person)} was removed from the active Supabase roster.`, "success");
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
      const bidAs = normalizeBidRoleForArea(bulkRowValue(row, "[data-bulk-bid-as]") || defaultBidRoleForArea(area), area);
      const rank = Number(bulkRowValue(row, "[data-bulk-rank]"));
      const participatesInBidding = bidRoleParticipatesInBidding(bidAs);
      return {
        profileId: seniorityEntryProfileId(senioritySource[Number(row.dataset.rosterEntryIndex)]),
        originalInitials,
        sourceIndex: Number(row.dataset.rosterEntryIndex),
        firstName: bulkRowValue(row, "[data-bulk-first-name]"),
        lastName: bulkRowValue(row, "[data-bulk-last-name]"),
        initials: bulkRowValue(row, "[data-bulk-initials]").toUpperCase(),
        email: bulkRowValue(row, "[data-bulk-email]").toLowerCase(),
        phone: bulkRowValue(row, "[data-bulk-phone]"),
        area,
        rank: participatesInBidding && Number.isFinite(rank) ? rank : null,
        bidAs,
        leaveSlotAllowance: bidRoleKeepsLeaveAllowance(bidAs) ? normalizeLeaveSlotAllowance(bulkRowValue(row, "[data-bulk-leave-slots]")) : 0,
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
    if (bidRoleParticipatesInBidding(row.bidAs) && (!Number.isFinite(row.rank) || row.rank < 1)) return `Enter a valid seniority rank for ${row.initials}.`;
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
      .filter((entry) => seniorityEntryActive(entry) && seniorityEntryParticipatesInBidding(entry))
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
    const nonBiddingEntries = areaEntries
      .filter((entry) => seniorityEntryActive(entry) && !seniorityEntryParticipatesInBidding(entry))
      .sort((a, b) => originalOrder.get(a) - originalOrder.get(b));
    const inactiveEntries = areaEntries
      .filter((entry) => !seniorityEntryActive(entry))
      .sort((a, b) => originalOrder.get(a) - originalOrder.get(b));
    rebuilt.push(...activeEntries, ...nonBiddingEntries, ...inactiveEntries);
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

  renderApp();
  setRosterStatus(`${editedEntries.length} visible roster rows applied. Syncing to Supabase...`, "info");
  const supabaseSave = await saveSupabaseRosterRows(rows);
  await loadSupabaseReferenceData();
  renderApp();
  if (supabaseSave.saved) {
    logHistory("All Areas", "Bulk roster update", `${currentUser.initials} applied ${editedEntries.length} visible roster rows from the bulk editor.`);
  }
  setRosterStatus(
    supabaseSave.saved
      ? `${editedEntries.length} visible roster rows saved to Supabase.${supabaseSave.bidWindowsReassigned ? ` ${supabaseSave.bidWindowsReassigned} bid-time assignments were updated by seniority.` : ""}`
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
  syncRosterParticipationFields();
  syncRosterDeleteSelectedButton();

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
  rosterTableRows().forEach(syncBulkRosterParticipationFields);
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

// Rounds 5 and 6 are reserved for a future bidding update.
const BID_WINDOW_BUILDER_ROUND_COUNT = 4;

function setBidWindowBuilderStatus(message, status = "info") {
  showActionFeedback(message, status);
  const target = document.querySelector("[data-bid-window-builder-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

function bidWindowBuilderMinutes(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function bidWindowBuilderClock(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function addDaysToDateKey(key, days = 1) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return dateKeyFromDate(date);
}

function nextBidWindowBuilderOpenDate(key, blackouts) {
  let nextKey = key;
  while (blackouts.has(nextKey)) nextKey = addDaysToDateKey(nextKey);
  return nextKey;
}

function bidWindowBuilderSettings() {
  const area = document.querySelector("[data-bid-window-builder-area]")?.value || currentViewArea();
  const keepAreasConsistent = Boolean(document.querySelector("[data-bid-window-builder-consistent]")?.checked);
  const startDate = document.querySelector("[data-bid-window-builder-start]")?.value || "";
  const opensAt = document.querySelector("[data-bid-window-builder-open]")?.value || "";
  const closesAt = document.querySelector("[data-bid-window-builder-close]")?.value || "";
  const windowMinutes = Number(document.querySelector("[data-bid-window-builder-length]")?.value);
  const reviewDays = Number(document.querySelector("[data-bid-window-builder-gap]")?.value);
  const blackoutDates = [...bidWindowBuilderBlackoutDates].sort();
  return { area, keepAreasConsistent, startDate, opensAt, closesAt, windowMinutes, reviewDays, blackoutDates };
}

function bidWindowBuilderSignature(settings) {
  return JSON.stringify(settings);
}

function validateBidWindowBuilderSettings(settings) {
  if (!ZLA_AREAS.includes(settings.area)) return "Choose a valid area.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(settings.startDate)) return "Choose the Round 1 start date.";
  const earliestStartDate = `${BID_YEAR - 1}-01-01`;
  const latestStartDate = `${BID_YEAR}-12-31`;
  if (settings.startDate < earliestStartDate || settings.startDate > latestStartDate) {
    return `Choose a Round 1 start date from ${BID_YEAR - 1} or ${BID_YEAR}.`;
  }

  const openingMinutes = bidWindowBuilderMinutes(settings.opensAt);
  const closingMinutes = bidWindowBuilderMinutes(settings.closesAt);
  if (!Number.isInteger(openingMinutes) || !Number.isInteger(closingMinutes) || closingMinutes <= openingMinutes) {
    return "Office closing time must be later than the opening time.";
  }
  if (!Number.isInteger(settings.windowMinutes) || settings.windowMinutes < 15 || settings.windowMinutes > 480) {
    return "Choose a bid-window length from 15 minutes through 8 hours.";
  }
  if (settings.windowMinutes > closingMinutes - openingMinutes) {
    return "The bid window must fit within one office day.";
  }
  if (!Number.isInteger(settings.reviewDays) || settings.reviewDays < 0 || settings.reviewDays > 14) {
    return "Review days must be a whole number from 0 through 14.";
  }
  return "";
}

function generateBidWindowBuilderPreview(settings) {
  const validationMessage = validateBidWindowBuilderSettings(settings);
  if (validationMessage) throw new Error(validationMessage);

  const scheduledAreas = settings.keepAreasConsistent ? ZLA_AREAS : [settings.area];
  const areaSchedules = scheduledAreas.map((area) => ({
    area,
    rows: activeRosterEntries(area).map((entry, index) => ({ person: rosterEntryToPerson(entry, index + 1), rounds: [] })),
  }));
  const largestAreaSchedule = areaSchedules.reduce((largest, schedule) => (
    !largest || schedule.rows.length > largest.rows.length ? schedule : largest
  ), null);
  if (!largestAreaSchedule?.rows.length) {
    throw new Error(settings.keepAreasConsistent
      ? "Add active bidding employees before building the all-area schedule."
      : `Add active bidding employees to ${settings.area} before building its schedule.`);
  }

  const openingMinutes = bidWindowBuilderMinutes(settings.opensAt);
  const closingMinutes = bidWindowBuilderMinutes(settings.closesAt);
  const blackouts = new Set(settings.blackoutDates);
  let roundStartDate = nextBidWindowBuilderOpenDate(settings.startDate, blackouts);
  let lastScheduledDate = roundStartDate;

  for (let round = 1; round <= BID_WINDOW_BUILDER_ROUND_COUNT; round += 1) {
    lastScheduledDate = roundStartDate;
    areaSchedules.forEach((schedule) => {
      let scheduleDate = roundStartDate;
      let startMinutes = openingMinutes;

      schedule.rows.forEach((row) => {
        if (startMinutes + settings.windowMinutes > closingMinutes) {
          scheduleDate = nextBidWindowBuilderOpenDate(addDaysToDateKey(scheduleDate), blackouts);
          startMinutes = openingMinutes;
        }

        row.rounds.push({
          round,
          date: scheduleDate,
          startMinutes,
        });
        startMinutes += settings.windowMinutes;
      });
      if (schedule.rows.length && scheduleDate > lastScheduledDate) lastScheduledDate = scheduleDate;
    });

    if (round < BID_WINDOW_BUILDER_ROUND_COUNT) {
      roundStartDate = addDaysToDateKey(lastScheduledDate);
      for (let reviewDay = 0; reviewDay < settings.reviewDays; reviewDay += 1) {
        roundStartDate = nextBidWindowBuilderOpenDate(roundStartDate, blackouts);
        roundStartDate = addDaysToDateKey(roundStartDate);
      }
      roundStartDate = nextBidWindowBuilderOpenDate(roundStartDate, blackouts);
    }
  }

  const scheduledRows = areaSchedules.flatMap((schedule) => schedule.rows);
  const firstWindow = scheduledRows.map((row) => row.rounds[0]).filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)[0];
  const lastWindow = scheduledRows.map((row) => row.rounds.at(-1)).filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date) || b.startMinutes - a.startMinutes)[0];

  return {
    settings,
    signature: bidWindowBuilderSignature(settings),
    areaSchedules,
    largestArea: largestAreaSchedule.area,
    totalBues: scheduledRows.length,
    firstWindow,
    lastWindow,
  };
}

function bidWindowBuilderWindowLabel(window) {
  return `${formatCalendarDate(window.date)} · ${bidWindowBuilderClock(window.startMinutes)}`;
}

function renderBidWindowBuilderBlackouts() {
  const target = document.querySelector("[data-bid-window-blackout-list]");
  if (!target) return;

  const dates = [...bidWindowBuilderBlackoutDates].sort();
  target.innerHTML = dates.length
    ? dates.map((key) => `
      <span class="bid-window-blackout-chip">
        ${escapeHtml(formatCalendarDate(key))}
        <button type="button" data-remove-bid-window-blackout="${escapeHtml(key)}" aria-label="Remove ${escapeHtml(formatCalendarDate(key))}" title="Remove blocked date">×</button>
      </span>
    `).join("")
    : '<span class="slot-capacity-no-changes">No dates are blocked.</span>';
}

function renderBidWindowBuilderPreview() {
  const target = document.querySelector("[data-bid-window-builder-preview]");
  const summary = document.querySelector("[data-bid-window-builder-summary]");
  if (!target || !summary) return;

  if (!bidWindowBuilderPreview) {
    summary.textContent = "Ready to build";
    target.innerHTML = "";
    return;
  }

  const { areaSchedules, largestArea, totalBues, firstWindow, lastWindow, settings } = bidWindowBuilderPreview;
  const windowCount = totalBues * BID_WINDOW_BUILDER_ROUND_COUNT;
  const scheduleHeading = settings.keepAreasConsistent ? "All Areas Schedule Preview" : `${settings.area} Schedule Preview`;
  summary.textContent = `${totalBues} BUEs · ${windowCount} windows`;
  target.innerHTML = `
    <div class="bid-window-builder-preview-header">
      <div>
        <h4>${escapeHtml(scheduleHeading)}</h4>
        <p>${escapeHtml(bidWindowBuilderWindowLabel(firstWindow))} through ${escapeHtml(bidWindowBuilderWindowLabel(lastWindow))}${settings.keepAreasConsistent ? ` · ${escapeHtml(largestArea)} sets the round spacing` : ""}</p>
      </div>
      <button class="primary-action small" type="button" data-save-bid-window-schedule ${bidWindowBuilderSaving ? "disabled" : ""}>${bidWindowBuilderSaving ? "Saving…" : "Save Schedule"}</button>
    </div>
    ${areaSchedules.map(({ area, rows }) => `
      <section class="bid-window-builder-area-preview">
        <h5>${escapeHtml(area)} · ${rows.length} BUE${rows.length === 1 ? "" : "s"}</h5>
        ${rows.length ? `
          <div class="bid-window-builder-table-wrap">
            <table class="bid-window-builder-table">
              <thead>
                <tr><th>#</th><th>Name</th><th>Bid As</th><th>Round 1</th><th>Round 2</th><th>Round 3</th><th>Round 4</th></tr>
              </thead>
              <tbody>
                ${rows.map((row) => `
                  <tr>
                    <td>${row.person.rank}</td>
                    <td><strong>${escapeHtml(personDisplayName(row.person))}</strong> · ${escapeHtml(row.person.initials)}</td>
                    <td>${escapeHtml(row.person.bidAs)}</td>
                    ${row.rounds.map((window) => `<td>${escapeHtml(bidWindowBuilderWindowLabel(window))}</td>`).join("")}
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : '<p class="slot-capacity-no-changes">No active bidding employees.</p>'}
      </section>
    `).join("")}
  `;
}

function syncBidWindowBuilder() {
  const areaInput = document.querySelector("[data-bid-window-builder-area]");
  const consistentInput = document.querySelector("[data-bid-window-builder-consistent]");
  const startInput = document.querySelector("[data-bid-window-builder-start]");
  const openInput = document.querySelector("[data-bid-window-builder-open]");
  const closeInput = document.querySelector("[data-bid-window-builder-close]");
  const lengthInput = document.querySelector("[data-bid-window-builder-length]");
  const gapInput = document.querySelector("[data-bid-window-builder-gap]");
  const blackoutInput = document.querySelector("[data-bid-window-builder-blackout]");
  if (!areaInput || !consistentInput || !startInput || !openInput || !closeInput || !lengthInput || !gapInput || !blackoutInput) return;

  if (!ZLA_AREAS.includes(areaInput.value)) areaInput.value = currentViewArea();
  areaInput.disabled = consistentInput.checked;
  if (!startInput.value) startInput.value = `${BID_YEAR - 1}-10-01`;
  startInput.min = `${BID_YEAR - 1}-01-01`;
  startInput.max = `${BID_YEAR}-12-31`;
  blackoutInput.min = startInput.min;
  blackoutInput.max = startInput.max;
  if (!openInput.value) openInput.value = "07:00";
  if (!closeInput.value) closeInput.value = "19:00";
  if (!lengthInput.value) lengthInput.value = "120";
  if (!gapInput.value) gapInput.value = "1";

  renderBidWindowBuilderBlackouts();
  renderBidWindowBuilderPreview();
}

function buildBidWindowPreviewFromForm(event) {
  event?.preventDefault();
  try {
    bidWindowBuilderPreview = generateBidWindowBuilderPreview(bidWindowBuilderSettings());
    renderBidWindowBuilderPreview();
    const { totalBues, settings } = bidWindowBuilderPreview;
    setBidWindowBuilderStatus(`${totalBues * BID_WINDOW_BUILDER_ROUND_COUNT} windows are ready to save for ${settings.keepAreasConsistent ? "all areas" : settings.area}. Review the schedule below.`, "success");
  } catch (error) {
    bidWindowBuilderPreview = null;
    renderBidWindowBuilderPreview();
    setBidWindowBuilderStatus(error.message || "The schedule could not be built.", "error");
  }
}

function addBidWindowBuilderBlackout() {
  const input = document.querySelector("[data-bid-window-builder-blackout]");
  const key = input?.value || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    setBidWindowBuilderStatus("Choose a date to block out.", "error");
    return;
  }

  bidWindowBuilderBlackoutDates.add(key);
  input.value = "";
  bidWindowBuilderPreview = null;
  renderBidWindowBuilderBlackouts();
  renderBidWindowBuilderPreview();
  setBidWindowBuilderStatus(`${formatCalendarDate(key)} will be skipped.`);
}

function removeBidWindowBuilderBlackout(key) {
  bidWindowBuilderBlackoutDates.delete(key);
  bidWindowBuilderPreview = null;
  renderBidWindowBuilderBlackouts();
  renderBidWindowBuilderPreview();
  setBidWindowBuilderStatus(`${formatCalendarDate(key)} is available for bidding again.`);
}

async function saveBidWindowBuilderSchedule() {
  if (!hasSystemAdminAccess() || bidWindowBuilderSaving) return;
  if (!bidWindowBuilderPreview) {
    setBidWindowBuilderStatus("Build and review the schedule before saving.", "error");
    return;
  }

  const currentSettings = bidWindowBuilderSettings();
  if (bidWindowBuilderPreview.signature !== bidWindowBuilderSignature(currentSettings)) {
    bidWindowBuilderPreview = null;
    renderBidWindowBuilderPreview();
    setBidWindowBuilderStatus("The settings changed. Build a new preview before saving.", "error");
    return;
  }

  const client = supabaseClient();
  if (!client || !supabaseState.connected) {
    setBidWindowBuilderStatus("Connect to Supabase before saving the schedule.", "error");
    return;
  }

  bidWindowBuilderSaving = true;
  renderBidWindowBuilderPreview();
  setBidWindowBuilderStatus("Saving the bid-window schedule…");

  const settings = bidWindowBuilderPreview.settings;
  const routine = settings.keepAreasConsistent
    ? "generate_consistent_bid_window_schedules"
    : "generate_bid_window_schedule";
  const parameters = {
    requested_bid_year: BID_YEAR,
    requested_start_date: settings.startDate,
    requested_office_opens: settings.opensAt,
    requested_office_closes: settings.closesAt,
    requested_window_minutes: settings.windowMinutes,
    requested_blackout_dates: settings.blackoutDates,
    requested_review_days: settings.reviewDays,
    requested_round_count: BID_WINDOW_BUILDER_ROUND_COUNT,
  };
  if (!settings.keepAreasConsistent) {
    parameters.requested_area_code = AREA_CODE_BY_NAME[settings.area] || settings.area;
  }

  const { data, error } = await client.rpc(routine, parameters);

  if (error) {
    bidWindowBuilderSaving = false;
    renderBidWindowBuilderPreview();
    setBidWindowBuilderStatus(
      isMissingSupabaseRoutine(error)
        ? `The Bid Window Builder database support is not installed yet. Run database/${settings.keepAreasConsistent ? "consistent_bid_window_builder" : "bid_window_builder"}.sql.`
        : error.message || "The bid-window schedule could not be saved.",
      "error"
    );
    return;
  }

  await loadSupabaseReferenceData();
  bidWindowBuilderSaving = false;
  renderApp();
  setBidWindowBuilderStatus(
    `${data?.windows_processed || bidWindowBuilderPreview.totalBues * BID_WINDOW_BUILDER_ROUND_COUNT} bid windows saved for ${settings.keepAreasConsistent ? "all areas" : settings.area}.`,
    "success"
  );
}

function renderAdminConsole() {
  syncIntakeTeamControls();
  syncSlotCapacityForm();
  renderSlotCapacitySummary();
  syncBidWindowBuilder();
  renderRosterManager();

  const target = document.querySelector("[data-admin-user-list]");
  if (!target) return;

  const teamPeople = intakeTeamMembers();

  target.innerHTML = `
    <section class="intake-team-builder">
      <div class="intake-team-add">
        <div class="intake-team-candidate-picker">
          <label>
            Add BUE to Intake Team
            <input type="search" placeholder="Name, initials, area, rank, role, or email" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="intake-team-candidate-results" data-intake-team-candidate-search />
          </label>
          <small data-intake-team-candidate-status role="status" aria-live="polite"></small>
          <div class="intake-team-candidate-results" id="intake-team-candidate-results" role="listbox" aria-label="Matching employees" data-intake-team-candidate-results hidden></div>
        </div>
        <button class="primary-action small" type="button" data-add-intake-team-member disabled>Add to Team</button>
      </div>
      <p class="form-status" data-intake-team-status role="status" aria-live="polite"></p>
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

let biddingBackupBusy = false;

function renderAdminToolsPage() {
  if (!hasSystemAdminAccess()) return;
  void loadBiddingBackups();
  renderRuleEditors();
  renderEmailLog();
  syncBidWindowTestingControls();
  syncPilotControls();
}

function setSlotCapacityStatus(message, status = "info") {
  showActionFeedback(message, status);
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
  if (!supabaseState.connected || !client) {
    setSlotCapacityStatus("Daily capacity could not reach the database. Check the connection and try again.", "error");
    return;
  }

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

  supabaseState.placeholdersCleared = false;
  await loadSupabaseReferenceData();
  logHistory(area, "Leave capacity range updated", `${currentUser.initials} set ${formatCalendarDate(startKey)} through ${formatCalendarDate(endKey)} to ${cpc} CPC and ${dev} DEV slots per day.`);
  renderApp();
  setSlotCapacityStatus(`${range.keys.length} ${range.keys.length === 1 ? "day" : "days"} saved for ${area}: ${cpc} CPC and ${dev} DEV slots per day.`, "success");
}

async function saveIntakeScheduleToSupabase(initials, start, end, scheduleId = "") {
  const client = supabaseClient();
  if (!client || !supabaseState.connected) {
    throw new Error("The intake schedule could not reach the database. Check the connection and try again.");
  }
  if (!await ensureIntakeScheduleSession(client)) return false;
  const routine = scheduleId ? "update_intake_schedule" : "create_intake_schedule";
  const parameters = {
    requested_bid_year: BID_YEAR,
    requested_initials: initials,
    requested_starts_at: start.toISOString(),
    requested_ends_at: end.toISOString(),
    requested_scope: INTAKE_SCHEDULE_AREA,
  };
  if (scheduleId) parameters.requested_schedule_id = scheduleId;

  const { error } = await client.rpc(routine, parameters);
  if (error) throw error;
  supabaseState.placeholdersCleared = false;
  await loadSupabaseReferenceData();
  return true;
}

async function ensureIntakeScheduleSession(client) {
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError || !sessionData.session) {
    currentUser = null;
    clearSupabaseAccountState();
    showPublicHome();
    setAuthStatus("Your sign-in ended. Sign in again to manage intake shifts.", "error");
    return false;
  }

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user || userData.user.id !== sessionData.session.user.id) {
    setScheduleFormStatus("Could not verify your sign-in. Check the connection or sign in again.", "error");
    return false;
  }

  syncSupabaseAccountStateFromSession(sessionData.session);
  return true;
}

function setIntakeScheduleMutationPending(isPending) {
  intakeScheduleMutationPending = isPending;
  document.querySelectorAll("[data-add-intake-schedule], [data-edit-intake-schedule], [data-delete-intake-schedule], [data-cancel-intake-schedule-edit]").forEach((button) => {
    button.disabled = isPending;
  });
}

function syncIntakeScheduleEditorControls() {
  const saveButton = document.querySelector("[data-add-intake-schedule]");
  const cancelButton = document.querySelector("[data-cancel-intake-schedule-edit]");
  if (saveButton) {
    saveButton.textContent = editingIntakeScheduleId ? "Update Intake Shift" : "Add Intake Shift";
    saveButton.disabled = intakeScheduleMutationPending;
  }
  if (cancelButton) {
    cancelButton.hidden = !editingIntakeScheduleId;
    cancelButton.disabled = intakeScheduleMutationPending;
  }
}

function resetIntakeScheduleEditor(options = {}) {
  editingIntakeScheduleId = "";
  const form = document.querySelector("[data-schedule-start]")?.closest(".schedule-form");
  if (options.resetValues && form) {
    form.querySelector("[data-intake-shift-time]").value = "";
    form.querySelector("[data-intake-shift-duration]").value = "";
    syncIntakeShiftForm(form);
  }
  syncIntakeScheduleEditorControls();
}

function beginIntakeScheduleEdit(scheduleId) {
  if (intakeScheduleMutationPending) return;
  const schedule = intakeSchedules.find((entry) => entry.id === scheduleId);
  const form = document.querySelector("[data-schedule-start]")?.closest(".schedule-form");
  if (!schedule || !form) {
    setScheduleFormStatus("That intake shift is no longer available. Refresh and try again.", "error");
    return;
  }

  editingIntakeScheduleId = schedule.id;
  form.querySelector("[data-schedule-rep]").value = schedule.initials;
  const localStart = formatDateTimeLocalValue(schedule.start);
  form.querySelector("[data-intake-shift-date]").value = localStart.slice(0, 10);
  form.querySelector("[data-intake-shift-time]").value = localStart.slice(11, 16);
  const durationHours = (schedule.end.getTime() - schedule.start.getTime()) / (60 * 60 * 1000);
  form.querySelector("[data-intake-shift-duration]").value = String(Math.round(durationHours * 100) / 100);
  syncIntakeShiftForm(form);
  syncIntakeScheduleEditorControls();
  setScheduleFormStatus(`Editing ${schedule.name}'s ${formatDateRange(schedule.start, schedule.end)} shift.`);
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function deleteIntakeSchedule(scheduleId) {
  if (intakeScheduleMutationPending) return;
  if (!hasIntakeAccess()) {
    setScheduleFormStatus("Only active intake/admin users can delete intake shifts.", "error");
    return;
  }

  const schedule = intakeSchedules.find((entry) => entry.id === scheduleId);
  if (!schedule) {
    setScheduleFormStatus("That intake shift is no longer available. Refresh and try again.", "error");
    return;
  }
  if (!window.confirm(`Delete ${schedule.name}'s intake shift on ${formatDateRange(schedule.start, schedule.end)}?`)) return;

  const client = supabaseClient();
  if (!client || !supabaseState.connected) {
    setScheduleFormStatus("The intake schedule could not reach the database. Check the connection and try again.", "error");
    return;
  }
  if (!await ensureIntakeScheduleSession(client)) return;

  setIntakeScheduleMutationPending(true);
  setScheduleFormStatus(`Deleting ${schedule.name}'s intake shift...`);
  try {
    const { error } = await client.rpc("delete_intake_schedule", {
      requested_bid_year: BID_YEAR,
      requested_schedule_id: schedule.id,
    });
    if (error) throw error;
    supabaseState.placeholdersCleared = false;
    await loadSupabaseReferenceData();
    if (editingIntakeScheduleId === schedule.id) resetIntakeScheduleEditor({ resetValues: true });
    logHistory(schedule.area, "Intake shift deleted", `${currentUser.initials} deleted ${schedule.name}'s ${formatDateRange(schedule.start, schedule.end)} intake shift.`);
    renderApp();
    setPage("intake-schedule");
    setScheduleFormStatus(`${schedule.name}'s intake shift was deleted from Supabase.`, "success");
  } catch (error) {
    setScheduleFormStatus(
      isMissingSupabaseRoutine(error)
        ? "Shift editing has not been installed in Supabase yet."
        : error.message || "The intake shift could not be deleted.",
      "error"
    );
  } finally {
    setIntakeScheduleMutationPending(false);
    syncIntakeScheduleEditorControls();
  }
}

function schedulesForDateKey(key) {
  return intakeSchedules
    .filter((schedule) => dateKeyFromDate(schedule.start) === key)
    .sort((a, b) => {
      const startDifference = a.start.getTime() - b.start.getTime();
      if (startDifference !== 0) return startDifference;
      return (a.name || a.initials).localeCompare(b.name || b.initials);
    });
}

function renderScheduleTooltip(key) {
  const schedules = schedulesForDateKey(key);
  if (!schedules.length) return "";
  return `
    <span class="schedule-tooltip" role="tooltip" aria-label="Intake representatives scheduled for ${formatCalendarDate(key)}">
      <strong>${formatCalendarDate(key)}</strong>
      <span class="schedule-tooltip-list">
        ${schedules.map((schedule) => `
          <span class="schedule-tooltip-row">
            <time datetime="${schedule.start.toISOString()}">${escapeHtml(formatScheduleStartTime(schedule.start))}</time>
            <span class="schedule-tooltip-rep">
              <b>${escapeHtml(schedule.name || schedule.initials)}</b>
              <small>${escapeHtml(schedule.initials)} · until ${escapeHtml(formatScheduleStartTime(schedule.end))}</small>
            </span>
          </span>
        `).join("")}
      </span>
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
        <span class="schedule-day-assignment ${schedule.initials === currentUser?.initials ? "mine" : ""}">
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
  const markKind = intakeCalendarMarks.get(key);
  const markLabel = INTAKE_CALENDAR_MARK_LABELS[markKind] || "";
  const hasUserSchedule = schedules.some((schedule) => schedule.initials === currentUser.initials);
  const label = includeMonth ? `${monthNames[date.getMonth()].slice(0, 3)} ${date.getDate()}` : date.getDate();
  const showAssignments = Boolean(options.showAssignments);
  return `
    <button class="schedule-day ${showAssignments ? "show-assignments" : ""} ${schedules.length ? "has-schedule" : ""} ${hasUserSchedule ? "my-schedule-day" : ""} ${markKind ? `intake-mark-${markKind}` : ""}" type="button" data-intake-calendar-date="${key}" aria-label="${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}: ${markLabel ? `${markLabel}; ` : ""}${schedules.length ? "intake scheduled" : "no intake scheduled"}">
      <span class="date-number">${label}</span>
      ${markLabel && showAssignments ? `<span class="intake-day-mark-label">${markLabel}</span>` : ""}
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

    if (scheduleCalendarView === "two-month") {
      const nextMonth = new Date(scheduleActiveDate.getFullYear(), scheduleActiveDate.getMonth() + 1, 1);
      label.textContent = `${monthNames[scheduleActiveDate.getMonth()]} ${scheduleActiveDate.getFullYear()} – ${monthNames[nextMonth.getMonth()]} ${nextMonth.getFullYear()}`;
      return;
    }

    label.textContent = `${monthNames[scheduleActiveDate.getMonth()]} ${scheduleActiveDate.getFullYear()}`;
  });
}

function renderIntakeCalendarMarkEditor() {
  const panel = document.querySelector("[data-intake-calendar-mark-editor]");
  if (!panel) return;
  panel.hidden = !hasSystemAdminAccess();
  if (panel.hidden) return;

  const dateInput = panel.querySelector("[data-intake-calendar-mark-date]");
  const kindInput = panel.querySelector("[data-intake-calendar-mark-kind]");
  const currentKind = intakeCalendarMarks.get(dateInput?.value);
  if (currentKind && kindInput && kindInput.dataset.selectedDate !== dateInput.value) {
    kindInput.value = currentKind;
  }
  if (kindInput) kindInput.dataset.selectedDate = dateInput?.value || "";
  const clearButton = panel.querySelector("[data-clear-intake-calendar-mark]");
  if (clearButton) clearButton.hidden = !currentKind;

  const list = panel.querySelector("[data-intake-calendar-mark-list]");
  if (!list) return;
  list.innerHTML = [...intakeCalendarMarks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, kind]) => `<button type="button" class="intake-calendar-mark-item ${kind}" data-edit-intake-calendar-mark="${date}"><span>${escapeHtml(formatCalendarDate(date))}</span><strong>${INTAKE_CALENDAR_MARK_LABELS[kind]}</strong></button>`)
    .join("");
}

function selectIntakeCalendarMarkDate(date) {
  const input = document.querySelector("[data-intake-calendar-mark-date]");
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  input.value = date;
  const kindInput = document.querySelector("[data-intake-calendar-mark-kind]");
  if (kindInput) kindInput.dataset.selectedDate = "";
  renderIntakeCalendarMarkEditor();
  input.focus();
}

function setIntakeCalendarMarkStatus(message, status = "info") {
  showActionFeedback(message, status);
  const target = document.querySelector("[data-intake-calendar-mark-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

async function saveIntakeCalendarMark(event) {
  event.preventDefault();
  if (!hasSystemAdminAccess()) return;
  const date = document.querySelector("[data-intake-calendar-mark-date]")?.value || "";
  const kind = document.querySelector("[data-intake-calendar-mark-kind]")?.value || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !INTAKE_CALENDAR_MARK_LABELS[kind]) {
    setIntakeCalendarMarkStatus("Choose a date and day type.", "error");
    return;
  }
  const client = supabaseClient();
  if (!client || !supabaseState.connected || !await ensureIntakeScheduleSession(client)) return;
  const button = document.querySelector("[data-save-intake-calendar-mark]");
  if (button) button.disabled = true;
  try {
    const { error } = await client.from("intake_calendar_marks")
      .upsert({ bid_year: BID_YEAR, marked_date: date, kind }, { onConflict: "bid_year,marked_date" });
    if (error) throw error;
    intakeCalendarMarks.set(date, kind);
    renderIntakeSchedule();
    setIntakeCalendarMarkStatus(`${formatCalendarDate(date)} marked as ${INTAKE_CALENDAR_MARK_LABELS[kind]}.`, "success");
  } catch (error) {
    setIntakeCalendarMarkStatus(error.message || "The day could not be saved.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function clearIntakeCalendarMark() {
  if (!hasSystemAdminAccess()) return;
  const date = document.querySelector("[data-intake-calendar-mark-date]")?.value || "";
  if (!intakeCalendarMarks.has(date)) return;
  const client = supabaseClient();
  if (!client || !supabaseState.connected || !await ensureIntakeScheduleSession(client)) return;
  const button = document.querySelector("[data-clear-intake-calendar-mark]");
  if (button) button.disabled = true;
  try {
    const { error } = await client.from("intake_calendar_marks")
      .delete().eq("bid_year", BID_YEAR).eq("marked_date", date);
    if (error) throw error;
    intakeCalendarMarks.delete(date);
    renderIntakeSchedule();
    setIntakeCalendarMarkStatus(`${formatCalendarDate(date)} cleared.`, "success");
  } catch (error) {
    setIntakeCalendarMarkStatus(error.message || "The day could not be cleared.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

function moveSchedulePeriod(direction) {
  const nextDate = new Date(scheduleActiveDate);
  if (scheduleCalendarView === "year") {
    nextDate.setFullYear(nextDate.getFullYear() + direction);
  } else if (scheduleCalendarView === "week") {
    nextDate.setDate(nextDate.getDate() + direction * 7);
  } else {
    nextDate.setDate(1);
    nextDate.setMonth(nextDate.getMonth() + direction);
  }
  scheduleActiveDate = nextDate;
  renderIntakeSchedule();
}

function renderIntakeSchedule() {
  const calendar = document.getElementById("intake-schedule-calendar");
  const list = document.querySelector("[data-intake-schedule-list]");
  syncScheduleFormDefaults();
  renderShiftPresets();
  syncIntakeTeamControls();
  updateScheduleCalendarControls();

  if (calendar) {
    calendar.classList.remove("month-view", "two-month-view", "week-view", "year-view");
    calendar.classList.add(`${scheduleCalendarView}-view`);
    if (scheduleCalendarView === "year") {
      calendar.innerHTML = monthNames
        .map((_, monthIndex) => renderScheduleMonthCard(monthIndex, scheduleActiveDate.getFullYear()))
        .join("");
    } else if (scheduleCalendarView === "week") {
      calendar.innerHTML = renderScheduleWeekCard(scheduleActiveDate);
    } else {
      const monthCount = scheduleCalendarView === "two-month" ? 2 : 1;
      const visibleMonths = Array.from({ length: monthCount }, (_, offset) => new Date(
        scheduleActiveDate.getFullYear(),
        scheduleActiveDate.getMonth() + offset,
        1
      ));
      calendar.innerHTML = visibleMonths.map((month) => renderScheduleMonthCard(month.getMonth(), month.getFullYear(), {
        showAssignments: true,
        showYear: true,
      }))
        .join("");
    }
  }

  if (!list) return;

  const adminCard = document.querySelector("[data-admin-schedule-card]");
  if (adminCard) adminCard.hidden = !hasIntakeAccess();
  renderIntakeCalendarMarkEditor();

  const sortedSchedules = [...intakeSchedules].sort((a, b) => a.start - b.start);
  const userSchedules = sortedSchedules.filter((schedule) => schedule.initials === currentUser.initials);
  if (editingIntakeScheduleId && !sortedSchedules.some((schedule) => schedule.id === editingIntakeScheduleId)) {
    resetIntakeScheduleEditor();
  }
  syncIntakeScheduleEditorControls();
  if (supabaseState.intakeSchedulesError) {
    list.innerHTML = '<p class="empty-state small">Intake assignments could not be loaded from Supabase. Refresh the page and try again.</p>';
    return;
  }
  list.innerHTML = `
    <div class="schedule-list-section">
      <div class="schedule-list-heading">
        <h3>Your Intake Assignments</h3>
        ${userSchedules.length ? '<button class="secondary-action small" type="button" data-download-intake-schedule aria-label="Download all your intake assignments as a calendar file">Download all .ics</button>' : ""}
      </div>
      ${userSchedules.length
        ? userSchedules.map((schedule) => `
          <article>
            <strong>${escapeHtml(formatDateRange(schedule.start, schedule.end))}</strong>
            <span>${escapeHtml(schedule.area)}</span>
            <div class="schedule-list-actions">
              <button class="secondary-action small" type="button" data-download-intake-schedule="${escapeHtml(schedule.id)}" aria-label="Download intake assignment for ${escapeHtml(formatCalendarDate(dateKeyFromDate(schedule.start)))} as a calendar file">Download .ics</button>
            </div>
          </article>
        `).join("")
        : '<p class="empty-state small">No intake shifts assigned for this bidding year.</p>'}
    </div>
    <div class="schedule-list-section">
      <h3>All Intake Coverage</h3>
      ${sortedSchedules.length ? sortedSchedules.map((schedule) => `
        <article class="${schedule.initials === currentUser.initials ? "mine" : ""}">
          <strong>${escapeHtml(schedule.name)} · ${escapeHtml(schedule.initials)}</strong>
          <span>${escapeHtml(formatDateRange(schedule.start, schedule.end))} · ${escapeHtml(schedule.area)}</span>
          <div class="schedule-list-actions">
            <button class="secondary-action small" type="button" data-edit-intake-schedule="${escapeHtml(schedule.id)}">Edit</button>
            <button class="secondary-action small danger-action" type="button" data-delete-intake-schedule="${escapeHtml(schedule.id)}">Delete</button>
          </div>
        </article>
      `).join("") : '<p class="empty-state small">No intake coverage has been scheduled for this bidding year.</p>'}
    </div>
  `;
}

function syncScheduleFormDefaults() {
  syncIntakeShiftForm(document.querySelector("[data-schedule-start]")?.closest(".schedule-form"));
  syncIntakeScheduleEditorControls();
}

function setScheduleFormStatus(message, status = "info") {
  showActionFeedback(message, status);
  const target = document.querySelector("[data-schedule-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

async function addIntakeScheduleFromForm() {
  if (intakeScheduleMutationPending) return;
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

  const scheduleId = editingIntakeScheduleId;
  const actionLabel = scheduleId ? "Updating" : "Saving";
  setIntakeScheduleMutationPending(true);
  setScheduleFormStatus(`${actionLabel} ${name}'s intake shift...`);
  try {
    if (!await saveIntakeScheduleToSupabase(initials, start, end, scheduleId)) return;
    logHistory(area, scheduleId ? "Intake shift updated" : "Intake shift assigned", `${currentUser.initials} ${scheduleId ? "updated" : "scheduled"} ${name} (${initials}) for ${formatDateRange(start, end)} · ${area}.`);
    resetIntakeScheduleEditor({ resetValues: true });
    renderApp();
    setPage("intake-schedule");
    setScheduleFormStatus(`${name}'s intake shift was ${scheduleId ? "updated" : "scheduled"} in Supabase for ${formatDateRange(start, end)}. Access starts 60 minutes before the shift.`, "success");
  } catch (error) {
    setScheduleFormStatus(
      scheduleId && isMissingSupabaseRoutine(error)
        ? "Shift editing has not been installed in Supabase yet."
        : error.message || "The intake shift could not be saved.",
      "error"
    );
  } finally {
    setIntakeScheduleMutationPending(false);
    syncIntakeScheduleEditorControls();
  }
}

function seniorityCardMarkup(people = seniority) {
  return people
    .map((person) => {
      const isBiddingNow = Boolean(person.openRound);
      const isCurrentUser = personMatchesCurrentUser(person);
      return `
      <article class="seniority-card ${isBiddingNow ? "active bidding-now" : person.status === "active" ? "active" : ""}"${isCurrentUser ? ' data-seniority-current tabindex="-1"' : ""}>
        <div class="seniority-card-head">
          <span>#${person.rank}</span>
        </div>
        <div class="seniority-card-name">
          <strong>${isCurrentUser ? `${person.firstName} ${person.lastName} · ${person.initials} · You` : `${person.firstName} ${person.lastName}`}</strong>
          ${bidTimeCurrentBidderDot(person)}
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

function seniorityTableMarkup(people = seniority) {
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
        ${people.map((person) => {
          const isBiddingNow = Boolean(person.openRound);
          const isCurrentUser = personMatchesCurrentUser(person);
          return `
            <tr class="${isCurrentUser ? "current-user-row" : ""} ${isBiddingNow ? "active-bidder-row" : ""}"${isCurrentUser ? ' data-seniority-current tabindex="-1"' : ""}>
              <td>${person.rank}</td>
              <td>
                <div class="seniority-table-person">
                  <span class="seniority-table-name">
                    ${escapeHtml(`${person.firstName} ${person.lastName}`)}${isCurrentUser ? " · You" : ""}
                    ${bidTimeCurrentBidderDot(person)}
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

  const normalizedQuery = senioritySearchQuery.trim().toLowerCase();
  const visiblePeople = normalizedQuery
    ? seniority.filter((person) => `${person.rank} ${person.firstName} ${person.lastName} ${person.initials} ${person.bidAs}`.toLowerCase().includes(normalizedQuery))
    : seniority;
  const currentPerson = seniority.find(personMatchesCurrentUser);
  const searchInput = document.querySelector("[data-seniority-search]");
  if (searchInput && searchInput.value !== senioritySearchQuery) searchInput.value = senioritySearchQuery;
  const jumpButton = document.querySelector("[data-seniority-jump-current]");
  if (jumpButton) {
    jumpButton.disabled = !currentPerson;
    jumpButton.title = currentPerson ? `Go to ${currentPerson.firstName} ${currentPerson.lastName}` : "Your account is not in this area's seniority list.";
  }
  setText(
    "[data-seniority-search-status]",
    normalizedQuery
      ? `${visiblePeople.length} ${visiblePeople.length === 1 ? "bidder" : "bidders"} found`
      : `${seniority.length} bidders shown`
  );

  cardTarget.innerHTML = visiblePeople.length
    ? seniorityCardMarkup(visiblePeople)
    : '<div class="empty-state seniority-empty-state">No bidders match this search.</div>';
  tableTarget.innerHTML = isListView
    ? visiblePeople.length
      ? seniorityTableMarkup(visiblePeople)
      : '<div class="empty-state seniority-empty-state">No bidders match this search.</div>'
    : "";
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
          <small class="audit-actor">Action by: ${actor}</small>
        </div>
        <span class="pill open">${area}</span>
      </article>
    `)
    .join("");
}

// Realtime events invalidate small groups; slower fallback checks repair missed events.
const liveDataTables = {
  roster: ["bidders", "areas"],
  bidding: ["rdo_lines", "rdo_line_days", "intake_submissions", "leave_requests", "leave_request_dates", "leave_request_week_buckets", "leave_credit_events"],
  slots: ["leave_slots", "leave_slot_capacities"],
  windows: ["bid_windows"],
  schedules: ["intake_schedules", "intake_calendar_marks", "intake_shift_presets"],
  rules: ["bid_year_settings", "bid_rounds", "bidder_bid_year_settings", "bid_years", "holidays"],
  faq: ["faq_entries", "mou_documents"],
  help: ["help_threads", "help_messages"],
};
let liveDataTimer = null;
let liveDataRunning = false;
let liveDataGeneration = 0;
let liveDataActivityRevision = 0;
let liveDataWritesPending = 0;
const liveDataDirtyGroups = new Set();
const liveDataSnapshots = new Map();
const liveDataLastReadAt = new Map();

function liveDataFallbackGroups(now = Date.now()) {
  return Object.keys(liveDataTables).filter((group) => {
    const interval = group === "schedules" ? 300000
      : ["roster", "rules", "faq"].includes(group) ? 600000 : 60000;
    return now - (liveDataLastReadAt.get(group) || 0) >= interval;
  });
}

async function fetchWithLiveUpdateTracking(input, init) {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  const method = String(init?.method || input?.method || "GET").toUpperCase();
  const routine = url.pathname.split("/rpc/")[1];
  const writing = url.pathname.includes("/rest/v1/") && !["GET", "HEAD"].includes(method)
    && !(routine && (routine.startsWith("read_") || routine === "live_help_threads"));
  if (!writing) return window.fetch(input, init);
  liveDataWritesPending += 1;
  liveDataActivityRevision += 1;
  try {
    return await window.fetch(input, init);
  } finally {
    liveDataWritesPending -= 1;
    liveDataActivityRevision += 1;
    scheduleLiveDataRefresh();
  }
}

function hasActiveLiveDataEditing() {
  return hasActiveIntakeEditing() || intakeDecisionPending || intakeDecisionRefreshRunning
    || intakeScheduleMutationPending || shiftPresetMutationPending || leaveManagementPendingId
    || intakeLeaveRemovalPendingId || pilotBidderResetPending || biddingBackupBusy
    || liveDataWritesPending > 0
    || Boolean(document.querySelector('[role="dialog"]:not([hidden]), [data-bid-change-modal]:not([hidden]), [data-leave-slot-modal]:not([hidden])'));
}

function liveDataLocalSnapshot() {
  return JSON.stringify([supabaseState.loadedAt, rdoLines, leaveBids, intakeQueue, senioritySource,
    databaseBidWindows.size, intakeSchedules, publicFaqContent]);
}

function scheduleLiveDataRefresh(groups = Object.keys(liveDataTables), delay = 750) {
  const publicPilot = window.NATCA_SUPABASE_CONFIG?.environment === "pilot" && !isMemberAppVisible();
  groups.filter((group) => !publicPilot || group === "slots").forEach((group) => liveDataDirtyGroups.add(group));
  clearTimeout(liveDataTimer);
  liveDataTimer = setTimeout(() => {
    liveDataTimer = null;
    void refreshLiveData();
  }, delay);
}

function stopLiveDataUpdates() {
  liveDataGeneration += 1;
  clearTimeout(liveDataTimer);
  liveDataTimer = null;
  liveDataDirtyGroups.clear();
  liveDataSnapshots.clear();
  liveDataLastReadAt.clear();
}

async function readLiveDataGroup(group, client, areaById, member) {
  const empty = () => Promise.resolve({ data: [], error: null });
  const read = (label, request) => readReferenceData(label, request);
  let results;
  let apply;
  if (group === "help") {
    const requester = member ? currentHelpRequester() : null;
    results = [await read("live help", () => member ? client.rpc("live_help_threads", {
      help_bid_year: BID_YEAR, help_session_id: requester.sessionId || liveHelpSessionId(),
    }) : empty())];
    apply = () => { if (member) helpThreads = (results[0].data || []).map(helpThreadFromRpc); };
  } else if (group === "roster") {
    results = [await read("live roster", () => client.rpc("read_bidding_roster"))];
    apply = () => applyRosterFromDatabase(results[0].data || [], areaById);
  } else if (group === "bidding") {
    results = await Promise.all([
      read("live RDO lines", () => loadRdoLines(client, supabaseState.bidYearId)),
      read("live GL assignments", () => loadPublishedGlRdoAssignments(client)),
      read("live bidding state", () => member ? client.rpc("read_bidding_state", { requested_bid_year: BID_YEAR }) : empty()),
      read("live leave requests", () => member ? client.rpc("read_leave_intake_queue", { queue_bid_year: BID_YEAR }) : empty()),
    ]);
    if (results.some((result) => result.error)) return { results };
    const submissions = results[2].data?.submissions || [];
    const leaveRows = member ? attachSubmissionIdsToLeaveRequests(
      await attachLeaveRequestWeekBuckets(client, results[3].data || []), submissions
    ) : [];
    apply = () => {
      // Replace deleted/renamed lines as well as updating existing lines.
      rdoLines.splice(0, rdoLines.length);
      upsertRdoLinesFromDatabase(results[0].data || [], areaById);
      applyGlRdoAssignments(supabaseRows(results[1]));
      if (member) {
        intakeQueue = intakeQueue.filter((item) => !item.supabaseSubmissionId && !item.supabaseRequestId);
        for (let index = leaveBids.length - 1; index >= 0; index--) {
          if (leaveBids[index].supabaseRequestId) leaveBids.splice(index, 1);
        }
        upsertRdoSubmissionsFromDatabase(submissions.filter((row) => biddingStateSubmissionType(row) === "RDO Line"
          && ["pending", "approved", "denied"].includes(String(row.status || "").toLowerCase())), areaById);
        upsertLeaveRequestsFromDatabase(leaveRows, areaById);
        lastAlertDatabaseSnapshot = "";
        intakeBidderSelection.record = null;
        intakeBidderSelection.generation += 1;
      }
    };
    // Bucket attachments are part of the comparison, not only the base requests.
    results = [...results, { data: leaveRows, error: null }];
  } else if (group === "slots") {
    results = [await read("live leave slots", () => loadPublishedLeaveSlots(client))];
    apply = () => applyLeaveSlotScheduleFromDatabase(supabaseRows(results[0]), areaById);
  } else if (group === "windows") {
    results = [await read("live bid windows", () => loadPublishedBidWindows(client, supabaseState.bidYearId))];
    apply = () => applyBidWindowsFromDatabase(supabaseRows(results[0]));
  } else if (group === "schedules") {
    results = await Promise.all([
      read("live intake schedules", () => loadIntakeSchedules(client)),
      read("live calendar marks", () => member ? client.from("intake_calendar_marks").select("marked_date,kind").eq("bid_year", BID_YEAR) : empty()),
      read("live shift presets", () => member && hasIntakeAccess() ? client.rpc("read_intake_shift_presets") : empty()),
    ]);
    apply = () => {
      applyIntakeSchedulesFromDatabase(results[0].data || [], areaById);
      if (member) {
        intakeCalendarMarks.clear();
        (results[1].data || []).forEach((row) => intakeCalendarMarks.set(row.marked_date, row.kind));
        if (hasIntakeAccess()) applyIntakeShiftPresets(results[2].data);
      }
    };
  } else if (group === "rules") {
    results = await Promise.all([
      read("live year settings", () => client.rpc("read_bid_year_settings", { requested_bid_year: BID_YEAR })),
      read("live round rules", () => client.rpc("read_round_rules", { requested_bid_year: BID_YEAR })),
      read("live approval rules", () => client.rpc("read_approval_rules", { requested_bid_year: BID_YEAR })),
      read("live ghost status", () => member ? client.rpc("read_ghost_bidding_status", { requested_bid_year: BID_YEAR }) : empty()),
      read("live holidays", () => client.from("holidays").select("holiday_date,name,is_observed").eq("bid_year_id", supabaseState.bidYearId)),
    ]);
    apply = () => {
      applyBidYearSettings(Array.isArray(results[0].data) ? results[0].data[0] : results[0].data);
      if (results[1].data) applyRoundRules(results[1].data);
      if (results[2].data !== null) applyApprovalRules(results[2].data);
      if (member) applyGhostBiddingStatus(results[3].data || []);
      holidayOverrides.clear();
      supabaseRows(results[4]).forEach((row) => { if (row.holiday_date) holidayOverrides.add(row.holiday_date); });
    };
  } else if (group === "faq") {
    results = await Promise.all([
      read("live FAQ", () => client.from("faq_entries").select("question,answer,display_order").eq("published", true).order("display_order").order("created_at")),
      read("live MOU documents", () => client.from("mou_documents").select("title,description,file_url,display_order").eq("published", true).order("display_order").order("created_at")),
    ]);
    apply = () => {
      publicFaqContent.entries = results[0].data || [];
      publicFaqContent.documents = results[1].data || [];
    };
  }
  return { results, apply };
}

// Keep unsaved values in static forms and filter controls when a section redraws.
// Manual entry and profile editors are deferred altogether by the editing guard.
function liveDataControlKey(control) {
  if (control.id) return `id:${control.id}`;
  const data = [...control.attributes].filter((attribute) => attribute.name.startsWith("data-"))
    .map((attribute) => [attribute.name, attribute.value]);
  if (!data.length && !control.name) return "";
  return JSON.stringify([control.tagName, control.name, data]);
}

function captureLiveDataControls() {
  const controls = new Map();
  for (const control of document.querySelectorAll("input, textarea, select")) {
    if (control.type === "password" || control.type === "file" || control.type === "hidden") continue;
    const key = liveDataControlKey(control);
    if (key) controls.set(key, { value: control.value, checked: control.checked });
  }
  return controls;
}

function restoreLiveDataControls(controls) {
  for (const control of document.querySelectorAll("input, textarea, select")) {
    const saved = controls.get(liveDataControlKey(control));
    if (!saved) continue;
    if (control.tagName !== "SELECT" || [...control.options].some((option) => option.value === saved.value)) {
      control.value = saved.value;
    }
    if (["checkbox", "radio"].includes(control.type)) control.checked = saved.checked;
  }
}

async function refreshLiveData() {
  if (liveDataRunning || !liveDataDirtyGroups.size || document.visibilityState !== "visible") return;
  const publicPilot = window.NATCA_SUPABASE_CONFIG?.environment === "pilot" && !isMemberAppVisible();
  const ready = publicPilot ? supabaseState.referenceDataLoaded : supabaseState.connected && supabaseState.bidYearId;
  if (!ready || supabaseState.loading || hasActiveLiveDataEditing()) {
    if (ready) scheduleLiveDataRefresh([], 1000);
    return;
  }
  const client = supabaseClient();
  if (!client) return;
  const generation = liveDataGeneration;
  const activity = liveDataActivityRevision;
  const year = BID_YEAR;
  const userId = supabaseState.authUserId;
  const member = isMemberAppVisible();
  const before = liveDataLocalSnapshot();
  const groups = [...liveDataDirtyGroups];
  groups.forEach((group) => liveDataDirtyGroups.delete(group));
  liveDataRunning = true;
  try {
    const areas = publicPilot ? { data: [], error: null }
      : await readReferenceData("live areas", () => client.from("areas").select("id,name"));
    if (areas.error) throw areas.error;
    const areaById = new Map((areas.data || []).map((area) => [area.id, area.name]));
    const updates = await Promise.all(groups.map((group) => readLiveDataGroup(group, client, areaById, member)));
    if (generation !== liveDataGeneration || year !== BID_YEAR || userId !== supabaseState.authUserId
      || member !== isMemberAppVisible()) return;
    // Never apply a read overtaken by editing, a local save, or a foreground load.
    if (activity !== liveDataActivityRevision || supabaseState.loading || hasActiveLiveDataEditing()
      || before !== liveDataLocalSnapshot()) {
      scheduleLiveDataRefresh(groups, 1000);
      return;
    }
    const changed = new Set();
    const previousSlots = JSON.stringify(extraLeaveSlotData);
    updates.forEach((update, index) => {
      if (!update.apply || update.results.some((result) => result.error)) {
        liveDataDirtyGroups.add(groups[index]);
        return;
      }
      const snapshot = JSON.stringify([year, userId, areas.data, update.results.map((result) => result.data)]);
      liveDataLastReadAt.set(groups[index], Date.now());
      if (liveDataSnapshots.get(groups[index]) === snapshot) return;
      update.apply();
      liveDataSnapshots.set(groups[index], snapshot);
      changed.add(groups[index]);
    });
    if (changed.size) {
      supabaseState.loadedAt = new Date();
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const controls = captureLiveDataControls();
      renderLiveDataSections(changed, member, JSON.parse(previousSlots));
      restoreLiveDataControls(controls);
      window.scrollTo(scrollX, scrollY);
    }
  } catch (error) {
    if (generation === liveDataGeneration) groups.forEach((group) => liveDataDirtyGroups.add(group));
    console.warn("Background bidding refresh unavailable:", error.message || error);
  } finally {
    liveDataRunning = false;
    if (liveDataDirtyGroups.size && document.visibilityState === "visible") scheduleLiveDataRefresh([], 5000);
  }
}

// Render only consumers of the changed groups. Hidden pages render on navigation.
function renderLiveDataSections(groups, member, previousSlots) {
  return withLeaveReadCache(() => {
    const has = (...names) => names.some((name) => groups.has(name));
    const calendarChanged = has("bidding", "slots", "roster", "rules");
    if (calendarChanged) calendarRenderRevision += 1;
    if (!member) {
      const relevant = publicState.area === "FAQ" ? has("faq")
        : publicState.section === "Calendar" ? calendarChanged
        : has("bidding", "roster", "windows", "rules");
      if (relevant) renderPublicPage();
      return;
    }
    const page = document.querySelector(".page.active")?.dataset.pagePanel;
    if (has("bidding", "roster", "windows", "rules")) {
      seniority = buildSeniority();
      renderCurrentUser();
    }
    if (has("bidding", "help", "roster", "rules")) renderAlerts();
    if (has("help")) {
      renderHelpSummary();
      renderHelpPanel();
    }
    if (has("bidding", "roster", "windows", "rules")) updateSelectedLine();
    if (has("bidding", "roster", "windows", "rules")) updateBidWindow(true);
    if (page === "intake" && has("bidding", "roster", "rules")) {
      if (has("rules")) {
        renderRoundRuleSummaryList();
        renderApprovalRuleSummary();
      }
      renderIntakeQueue();
      ensureIntakeBidderSelection();
    }
    if (page === "rdos" && has("bidding", "roster", "rules")) renderRdoLines();
    if (page === "seniority" && has("bidding", "roster", "windows", "rules")) renderSeniority();
    if (page === "history" && has("bidding", "roster", "rules")) renderHistory();
    if (page === "intake-schedule" && has("schedules", "roster", "rules")) renderIntakeSchedule();
    if (["dashboard", "leave", "calendar"].includes(page)) {
      if (has("bidding", "roster", "rules")) {
        renderMemberLeaveContent(page);
        if (page === "leave") renderSubmittedLeaveManager();
      } else if (has("slots") && page !== "dashboard") renderLeaveSlotBoard();
      if (calendarChanged) {
        if (has("bidding", "roster", "rules")) renderMemberCalendarForPage(page);
        else {
          const target = memberCalendarForPage(page);
          if (!target?.childElementCount || Number(target.dataset.calendarRevision) !== calendarRenderRevision - 1) {
            renderMemberCalendarForPage(page);
            return;
          }
          const keys = new Set([...Object.keys(previousSlots), ...Object.keys(extraLeaveSlotData)]);
          const dates = [...keys].filter((key) => JSON.stringify(previousSlots[key]) !== JSON.stringify(extraLeaveSlotData[key]))
            .map((key) => extraLeaveSlotData[key]?.date || previousSlots[key]?.date || key);
          refreshMemberCalendarDates(dates);
          target.dataset.calendarRevision = String(calendarRenderRevision);
        }
      }
    }
    if (page === "admin" && has("roster", "rules", "windows", "schedules", "faq", "slots")) renderAdminConsole();
    if (page === "admin-tools" && has("roster", "rules", "windows", "schedules", "faq")) renderAdminToolsPage();
  });
}

// Discard in-flight reads if the user starts interacting with the page.
for (const eventName of ["input", "change", "pointerdown"]) {
  document.addEventListener(eventName, () => { liveDataActivityRevision += 1; }, true);
}

let alertRefreshPending = false;
let alertRefreshTimer = null;
let alertRealtimeChannel = null;
let alertRealtimeUserId = "";
let lastAlertDatabaseSnapshot = "";
let liveIntakeQueueRenderPending = false;
let liveIntakeQueueRenderTimer = null;

function renderLiveIntakeQueue() {
  clearTimeout(liveIntakeQueueRenderTimer);
  liveIntakeQueueRenderTimer = null;
  if (!liveIntakeQueueRenderPending) return;
  if (!hasIntakeAccess() || !document.querySelector('.page.active[data-page-panel="intake"]')) return;
  if (intakeDecisionPending || hasActiveIntakeEditing()) {
    liveIntakeQueueRenderTimer = setTimeout(renderLiveIntakeQueue, 350);
    return;
  }
  liveIntakeQueueRenderPending = false;
  renderIntakeQueue();
  renderIntakeBidderSummary();
}

function stopLiveAlertUpdates() {
  stopLiveDataUpdates();
  clearTimeout(liveIntakeQueueRenderTimer);
  liveIntakeQueueRenderTimer = null;
  liveIntakeQueueRenderPending = false;
  clearTimeout(alertRefreshTimer);
  alertRefreshTimer = null;
  if (alertRealtimeChannel) void supabaseClient()?.removeChannel(alertRealtimeChannel);
  alertRealtimeChannel = null;
  alertRealtimeUserId = "";
  lastAlertDatabaseSnapshot = "";
}

function scheduleLiveAlertRefresh() {
  // A submission can change several tables. Fetch once after the burst settles.
  clearTimeout(alertRefreshTimer);
  alertRefreshTimer = setTimeout(() => {
    alertRefreshTimer = null;
    void refreshLiveAlerts();
  }, 750);
}

function startLiveAlertUpdates() {
  const client = supabaseClient();
  const userId = supabaseState.authUserId || "public";
  if (!client || alertRealtimeUserId === userId) return;
  stopLiveAlertUpdates();
  alertRealtimeUserId = userId;
  alertRealtimeChannel = client.channel(`bidding-alerts-${userId}`);
  for (const [group, tables] of Object.entries(liveDataTables)) {
    for (const table of tables) {
      alertRealtimeChannel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        const groups = group === "bidding" ? ["bidding", "slots", "windows"]
          : group === "roster" ? Object.keys(liveDataTables) : [group];
        scheduleLiveDataRefresh(groups);
      });
    }
  }
  alertRealtimeChannel.on("postgres_changes", { event: "*", schema: "public", table: "bidding_site_settings" }, () => {
    void refreshActiveBidYear();
  });
  alertRealtimeChannel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      scheduleLiveDataRefresh();
    }
  });
}

async function refreshLiveAlerts() {
  scheduleLiveDataRefresh(["bidding", "help"]);
}

function alertItems(groupedItems = groupedLeaveIntakeItems()) {
  const isIntake = hasIntakeAccess();
  if (isIntake) {
    const intakeAlerts = groupedItems.filter((item) => item.status === "Pending").map((item) => ({
      category: "Intake",
      title: `${item.initials} submitted ${bidTypeLabel(item)}`,
      detail: `${item.summary} · ${item.area}`,
      action: "Review",
      page: "intake",
      intakeItemId: item.id,
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

  const bidAlerts = groupedItems
    .filter((item) => item.initials === currentUser.initials && ["Pending", "Approved", "Denied"].includes(item.status))
    .map((item) => ({
      category: item.status,
      title: `${bidTypeLabel(item)} ${item.status.toLowerCase()}`,
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
  const groupedItems = groupedLeaveIntakeItems();
  const items = alertItems(groupedItems);
  const count = items.filter((item) => item.category !== "Approved").length;
  setText("[data-alert-count]", count);
  setText("[data-intake-count]", groupedItems.filter((item) => item.status === "Pending").length);

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
      <article data-page="${item.page}" ${item.intakeItemId ? `data-intake-item="${escapeHtml(item.intakeItemId)}"` : ""} ${item.helpThreadId ? `data-help-thread="${item.helpThreadId}"` : ""}>
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
  const requestedYear = BID_YEAR;
  const requestedUserId = supabaseState.authUserId;
  const isCurrentRequest = () => BID_YEAR === requestedYear && supabaseState.authUserId === requestedUserId;
  try {
    const { data, error } = await client.rpc("live_help_threads", {
      help_bid_year: BID_YEAR,
      help_session_id: requester.sessionId || liveHelpSessionId(),
    });
    if (error) throw error;
    if (!isCurrentRequest()) return false;
    helpThreads = (data || []).map(helpThreadFromRpc);
    return true;
  } catch (error) {
    if (!isMissingSupabaseRoutine(error)) {
      console.warn("Live help RPC unavailable:", error.message || error);
    }
  }

  if (!isCurrentRequest() || (!requester.verified && !hasIntakeAccess())) return false;

  try {
    await ensureSupabaseBidYearId();
    if (!isCurrentRequest()) return false;
    let query = client
      .from("help_threads")
      .select("id,bid_year_id,bidder_id,subject,status,created_at,updated_at,help_messages(id,sender_id,message,created_at)")
      .eq("bid_year_id", supabaseState.bidYearId)
      .order("updated_at", { ascending: false });
    if (!hasIntakeAccess()) query = query.eq("bidder_id", requester.bidderId);
    const { data, error } = await query;
    if (error) throw error;
    if (!isCurrentRequest()) return false;
    helpThreads = (data || []).map(helpThreadFromLegacyRow);
    return true;
  } catch (error) {
    console.warn("Live help table load unavailable:", error.message || error);
    return false;
  }
}

async function saveSupabaseHelpMessage(thread, body, role) {
  const client = supabaseClient();
  if (!client || !supabaseState.connected) {
    throw new Error("The help message could not reach the database. Check the connection and try again.");
  }

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
  if (!client || !supabaseState.connected) {
    throw new Error("The help conversation could not reach the database. Check the connection and try again.");
  }
  if (!thread?.supabaseThreadId) {
    throw new Error("This help conversation is not linked to a saved database record.");
  }

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
  setHelpStatus("Sending message...");

  try {
    await saveSupabaseHelpMessage(thread, body, role);
    input.value = "";
    const savedThread = activeHelpThread();
    if (savedThread) activeHelpThreadId = savedThread.id;
    logHistory(
      thread.area,
      "Help message saved",
      `${role === "Intake" ? currentUser.initials : requester.initials} added a ${role.toLowerCase()} message to ${thread.initials}'s help thread.`,
      role === "Intake" ? currentUser.initials : requester.initials
    );
    renderApp();
    setHelpStatus(role === "Intake" ? "Reply sent and saved to Supabase." : "Message sent to bidding intake and saved to Supabase.", "success");
  } catch (error) {
    renderApp();
    setHelpStatus(error.message || "The message could not be saved. Please try again.", "error");
  }
}

async function resolveHelpThread() {
  if (!hasIntakeAccess()) return;
  const thread = activeHelpThread();
  if (!thread) return;
  setHelpStatus("Saving resolution...");
  try {
    await saveSupabaseHelpResolution(thread);
    logHistory(thread.area, "Help thread resolved", `${currentUser.initials} marked ${thread.initials}'s help conversation resolved.`);
    renderApp();
    setHelpStatus("Thread marked resolved and saved to Supabase.", "success");
  } catch (error) {
    setHelpStatus(error.message || "The thread could not be resolved. Please try again.", "error");
  }
}

function renderOverrideEditor(item) {
  if (!item) return "";
  if (item.type === "RDO Line" && !hasIntakeAccess()) {
    return '<p class="override-warning">Active intake access is required to edit RDO bids.</p>';
  }
  const pending = item.status === "Pending";
  const bidderIdentity = `
    <label>BUE being edited
      <input type="text" value="${escapeHtml(item.name)} · ${escapeHtml(item.initials)} · Area ${escapeHtml(item.area)}" readonly data-override-bue />
    </label>
  `;
  const approveButton = pending
    ? `<button class="primary-action" type="button" data-intake-approve="${item.id}">Approve With Changes</button>`
    : "";

  if (item.type === "RDO Line") {
    const eligibleLines = rdoLinesForBidder(item.bidAs, item.area);
    const selectedLine = eligibleLines.find((line) => line.line === item.line);
    const glCategory = selectedLine && isCpcLine(selectedLine) ? (item.area === "TMU" ? "TMC" : "CPC") : "DEV";
    const developmentalBidder = isDevelopmentalBidRole(item.bidAs, item.area);
    return `
      ${bidderIdentity}
      <label>Line
        <select data-override-line>
          ${eligibleLines.map((line) => `<option value="${escapeHtml(line.line)}" ${line.line === item.line ? "selected" : ""}>${escapeHtml(rdoLineOptionLabel(line))}</option>`).join("")}
        </select>
      </label>
      ${item.bidAs === "GL" ? `<label class="override-check gl-line-type-verification">
        <input type="checkbox" data-gl-line-type-verification />
        I verified this GL is bidding as <span data-gl-line-type-label>${glCategory}</span>. All GL rules still apply.
      </label>` : ""}
      <label>Fatigue Group
        <select data-override-group>
          ${[["", "No preference — assign later"], ["A", "A"], ["B", "B"], ["C", "C"]].map(([value, label]) => `<option value="${value}" ${value === item.fatigueGroup ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
      <label>Flex
        <select data-override-flex>
          ${["Yes", "No"].map((value) => `<option ${value === rdoBidPreferenceLabel(item.flex) ? "selected" : ""}>${value}</option>`).join("")}
        </select>
      </label>
      <label>AWS
        <select data-override-aws ${developmentalBidder ? "disabled" : ""}>
          ${developmentalBidder ? '<option value="No">No — DEV does not work AWS</option>' : ["Yes", "No"].map((value) => `<option ${value === rdoBidPreferenceLabel(item.aws) ? "selected" : ""}>${value}</option>`).join("")}
        </select>
      </label>
      <label>Mid
        <select data-override-mid ${developmentalBidder ? "disabled" : ""}>
          ${developmentalBidder ? '<option value="No">No — DEV does not work Mid</option>' : ["Yes", "No", "BID"].map((value) => `<option ${value === item.mid ? "selected" : ""}>${value}</option>`).join("")}
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
    ${bidderIdentity}
    ${rdoConflictNote}
    ${conflictNote}
    <label>Date Range <input type="text" value="${escapeHtml(item.range)}" data-override-range /></label>
    <label>Days <input type="number" value="${item.days}" data-override-days ${pending ? "" : "readonly"} /></label>
    ${pending ? "" : "<small>Charged days are recalculated from the replacement range.</small>"}
    ${item.ghostBid ? '<p class="ghost-bid-badge">Ghost Leave · Area capacity is not consumed.</p>' : isGlLeaveItem(item) ? '<p class="gl-bid-badge">GL Bid · Visible on the calendar; no area slot is consumed.</p>' : `<label class="override-check">
      <input type="checkbox" data-override-capacity ${item.leaveCapacityOverride ? "checked" : ""} />
      Approve even though one or more dates are full
    </label>`}
    <div class="button-row">
      <button class="secondary-action" type="button" data-intake-save-override="${item.id}">${pending ? "Save Override" : "Replace Approved Dates"}</button>
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

function intakeLeaveRoundIsOpen(item) {
  const round = intakeItemRound(item);
  if (pilotState.database) return pilotState.enabled && pilotOpenRounds.includes(round);
  const windows = ZLA_AREAS.flatMap((area) => roundWindows(round, area));
  if (!windows.length) return false;
  const startsAt = Math.min(...windows.map((window) => window.start.getTime()));
  const endsAt = Math.max(...windows.map((window) => window.end.getTime()));
  const now = Date.now();
  return now >= startsAt && now < endsAt;
}

function intakeDisplayStatus(item) {
  return item.status === "Expired" && ["RDO Line", "Leave"].includes(item.type)
    ? "Cancelled"
    : item.status;
}


function intakeCancellationNote(item) {
  if (intakeDisplayStatus(item) !== "Cancelled") return "";
  const removal = item.type === "RDO Line"
    ? "Previous RDO bid removed. This bid no longer assigns an RDO line."
    : "Leave dates removed. These dates no longer hold leave slots.";
  return `${removal}${item.cancelledAt ? ` Cancelled ${item.cancelledAt}.` : ""} Bid history retained.`;
}


function intakeSearchText(item) {
  return [
    bidTypeLabel(item),
    intakeDisplayStatus(item),
    item.name,
    item.initials,
    item.area,
    item.bidAs,
    item.seniority,
    item.line ? `Line ${item.line}` : "",
    item.range,
    item.summary,
    item.reviewNote,
    item.isChange ? "change changed original bid" : "",
    item.originalBid ? rdoBidSnapshotSummary(item.originalBid) : "",
    item.submittedAt,
    item.approvedAt,
    item.deniedAt,
    `Round ${intakeItemRound(item)}`,
  ].filter(Boolean).join(" ").toLowerCase();
}

function intakeItemMatchesFilters(item) {
  const query = intakeSearchQuery.trim().toLowerCase();
  if (intakeSearchEmployeeInitials) {
    if (item.initials !== intakeSearchEmployeeInitials) return false;
  } else if (query && !intakeSearchText(item).includes(query)) return false;
  if (intakeFilters.status !== "all" && intakeDisplayStatus(item) !== intakeFilters.status) return false;
  if (intakeFilters.type !== "all" && item.type !== intakeFilters.type) return false;
  if (intakeFilters.area !== "all" && item.area !== intakeFilters.area) return false;
  if (intakeFilters.round !== "all" && String(intakeItemRound(item)) !== intakeFilters.round) return false;
  return true;
}

function intakeSortTimestamp(item, field) {
  return Math.max(0, ...(item.members || [item]).map((entry) => {
    const timestamp = Date.parse(entry[field] || "");
    return Number.isFinite(timestamp) ? timestamp : 0;
  }));
}

function compareIntakeItems(left, right) {
  const enteredDifference = intakeSortTimestamp(right, "submittedAt") - intakeSortTimestamp(left, "submittedAt");
  if (intakeSort === "entered") return enteredDifference;
  return intakeSortTimestamp(right, "approvedAt") - intakeSortTimestamp(left, "approvedAt") || enteredDifference;
}

function compareIntakeActionItems(left, right) {
  const pendingDifference = Number(right.status === "Pending") - Number(left.status === "Pending");
  return pendingDifference || compareIntakeItems(left, right);
}

function renderIntakeEmployeeSearch() {
  const input = document.querySelector("[data-intake-search]");
  const results = document.querySelector("[data-intake-employee-results]");
  const status = document.querySelector("[data-intake-employee-status]");
  if (!input || !results || !status) return;
  const query = intakeSearchQuery.trim();
  const selected = bueByInitials(intakeSearchEmployeeInitials);
  const matches = query && !selected
    ? bueRoster().filter((person) => manualBidControllerMatches(person, query))
    : [];
  results.innerHTML = matches.map((person) => `
    <button type="button" data-intake-employee-result="${escapeHtml(person.initials)}">
      <strong>${escapeHtml(personDisplayName(person))} · ${escapeHtml(person.initials)}</strong>
      <span>${escapeHtml(person.area)} · Seniority #${escapeHtml(person.rank)} · ${escapeHtml(person.bidAs || "CPC")}</span>
    </button>
  `).join("");
  results.hidden = matches.length === 0;
  input.setAttribute("aria-expanded", String(!results.hidden));
  status.textContent = selected
    ? `Selected ${personDisplayName(selected)} (${selected.initials}). Showing their bids with the current filters.`
    : matches.length ? `${matches.length} ${matches.length === 1 ? "employee" : "employees"}. Select an employee to view their information.` : "";
}

function syncIntakeSearchControls() {
  renderIntakeEmployeeSearch();
  const sort = document.querySelector("[data-intake-sort]");
  if (sort) sort.value = intakeSort;
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
  ).sort(compareIntakeItems);
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
          <span class="status ${intakeDisplayStatus(entry).toLowerCase()}">${escapeHtml(intakeDisplayStatus(entry))}</span>
          <strong>${escapeHtml(bidTypeLabel(entry))}</strong>
          <p>${escapeHtml(entry.summary)}</p>
          ${renderIntakeChangeHistory(entry)}
          ${intakeCancellationNote(entry) ? `<small>${escapeHtml(intakeCancellationNote(entry))}</small>` : ""}
          <small>Submitted ${escapeHtml(entry.submittedAt || "not recorded")}</small>
        </article>
      `).join("")}
    </div>
  `;
}

function rdoBidChangeDifferences(original, requested) {
  if (!original) return [];
  const fields = [
    ["Line", (bid) => String(bid.line || bid.rdo_line_code || "—")],
    ["Fatigue", (bid) => fatigueGroupPreferenceLabel(bid.fatigueGroup ?? bid.fatigue_group ?? "")],
    ["Flex", (bid) => rdoBidPreferenceLabel(bid.flex)],
    ["AWS", (bid) => rdoBidPreferenceLabel(bid.aws)],
    ["Mid", (bid) => rdoBidPreferenceLabel(bid.mid)],
  ];
  return fields.flatMap(([label, value]) => value(original) === value(requested)
    ? []
    : [`${label}: ${value(original)} → ${value(requested)}`]);
}

function renderIntakeChangeHistory(item) {
  if (!item?.isChange) return "";
  const differences = rdoBidChangeDifferences(item.originalBid, item);
  const source = item.changeSource === "intake"
    ? `Entered as a change by ${item.changeEnteredBy || "Intake"}`
    : item.changeSource === "bidder"
      ? "Submitted by the employee as a change"
      : "Detected from the employee's earlier approved bid";
  return `
    <div class="intake-change-history">
      <strong>Bid change</strong>
      <span><b>Original:</b> ${escapeHtml(rdoBidSnapshotSummary(item.originalBid))}</span>
      <span><b>Requested:</b> ${escapeHtml(rdoBidSnapshotSummary(item))}</span>
      ${differences.length ? `<span><b>Changed:</b> ${escapeHtml(differences.join(" · "))}</span>` : ""}
      <small>${escapeHtml(source)}</small>
    </div>
  `;
}

function selectedIntakeBidderPerson() {
  const rosterPerson = bueByInitials(intakeBidderSelection.initials);
  const savedPerson = intakeBidderSelection.record?.person;
  if (!savedPerson) return rosterPerson;
  return {
    ...rosterPerson,
    profileId: savedPerson.id || rosterPerson?.profileId || intakeBidderSelection.profileId,
    firstName: savedPerson.first_name || rosterPerson?.firstName || "",
    lastName: savedPerson.last_name || rosterPerson?.lastName || "",
    initials: savedPerson.initials || rosterPerson?.initials || intakeBidderSelection.initials,
    area: savedPerson.area || rosterPerson?.area || "",
    bidAs: savedPerson.bid_role || rosterPerson?.bidAs || "",
    seniorityRank: savedPerson.seniority_rank ?? rosterPerson?.seniorityRank ?? rosterPerson?.rank,
    email: savedPerson.email || rosterPerson?.email || "",
    phone: savedPerson.phone || rosterPerson?.phone || "",
    leaveSlotAllowance: normalizeLeaveSlotAllowance(
      savedPerson.leave_slot_allowance ?? rosterPerson?.leaveSlotAllowance
    ),
  };
}

function intakeBidderLocalLeaveRows(initials) {
  return activeLeaveItemsForInitials(initials).map((item) => ({
    id: item.supabaseRequestId || item.id,
    round_number: leaveRoundForItem(item),
    priority: Number(item.priority || 0),
    status: String(item.status || "Pending").toLowerCase(),
    charged_days: leaveItemChargedDays(item),
    requested_start_date: leaveDateKeysForItem(item)[0] || "",
    requested_end_date: leaveDateKeysForItem(item).at(-1) || "",
    dates: leaveDateKeysForItem(item)
      .filter((key) => !isRdoDateForInitials(key, initials))
      .map((key) => ({
        leave_date: key,
        charged: true,
        is_rdo: false,
        is_holiday: isHolidayDate(key, initials) && !isHolidayInLieuDate(key, initials),
        is_holiday_in_lieu: isHolidayInLieuDate(key, initials),
      })),
  }));
}

function selectedIntakeBidderLeaveRows() {
  const savedRows = intakeBidderSelection.record?.snapshot?.leave;
  return Array.isArray(savedRows) ? savedRows : intakeBidderLocalLeaveRows(intakeBidderSelection.initials);
}

function intakeBidderActiveLeaveRows(rows) {
  return rows.filter((row) => ["pending", "approved"].includes(String(row.status || "").toLowerCase()));
}

function intakeBidderLeaveDates(row) {
  if (Array.isArray(row.dates) && row.dates.length) {
    return row.dates
      .filter((date) => !date.is_rdo)
      .sort((left, right) => String(left.leave_date).localeCompare(String(right.leave_date)));
  }
  const start = row.requested_start_date;
  const end = row.requested_end_date || start;
  return start && end
    ? datesBetweenKeys(start, end)
      .filter((key) => !isRdoDateForInitials(key, intakeBidderSelection.initials))
      .map((key) => ({ leave_date: key, charged: true }))
    : [];
}

function intakeBidderLine() {
  const initials = intakeBidderSelection.initials;
  const localLine = submittedRdoLineForInitials(initials) || rdoLineForInitials(initials);
  if (localLine) return localLine;
  const assignment = intakeBidderSelection.record?.snapshot?.assignment;
  if (!assignment) return null;
  const savedLine = intakeBidderSelection.record?.lines?.find((line) => line.id === assignment.id);
  return savedLine ? {
    line: savedLine.line_code,
    pattern: savedLine.pattern,
    fourTen: savedLine.four_ten ? "Yes" : "No",
    week: Array.isArray(assignment.week) ? assignment.week : [],
  } : null;
}

function intakeBidderExactDateLabel(key) {
  if (!key) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(dateFromKey(key));
}

function intakeBidderWindowState(person, date = new Date()) {
  const rank = Number.isFinite(person?.rank) ? person.rank : person?.seniorityRank;
  const area = person?.area || currentViewArea();
  if (!Number.isFinite(rank)) return { window: null, isOpen: false };

  const roundCount = Math.max(6, roundDateBlocksForArea(area)[0]?.length || 0);
  const windows = Array.from(
    { length: roundCount },
    (_, index) => bidWindowForRankRound(rank, index + 1, area)
  ).filter(Boolean);
  const openWindow = windows.find((window) => date >= window.start && date < window.end) || null;
  const areaRound = areaBidRoundState(date, area)?.round;
  const currentRoundWindow = areaRound
    ? windows.find((window) => window.round === areaRound) || null
    : null;
  const nextWindow = windows.find((window) => date < window.end) || null;
  const previousWindow = windows.toReversed().find((window) => date >= window.end) || null;

  return {
    window: openWindow || currentRoundWindow || nextWindow || previousWindow,
    isOpen: Boolean(openWindow),
  };
}

function syncIntakeBidderWindowStatus(date = new Date()) {
  const range = document.querySelector("[data-intake-bidder-window-range]");
  const status = document.querySelector("[data-intake-bidder-window-status]");
  if (!range || !status) return;

  const person = selectedIntakeBidderPerson();
  if (!person) return;

  const { window, isOpen } = intakeBidderWindowState(person, date);
  range.textContent = window
    ? `Round ${window.round} · ${formatDateRange(window.start, window.end)}`
    : "No bid window scheduled";
  status.textContent = window ? (isOpen ? "In bid window" : "Not in bid window") : "Not scheduled";
  status.classList.toggle("open", isOpen);
  status.classList.toggle("closed", !isOpen);
}

function intakeBidderRoundDetail(rows) {
  const rounds = Array.from({ length: 6 }, (_, index) => index + 1);
  return rounds.map((round) => {
    const roundRows = rows
      .filter((row) => Number(row.round_number) === round)
      .sort((left, right) => Number(left.priority || 0) - Number(right.priority || 0));
    const entries = roundRows.length ? roundRows.map((row) => {
      const dates = intakeBidderLeaveDates(row);
      const dateList = dates.length
        ? dates.map((date) => {
          const holiday = date.is_holiday_in_lieu ? " · Holiday in-lieu" : date.is_holiday ? " · Holiday" : "";
          return '<time datetime="' + escapeHtml(date.leave_date) + '">' +
            escapeHtml(intakeBidderExactDateLabel(date.leave_date)) + holiday + "</time>";
        }).join(", ")
        : "No exact dates are stored for this bid.";
      const status = uiStatusFromDatabase(row.status || "pending");
      const priority = Number(row.priority || 0);
      const chargedDays = Number(row.charged_days || 0);
      return '<div class="intake-bid-round-entry"><strong>' +
        (priority ? "Priority " + priority + " · " : "") + escapeHtml(status) +
        "</strong><span>" + dateList + "</span><small>" +
        formatLeaveDaysLabel(chargedDays) + " charged</small></div>";
    }).join("") : "<span>No leave bids in this round.</span>";
    return '<section class="intake-bid-round"><strong>Round ' + round +
      '</strong><div class="intake-bid-round-list">' + entries + "</div></section>";
  }).join("");
}

function renderIntakeBidderDetail(person, rows) {
  const target = document.querySelector("[data-intake-bidder-detail]");
  if (!target) return;
  const mode = intakeBidderSelection.detail;
  target.hidden = !mode;
  if (!mode) {
    target.replaceChildren();
    return;
  }

  const closeButton = '<button class="secondary-action small" type="button" data-intake-bidder-detail-close>Close</button>';
  if (mode === "contact") {
    const phone = person.phone || "Not provided";
    const email = person.email || "Not provided";
    const phoneValue = person.phone
      ? '<a href="tel:' + escapeHtml(person.phone) + '">' + escapeHtml(phone) + "</a>"
      : "<strong>" + escapeHtml(phone) + "</strong>";
    const emailValue = person.email
      ? '<a href="mailto:' + escapeHtml(person.email) + '">' + escapeHtml(email) + "</a>"
      : "<strong>" + escapeHtml(email) + "</strong>";
    target.innerHTML =
      '<div class="intake-bidder-detail-header"><div><h3>' +
      escapeHtml(personDisplayName(person)) +
      "</h3><p>Contact information</p></div>" + closeButton + "</div>" +
      '<div class="intake-bidder-contact-grid"><div><span>Phone</span>' + phoneValue +
      "</div><div><span>Email</span>" + emailValue + "</div></div>";
    return;
  }

  target.innerHTML =
    '<div class="intake-bidder-detail-header"><div><h3>Leave bids by round</h3><p>' +
    escapeHtml(personDisplayName(person)) + " · Bid Year " + BID_YEAR +
    "</p></div>" + closeButton + '</div><div class="intake-bid-rounds">' +
    intakeBidderRoundDetail(rows) + "</div>";
}

function renderIntakeBidderSummary() {
  return withLeaveReadCache(() => renderIntakeBidderSummaryWithCache());
}

function renderIntakeBidderSummaryWithCache() {
  const target = document.querySelector("[data-intake-bidder-summary]");
  const area = document.querySelector("[data-intake-bidder-area]");
  const role = document.querySelector("[data-intake-bidder-role]");
  if (!target || !area || !role) return;
  const person = selectedIntakeBidderPerson();
  if (!person) {
    role.hidden = true;
    role.textContent = "";
    role.className = "intake-bidder-role";
    area.textContent = "Select a controller";
    target.innerHTML = '<div class="intake-bidder-empty">Select a controller from the Intake Queue, RDO Selection, or Requested Leave Dates.</div>';
    renderIntakeBidderDetail({}, []);
    return;
  }

  const line = intakeBidderLine();
  const rdoDays = line
    ? [...rdoWeekdaysForLine(line)].sort((left, right) => left - right).map((weekday) => dayNames[weekday])
    : [];
  const hoursPerDay = leaveHoursPerDayForLine(line);
  const allowanceHours = normalizeLeaveSlotAllowance(person.leaveSlotAllowance);
  const allowanceDays = estimatedLeaveDaysFromHours(allowanceHours, hoursPerDay);
  const rows = selectedIntakeBidderLeaveRows();
  const activeRows = intakeBidderActiveLeaveRows(rows);
  const daysBid = activeRows.reduce((total, row) => total + Number(row.charged_days || 0), 0);
  const holidaysBid = new Set(activeRows.flatMap((row) => intakeBidderLeaveDates(row)
    .filter((date) => date.is_holiday || date.is_holiday_in_lieu)
    .map((date) => date.leave_date))).size;
  const scheduleLabel = hoursPerDay === CWS_LEAVE_HOURS_PER_DAY ? "10-hour schedule" : "8-hour schedule";
  const loadingNote = intakeBidderSelection.loading ? "Refreshing saved details…" : intakeBidderSelection.error;
  const rank = Number.isFinite(person.rank) ? person.rank : person.seniorityRank;
  const bidRole = String(person.bidAs || "BUE").trim().toUpperCase();

  role.hidden = false;
  role.textContent = bidRole;
  role.className = `intake-bidder-role ${bidAsClass(bidRole)}`;
  area.textContent = person.area || "Area";
  target.classList.toggle("intake-bidder-loading", intakeBidderSelection.loading);
  target.innerHTML =
    '<div class="intake-bidder-metric"><span>Name</span>' +
      '<button class="intake-bidder-link" type="button" data-intake-bidder-detail-open="contact">' +
      escapeHtml(personDisplayName(person)) + '</button><small class="intake-bid-window">' +
      '<span data-intake-bidder-window-range>No bid window scheduled</span>' +
      '<span class="intake-bid-window-status closed" data-intake-bidder-window-status>Not scheduled</span>' +
      (loadingNote ? '<span class="intake-bidder-loading-note">' + escapeHtml(loadingNote) + "</span>" : "") +
      "</small></div>" +
    '<div class="intake-bidder-metric"><span>Initials</span><strong>' +
      escapeHtml(person.initials || "—") + "</strong><small>Seniority #" +
      (Number.isFinite(rank) ? rank : "—") + "</small></div>" +
    '<div class="intake-bidder-metric"><span>Line &amp; RDOs</span><strong>' +
      (line?.line ? "Line " + escapeHtml(line.line) : "Not selected") + "</strong><small>" +
      (rdoDays.length ? escapeHtml(rdoDays.join(" / ")) : "RDOs unavailable") + "</small></div>" +
    '<div class="intake-bidder-metric"><span>' + BID_YEAR + " Accrual</span><strong>" +
      formatRoundedUpLeaveDays(allowanceDays) + " days</strong><small>" + allowanceHours +
      " hours · " + scheduleLabel + "</small></div>" +
    '<div class="intake-bidder-metric"><span>Days Bid</span>' +
      '<button class="intake-bidder-link" type="button" data-intake-bidder-detail-open="bids">' +
      formatEstimatedLeaveDays(daysBid) + " days</button><small>Pending and approved</small></div>" +
    '<div class="intake-bidder-metric"><span>Holidays Bid</span><strong>' +
      holidaysBid + "</strong><small>Holiday and in-lieu dates</small></div>";
  syncIntakeBidderWindowStatus();
  renderIntakeBidderDetail(person, rows);
}

async function loadSelectedIntakeBidder() {
  const client = supabaseClient();
  const profileId = intakeBidderSelection.profileId;
  if (!client || !supabaseState.connected || !profileId || !hasIntakeAccess()) return;
  const generation = ++intakeBidderSelection.generation;
  intakeBidderSelection.loading = true;
  intakeBidderSelection.error = "";
  renderIntakeBidderSummary();
  try {
    const { data, error } = await client.rpc("read_admin_bidder_editor", {
      requested_bid_year: BID_YEAR,
      target_bidder_id: profileId,
    });
    if (generation !== intakeBidderSelection.generation) return;
    if (error) throw error;
    intakeBidderSelection.record = data;
  } catch (_error) {
    if (generation === intakeBidderSelection.generation) {
      intakeBidderSelection.error = "Saved details unavailable";
    }
  } finally {
    if (generation === intakeBidderSelection.generation) {
      intakeBidderSelection.loading = false;
      renderIntakeBidderSummary();
    }
  }
}

function selectIntakeBidder(initials, profileId = "", { deferRender = false } = {}) {
  const normalized = String(initials || "").trim().toUpperCase();
  const person = bueByInitials(normalized);
  if (!normalized || !person) return;
  const nextProfileId = profileId || person.profileId || "";
  const changed = normalized !== intakeBidderSelection.initials || nextProfileId !== intakeBidderSelection.profileId;
  intakeBidderSelection.initials = normalized;
  intakeBidderSelection.profileId = nextProfileId;
  if (changed) {
    intakeBidderSelection.record = null;
    intakeBidderSelection.detail = "";
    intakeBidderSelection.error = "";
    intakeBidderSelection.generation += 1;
    intakeBidderSelection.loading = false;
  }
  if (deferRender) return;
  renderIntakeBidderSummary();
  if (!intakeBidderSelection.loading && (changed || !intakeBidderSelection.record)) void loadSelectedIntakeBidder();
}

function ensureIntakeBidderSelection() {
  if (!hasIntakeAccess()) return;
  const selected = bueByInitials(intakeBidderSelection.initials)
    || bueByInitials(currentUser.initials)
    || manualBidControllerRoster()[0];
  if (!selected) return;
  const profileId = selected.profileId || "";
  const changed = selected.initials !== intakeBidderSelection.initials || profileId !== intakeBidderSelection.profileId;
  intakeBidderSelection.initials = selected.initials;
  intakeBidderSelection.profileId = profileId;
  if (changed) {
    intakeBidderSelection.record = null;
    intakeBidderSelection.error = "";
  }
  renderIntakeBidderSummary();
  if (!intakeBidderSelection.record && !intakeBidderSelection.loading) void loadSelectedIntakeBidder();
}

// Keep each date's saved request so intake can still edit or decide individual
// dates. Present those requests as one week (Round 1) or submission batch.
const intakeGroupReviewState = new Map();

function groupedLeaveIntakeItems(items = intakeQueue) {
  const weekStartsByBidder = new Map();
  items.forEach((item) => {
    if (item.type !== "Leave" || intakeItemRound(item) !== 1 || !["Pending", "Approved", "Denied"].includes(item.status)) return;
    const owner = `${item.area}|${item.initials}|${item.status === "Denied" ? item.submissionBatchKey : "active"}`;
    const dates = weekStartsByBidder.get(owner) || [];
    dates.push(...leaveDateKeysForItem(item));
    weekStartsByBidder.set(owner, dates);
  });
  weekStartsByBidder.forEach((dates, owner) => weekStartsByBidder.set(owner, roundOneWeekKeysForDateKeys(dates)));
  const groups = new Map();
  const result = [];
  items.forEach((item) => {
    if (item.type !== "Leave" || !item.submissionBatchKey) { result.push(item); return; }
    const round = intakeItemRound(item);
    const dates = leaveDateKeysForItem(item).sort();
    if (!dates.length) { result.push(item); return; }
    const starts = weekStartsByBidder.get(`${item.area}|${item.initials}|${item.status === "Denied" ? item.submissionBatchKey : "active"}`) || roundOneWeekKeysForDateKeys(dates);
    const weekStart = round === 1 ? starts.find((start) => dates[0] >= start && dates[0] <= dateKeyFromDate(new Date(dateFromKey(start).getTime() + 6 * 86400000))) : "";
    // Legacy continuous requests spanning two weeks already have one approval;
    // keep their edit/review controls instead of approving half a saved range.
    if (round === 1 && (!weekStart || dates.some((key) => Math.round((dateFromKey(key) - dateFromKey(weekStart)) / 86400000) > 6))) {
      result.push(item); return;
    }
    const key = JSON.stringify([item.area, item.initials, round, item.submissionBatchKey, weekStart, item.status, Boolean(item.ghostBid)]);
    let group = groups.get(key);
    if (!group) {
      group = { ...item, id: `leave-group-${item.id}`, members: [], weekStart, round, days: 0, dateKeys: [], weekUnits: round === 1 ? 1 : 0 };
      groups.set(key, group);
      result.push(group);
    }
    group.members.push(item);
    group.dateKeys.push(...dates);
    group.days += Number(item.days || 0);
  });
  groups.forEach((group) => {
    group.members.sort((a,b) => leaveDateKeysForItem(a)[0].localeCompare(leaveDateKeysForItem(b)[0]));
    group.dateKeys = [...new Set(group.dateKeys)].sort();
    group.range = formatIndividualLeaveDates(group.dateKeys);
    group.groupLabel = group.round === 1 ? `Round 1 · Week starting ${formatCalendarDate(group.weekStart)}` : `Round ${group.round} · Leave batch`;
    group.summary = `${group.groupLabel} · ${group.range} · ${group.days} charged ${group.days === 1 ? "day" : "days"}`;
    Object.assign(group, intakeGroupReviewState.get(group.id) || {});
  });
  return result;
}

function intakeReviewItemById(id) {
  return intakeQueue.find((item) => item.id === id) || groupedLeaveIntakeItems().find((item) => item.id === id);
}

function intakeReviewConflicts(item, check) {
  return [...new Set((item.members || [item]).flatMap(check))].sort();
}

function renderIntakeGroupDates(item, canReview) {
  if (!item.members) return "";
  return `<details><summary>Review ${item.dateKeys.length} selected dates</summary>${item.members.map((member) => `
    <div class="intake-meta"><strong>${escapeHtml(member.range)}</strong><span>${member.days} charged ${member.days === 1 ? "day" : "days"}</span>
    ${canReview && member.status === "Pending" ? `<button class="secondary-action small" type="button" data-intake-approve="${member.id}">Approve date</button><button class="secondary-action small danger" type="button" data-intake-deny="${member.id}">Deny date</button>` : ""}
    ${canReview && ["Pending", "Approved"].includes(member.status) && intakeLeaveRoundIsOpen(member) ? `<button class="secondary-action small" type="button" data-intake-edit="${member.id}">${member.status === "Approved" ? "Edit date" : "Edit / Override date"}</button>` : ""}
    </div>`).join("")}</details>`;
}

function revealIntakeLeaveDates(id) {
  const card = [...document.querySelectorAll("[data-intake-card]")]
    .find((candidate) => candidate.dataset.intakeCard === id);
  const details = card?.querySelector("details");
  if (!details) return;
  details.open = true;
  window.requestAnimationFrame(() => details.querySelector("[data-intake-edit]")?.focus());
}

async function reviewIntakeLeaveGroup(item, decision, reason = "") {
  if (!supabaseState.connected) throw new Error("This intake decision could not reach the database. Check the connection and try again.");
  let submissions = [];
  if (item.members.some((member) => !member.supabaseSubmissionId)) {
    const { data, error } = await supabaseClient().rpc("read_bidding_state", { requested_bid_year: BID_YEAR });
    if (error) throw error;
    submissions = data?.submissions || [];
  }
  const ids = item.members.map((member) => member.supabaseSubmissionId || intakeSubmissionIdFromBiddingState(member, submissions));
  if (ids.some((id) => !id)) throw new Error("A saved request could not be found. Reload the queue before reviewing this group.");
  const { error } = await supabaseClient().rpc("review_leave_submission_group", {
    submission_ids: ids, decision, denial_reason_text: reason || null,
  });
  if (error) throw error;
  updateConfirmedIntakeDecision(item, decision, reason);
  if (decision === "approved") queueBidVerifiedEmail(item);
  else { item.denialReason = reason; queueBidDeniedEmail(item); }
  intakeGroupReviewState.delete(item.id);
  activeOverrideId = null;
  activeDenialId = null;
  scheduleIntakeDecisionRefresh();
  renderIntakeQueue();
  setPage("intake");
}

function intakeBidSummary(item) {
  let summary = item.summary || "";
  if (item.type !== "RDO Line") return summary;
  summary = summary.replace(/\b(Flex|AWS)(?:\s+([^·]*?))?(?=\s*·|$)/g, (match, preference, displayed) => {
    const value = item[preference.toLowerCase()] ?? displayed ?? "";
    const enabled = value === true || ["yes", "true"].includes(String(value).trim().toLowerCase());
    return `${preference} ${enabled ? "Yes" : "No"}${/\s$/.test(match) ? " " : ""}`;
  });
  const line = rdoLines.find((entry) => String(entry.line) === String(item.line) && lineForArea(entry, item.area));
  const pattern = String(line?.pattern || "").trim();
  if (!pattern) return summary;
  const label = `Line ${item.line}`;
  if (summary.endsWith(label)) return `${summary} ${pattern}`;
  return summary.replace(`${label} ·`, `${label} ${pattern} ·`);
}

function submissionRoleLabel(role) {
  const normalized = String(role || "").toLowerCase();
  return normalized === "admin" ? "admin" : ["intake", "intake rep"].includes(normalized) ? "intake rep" : "user";
}

function intakeSubmissionLabel(item) {
  const initials = item.submittedBy || item.enteredBy || "";
  const role = item.submittedByRole ? submissionRoleLabel(item.submittedByRole) : "";
  const date = new Date(item.submittedAt);
  const submittedAt = Number.isNaN(date.getTime()) ? item.submittedAt || "Time not recorded" : formatDateTime(date);
  // Historical bids without saved attribution cannot safely be assigned to the bidder.
  return `Submitted by ${initials && role ? `${role} (${initials})` : "unknown submitter"} · ${submittedAt}`;
}

function intakeReviewerLabel(initials) {
  if (!initials) return "Unknown reviewer";
  const entry = senioritySource.find((person) => person[3] === initials);
  const role = entry ? seniorityEntryAppRole(entry) : currentUser?.initials === initials ? currentUser.role : "";
  return `${role === "admin" ? "Admin" : "Intake Rep"} ${initials}`;
}

let intakeQueueRefreshPending = false;

async function refreshIntakeQueue() {
  if (intakeQueueRefreshPending || !hasIntakeAccess()) return;
  const button = document.querySelector("[data-intake-refresh]");
  const status = document.querySelector("[data-intake-refresh-status]");
  const userId = supabaseState.authUserId;
  const bidYear = BID_YEAR;
  const previousQueue = JSON.stringify(intakeQueue);
  intakeQueueRefreshPending = true;
  if (button) {
    button.disabled = true;
    button.textContent = "Refreshing…";
  }
  if (status) {
    status.hidden = false;
    status.textContent = "Loading the latest bids…";
    showActionFeedback(status.textContent, "info");
  }
  try {
    const client = supabaseClient();
    if (!client || !userId || !supabaseState.connected || supabaseState.loading) {
      throw new Error("Queue unavailable. Check your connection and try again.");
    }
    const [bidding, leave, areas] = await Promise.all([
      client.rpc("read_bidding_state", { requested_bid_year: bidYear }),
      client.rpc("read_leave_intake_queue", { queue_bid_year: bidYear }),
      client.from("areas").select("id,name"),
    ]);
    for (const result of [bidding, leave, areas]) {
      if (result.error) throw result.error;
    }
    const submissions = bidding.data?.submissions || [];
    const leaveRows = attachSubmissionIdsToLeaveRequests(
      await attachLeaveRequestWeekBuckets(client, leave.data || []), submissions
    );
    if (supabaseState.authUserId !== userId || BID_YEAR !== bidYear || supabaseState.loading
      || !hasIntakeAccess() || JSON.stringify(intakeQueue) !== previousQueue) {
      throw new Error("The queue changed while refreshing. Please try again.");
    }
    const areaById = new Map((areas.data || []).map((area) => [area.id, area.name]));
    const rdoItems = submissions.filter((row) => biddingStateSubmissionType(row) === "RDO Line"
      && ["pending", "approved", "denied"].includes(String(row.status || "").toLowerCase()))
      .map((row) => supabaseRdoSubmissionToIntakeItem(row, areaById));
    inferRdoBidChanges(rdoItems);
    intakeQueue = intakeQueue.filter((item) => !item.supabaseSubmissionId && !item.supabaseRequestId);
    intakeQueue.unshift(...rdoItems);
    upsertLeaveRequestsFromDatabase(leaveRows, areaById);
    renderIntakeQueue();
    renderAlerts();
    if (status) status.textContent = "Queue updated.";
    showActionFeedback("Queue updated.", "success");
  } catch (error) {
    if (status) status.textContent = `Could not refresh the queue. ${error.message || "Please try again."}`;
    showActionFeedback(`Could not refresh the queue. ${error.message || "Please try again."}`, "error");
  } finally {
    intakeQueueRefreshPending = false;
    if (button) {
      button.disabled = false;
      button.textContent = "Refresh Queue";
    }
  }
}

function renderIntakeQueue() {
  return withLeaveReadCache(() => renderIntakeQueueWithCache());
}

function renderIntakeQueueWithCache() {
  const target = document.getElementById("intake-queue");
  if (!target) return;

  syncIntakeSearchControls();
  const canReview = hasIntakeAccess();
  const groupedItems = groupedLeaveIntakeItems();
  const visibleItems = canReview
    ? groupedItems
    : groupedItems.filter((item) => item.area === currentUser.area && item.initials === currentUser.initials);
  const filteredItems = visibleItems.filter(intakeItemMatchesFilters).sort(compareIntakeActionItems);
  const activeDetailItem = visibleItems.find((item) => item.id === activeIntakeDetailId) || null;
  renderIntakeDetailPanel(activeDetailItem, visibleItems);

  target.innerHTML = filteredItems.length
    ? filteredItems.map((item) => `
      <article class="intake-card ${intakeDisplayStatus(item).toLowerCase()} ${item.isChange ? "bid-change" : ""} ${item.id === activeIntakeDetailId ? "selected" : ""}" tabindex="0" data-intake-card="${item.id}">
        <div>
          <span class="intake-type">${escapeHtml(bidTypeLabel(item))}</span>
          <div class="intake-card-name-row">
            <h3>${item.name} · ${item.initials}</h3>
          </div>
          <p>${escapeHtml(intakeBidSummary(item))}</p>
          ${renderIntakeChangeHistory(item)}
          ${renderIntakeGroupDates(item, canReview)}
          ${item.reviewNote ? `<p class="intake-warning">${escapeHtml(item.reviewNote)}</p>` : ""}
          ${item.type === "Leave" && item.status === "Pending" && intakeReviewConflicts(item, leaveRdoConflicts).length ? `<p class="intake-warning">Cannot approve: ${formatLeaveConflictDates(intakeReviewConflicts(item, leaveRdoConflicts))} ${intakeReviewConflicts(item, leaveRdoConflicts).length === 1 ? "is" : "are"} the bidder's RDO.</p>` : ""}
          ${item.type === "Leave" && item.status === "Pending" && intakeReviewConflicts(item, leaveApprovalConflicts).length ? `<p class="intake-warning">Requires override before approval: ${formatLeaveConflictDates(intakeReviewConflicts(item, leaveApprovalConflicts))} is full.</p>` : ""}
          <div class="intake-meta">
            <span>${item.area}</span>
            <span>Seniority #${item.seniority}</span>
            <span>Bid as ${item.bidAs}</span>
            ${item.ghostBid ? `<span class="ghost-bid-badge">Does not count against area capacity</span>` : ""}
            ${item.type === "RDO Line" && item.bidAs === "GL" && !item.ghostBid ? `<span class="gl-bid-badge">GL RDO · visible, no line taken</span>` : ""}
            ${item.type === "Leave" && isGlLeaveItem(item) ? `<span class="gl-bid-badge">GL Bid · visible, no slot used</span>` : ""}
            <span>${escapeHtml(intakeSubmissionLabel(item))}</span>
          </div>
        </div>
        <div class="intake-actions">
          ${item.isChange ? '<span class="intake-change-badge">Change Request</span>' : ""}
          <span class="status ${intakeDisplayStatus(item).toLowerCase()}">${escapeHtml(intakeDisplayStatus(item))}</span>
          ${item.status === "Pending" && canReview ? `
            <button class="primary-action small" type="button" data-intake-approve="${item.id}">${item.members ? (item.round === 1 ? "Approve week" : "Approve batch") : "Approve"}</button>
            <button class="secondary-action small danger" type="button" data-intake-deny="${item.id}">${item.members ? (item.round === 1 ? "Deny week" : "Deny batch") : "Deny"}</button>
          ` : ""}
          ${canReview && !item.members && ["Pending", "Approved"].includes(item.status) && (item.type !== "Leave" || intakeLeaveRoundIsOpen(item)) ? `<button class="secondary-action small" type="button" data-intake-edit="${item.id}">${item.status === "Pending" ? "Edit / Override" : item.type === "Leave" ? "Edit Dates" : "Admin Edit"}</button>` : ""}
          ${canReview && item.members && item.status === "Approved" && intakeLeaveRoundIsOpen(item) ? `<button class="secondary-action small" type="button" data-intake-manage-leave="${item.id}">Edit Dates</button>` : ""}
          ${canReview && item.type === "Leave" && item.status === "Approved" && intakeLeaveRoundIsOpen(item) ? `<button class="secondary-action small danger" type="button" data-intake-remove-leave="${item.id}" ${intakeLeaveRemovalPendingId ? "disabled" : ""}>${intakeLeaveRemovalPendingId === item.id ? "Removing…" : "Remove Bid"}</button>` : ""}
          ${item.type === "Leave" && item.status === "Approved" && !intakeLeaveRoundIsOpen(item) ? `<small>Round ${intakeItemRound(item)} closed · dates and removal locked</small>` : ""}
          ${item.status === "Approved" ? `<small>Approved by ${escapeHtml(intakeReviewerLabel(item.approvedBy))} · ${item.approvedAt}</small>` : ""}
          ${item.status === "Denied" ? `<small>Denied by ${escapeHtml(intakeReviewerLabel(item.deniedBy))} · ${item.deniedAt}</small>` : ""}
          ${intakeCancellationNote(item) ? `<small>${escapeHtml(intakeCancellationNote(item))}</small>` : ""}
        </div>
      </article>
    `).join("")
    : '<div class="empty-state">No intake submissions match the current search.</div>';

  const panel = document.getElementById("override-panel");
  const editor = document.querySelector("[data-override-editor]");
  const activeItem = intakeQueue.find((item) => item.id === activeOverrideId);
  const editableItem = activeItem?.type === "Leave" && !intakeLeaveRoundIsOpen(activeItem) ? null : activeItem;
  if (activeItem && !editableItem) activeOverrideId = null;
  if (panel && editor) {
    panel.hidden = !editableItem;
    editor.innerHTML = editableItem ? renderOverrideEditor(editableItem) : "";
  }

  const denialPanel = document.getElementById("denial-panel");
  const denialEditor = document.querySelector("[data-denial-editor]");
  const denialItem = intakeReviewItemById(activeDenialId);
  if (denialPanel && denialEditor) {
    denialPanel.hidden = !denialItem;
    denialEditor.innerHTML = denialItem ? renderDenialEditor(denialItem) : "";
  }
  const backdrop = document.querySelector("[data-intake-editor-backdrop]");
  if (backdrop) backdrop.hidden = !(editableItem || denialItem);
}

function focusIntakeEditor(panelId) {
  window.requestAnimationFrame(() => {
    const panel = document.getElementById(panelId);
    if (!panel || panel.hidden) return;
    const focusTarget = panel.querySelector("[data-denial-reason]")
      || panel.querySelector("[data-override-line], [data-override-range]")
      || panel.querySelector("textarea, input:not([readonly]), select")
      || panel.querySelector("button");
    focusTarget?.focus();
    if (!window.matchMedia("(max-width: 720px)").matches) {
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

function closeIntakeEditor() {
  const returnTarget = intakeEditorReturnFocus;
  activeOverrideId = null;
  activeDenialId = null;
  renderIntakeQueue();
  if (returnTarget) {
    const actionSelector = returnTarget.action === "deny" ? "[data-intake-deny]" : "[data-intake-edit]";
    const returnCard = [...document.querySelectorAll("[data-intake-card]")]
      .find((card) => card.dataset.intakeCard === returnTarget.id);
    returnCard?.querySelector(actionSelector)?.focus();
  }
  intakeEditorReturnFocus = null;
}

function revealIntakeDetail() {
  if (!window.matchMedia("(max-width: 720px)").matches) return;
  window.requestAnimationFrame(() => {
    const detail = document.querySelector("[data-intake-detail-panel]");
    if (!detail || detail.hidden) return;
    detail.scrollIntoView({ behavior: "smooth", block: "start" });
    detail.focus({ preventScroll: true });
  });
}

function openIntakeItemFromAlert(itemId) {
  return withLeaveReadCache(() => openIntakeItemFromAlertWithCache(itemId));
}

function openIntakeItemFromAlertWithCache(itemId) {
  const groupedItem = groupedLeaveIntakeItems().find((item) =>
    item.id === itemId || item.members?.some((member) => member.id === itemId)
  );
  if (!groupedItem) return;

  activeIntakeDetailId = groupedItem.id;
  activeOverrideId = null;
  activeDenialId = null;
  intakeSearchQuery = "";
  intakeSearchEmployeeInitials = "";
  Object.keys(intakeFilters).forEach((filterName) => { intakeFilters[filterName] = "all"; });
  selectIntakeBidder(groupedItem.initials, groupedItem.bidderId, { deferRender: true });
  const alreadyInIntake = document.querySelector(".page.active")?.dataset.pagePanel === "intake";
  setPage("intake");
  if (alreadyInIntake) {
    renderIntakeQueue();
    ensureIntakeBidderSelection();
  }

  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    const card = [...document.querySelectorAll("[data-intake-card]")]
      .find((candidate) => candidate.dataset.intakeCard === groupedItem.id);
    if (!card) return;
    card.scrollIntoView({ behavior: "instant", block: "start" });
    card.focus({ preventScroll: true });
  }));
}

function syncNavigationUrl(url) {
  replaceBrowserHistory(window, url.toString());
  // Preserve the visible address when this app is embedded in the dashboard.
  if (window.parent !== window) {
    window.parent.postMessage({ type: "bidding-navigation", search: url.search }, window.location.origin);
    try {
      const parentUrl = new URL(window.parent.location.href);
      for (const key of ["page", "member", "area", "section", "bidYear"]) {
        if (url.searchParams.has(key)) parentUrl.searchParams.set(key, url.searchParams.get(key));
        else parentUrl.searchParams.delete(key);
      }
      replaceBrowserHistory(window.parent, parentUrl.toString());
    } catch {
      // A host on another origin cannot expose its address to this frame.
    }
  }
}

function syncMemberPageUrl(pageName) {
  const url = new URL(window.location.href);
  url.searchParams.set("page", pageName);
  url.searchParams.delete("area");
  url.searchParams.delete("section");
  syncNavigationUrl(url);
}

function setPage(pageName) {
  if (pageName === "intake" && !canUseIntakeView()) {
    pageName = "history";
  }
  if (pageName === "intake-schedule" && !canViewIntakeSchedule()) {
    pageName = "dashboard";
  }
  if ((pageName === "admin" || pageName === "admin-tools") && !hasSystemAdminAccess()) {
    pageName = "dashboard";
  }

  syncMemberPageUrl(pageName);

  document.querySelector("[data-account-menu]")?.setAttribute("hidden", "");
  document.querySelector("[data-account-toggle]")?.setAttribute("aria-expanded", "false");

  const activePageName = document.querySelector(".page.active")?.dataset.pagePanel;

  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active", page.dataset.pagePanel === pageName);
  });

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === pageName);
  });
  document.querySelector(".mobile-app-menu")?.removeAttribute("open");

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
    "admin-tools": "Bidding Setup",
    history: "Bid History",
    profile: "My Profile",
  };
  title.textContent = titles[pageName] || "Dashboard";
  syncViewModeSwitcher(pageName);
  if (isMemberAppVisible() && activePageName !== pageName) renderMemberPageContent(pageName);
  if (activePageName !== pageName) {
    window.scrollTo({ top: 0, behavior: "instant" });
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" }));
  }
  if (isMemberAppVisible() && ["dashboard", "leave", "calendar"].includes(pageName)) {
    const needsFullRender = memberPageCalendarNeedsRender(pageName);
    renderMemberCalendarForPage(pageName, {
      defer: activePageName !== pageName && needsFullRender,
    });
    if (pageName === "leave" || pageName === "calendar") renderLeaveSlotBoard();
  }
}

function updateSelectedBidYear(year) {
  if (Number(year) !== BID_YEAR && bidYearCatalog.some((entry) => entry.bid_year === Number(year))) {
    navigateToBidYear(Number(year));
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

// Keep the draft separate from the intake queue until the atomic database save succeeds.
const bidderEditor = { record: null, person: null, results: [], validated: '', busy: false, generation: 0 };
let bidderEditorSearchTimer;
function bidderEditorStatus(message, kind = '') {
  showActionFeedback(message, kind || 'info');
  const status = document.querySelector('[data-bidder-editor-status]');
  if (status) { status.textContent = message; status.dataset.kind = kind; }
}
function bidderEditorDraft() {
  const form = document.querySelector('[data-bidder-editor-form]');
  const field = (name) => form.querySelector(`[data-editor-field="${name}"]`)?.value;
  return {
    rdo: field('line_id') ? { line_id: field('line_id'), fatigue_group: field('fatigue_group'),
      flex: field('flex') === 'true', aws: field('aws') === 'true', mid: field('mid'),
      gl_line_type_verified: bidderEditor.person?.bid_role !== 'GL'
        || Boolean(form.querySelector('[data-editor-gl-line-type-verification]')?.checked) } : null,
    leave: (bidderEditor.record?.snapshot.leave || []).map((row) => ({ id: row.id,
      // Hidden requests must retain their dates in the complete database save payload.
      start_date: row.status === 'approved' ? form.querySelector(`[data-editor-start="${row.id}"]`)?.value || null : row.requested_start_date,
      end_date: row.status === 'approved' ? form.querySelector(`[data-editor-end="${row.id}"]`)?.value || null : row.requested_end_date,
    })),
  };
}
function bidderEditorSetBusy(busy) {
  bidderEditor.busy = busy;
  document.querySelectorAll('[data-bidder-editor] input, [data-bidder-editor] select, [data-bidder-editor] button, [data-bidder-editor] fieldset').forEach((el) => { el.disabled = busy; });
  const submit = document.querySelector('[data-editor-submit]');
  if (submit) submit.disabled = busy || !bidderEditor.validated || bidderEditor.validated !== JSON.stringify(bidderEditorDraft());
}
function invalidateBidderEditor() {
  bidderEditor.validated = '';
  bidderEditorSetBusy(false);
  document.querySelector('[data-editor-review]')?.replaceChildren();
  bidderEditorStatus('Unsaved changes. Confirm and check changes before submitting.');
}
async function searchBidderEditor(query) {
  const generation = ++bidderEditor.generation;
  const results = document.querySelector('[data-bidder-editor-results]');
  results.replaceChildren();
  if (!query.trim()) { bidderEditorStatus('Enter a name or initials to find a bidder.'); return; }
  bidderEditorStatus('Searching bidders…');
  try {
    const client = supabaseClient();
    if (!client || !supabaseState.connected) throw new Error('Connect to the database to search and edit saved bids.');
    const { data, error } = await client.rpc('read_admin_bidder_editor', { requested_bid_year: BID_YEAR, search_text: query.trim() });
    if (generation !== bidderEditor.generation) return;
    if (error) throw error;
    bidderEditor.results = data.bidders;
    results.innerHTML = data.bidders.map((person) => `<button type="button" data-editor-bidder="${escapeHtml(person.id)}" aria-pressed="${person.id === bidderEditor.person?.id}"><strong>${escapeHtml(person.first_name)} ${escapeHtml(person.last_name)}</strong> · ${escapeHtml(person.initials || 'No initials')}<br>${escapeHtml(person.area)} · ${escapeHtml(person.bid_role)}${person.is_ghost_bidder ? ' · Ghost Bidder' : ''}</button>`).join('');
    bidderEditorStatus(data.bidders.length ? `${data.bidders.length} matching bidders${data.bidders.length === 50 ? ' (first 50; refine your search)' : ''}. Select a bidder to edit.` : 'No bidders match this search in your authorized areas.');
  } catch (error) { if (generation === bidderEditor.generation) bidderEditorStatus(error.message || 'Unable to search bidders.', 'error'); }
}
function renderBidderEditorForm() {
  const editingForm = document.querySelector("[data-bidder-editor-form]");
  if (editingForm) delete editingForm.dataset.approvalRefreshDirty;
  const { snapshot, lines } = bidderEditor.record;
  const payload = snapshot.rdo?.payload || {};
  const assigned = snapshot.assignment;
  const lineId = snapshot.rdo?.rdo_line_id || assigned?.id || '';
  const initial = snapshot.rdo ? {
    fatigue_group: payload.fatigueGroup || payload.fatigue_group || '',
    flex: String(payload.flex).toLowerCase() === 'true' || payload.flex === 'Yes',
    aws: String(payload.aws).toLowerCase() === 'true' || payload.aws === 'Yes', mid: payload.mid || 'No',
  } : assigned || { fatigue_group: '', flex: false, aws: false, mid: 'No' };
  const select = (label, key, values, value) => `<label>${label}<select data-editor-field="${key}">${values.map(([v,l]) => `<option value="${escapeHtml(String(v))}"${String(v) === String(value) ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></label>`;
  const person = bidderEditor.person;
  const ghostBidder = Boolean(snapshot.is_ghost_bidder ?? person.is_ghost_bidder);
  const selectedLine = lines.find(line => line.id === lineId);
  const glLineCategory = selectedLine && /DEV/i.test(selectedLine.pattern) ? 'DEV' : person.area === 'TMU' ? 'TMC' : 'CPC';
  document.querySelector('[data-bidder-editor-form]').innerHTML = `
    <h3>${escapeHtml(person.first_name)} ${escapeHtml(person.last_name)} · ${escapeHtml(person.initials || 'No initials')}</h3>
    <p>${escapeHtml(person.area)} · ${escapeHtml(person.bid_role)} · Changes retain each bid’s current approval status.</p>
    <fieldset class="ghost-bidder-setting"><legend>Ghost bidding · Bid Year ${BID_YEAR}</legend>
      <label class="override-check"><input type="checkbox" data-editor-ghost-bidder ${ghostBidder ? 'checked' : ''} /> Designate this controller as a ghost bidder</label>
      <p>A ghost bidder’s selected RDO is saved as a <strong>Ghost Line</strong>. RDO inventory and leave capacity remain available to bidders who follow.</p>
      <button type="button" class="secondary-action" data-editor-save-ghost>Update ghost bidding status</button>
    </fieldset>
    <fieldset><legend>RDO bid · ${escapeHtml(snapshot.rdo?.status || (assigned ? 'approved' : 'not yet bid'))}</legend><div class="bidder-editor-fields">
      ${select('RDO line','line_id',[['','Select a line'], ...lines.map(l => [l.id, `${l.line_code} · ${l.pattern}${l.status !== 'open' && l.assigned_bidder_id !== person.id ? ' · unavailable' : ''}`])],lineId)}
      ${select('Fatigue group','fatigue_group',[['','Select a group'],['A','Group A'],['B','Group B'],['C','Group C']],initial.fatigue_group)}
      ${select('Flex','flex',[[true,'Yes'],[false,'No']],initial.flex)}
      ${select('AWS','aws',[[true,'Yes'],[false,'No']],initial.aws)}
      ${select('Mid','mid',[['No','No'],['Yes','Yes'],['BID','BID']],initial.mid)}
    </div>
    ${person.bid_role === 'GL' ? `<label class="override-check gl-line-type-verification">
      <input type="checkbox" data-editor-gl-line-type-verification />
      I verified this GL is bidding as <span data-editor-gl-line-type-label>${glLineCategory}</span>. All GL rules still apply.
    </label>` : ''}</fieldset>
    ${[1,2,3,4,5].map(round => {
      const rows = snapshot.leave.filter(row => row.round_number === round && row.status === 'approved');
      return `<fieldset><legend>Round ${round} · ${rows.length} leave bid${rows.length === 1 ? '' : 's'}</legend>${rows.length ? rows.map(row => `
        <div class="bidder-editor-date-row"><div><strong>Priority ${row.priority}</strong> · ${escapeHtml(row.status)}<br><small>${row.charged_days} charged days currently</small></div>
          <label>Start date<input type="date" min="${BID_YEAR}-01-10" max="${BID_YEAR+1}-01-08" data-editor-start="${row.id}" value="${escapeHtml(row.requested_start_date || '')}" /></label>
          <label>End date<input type="date" min="${BID_YEAR}-01-10" max="${BID_YEAR+1}-01-08" data-editor-end="${row.id}" value="${escapeHtml(row.requested_end_date || '')}" /></label>
        </div>`).join('') : '<p>No approved leave bids in this round.</p>'}</fieldset>`;
    }).join('')}
    <div data-editor-review aria-live="polite"></div>
    <div class="bidder-editor-actions"><button type="button" class="secondary-action" data-editor-check>1. Confirm &amp; check changes</button>
      <button type="button" class="primary-action" data-editor-submit disabled>2. Submit changes to database</button></div>`;
  bidderEditor.initialDraft = JSON.stringify(bidderEditorDraft());
  bidderEditor.validated = '';
}
async function loadBidderEditor(id) {
  if (bidderEditor.busy) return;
  if (bidderEditor.record && JSON.stringify(bidderEditorDraft()) !== bidderEditor.initialDraft &&
    !window.confirm('Discard unsaved edits and load this bidder?')) return;
  const person = bidderEditor.results.find(p => p.id === id);
  if (!person) return;
  const generation = ++bidderEditor.generation;
  clearTimeout(bidderEditorSearchTimer);
  bidderEditorSetBusy(true);
  bidderEditorStatus('Loading all bid rounds…');
  try {
    const { data, error } = await supabaseClient().rpc('read_admin_bidder_editor', { requested_bid_year: BID_YEAR, target_bidder_id: id });
    if (generation !== bidderEditor.generation) return;
    if (error) throw error;
    bidderEditor.person = person;
    bidderEditor.record = data;
    renderBidderEditorForm();
    document.querySelectorAll('[data-editor-bidder]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.editorBidder === id)));
    bidderEditorStatus('Edit the values below, then confirm and check changes.');
  } catch (error) { bidderEditorStatus(error.message || 'Could not load bidder.', 'error'); }
  finally { bidderEditorSetBusy(false); }
}
async function processBidderEditor(validateOnly) {
  if (bidderEditor.busy || !bidderEditor.record || !hasIntakeAccess()) return;
  const generation = bidderEditor.generation;
  const draft = bidderEditorDraft();
  const serialized = JSON.stringify(draft);
  if (serialized === bidderEditor.initialDraft) { bidderEditorStatus('No changes to save. Edit a value first.'); return; }
  if (validateOnly) {
    if (!window.confirm(`Are you sure you want to make these changes to ${bidderEditor.person.first_name} ${bidderEditor.person.last_name} (${bidderEditor.person.initials || bidderEditor.person.area})? The next step checks your changes; nothing is saved yet.`)) return;
  } else if (bidderEditor.validated !== serialized) { invalidateBidderEditor(); return; }
  bidderEditor.validated = '';
  bidderEditorSetBusy(true);
  bidderEditorStatus(validateOnly ? 'Checking bidding rules and availability…' : 'Rechecking and saving changes…');
  try {
    const { data, error } = await supabaseClient().rpc('edit_admin_bidder', {
      requested_bid_year: BID_YEAR, target_bidder_id: bidderEditor.person.id,
      expected_snapshot: bidderEditor.record.snapshot, changes: draft, validate_only: validateOnly,
    });
    if (generation !== bidderEditor.generation) return;
    if (error) throw error;
    if (!data?.valid) throw new Error((data?.errors || ['Validation did not complete.']).join('\n'));
    if (validateOnly) {
      bidderEditor.validated = serialized;
      const original = JSON.parse(bidderEditor.initialDraft);
      const changes = [];
      const lineLabel = id => bidderEditor.record.lines.find(l => l.id === id)?.line_code || 'None';
      const labels = { line_id: 'RDO line', fatigue_group: 'Fatigue group', flex: 'Flex', aws: 'AWS', mid: 'Mid' };
      for (const [key,label] of Object.entries(labels)) {
        if (draft.rdo?.[key] !== original.rdo?.[key]) {
          const format = value => key === 'line_id' ? lineLabel(value) : typeof value === 'boolean' ? value ? 'Yes' : 'No' : value || 'None';
          changes.push(`${label}: ${format(original.rdo?.[key])} → ${format(draft.rdo?.[key])}`);
        }
      }
      draft.leave.forEach((row,i) => {
        if (JSON.stringify(row) !== JSON.stringify(original.leave[i])) {
          const stored = bidderEditor.record.snapshot.leave[i];
          changes.push(`Round ${stored.round_number}, priority ${stored.priority}: ${original.leave[i].start_date || 'None'} – ${original.leave[i].end_date || 'None'} → ${row.start_date} – ${row.end_date}`);
        }
      });
      document.querySelector('[data-editor-review]').innerHTML = `<div class="bidder-editor-review"><strong>Validated changes</strong><ul>${changes.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul></div>`;
      bidderEditorStatus('Checks passed. Review the changes below, then submit to save them.', 'success');
    } else {
      if (!data.saved) throw new Error('The database did not confirm the save. Reload before retrying.');
      bidderEditor.record.snapshot = data.snapshot;
      renderBidderEditorForm();
      bidderEditorStatus('Changes saved to the database. All bid rounds have been refreshed.', 'success');
      try { await refreshBiddingAfterIntakeDecision(); renderApp(); }
      catch { bidderEditorStatus('Changes saved. Refresh the page to update other bidding views.', 'success'); }
    }
  } catch (error) { bidderEditorStatus(error.message || 'Unable to complete this operation. Reload before retrying.', 'error'); }
  finally { bidderEditorSetBusy(false); }
}
async function saveBidderGhostStatus() {
  if (bidderEditor.busy || !bidderEditor.person || !bidderEditor.record || !hasIntakeAccess()) return;
  const shouldBeGhost = Boolean(document.querySelector('[data-editor-ghost-bidder]')?.checked);
  const currentValue = Boolean(bidderEditor.record.snapshot.is_ghost_bidder);
  if (shouldBeGhost === currentValue) {
    bidderEditorStatus(`This bidder is already ${shouldBeGhost ? 'a ghost bidder' : 'a standard bidder'} for ${BID_YEAR}.`);
    return;
  }
  if (!window.confirm(`Set ${bidderEditor.person.first_name} ${bidderEditor.person.last_name} as ${shouldBeGhost ? 'a ghost bidder' : 'a standard bidder'} for ${BID_YEAR}? This status must be set before RDO or leave bids are submitted.`)) return;
  bidderEditorSetBusy(true);
  bidderEditorStatus('Updating ghost bidding status…');
  try {
    const { data, error } = await supabaseClient().rpc('set_ghost_bidding_status', {
      requested_bid_year: BID_YEAR,
      target_bidder_id: bidderEditor.person.id,
      should_be_ghost: shouldBeGhost,
    });
    if (error) throw error;
    bidderEditor.record.snapshot.is_ghost_bidder = Boolean(data?.is_ghost_bidder);
    bidderEditor.person.is_ghost_bidder = Boolean(data?.is_ghost_bidder);
    if (bidderEditor.person.id === currentUser.supabaseProfileId) currentUser.ghostBidder = Boolean(data?.is_ghost_bidder);
    renderBidderEditorForm();
    bidderEditorStatus(`Ghost bidding status updated for ${BID_YEAR}.`, 'success');
    await loadSupabaseReferenceData();
    renderApp();
  } catch (error) {
    bidderEditorStatus(error.message || 'Ghost bidding status could not be updated.', 'error');
  } finally {
    bidderEditorSetBusy(false);
  }
}
document.addEventListener('input', (event) => {
  if (event.target.matches('[data-bidder-editor-search]')) {
    ++bidderEditor.generation;
    clearTimeout(bidderEditorSearchTimer);
    bidderEditorSearchTimer = setTimeout(() => searchBidderEditor(event.target.value), 300);
  } else if (event.target.closest('[data-bidder-editor-form]')) invalidateBidderEditor();
});
document.addEventListener('change', (event) => {
  if (event.target.matches('[data-editor-ghost-bidder]')) {
    bidderEditorStatus('Ghost bidding status has not been saved yet. Use the update button in that section.');
  } else if (event.target.matches('[data-editor-field="line_id"]') && bidderEditor.person?.bid_role === 'GL') {
    const selectedLine = bidderEditor.record?.lines.find(line => line.id === event.target.value);
    const category = selectedLine && /DEV/i.test(selectedLine.pattern) ? 'DEV' : bidderEditor.person.area === 'TMU' ? 'TMC' : 'CPC';
    const form = event.target.closest('[data-bidder-editor-form]');
    const label = form?.querySelector('[data-editor-gl-line-type-label]');
    const verification = form?.querySelector('[data-editor-gl-line-type-verification]');
    if (label) label.textContent = category;
    if (verification) verification.checked = false;
    invalidateBidderEditor();
  } else if (event.target.closest('[data-bidder-editor-form]')) invalidateBidderEditor();
});
document.addEventListener('click', async (event) => {
  const manualIntakeToggle = event.target.closest('[data-manual-intake-toggle]');
  if (manualIntakeToggle) {
    const panelName = manualIntakeToggle.dataset.manualIntakeToggle;
    const content = document.querySelector(`[data-manual-intake-content="${panelName}"]`);
    const open = manualIntakeToggle.getAttribute('aria-expanded') !== 'true';
    manualIntakeToggle.setAttribute('aria-expanded', String(open));
    if (content) content.hidden = !open;
    const preferenceKey = manualIntakeToggle.dataset.preferenceKey;
    if (preferenceKey) {
      storeJsonValue(preferenceKey, {
        ...storedJsonValue(preferenceKey, {}),
        [panelName]: open,
      });
    }
    return;
  }
  const bidder = event.target.closest('[data-editor-bidder]');
  if (bidder) await runUiAction("editor-load", bidder, "Loading bidder…", () => loadBidderEditor(bidder.dataset.editorBidder));
  if (event.target.closest('[data-editor-check]')) await runUiAction('editor-save', event.target.closest('[data-editor-check]'), 'Validating changes…', () => processBidderEditor(true));
  if (event.target.closest('[data-editor-submit]')) await runUiAction('editor-save', event.target.closest('[data-editor-submit]'), 'Saving changes…', () => processBidderEditor(false));
  if (event.target.closest('[data-editor-save-ghost]')) await runUiAction('editor-save', event.target.closest('[data-editor-save-ghost]'), 'Saving ghost status…', () => saveBidderGhostStatus());

  const intakeControl = event.target.closest('[data-intake-control]');
  if (intakeControl) {
    const controlName = intakeControl.dataset.intakeControl;
    const shouldOpen = intakeControl.getAttribute('aria-expanded') !== 'true';
    document.querySelectorAll('[data-intake-control]').forEach((button) => {
      button.setAttribute('aria-expanded', String(shouldOpen && button.dataset.intakeControl === controlName));
    });
    document.querySelectorAll('[data-intake-control-panel]').forEach((panel) => {
      panel.hidden = !shouldOpen || panel.dataset.intakeControlPanel !== controlName;
    });
  }
});

function renderMemberPageContent(pageName) {
  return withLeaveReadCache(() => {
    if (pageName === "rdos") {
      syncRdoFilterControls();
      renderRdoLines();
    }
    if (["dashboard", "leave", "calendar"].includes(pageName)) renderMemberLeaveContent(pageName);
    if (pageName === "leave") renderSubmittedLeaveManager();
    if (pageName === "seniority") renderSeniority();
    if (pageName === "intake-schedule") renderIntakeSchedule();
    if (pageName === "history") renderHistory();
    if (pageName === "intake") {
      renderRoundRuleSummaryList();
      renderApprovalRuleSummary();
      renderIntakeQueue();
      renderManualBidEntry();
      ensureIntakeBidderSelection();
    }
    if (pageName === "admin") {
      renderAdminConsole();
    }
    if (pageName === "admin-tools") renderAdminToolsPage();
  });
}

// Rebuild personal leave controls only when their page is visible. Admin and
// intake saves must not calculate annual leave budgets for hidden pages.
function renderMemberLeaveContent(pageName) {
  if (pageName === "dashboard" || pageName === "leave") {
    syncLeaveBuilderInputs();
    renderLeaveRows(pageName === "dashboard" ? "dashboard-leave-rows" : "leave-page-rows");
    renderLeaveAllowanceSummary();
    renderLeaveBucketCards();
  }
  if (pageName === "leave") {
    renderLeaveDraftQueue();
    renderLeaveDatePicker();
  }
  if (pageName === "leave" || pageName === "calendar") renderLeaveSlotBoard();
}

function renderApp() {
  return withLeaveReadCache(() => renderAppWithCache());
}

function renderAppWithCache() {
  syncBidYearControls();
  syncPilotControls();
  setText("[data-editor-year]", String(BID_YEAR));
  if (!isMemberAppVisible()) {
    renderPublicPage();
    return;
  }

  seniority = buildSeniority();
  renderCurrentUser();
  // Mark hidden calendars stale so navigation renders the latest saved bids.
  calendarRenderRevision += 1;
  renderCalendars({ includePublic: false });
  updateSelectedLine();
  renderHelpSummary();
  renderHelpPanel();
  renderAlerts();
  renderMemberPageContent(document.querySelector(".page.active")?.dataset.pagePanel);
  updateBidWindow(true);
}

function logOut() {
  supabaseClient()?.auth.signOut();
  clearSupabaseAccountState();
  manualLeaveControllerInitials = "";
  const leaveController = document.querySelector(".manual-leave-request-card [data-manual-bid-controller]");
  if (leaveController) leaveController.value = "";
  selectedViewArea = null;
  document.querySelector(".app-shell")?.setAttribute("hidden", "");
  document.querySelector("[data-help-menu]")?.setAttribute("hidden", "");
  document.querySelector(".login-screen")?.removeAttribute("hidden");
  const loginToggle = document.querySelector("[data-public-login-toggle]");
  if (loginToggle) loginToggle.textContent = "Login";
  renderPublicPage(publicState.area, publicState.section, { persistNavigation: true });
}

document.addEventListener("click", async (event) => {
  const leaveSortButton = event.target.closest("[data-bidder-leave-sort]");
  if (leaveSortButton) {
    const column = leaveSortButton.dataset.bidderLeaveSort;
    if (!["round", "date", "status"].includes(column)) return;
    if (column === "status" && !bidderLeaveSort.statusActive) {
      bidderLeaveSort.statusActive = true;
      bidderLeaveSort.status = "asc";
    } else {
      bidderLeaveSort[column] = bidderLeaveSort[column] === "asc" ? "desc" : "asc";
      if (column === "round") bidderLeaveSort.statusActive = false;
    }
    renderLeaveRows("dashboard-leave-rows");
    renderLeaveRows("leave-page-rows");
    return;
  }
  if (event.target.closest("[data-intake-refresh]")) {
    await runUiAction("intake-refresh", event.target.closest("[data-intake-refresh]"), "Refreshing bids…", refreshIntakeQueue);
    return;
  }
  // Navigation must stay available even when bidding data cannot load.
  const pageNavigation = event.target.closest("[data-page]");
  if (pageNavigation?.matches("button") && !pageNavigation.matches(".window-action") && !pageNavigation.closest("[data-alert-list]")) {
    setPage(pageNavigation.dataset.page);
    return;
  }
  const intakeBidderDetailOpen = event.target.closest("[data-intake-bidder-detail-open]");
  if (intakeBidderDetailOpen) {
    intakeBidderSelection.detail = intakeBidderDetailOpen.dataset.intakeBidderDetailOpen;
    renderIntakeBidderSummary();
    document.querySelector("[data-intake-bidder-detail]")?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (event.target.closest("[data-intake-bidder-detail-close]")) {
    intakeBidderSelection.detail = "";
    renderIntakeBidderSummary();
    return;
  }

  const intakeEmployeeResult = event.target.closest("[data-intake-employee-result]");
  if (intakeEmployeeResult) {
    const person = bueByInitials(intakeEmployeeResult.dataset.intakeEmployeeResult);
    if (!person) return;
    intakeSearchEmployeeInitials = person.initials;
    intakeSearchQuery = personDisplayName(person);
    selectIntakeBidder(person.initials, person.profileId);
    renderIntakeQueue();
    document.querySelector("[data-intake-search]")?.focus();
    return;
  }

  const manualControllerResult = event.target.closest("[data-manual-controller-result]");
  if (manualControllerResult) {
    const panel = manualControllerResult.closest("[data-manual-bid-panel]");
    const controllerSelect = panel?.querySelector("[data-manual-bid-controller]");
    const controllerSearch = panel?.querySelector("[data-manual-controller-search]");
    if (panel && controllerSelect) {
      controllerSelect.value = manualControllerResult.dataset.manualControllerResult;
      if (panel.classList.contains("manual-leave-request-card")) manualLeaveControllerInitials = controllerSelect.value;
      if (controllerSearch) controllerSearch.value = "";
      renderManualBidPanel(panel);
      const person = manualBidSelectedPerson(controllerSelect.value);
      setManualBidStatus(panel, `Selected ${controllerName(person)} (${person.initials}).`);
      selectIntakeBidder(person.initials, person.profileId);
      controllerSelect.focus();
    }
    return;
  }

  const intakeTeamCandidateResult = event.target.closest("[data-intake-team-candidate-result]");
  if (intakeTeamCandidateResult) {
    selectedIntakeTeamCandidateInitials = intakeTeamCandidateResult.dataset.intakeTeamCandidateResult || "";
    intakeTeamCandidateQuery = "";
    renderIntakeTeamCandidateSearch();
    document.querySelector("[data-add-intake-team-member]")?.focus();
    return;
  }

  const mobileAppMenu = event.target.closest(".mobile-app-menu");
  if (mobileAppMenu && event.target.closest("button")) mobileAppMenu.removeAttribute("open");

  const publicDate = event.target.closest("[data-public-leave-date]");
  if (publicDate && window.matchMedia("(max-width: 900px)").matches) {
    openPublicDateSheet(publicDate);
    return;
  }
  if (event.target.closest("[data-public-date-close]")) {
    document.querySelector("[data-public-date-sheet]").close();
    return;
  }
  if (event.target.closest("[data-late-bid-close]") || event.target.matches("[data-late-bid-dialog]")) {
    closeLateBidDialog();
    return;
  }
  const mobileCalendar = event.target.closest("[data-mobile-calendar]");
  const monthStep = event.target.closest("[data-mobile-month-step]");
  if (monthStep) {
    const next = new Date(displayedCalendarYear, displayedCalendarMonth + Number(monthStep.dataset.mobileMonthStep), 1);
    displayedCalendarYear = next.getFullYear();
    displayedCalendarMonth = next.getMonth();
    setSelectedDateYear(displayedCalendarYear);
    annualMobileCalendars.delete(mobileCalendar.dataset.mobileCalendar);
    renderVisibleCalendars();
    document.querySelector(`[data-mobile-calendar="${mobileCalendar.dataset.mobileCalendar}"] [data-mobile-month-step="${monthStep.dataset.mobileMonthStep}"]`)?.focus();
    return;
  }
  if (event.target.closest("[data-mobile-calendar-annual]")) {
    const id = mobileCalendar.dataset.mobileCalendar;
    if (annualMobileCalendars.has(id)) annualMobileCalendars.delete(id);
    else annualMobileCalendars.add(id);
    renderVisibleCalendars();
    return;
  }
  const presentation = event.target.closest("[data-rdo-presentation]");
  if (presentation) {
    publicRdoPresentation = presentation.dataset.rdoPresentation;
    document.querySelector("[data-public-rdo-sections]").dataset.presentation = publicRdoPresentation;
    document.querySelectorAll("[data-rdo-presentation]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.rdoPresentation === publicRdoPresentation)));
    document.querySelector(".mobile-table-hint").hidden = publicRdoPresentation !== "table";
    return;
  }
  const bidTimePresentation = event.target.closest("[data-bid-time-presentation]");
  if (bidTimePresentation) {
    publicBidTimePresentation = bidTimePresentation.dataset.bidTimePresentation === "list" ? "list" : "cards";
    const results = document.querySelector("[data-public-bid-time-results]");
    if (results) results.dataset.presentation = publicBidTimePresentation;
    document.querySelectorAll("[data-bid-time-presentation]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.bidTimePresentation === publicBidTimePresentation));
    });
    return;
  }
  const memberPresentation = event.target.closest("[data-member-rdo-presentation]");
  if (memberPresentation) {
    memberRdoPresentation = memberPresentation.dataset.memberRdoPresentation === "table" ? "table" : "cards";
    const results = document.querySelector("[data-member-rdo-results]");
    if (results) results.dataset.presentation = memberRdoPresentation;
    document.querySelectorAll("[data-member-rdo-presentation]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.memberRdoPresentation === memberRdoPresentation));
    });
    const hint = document.querySelector(".member-rdo-table-hint");
    if (hint) hint.hidden = memberRdoPresentation !== "table";
    return;
  }

  primeAlertSound();

  if (event.target.closest("[data-add-approval-rule]")) {
    await runUiAction("approval-rule-save", document.querySelector("[data-add-approval-rule]"), "Saving rule…", saveApprovalRuleFromInput);
    return;
  }

  const approvalRuleEdit = event.target.closest("[data-approval-rule-edit]");
  if (approvalRuleEdit) {
    editApprovalRule(Number(approvalRuleEdit.dataset.approvalRuleEdit));
    return;
  }

  const approvalRuleRemove = event.target.closest("[data-approval-rule-remove]");
  if (approvalRuleRemove) {
    await runUiAction("approval-rule-save", approvalRuleRemove, "Removing rule…", () => removeApprovalRule(Number(approvalRuleRemove.dataset.approvalRuleRemove)));
    return;
  }

  const roundRuleSave = event.target.closest("[data-save-round-rule]");
  if (roundRuleSave) {
    await runUiAction("round-rule-save", roundRuleSave, "Saving round…", () => saveRoundRule(Number(roundRuleSave.dataset.saveRoundRule)));
    return;
  }

  const bidWindowToggle = event.target.closest("[data-bid-window-enforcement-toggle]");
  if (bidWindowToggle) {
    await setBidWindowEnforcement(bidWindowToggle.checked);
    return;
  }

  if (event.target.closest("[data-save-pilot-settings]")) {
    await runUiAction("pilot-settings", event.target.closest("[data-save-pilot-settings]"), "Saving settings…", savePilotSettings);
    return;
  }

  if (event.target.closest("[data-reset-pilot-data]")) {
    await runUiAction("pilot-reset", event.target.closest("[data-reset-pilot-data]"), "Resetting pilot…", resetPilotData);
    return;
  }

  if (event.target.closest("[data-reset-pilot-bidder]")) {
    await runUiAction("pilot-reset", event.target.closest("[data-reset-pilot-bidder]"), "Resetting bidder…", resetPilotBidderRound);
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
    event.preventDefault();
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
    const windowError = leaveBidWindowErrorMessage();
    if (windowError) {
      setLeaveBuilderStatus(windowError, "error");
      return;
    }
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
    const windowError = leaveBidWindowErrorMessage();
    if (windowError) {
      setLeavePickerOpen(false);
      setLeaveBuilderStatus(windowError, "error");
      return;
    }
    const previousPreviewKeys = leaveRangePreviewActive ? leaveBuilderDateKeys() : [];
    selectLeaveBuilderDate(leavePickerDateButton.dataset.leavePickerDate);
    syncMemberCalendarSelection(previousPreviewKeys);
    renderLeaveDatePicker();
    return;
  }

  if (leavePickerOpen && !event.target.closest(".date-range-picker")) {
    setLeavePickerOpen(false);
  }

  const publicButton = event.target.closest("[data-public-area]");
  if (publicButton && !event.target.closest(".app-shell")) {
    await runUiAction("public-area-switch", publicButton, "Loading…", () => {
      renderPublicPage(publicButton.dataset.publicArea, publicButton.dataset.publicSection || "Calendar", { persistNavigation: true });
      showActionFeedback(`Now viewing ${publicButton.dataset.publicArea} · ${publicState.section}.`, "success");
    });
    return;
  }

  const accountToggle = event.target.closest("[data-account-toggle]");
  const accountMenu = document.querySelector("[data-account-menu]");
  const alertToggle = event.target.closest("[data-alert-toggle]");
  const alertMenu = document.querySelector("[data-alert-menu]");
  const helpToggle = event.target.closest("[data-help-toggle]");
  const helpMenu = document.querySelector("[data-help-menu]");

  if (helpToggle) {
    document.querySelector(".mobile-public-menu")?.removeAttribute("open");
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
      openHelpPanel(alertItem.dataset.helpThread);
      return;
    }
    if (alertItem.dataset.intakeItem) {
      openIntakeItemFromAlert(alertItem.dataset.intakeItem);
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

  const intakeScheduleDownload = event.target.closest("[data-download-intake-schedule]");
  if (intakeScheduleDownload) {
    downloadIntakeScheduleIcs(intakeScheduleDownload.dataset.downloadIntakeSchedule);
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
    await runUiAction("leave-submit", event.target.closest("[data-submit-leave-batch]"), "Submitting batch…", submitLeaveDraftBatch);
    return;
  }

  if (event.target.closest("[data-add-more-leave-dates]")) {
    openLeaveBuilderForMoreDates();
    return;
  }

  if (event.target.closest("[data-change-all-submitted-leave]")) {
    openBidChangeModal();
    return;
  }

  if (event.target.closest("[data-bid-change-close], [data-bid-change-cancel]")) {
    closeBidChangeModal();
    return;
  }

  if (event.target.matches("[data-bid-change-modal]")) {
    closeBidChangeModal();
    return;
  }

  const weekChoice = event.target.closest('[data-bid-change-select-week]');
  if (weekChoice) { selectRoundOneBidChangeWeek(weekChoice.dataset.bidChangeSelectWeek); return; }
  const weekDate = event.target.closest('[data-bid-change-toggle-date]');
  if (weekDate) { toggleRoundOneBidChangeDate(weekDate.dataset.bidChangeToggleDate); return; }

  if (event.target.closest("[data-bid-change-save]")) {
    await saveBidDateChanges();
    return;
  }

  const changeSubmittedLeave = event.target.closest("[data-change-submitted-leave]");
  if (changeSubmittedLeave) {
    openSubmittedLeaveForReplacement(changeSubmittedLeave.dataset.changeSubmittedLeave);
    return;
  }

  const removeSubmittedLeave = event.target.closest("[data-remove-submitted-leave]");
  if (removeSubmittedLeave) {
    await removeSubmittedLeaveRequest(removeSubmittedLeave.dataset.removeSubmittedLeave);
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

  const editIntakeScheduleButton = event.target.closest("[data-edit-intake-schedule]");
  if (editIntakeScheduleButton) {
    beginIntakeScheduleEdit(editIntakeScheduleButton.dataset.editIntakeSchedule);
    return;
  }

  const deleteIntakeScheduleButton = event.target.closest("[data-delete-intake-schedule]");
  if (deleteIntakeScheduleButton) {
    await runUiAction("intake-schedule-save", deleteIntakeScheduleButton, "Deleting shift…", () => deleteIntakeSchedule(deleteIntakeScheduleButton.dataset.deleteIntakeSchedule));
    return;
  }

  if (event.target.closest("[data-cancel-intake-schedule-edit]")) {
    resetIntakeScheduleEditor({ resetValues: true });
    setScheduleFormStatus("Shift editing canceled.");
    return;
  }

  if (event.target.closest("[data-add-intake-schedule]")) {
    await runUiAction("intake-schedule-save", event.target.closest("[data-add-intake-schedule]"), "Saving shift…", addIntakeScheduleFromForm);
    return;
  }

  const intakeShiftPreset = event.target.closest("[data-intake-shift-preset]");
  if (intakeShiftPreset) {
    applyIntakeShiftPreset(intakeShiftPreset);
    return;
  }

  const editShiftPresetButton = event.target.closest("[data-edit-shift-preset]");
  if (editShiftPresetButton && hasSystemAdminAccess()) {
    const preset = intakeShiftPresets.find((item) => item.id === editShiftPresetButton.dataset.editShiftPreset);
    if (preset) {
      editingShiftPresetId = preset.id;
      const form = document.querySelector("[data-shift-builder-form]");
      form.querySelector("[data-shift-builder-time]").value = preset.startTime;
      form.querySelector("[data-shift-builder-hours]").value = String(preset.durationHours);
      renderShiftPresets();
      form.querySelector("[data-shift-builder-time]").focus();
    }
    return;
  }
  const deleteShiftPresetButton = event.target.closest("[data-delete-shift-preset]");
  if (deleteShiftPresetButton) { await runUiAction("shift-save", deleteShiftPresetButton, "Deleting shift…", () => deleteShiftPreset(deleteShiftPresetButton.dataset.deleteShiftPreset)); return; }
  if (event.target.closest("[data-cancel-shift-preset]")) { resetShiftPresetEditor(); setShiftBuilderStatus(""); return; }

  const scheduleViewButton = event.target.closest("[data-schedule-calendar-view]");
  if (scheduleViewButton) {
    scheduleCalendarView = scheduleViewButton.dataset.scheduleCalendarView || "month";
    renderIntakeSchedule();
    return;
  }

  const markedDayButton = event.target.closest("[data-intake-calendar-date]");
  if (markedDayButton && hasSystemAdminAccess()) {
    selectIntakeCalendarMarkDate(markedDayButton.dataset.intakeCalendarDate);
    return;
  }

  const editMarkedDayButton = event.target.closest("[data-edit-intake-calendar-mark]");
  if (editMarkedDayButton && hasSystemAdminAccess()) {
    selectIntakeCalendarMarkDate(editMarkedDayButton.dataset.editIntakeCalendarMark);
    return;
  }

  if (event.target.closest("[data-clear-intake-calendar-mark]")) {
    await runUiAction("calendar-mark-save", event.target.closest("[data-clear-intake-calendar-mark]"), "Clearing day type…", clearIntakeCalendarMark);
    return;
  }

  const schedulePeriodButton = event.target.closest("[data-schedule-period-action]");
  if (schedulePeriodButton) {
    moveSchedulePeriod(schedulePeriodButton.dataset.schedulePeriodAction === "next" ? 1 : -1);
    return;
  }

  if (event.target.closest("[data-add-intake-team-member]")) {
    await runUiAction("intake-team-save", event.target.closest("[data-add-intake-team-member]"), "Adding member…", addSelectedBueToIntakeTeam);
    return;
  }

  const removeIntakeTeamMember = event.target.closest("[data-remove-intake-team-member]");
  if (removeIntakeTeamMember) {
    await runUiAction("intake-team-save", removeIntakeTeamMember, "Removing member…", () => removeBueFromIntakeTeam(removeIntakeTeamMember.dataset.removeIntakeTeamMember));
    return;
  }

  if (event.target.closest("[data-add-bid-window-blackout]")) {
    addBidWindowBuilderBlackout();
    return;
  }

  const removeBidWindowBlackout = event.target.closest("[data-remove-bid-window-blackout]");
  if (removeBidWindowBlackout) {
    removeBidWindowBuilderBlackout(removeBidWindowBlackout.dataset.removeBidWindowBlackout);
    return;
  }

  if (event.target.closest("[data-save-bid-window-schedule]")) {
    await runUiAction("window-save", event.target.closest("[data-save-bid-window-schedule]"), "Saving schedule…", saveBidWindowBuilderSchedule);
    return;
  }

  if (event.target.closest("[data-roster-new]")) {
    resetRosterForm();
    syncRosterDeleteSelectedButton();
    return;
  }

  if (event.target.closest("[data-export-seniority-roster]")) {
    await runUiAction("roster-export", event.target.closest("[data-export-seniority-roster]"), "Exporting roster…", exportSeniorityRoster);
    return;
  }

  if (event.target.closest("[data-roster-delete-selected]")) {
    await runUiAction("roster-save", event.target.closest("[data-roster-delete-selected]"), "Removing bidder…", () => deleteRosterEntryByIndex(document.querySelector("[data-roster-edit-index]")?.value));
    return;
  }

  if (event.target.closest("[data-apply-bulk-roster]")) {
    await runUiAction("roster-save", event.target.closest("[data-apply-bulk-roster]"), "Saving roster changes…", applyBulkRosterChanges);
    return;
  }

  const editRosterButton = event.target.closest("[data-edit-roster-bue]");
  if (editRosterButton) {
    editRosterEntryByIndex(editRosterButton.dataset.editRosterBue);
    return;
  }

  const deleteRosterButton = event.target.closest("[data-delete-roster-bue]");
  if (deleteRosterButton) {
    await runUiAction("roster-save", deleteRosterButton, "Removing bidder…", () => deleteRosterEntryByIndex(deleteRosterButton.dataset.deleteRosterBue));
    return;
  }

  const viewModeButton = event.target.closest("[data-view-mode]");
  if (viewModeButton) {
    setPage(pageForViewMode(viewModeButton.dataset.viewMode));
    return;
  }

  const adminSectionButton = event.target.closest("[data-admin-section-target]");
  if (adminSectionButton) {
    const section = document.getElementById(adminSectionButton.dataset.adminSectionTarget);
    section?.scrollIntoView({ behavior: "instant", block: "start" });
    section?.focus({ preventScroll: true });
    return;
  }

  const seniorityViewButton = event.target.closest("[data-seniority-view]");
  if (seniorityViewButton) {
    seniorityViewMode = seniorityViewButton.dataset.seniorityView === "list" ? "list" : "cards";
    renderSeniority();
    return;
  }

  if (event.target.closest("[data-seniority-jump-current]")) {
    senioritySearchQuery = "";
    renderSeniority();
    window.requestAnimationFrame(() => {
      const visiblePanel = seniorityViewMode === "list"
        ? document.getElementById("seniority-page-table")
        : document.getElementById("seniority-page-list");
      const currentEntry = visiblePanel?.querySelector("[data-seniority-current]");
      currentEntry?.scrollIntoView({ behavior: "smooth", block: "center" });
      currentEntry?.focus({ preventScroll: true });
    });
    return;
  }

  const manualBidSubmit = event.target.closest("[data-manual-bid-submit]");
  const manualLeaveAdd = event.target.closest("[data-manual-leave-add]");
  if (manualLeaveAdd) {
    const panel = manualLeaveAdd.closest("[data-manual-bid-panel]");
    if (panel && (hasIntakeAccess() || hasSystemAdminAccess()) && panel.dataset.manualBidSubmitting !== "true") addManualLeaveToBatch(panel);
    return;
  }
  const manualLeaveRemove = event.target.closest("[data-manual-leave-remove]");
  if (manualLeaveRemove) {
    const panel = manualLeaveRemove.closest("[data-manual-bid-panel]");
    if (panel && panel.dataset.manualBidSubmitting !== "true") {
      manualLeaveBatch.entries.splice(Number(manualLeaveRemove.dataset.manualLeaveRemove), 1);
      if (!manualLeaveBatch.entries.length) manualLeaveBatch.key = "";
      renderManualLeaveBatch(panel);
    }
    return;
  }
  if (manualBidSubmit) {
    const panel = manualBidSubmit.closest("[data-manual-bid-panel]");
    if (panel) await runUiAction("manual-submit", manualBidSubmit, "Submitting bid…", () => submitManualBidEntry(panel));
    return;
  }

  const intakeApprove = event.target.closest("[data-intake-approve]");
  if (intakeApprove) {
    await runUiAction("intake-decision", intakeApprove, "Approving…", () => runIntakeDecision(approveIntakeItem, intakeApprove.dataset.intakeApprove));
    return;
  }

  const intakeDeny = event.target.closest("[data-intake-deny]");
  if (intakeDeny) {
    intakeEditorReturnFocus = { id: intakeDeny.dataset.intakeDeny, action: "deny" };
    activeDenialId = intakeDeny.dataset.intakeDeny;
    activeOverrideId = null;
    renderIntakeQueue();
    focusIntakeEditor("denial-panel");
    return;
  }

  const intakeDenyConfirm = event.target.closest("[data-intake-deny-confirm]");
  if (intakeDenyConfirm) {
    await runUiAction("intake-decision", intakeDenyConfirm, "Denying…", () => runIntakeDecision(denyIntakeItem, intakeDenyConfirm.dataset.intakeDenyConfirm));
    return;
  }

  if (event.target.closest("[data-denial-cancel], [data-intake-editor-close], [data-intake-editor-backdrop]")) {
    closeIntakeEditor();
    return;
  }

  const intakeEdit = event.target.closest("[data-intake-edit]");
  if (intakeEdit) {
    const item = intakeReviewItemById(intakeEdit.dataset.intakeEdit);
    if (item?.type === "Leave" && !intakeLeaveRoundIsOpen(item)) { renderIntakeQueue(); return; }
    intakeEditorReturnFocus = { id: intakeEdit.dataset.intakeEdit, action: "edit" };
    activeOverrideId = intakeEdit.dataset.intakeEdit;
    activeDenialId = null;
    renderIntakeQueue();
    focusIntakeEditor("override-panel");
    return;
  }

  const intakeSaveOverride = event.target.closest("[data-intake-save-override]");
  if (intakeSaveOverride) {
    await runUiAction("intake-edit", intakeSaveOverride, "Saving changes…", () => saveIntakeOverride(intakeSaveOverride.dataset.intakeSaveOverride));
    return;
  }

  const intakeManageLeave = event.target.closest("[data-intake-manage-leave]");
  if (intakeManageLeave) {
    revealIntakeLeaveDates(intakeManageLeave.dataset.intakeManageLeave);
    return;
  }

  const intakeRemoveLeave = event.target.closest("[data-intake-remove-leave]");
  if (intakeRemoveLeave) {
    await runUiAction("intake-edit", intakeRemoveLeave, "Removing leave…", () => removeApprovedLeaveBid(intakeRemoveLeave.dataset.intakeRemoveLeave));
    return;
  }

  const intakeCard = event.target.closest("[data-intake-card]");
  if (intakeCard) {
    activeIntakeDetailId = intakeCard.dataset.intakeCard;
    const item = intakeQueue.find((entry) => entry.id === activeIntakeDetailId);
    if (item) selectIntakeBidder(item.initials, item.bidderId);
    renderIntakeQueue();
    revealIntakeDetail();
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

  const bidEntryButton = event.target.closest("[data-bid-entry-action]");
  if (bidEntryButton?.dataset.lateBidContact === "true") {
    openLateBidDialog();
    return;
  }

  const selectLineButton = event.target.closest("[data-select-line]");
  if (selectLineButton && !selectLineButton.hidden) {
    const line = rdoLinesForBidder(currentUserBidAs(), currentUser.area).find((item) => item.line === selectedLineId);
    if (line && line.status !== "Taken") {
      await runUiAction("rdo-submit", selectLineButton, "Submitting bid…", addOrUpdateRdoSubmission);
    }
    return;
  }

  const row = event.target.closest("[data-line-id]");
  if (row && !row.classList.contains("occupied-row")) {
    const previousLineId = selectedLineId;
    const previousRdoWeekdays = selectedRdoWeekdays();
    const selectedLine = rdoLinesForBidder(currentUserBidAs(), currentUser.area).find((item) => item.line === row.dataset.lineId);
    if (!selectedLine || selectedLine.status === "Taken" || !isViewingHomeArea() || pendingCurrentUserRdoRequest()) return;
    selectedLineId = selectedLine.line;
    if (selectedLineId !== previousLineId && !submittedRdoLineForInitials(currentUser.initials)) {
      reconcileUnsubmittedLeaveForRdoLine(selectedLine);
    }
    renderRdoLines();
    updateSelectedLine();
    refreshMemberCalendarRdoPattern(previousRdoWeekdays);
    return;
  }

  // Inspect dashboard dates without updating the leave builder or rerendering calendars.
  const dashboardDateButton = event.target.closest("#dashboard-calendar [data-calendar-date]");
  if (dashboardDateButton) {
    const key = dashboardDateButton.dataset.calendarDate;
    if (key >= BID_LEAVE_YEAR_START_KEY && key <= BID_LEAVE_YEAR_END_KEY) {
      openLeaveSlotModal({ key, area: currentViewArea(), inspectOnly: true });
    }
    return;
  }

  const leaveDateButton = event.target.closest("[data-leave-date]");
  if (leaveDateButton) {
    const previousPreviewKeys = leaveRangePreviewActive ? leaveBuilderDateKeys() : [];
    const isAppCalendar = Boolean(event.target.closest(".app-shell"));
    const individualDates = isAppCalendar && usesIndividualLeaveDateSelection();
    if (isAppCalendar) {
      selectLeaveBuilderDate(leaveDateButton.dataset.leaveDate);
    } else {
      selectedLeaveDateKey = leaveDateButton.dataset.leaveDate;
    }
    syncMemberCalendarSelection(previousPreviewKeys);
    if (!isAppCalendar) return;
    syncLeaveBuilderInputs();
    renderLeaveDatePicker();
    if (individualDates) return;
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

  const calendarWorkforceButton = event.target.closest("[data-calendar-workforce]");
  if (calendarWorkforceButton) {
    setCalendarWorkforceForScope(
      calendarWorkforceButton.dataset.calendarScope,
      calendarWorkforceButton.dataset.calendarWorkforce
    );
    renderVisibleCalendars();
    return;
  }

  const calendarYearButton = event.target.closest("[data-calendar-year-action]");
  if (calendarYearButton) {
    const action = calendarYearButton.dataset.calendarYearAction;
    if (action === "next") displayedCalendarYear += 1;
    if (action === "previous") displayedCalendarYear -= 1;
    if (action === "today") {
      displayedCalendarYear = BID_YEAR;
      displayedCalendarMonth = new Date().getFullYear() === BID_YEAR ? new Date().getMonth() : 0;
    }
    setSelectedDateYear(displayedCalendarYear);
    renderVisibleCalendars();
    if (isMemberAppVisible()) renderLeaveSlotBoard();
    return;
  }

  const trigger = event.target.closest("[data-page]");
  if (!trigger) return;
  if (trigger.dataset.page === "intake-schedule" && !await refreshIntakeScheduleMembership()) return;
  setPage(trigger.dataset.page);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && document.querySelector(".page.active")?.dataset.pagePanel === "intake-schedule") {
    void refreshIntakeScheduleMembership();
  }
});

document.addEventListener("keydown", async (event) => {
  if (event.key === "Escape") {
    document.querySelector(".mobile-public-menu")?.removeAttribute("open");
    document.querySelector(".mobile-app-menu")?.removeAttribute("open");
    if (activeOverrideId || activeDenialId) closeIntakeEditor();
    closeLeaveSlotModal();
    closeBidChangeModal();
  }

  if (event.key === "Enter" && event.target.closest("[data-approval-rule-input]")) {
    event.preventDefault();
    await runUiAction("approval-rule-save", document.querySelector("[data-add-approval-rule]"), "Saving rule…", saveApprovalRuleFromInput);
    return;
  }

  const approvalRuleHandle = event.target.closest("[data-approval-rule-drag-handle]");
  if (approvalRuleHandle && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    event.preventDefault();
    const currentIndex = Number(approvalRuleHandle.dataset.approvalRuleDragHandle);
    const nextIndex = event.key === "ArrowUp" ? currentIndex - 1 : currentIndex + 1;
    if (await reorderApprovalRule(currentIndex, nextIndex)) {
      document.querySelector(`[data-approval-rule-drag-handle="${nextIndex}"]`)?.focus();
    }
    return;
  }

  if ((event.key === "Enter" || event.key === " ") && event.target.closest("[data-intake-card]")) {
    event.preventDefault();
    activeIntakeDetailId = event.target.closest("[data-intake-card]").dataset.intakeCard;
    const item = intakeQueue.find((entry) => entry.id === activeIntakeDetailId);
    if (item) selectIntakeBidder(item.initials, item.bidderId);
    renderIntakeQueue();
    revealIntakeDetail();
  }
});

document.querySelector("[data-save-active-bid-year]")?.addEventListener("click", event => { void runUiAction("active-year-save", event.currentTarget, "Saving year…", saveActiveBidYear); });

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

bindUiActionForm("[data-roster-form]", "roster-save", "Saving roster…", saveRosterEntry);
bindUiActionForm("[data-slot-capacity-form]", "capacity-save", "Saving capacity…", saveSlotCapacity);
bindUiActionForm("[data-bid-window-builder-form]", "window-preview", "Building preview…", buildBidWindowPreviewFromForm);
bindUiActionForm("[data-shift-builder-form]", "shift-save", "Saving shift…", saveShiftPreset);
bindUiActionForm("[data-intake-calendar-mark-form]", "calendar-mark-save", "Saving day type…", saveIntakeCalendarMark);

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
  if (event.target.matches("[data-intake-calendar-mark-date]")) {
    const kindInput = document.querySelector("[data-intake-calendar-mark-kind]");
    if (kindInput) kindInput.dataset.selectedDate = "";
    renderIntakeCalendarMarkEditor();
    return;
  }
  if (event.target.matches("[data-intake-shift-date], [data-intake-shift-time], [data-intake-shift-duration]")) {
    syncIntakeShiftForm(event.target.closest(".schedule-form"));
    return;
  }

  if (event.target.matches("[data-mobile-bid-search]")) {
    const query = event.target.value.trim().toLowerCase();
    let matches = 0;
    document.querySelectorAll("[data-public-bid-time-card]").forEach((card) => {
      const name = `${card.querySelector("[data-bidder-name]").textContent} ${card.querySelector("p").textContent}`.toLowerCase();
      card.hidden = !name.includes(query);
      if (!card.hidden) matches += 1;
    });
    document.querySelectorAll("[data-public-bid-time-row]").forEach((row) => {
      row.hidden = !row.textContent.toLowerCase().includes(query);
    });
    const emptyMessage = document.querySelector("[data-mobile-bid-empty]");
    if (emptyMessage) emptyMessage.hidden = matches > 0 || !query;
    return;
  }

  if (event.target.matches("[data-seniority-search]")) {
    senioritySearchQuery = event.target.value;
    renderSeniority();
    return;
  }

  const manualControllerSearch = event.target.closest("[data-manual-controller-search]");
  if (manualControllerSearch) {
    const panel = manualControllerSearch.closest("[data-manual-bid-panel]");
    if (panel) renderManualBidPanel(panel);
    return;
  }

  const intakeTeamCandidateSearch = event.target.closest("[data-intake-team-candidate-search]");
  if (intakeTeamCandidateSearch) {
    intakeTeamCandidateQuery = intakeTeamCandidateSearch.value;
    selectedIntakeTeamCandidateInitials = "";
    renderIntakeTeamCandidateSearch();
    return;
  }

  const manualPanel = event.target.closest("[data-manual-bid-panel]");
  const manualLeaveDateField = event.target.closest("[data-manual-leave-start], [data-manual-leave-end]");
  if (manualPanel && manualLeaveDateField) {
    if (manualLeaveDateField.matches("[data-manual-leave-start]")) defaultManualLeaveEndDate(manualPanel);
    updateManualLeaveDays(manualPanel);
    return;
  }

  const intakeSearch = event.target.closest("[data-intake-search]");
  if (intakeSearch) {
    intakeSearchQuery = intakeSearch.value;
    intakeSearchEmployeeInitials = "";
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
  const overrideLine = event.target.closest("[data-override-line]");
  if (overrideLine) {
    const item = intakeReviewItemById(activeOverrideId);
    const line = item
      ? rdoLines.find((entry) => entry.line === overrideLine.value && lineForArea(entry, item.area))
      : null;
    const category = line && isCpcLine(line) ? (item?.area === "TMU" ? "TMC" : "CPC") : "DEV";
    const editor = overrideLine.closest("[data-override-editor]");
    const label = editor?.querySelector("[data-gl-line-type-label]");
    const verification = editor?.querySelector("[data-gl-line-type-verification]");
    if (label) label.textContent = category;
    if (verification) verification.checked = false;
    return;
  }
  if (event.target.matches("[data-pilot-round-toggle]")) {
    const toggle = event.target;
    const round = Number(toggle.dataset.pilotRoundToggle);
    const enabled = toggle.checked;
    await runUiAction("pilot-round-save", toggle, "Updating pilot round…", () => setPilotRound(round, enabled));
    return;
  }
  if (event.target.matches("[data-pilot-round-picker]")) {
    selectedPilotRound = normalizeBidWindowTestRound(event.target.value);
    renderApp();
    return;
  }
  if (event.target.matches("[data-intake-shift-date], [data-intake-shift-time], [data-intake-shift-duration]")) {
    syncIntakeShiftForm(event.target.closest(".schedule-form"));
    return;
  }

  const bidChangeWeekStart = event.target.closest("[data-bid-change-week-start]");
  if (bidChangeWeekStart) {
    updateRoundOneBidChangeWeek(bidChangeWeekStart.dataset.bidChangeWeekStart, bidChangeWeekStart.value);
    return;
  }

  const bidChangeDate = event.target.closest("[data-bid-change-date]");
  if (bidChangeDate && !bidChangeDate.readOnly) {
    updateIndividualBidChange(bidChangeDate.dataset.bidChangeDate, bidChangeDate.value);
    return;
  }

  if (event.target.matches("[data-mobile-public-area]")) {
    renderPublicPage(event.target.value, publicState.section, { persistNavigation: true });
    return;
  }
  if (event.target.matches("[data-mobile-month]")) {
    displayedCalendarMonth = Number(event.target.value);
    annualMobileCalendars.delete(event.target.closest("[data-mobile-calendar]").dataset.mobileCalendar);
    renderVisibleCalendars();
    return;
  }

  if (event.target.closest("[data-slot-capacity-area], [data-slot-capacity-start], [data-slot-capacity-end]")) {
    syncSlotCapacityForm();
    setSlotCapacityStatus("");
    return;
  }

  if (event.target.closest("[data-bid-window-builder-consistent], [data-bid-window-builder-area], [data-bid-window-builder-start], [data-bid-window-builder-open], [data-bid-window-builder-close], [data-bid-window-builder-length], [data-bid-window-builder-gap]")) {
    bidWindowBuilderPreview = null;
    syncBidWindowBuilder();
    renderBidWindowBuilderPreview();
    setBidWindowBuilderStatus("Settings changed. Build a new preview.");
    return;
  }

  const intakeSortControl = event.target.closest("[data-intake-sort]");
  if (intakeSortControl) {
    intakeSort = intakeSortControl.value === "entered" ? "entered" : "approved";
    renderIntakeQueue();
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
    if (
      !document.querySelector("[data-roster-edit-initials]")?.value &&
      bidRoleParticipatesInBidding(document.querySelector("[data-roster-bid-as]")?.value)
    ) {
      const rankInput = document.querySelector("[data-roster-rank]");
      if (rankInput) rankInput.value = activeRosterEntries(rosterAreaInput.value).length + 1;
    }
    syncRosterParticipationFields();
    return;
  }

  const rosterBidAsInput = event.target.closest("[data-roster-bid-as]");
  if (rosterBidAsInput) {
    syncRosterParticipationFields();
    return;
  }

  const bulkRosterAreaInput = event.target.closest("[data-bulk-area]");
  if (bulkRosterAreaInput) {
    const row = bulkRosterAreaInput.closest("[data-roster-row]");
    if (row) syncBulkRosterBidAsSelect(row);
    return;
  }

  const bulkRosterBidAsInput = event.target.closest("[data-bulk-bid-as]");
  if (bulkRosterBidAsInput) {
    const row = bulkRosterBidAsInput.closest("[data-roster-row]");
    if (row) syncBulkRosterParticipationFields(row);
    return;
  }

  const manualPanel = event.target.closest("[data-manual-bid-panel]");
  const manualFlexField = event.target.closest("[data-manual-flex]");
  if (manualPanel && manualFlexField && manualFlexField.value === "No" && !confirmFlexNo()) {
    manualFlexField.value = "Yes";
    return;
  }

  const manualReactiveField = event.target.closest("[data-manual-bid-controller], [data-manual-bid-type], [data-manual-bid-area], [data-manual-rdo-line], [data-manual-fatigue-group], [data-manual-fatigue-override], [data-manual-leave-start], [data-manual-leave-end], [data-manual-leave-round]");
  if (manualPanel && manualReactiveField) {
    if (manualReactiveField.matches("[data-manual-leave-start]")) defaultManualLeaveEndDate(manualPanel);
    if (manualReactiveField.matches("[data-manual-leave-start], [data-manual-leave-end]")) {
      updateManualLeaveDays(manualPanel);
      return;
    }
    renderManualBidPanel(manualPanel);
    if (manualReactiveField.matches("[data-manual-bid-controller]")) {
      if (manualPanel.classList.contains("manual-leave-request-card")) manualLeaveControllerInitials = manualReactiveField.value;
      const person = manualBidSelectedPerson(manualReactiveField.value);
      selectIntakeBidder(person.initials, person.profileId);
    }
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
  const nextArea = viewAreaSelect.value || currentUser.area;
  await runUiAction("area-switch", viewAreaSelect, `Loading ${nextArea}…`, () => {
    selectedViewArea = nextArea;
    renderApp();
    showActionFeedback(`Now viewing ${nextArea}.`, "success");
  });
});

Object.assign(publicState, requestedPublicView() || {});
initializeMobilePublicNavigation();
resetSupabaseBackedData();
renderPublicPage();
initializeSupabaseAuth().then(async (restoredSession) => {
  // Session restoration already renders the requested member page.
  if (restoredSession) return;
  if (!restoredSession) {
    if (window.NATCA_SUPABASE_CONFIG?.environment === "pilot") await loadPublicPilotCalendar();
    else await loadSupabaseReferenceData();
  }
  if (isMemberAppVisible()) {
    renderApp();
  } else {
    renderPublicPage();
    document.documentElement.classList.remove("member-boot-pending");
  }
  startLiveAlertUpdates();
});
setInterval(() => {
  if (document.visibilityState === "visible") updateBidWindow();
}, 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    updateBidWindow(true);
    void refreshActiveBidYear();
    scheduleLiveDataRefresh();
  }
});
window.addEventListener("focus", () => { void refreshActiveBidYear(); });
window.addEventListener("focus", () => scheduleLiveDataRefresh());
window.addEventListener("online", () => scheduleLiveDataRefresh());
// Reconcile missed events or unavailable Realtime without frequent polling.
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  void refreshActiveBidYear();
  const groups = liveDataFallbackGroups();
  if (groups.length) scheduleLiveDataRefresh(groups);
}, 60000);
window.NATCA_BIDDING_READY = true;

setInterval(() => {
  if (document.visibilityState === "visible") void refreshPilotRounds();
}, 10000);


function backupStatus(message, status = "info") {
  showActionFeedback(message, status);
  const target = document.querySelector('[data-backup-status]');
  if (target) target.textContent = message;
}
function backupClient() {
  if (!hasSystemAdminAccess() || !supabaseClient()) throw new Error('Sign in as a system administrator to manage backups.');
  return supabaseClient();
}
async function loadBiddingBackups() {
  if (biddingBackupBusy) return;
  try {
    const client = backupClient();
    const schedule = await client.from('bidding_backup_schedule').select('*').eq('id', true).maybeSingle();
    if (schedule.error) throw new Error('Backup setup is unavailable. Install database/bidding_backups.sql and enable Supabase Cron.');
    const form = document.querySelector('[data-backup-form]');
    if (schedule.data && form) {
      for (const key of ['start_date', 'end_date', 'start_time', 'end_time', 'interval_minutes']) form.elements.namedItem(key).value = schedule.data[key];
      form.elements.namedItem('enabled').checked = schedule.data.enabled;
      form.elements.namedItem('retention_days').value = schedule.data.retention_days ?? '';
    }
    await refreshLatestBiddingBackup();
  } catch (error) { backupStatus(error.message); }
}
async function refreshLatestBiddingBackup() {
  const result = await backupClient().from('bidding_backups').select('id,created_at,source').order('id', { ascending: false }).limit(1);
  if (result.error) throw result.error;
  const latest = result.data?.[0];
  document.querySelector('[data-backup-latest]').textContent = latest
    ? `Latest backup: ${new Date(latest.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} Pacific (${latest.source}).`
    : 'No backups saved yet.';
  document.querySelector('[data-backup-download]').disabled = !latest;
}
async function performBiddingBackupAction(action) {
  if (biddingBackupBusy) return;
  biddingBackupBusy = true;
  const buttons = document.querySelectorAll('[data-backup-form] button, [data-backup-now], [data-backup-download]');
  buttons.forEach(button => { button.disabled = true; });
  try {
    const client = backupClient();
    if (action === 'save') {
      const form = document.querySelector('[data-backup-form]');
      const values = Object.fromEntries(new FormData(form));
      if (values.end_date < values.start_date || values.end_time < values.start_time) throw new Error('End date and daily end time must be on or after their start values.');
      const interval = Number(values.interval_minutes);
      if (!Number.isInteger(interval) || interval < 1 || interval > 10080) throw new Error('Choose an interval from 1 to 10080 minutes.');
      const retention = String(values.retention_days || '').trim() === '' ? null : Number(values.retention_days);
      if (retention !== null && (!Number.isInteger(retention) || retention < 1 || retention > 36500)) throw new Error('Choose a whole number of days from 1 to 36500, or leave blank to keep all backups.');
      const result = await client.from('bidding_backup_schedule').upsert({
        id: true, enabled: form.elements.namedItem('enabled').checked,
        start_date: values.start_date, end_date: values.end_date,
        start_time: values.start_time, end_time: values.end_time,
        interval_minutes: interval, retention_days: retention, timezone: 'America/Los_Angeles',
      });
      if (result.error) throw result.error;
      backupStatus('Backup schedule saved.', 'success');
    } else if (action === 'now') {
      backupStatus('Backing up now… Keep this page open until the backup finishes.');
      const result = await client.rpc('backup_bidding_now');
      if (result.error) throw result.error;
      backupStatus('Backup completed and saved.', 'success');
    } else {
      backupStatus('Preparing backup download…');
      const result = await client.from('bidding_backups').select('id,created_at,payload').order('id', { ascending: false }).limit(1);
      if (result.error) throw result.error;
      if (!result.data?.length) throw new Error('No backups saved yet.');
      const backup = result.data[0];
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup.payload, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `zla-bidding-backup-${backup.id}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      backupStatus('Backup downloaded.', 'success');
    }
  } catch (error) { backupStatus(error.message || 'The backup operation failed.', 'error'); }
  finally {
    biddingBackupBusy = false;
    buttons.forEach(button => { button.disabled = false; });
    try { await refreshLatestBiddingBackup(); } catch (_) { /* Preserve the operation error. */ }
  }
}
document.addEventListener('submit', event => {
  if (!event.target.matches('[data-backup-form]')) return;
  event.preventDefault();
  const form = event.target;
  void runUiAction('backup', event.submitter || form.querySelector('button[type=submit]'), 'Saving schedule…', () => performBiddingBackupAction('save'));
});
document.addEventListener('click', event => {
  if (event.target.closest('[data-backup-now]')) void runUiAction('backup', event.target.closest('[data-backup-now]'), 'Backing up…', () => performBiddingBackupAction('now'));
  if (event.target.closest('[data-backup-download]')) void runUiAction('backup', event.target.closest('[data-backup-download]'), 'Downloading…', () => performBiddingBackupAction('download'));
});
