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
    phone: "(555) 555-0147",
    email: "m.schoelen@yahoo.com",
    adminGrant: {
      type: "Bidding Intake",
      scope: "All Areas",
      start: new Date(now - 60 * 60 * 1000),
      end: new Date(now + 4 * 60 * 60 * 1000),
      grantedBy: "NATCA ZLA Bidding Chair",
    },
  },
  admin: {
    firstName: "Sarah",
    lastName: "Harris",
    initials: "SH",
    seniorityRank: 11,
    bidderCount: 45,
    area: "Area A",
    role: "bidding-intake",
    roleLabel: "Bidding Intake",
    systemAdmin: false,
    phone: "(555) 555-0111",
    email: "sh@natcazla.com",
    adminGrant: {
      type: "Bidding Intake",
      scope: "All Areas",
      start: new Date(now - 60 * 60 * 1000),
      end: new Date(now + 4 * 60 * 60 * 1000),
      grantedBy: "NATCA ZLA Bidding Chair",
    },
  },
  "regular-bue": {
    firstName: "Martin",
    lastName: "Ramirez",
    initials: "EZ",
    seniorityRank: 17,
    bidderCount: 45,
    area: "Area D",
    role: "controller",
    roleLabel: "BUE Controller",
    systemAdmin: false,
    phone: "(555) 555-0127",
    email: "ez@natcazla.com",
  },
};

let currentUser = { ...testAccounts.bue };
let selectedViewArea = null;
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

const intakeSchedules = [
  {
    id: "sched-oc-1",
    initials: "OC",
    name: "Michael Schoelen",
    area: "Area A",
    start: new Date(Date.now() + 24 * 60 * 60 * 1000),
    end: new Date(Date.now() + 26 * 60 * 60 * 1000),
  },
  {
    id: "sched-oc-2",
    initials: "OC",
    name: "Michael Schoelen",
    area: "Area A",
    start: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000),
    end: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000),
  },
  {
    id: "sched-sh-1",
    initials: "SH",
    name: "Sarah Harris",
    area: "All Areas",
    start: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    end: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
  },
];

// Prototype data: in production these timestamps come from the logged-in user's bid window.
const userBidWindow = {
  start: new Date(Date.now() - 30 * 60 * 1000),
  end: new Date(Date.now() + 90 * 60 * 1000),
};

function isBidWindowOpen(date = new Date()) {
  return date >= userBidWindow.start && date <= userBidWindow.end;
}

function activeBidderRank() {
  return isBidWindowOpen() && Number.isFinite(currentUser.seniorityRank)
    ? currentUser.seniorityRank
    : null;
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

const rdoLines = [
  { pattern: "S/S", line: "1", cpc: "CD", week: ["RDO", "M1300", "M1100", "RDO", "M2100", "M2100", "RDO"], group: "A", mid: "BID", aws: "Yes", fourTen: "Yes", flex: "Yes", status: "Taken" },
  { pattern: "S/S", line: "2", cpc: "BG", week: ["RDO", "1330", "1300", "700", "630", "600", "RDO"], group: "C", mid: "No", aws: "No", fourTen: "No", flex: "No", status: "Taken" },
  { pattern: "S/S", line: "3", cpc: "JH", week: ["RDO", "1430", "1330", "730", "630", "600", "RDO"], group: "B", mid: "No", aws: "No", fourTen: "No", flex: "Yes", status: "Taken" },
  { pattern: "S/S", line: "G1", cpc: "JJ", week: ["RDO", "1430", "1330", "730", "630", "600", "RDO"], group: "C only", mid: "No", aws: "No", fourTen: "No", flex: "No", status: "Open" },
  { pattern: "S/S", line: "4", cpc: "PE", week: ["RDO", "1430", "1330", "730", "630", "600", "RDO"], group: "B", mid: "No", aws: "No", fourTen: "No", flex: "Yes", status: "Open" },
  { pattern: "S/S", line: "5", cpc: "RO", week: ["RDO", "1500", "1330", "1200", "700", "600", "RDO"], group: "C", mid: "No", aws: "Yes", fourTen: "No", flex: "Yes", status: "Open" },
  { pattern: "S/M", line: "6", cpc: "LA", week: ["RDO", "RDO", "M1300", "M1100", "RDO", "M2100", "M2100"], group: "B", mid: "BID", aws: "Yes", fourTen: "Yes", flex: "Yes", status: "Open" },
  { pattern: "S/M", line: "7", cpc: "AM", week: ["RDO", "RDO", "1430", "1300", "700", "630", "600"], group: "C", mid: "No", aws: "No", fourTen: "No", flex: "No", status: "Open" },
  { pattern: "S/M", line: "8", cpc: "XJ", week: ["RDO", "RDO", "1500", "1330", "730", "630", "600"], group: "A", mid: "No", aws: "Yes", fourTen: "No", flex: "Yes", status: "Open" },
  { pattern: "S/M", line: "9", cpc: "CP", week: ["RDO", "RDO", "1500", "1330", "1200", "630", "600"], group: "A", mid: "No", aws: "No", fourTen: "No", flex: "No", status: "Open" },
  { pattern: "M/T", line: "10", cpc: "FJ", week: ["600", "RDO", "RDO", "1430", "1300", "700", "630"], group: "A", mid: "No", aws: "No", fourTen: "No", flex: "No", status: "Open" },
  { pattern: "M/T", line: "11", cpc: "GS", week: ["600", "RDO", "RDO", "1430", "1300", "700", "630"], group: "C", mid: "No", aws: "Yes", fourTen: "No", flex: "Yes", status: "Open" },
  { pattern: "M/T", line: "12", cpc: "TY", week: ["600", "RDO", "RDO", "1500", "1330", "730", "630"], group: "B", mid: "No", aws: "No", fourTen: "No", flex: "Yes", status: "Open" },
  { pattern: "M/T", line: "13", cpc: "ZH", week: ["600", "RDO", "RDO", "1500", "1330", "1200", "700"], group: "A", mid: "No", aws: "No", fourTen: "No", flex: "No", status: "Open" },
  { pattern: "T/W", line: "14", cpc: "OP", week: ["M2100", "M2100", "RDO", "RDO", "M1300", "M1100", "RDO"], group: "A", mid: "BID", aws: "Yes", fourTen: "Yes", flex: "Yes", status: "Open" },
  { pattern: "T/W", line: "15", cpc: "", week: ["630", "600", "RDO", "RDO", "1430", "1300", "700"], group: "C", mid: "No", aws: "No", fourTen: "No", flex: "Yes", status: "Open" },
  { pattern: "T/W", line: "16", cpc: "NO", week: ["630", "600", "RDO", "RDO", "1430", "1330", "730"], group: "C", mid: "No", aws: "Yes", fourTen: "No", flex: "Yes", status: "Open" },
  { pattern: "T/W", line: "17", cpc: "GK", week: ["700", "600", "RDO", "RDO", "1500", "1330", "730"], group: "B", mid: "No", aws: "Yes", fourTen: "No", flex: "Yes", status: "Open" },
  { pattern: "W/T", line: "18", cpc: "GM", week: ["700", "S530", "2230", "RDO", "RDO", "N1330", "1300"], group: "B", mid: "BID", aws: "Yes", fourTen: "No", flex: "Yes", status: "Open" },
  { pattern: "W/T", line: "19", cpc: "TK", week: ["700", "630", "600", "RDO", "RDO", "1430", "1300"], group: "A", mid: "No", aws: "No", fourTen: "No", flex: "No", status: "Open" },
  { pattern: "W/T", line: "20", cpc: "ES", week: ["730", "630", "600", "RDO", "RDO", "1500", "1330"], group: "A", mid: "No", aws: "No", fourTen: "No", flex: "Yes", status: "Open" },
  { pattern: "W/T", line: "21", cpc: "DG", week: ["1200", "630", "630", "RDO", "RDO", "1500", "1330"], group: "C", mid: "No", aws: "Yes", fourTen: "No", flex: "Yes", status: "Open" },
  { pattern: "T/F", line: "22", cpc: "AR", week: ["1300", "700", "S530", "2230", "RDO", "RDO", "N1330"], group: "C", mid: "BID", aws: "Yes", fourTen: "No", flex: "Yes", status: "Open" },
  { pattern: "T/F", line: "23", cpc: "AG", week: ["1300", "700", "S530", "2230", "RDO", "RDO", "N1330"], group: "A", mid: "BID", aws: "Yes", fourTen: "No", flex: "Yes", status: "Open" },
  { pattern: "T/F", line: "24", cpc: "CZ", week: ["1330", "730", "630", "600", "RDO", "RDO", "1500"], group: "B", mid: "No", aws: "No", fourTen: "No", flex: "No", status: "Open" },
  { pattern: "F/S", line: "27", cpc: "HH", week: ["N1330", "1300", "700", "S530", "2230", "RDO", "RDO"], group: "C", mid: "BID", aws: "Yes", fourTen: "No", flex: "Yes", status: "Open" },
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
];

let selectedLineId = "15";
let selectedFatigueGroup = "";
let selectedMidPreference = "";
let selectedAwsPreference = "";
let selectedFlexPreference = "";
let calendarView = "year";
let displayedCalendarYear = BID_YEAR;
const rdoFilters = {
  search: "",
  openOnly: true,
  mid: "all",
  fourTen: "all",
};
const publicState = {
  area: "Area A",
  section: "Calendar",
};

const ZLA_AREAS = ["Area A", "Area B", "Area C", "Area D", "Area E", "Area F", "TMU"];

const supabaseState = {
  enabled: false,
  connected: false,
  loading: false,
  message: "Using built-in prototype data.",
  loadedAt: null,
};

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

function fatigueCapacityForLine(line) {
  const area = line.area || currentUser.area || "Area A";
  const areaLines = rdoLinesForArea(area);
  const crewSize = crewSizeByPattern[line.pattern] || areaLines.filter((item) => item.pattern === line.pattern).length;
  const crewMax = Math.max(1, Math.floor(crewSize / 3));

  return ["A", "B", "C"].map((group) => {
    const areaUsed = areaLines.filter((item) => {
      if (!isCpcLine(item)) return false;
      if (item.line === selectedLineId) return selectedFatigueGroup === group;
      return item.status === "Taken" && item.group === group;
    }).length;

    const crewUsed = areaLines.filter((item) => {
      if (!isCpcLine(item)) return false;
      if (item.pattern !== line.pattern) return false;
      if (item.line === selectedLineId) return selectedFatigueGroup === group;
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
  const workedDays = line.week.filter((value) => value !== "RDO").length;
  return workedDays === 4 ? "Yes" : "No";
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
      { date: "2027-01-14", label: "Thu, Jan 14", cpc: ["CZ", "AG"], dev: ["BS"] },
      { date: "2027-01-15", label: "Fri, Jan 15", cpc: [], dev: ["BS"], unavailable: true },
      { date: "2027-01-16", label: "Sat, Jan 16", cpc: [], dev: ["BS"], unavailable: true },
      { date: "2027-01-17", label: "Sun, Jan 17", cpc: ["CZ", "AG", "LA"], dev: [] },
    ],
  },
  {
    group: "C",
    round: 2,
    days: [
      { date: "2027-01-18", label: "Mon, Jan 18", cpc: ["CZ", "AG", "SS"], dev: [], holiday: true },
      { date: "2027-01-19", label: "Tue, Jan 19", cpc: ["RO", "AG", "VO"], dev: [] },
      { date: "2027-01-20", label: "Wed, Jan 20", cpc: ["AG"], dev: [] },
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
      { date: "2027-01-25", label: "Mon, Jan 25", cpc: ["GK", "AG"], dev: [] },
      { date: "2027-01-26", label: "Tue, Jan 26", cpc: ["GK", "CE"], dev: [] },
      { date: "2027-01-27", label: "Wed, Jan 27", cpc: ["SZ"], dev: [] },
      { date: "2027-01-28", label: "Thu, Jan 28", cpc: [], dev: [], unavailable: true },
      { date: "2027-01-29", label: "Fri, Jan 29", cpc: [], dev: [], unavailable: true },
      { date: "2027-01-30", label: "Sat, Jan 30", cpc: [], dev: [], unavailable: true },
      { date: "2027-01-31", label: "Sun, Jan 31", cpc: ["FJ", "AG"], dev: [] },
    ],
  },
];

const extraLeaveSlotData = {
  "2027-02-10": { cpc: ["TY", "ZH", "OP"], dev: ["DL"], unavailable: true },
  "2027-02-11": { cpc: ["NO", "GK", "GM"], dev: [] },
  "2027-02-12": { cpc: ["TK", "ES", "DG"], dev: ["KM", "XO"] },
  "2027-06-10": { cpc: ["OC", "AG", "CZ"], dev: ["BS"] },
  "2027-07-07": { cpc: ["RO", "VO", "CE"], dev: [] },
  "2027-09-03": { cpc: ["HH", "HN", "TE"], dev: ["AW"] },
  "2027-11-24": { cpc: ["AR", "SZ", "FJ"], dev: ["TP"] },
  "2027-11-25": { cpc: ["AG", "CP", "SS"], dev: [], holiday: true },
  "2027-12-27": { cpc: ["CZ", "NO", "GM"], dev: ["KE", "AW"] },
};

let selectedLeaveDateKey = "2027-01-18";

const senioritySource = [
  ["Denham", "Corey", "CPC"],
  ["Grider", "Brian", "CPC"],
  ["Hutson", "Jeffrey", "CPC"],
  ["Bonanno", "Justin", "GL"],
  ["Schoelen", "Michael", "GL", "OC"],
  ["Lane", "Joshua", "CPC"],
  ["Wagner", "Aaron", "CPC"],
  ["Harold", "Kristina", "CPC"],
  ["Bickel", "Shane", "CPC"],
  ["Couche", "Rachel", "CPC"],
  ["Harris", "Sarah", "CPC"],
  ["Robertson", "Rajanish", "CPC"],
  ["Alvarez", "Mark", "CPC"],
  ["Carpenter", "Jonathan", "CPC"],
  ["Lohrman", "Joshua", "CPC"],
  ["Norr", "Garrett", "GL"],
  ["Carlin", "Russell", "CPC"],
  ["Bengard", "Erik", "GL"],
  ["Arce", "Adolfo", "CPC"],
  ["Christie", "Philip", "CPC"],
  ["Holder", "Joseph", "CPC"],
  ["Gabriel", "Colin", "CPC"],
  ["Susnitzky", "Brett", "CPC"],
  ["Barrett", "Timothy", "CPC"],
  ["Romano", "Frank", "CPC"],
  ["Lowther", "Timothy", "CPC"],
  ["Tshudy", "Matthew", "CPC"],
  ["Hanson", "Brett", "CPC"],
  ["Vo", "Kevin", "CPC"],
  ["Moss", "Gerrit", "CPC"],
  ["Kelsey", "Taylor", "CPC"],
  ["Speakman", "Erik", "CPC"],
  ["Meuleners", "Janessa", "CPC"],
  ["Graham", "Kaleb", "CPC"],
  ["Griffin", "Dylan", "CPC"],
  ["Pastore", "Tanner", "R-DEV"],
  ["De La O", "Kevin", "R-DEV"],
  ["Stout", "Joshua", "R-DEV"],
  ["Madera", "Allan", "R-DEV"],
  ["Macias", "Benny", "D-DEV"],
  ["Von Buck", "Corbin", "D-DEV"],
  ["Greer", "William", "D-DEV"],
  ["Hansen", "Dallas", "D-DEV"],
  ["Myers", "Kyle", "D-DEV"],
  ["McCarthy", "Aidan", "D-DEV"],
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

function bidWindowLabel(date, start) {
  const hour = Number(start.slice(0, 2));
  const endHour = hour + 1;
  return `${date} · ${start}-${String(endHour).padStart(2, "0")}59`;
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

function downloadBidWindowsIcs(rank = currentUser.seniorityRank) {
  const person = seniority.find((item) => item.rank === Number(rank));
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

function buildSeniority() {
  const openRank = activeBidderRank();
  return senioritySource.map(([lastName, firstName, bidAs, initials], index) => {
    const rank = index + 1;
    const rowBlock = Math.floor(index / bidStartTimes.length);
    const start = bidStartTimes[index % bidStartTimes.length];
    const hasActiveBidder = Number.isFinite(openRank);
    const isCurrentBidder = hasActiveBidder && rank === openRank;

    return {
      rank,
      firstName,
      lastName,
      bidAs,
      initials: initials || fallbackInitials(firstName, lastName),
      status: !hasActiveBidder ? "waiting" : rank < openRank ? "done" : isCurrentBidder ? "active" : "waiting",
      rounds: roundDateBlocks[rowBlock].map((date) => bidWindowLabel(date, start)),
      completed: hasActiveBidder && rank < openRank ? [1] : [],
      openRound: isCurrentBidder ? 1 : undefined,
    };
  });
}

let seniority = buildSeniority();

const history = [
  { area: "Area A", time: "May 7, 2026 14:32", actor: "OC", title: "Draft saved", detail: "Selected Line 15 OC and updated Flex preference." },
  { area: "Area A", time: "May 7, 2026 14:18", actor: "OC", title: "Leave queue reordered", detail: "Moved Thanksgiving week to priority 4." },
  { area: "Area A", time: "May 7, 2026 14:04", actor: "OC", title: "RDO line viewed", detail: "Compared Line 14 OP, Line 15 OC, and Line 18 GM." },
  { area: "Area A", time: "May 7, 2026 13:52", actor: "System", title: "Bid window opened", detail: "Your Area A seniority window started. You are on the clock." },
  { area: "Area B", time: "May 7, 2026 13:40", actor: "SH", title: "Area B bid intake approved", detail: "Sarah Harris verified a submitted RDO bid while assigned temporary bidding intake rights." },
  { area: "Area C", time: "May 7, 2026 13:25", actor: "SH", title: "Area C leave request reviewed", detail: "Sarah Harris reviewed leave slots under temporary bidding intake access." },
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
    approvedBy: "SH",
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
        author: "SH",
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

function selectedLineRequest(line) {
  return intakeQueue.find((item) =>
    item.type === "RDO Line" &&
    item.line === line.line &&
    item.initials === currentUser.initials &&
    item.status === "Pending"
  );
}

function logHistory(area, title, detail) {
  history.unshift({
    area,
    time: formatDateTime(new Date()),
    actor: currentUser.initials,
    title,
    detail,
  });
}

function addOrUpdateRdoSubmission() {
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
  const request = {
    id: existing?.id || `rdo-${currentUser.initials.toLowerCase()}-${Date.now()}`,
    type: "RDO Line",
    area: currentUser.area,
    name: userFullName(),
    initials: currentUser.initials,
    bidAs: currentUserBidAs(),
    seniority: currentUser.seniorityRank,
    status: "Pending",
    submittedAt: formatDateTime(new Date()),
    line: line.line,
    fatigueGroup: selectedFatigueGroup,
    flex: selectedFlexPreference,
    aws: selectedAwsPreference,
    mid: selectedMidValue(line),
    summary: `Line ${line.line} · Group ${selectedFatigueGroup} · Flex ${selectedFlexPreference} · AWS ${selectedAwsPreference} · Mid ${selectedMidValue(line)}`,
  };

  if (existing) {
    Object.assign(existing, request);
  } else {
    intakeQueue.unshift(request);
  }

  logHistory(currentUser.area, "RDO bid submitted", `${currentUser.initials} submitted ${request.summary}. Intake approval is required before the line is populated.`);
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
  return { range, days };
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
    cells.push(`
      <button class="${isInRange ? "in-range" : ""} ${isEdge ? "range-edge" : ""}" type="button" data-leave-picker-date="${key}" aria-label="${monthNames[leavePickerMonthIndex]} ${day}, ${leavePickerYear}">
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
  return 10;
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
  return [...new Set(dateKeys.map((key) => roundOneWeekKeyForDateKey(key)))].sort();
}

function roundOneDraftWeekKeySet(extraItems = []) {
  return [...leaveDraftQueue, ...extraItems].reduce((weeks, item) => {
    if (!isRoundOneLeaveItem(item)) return weeks;
    const itemWeeks = item.weekKeys?.length
      ? item.weekKeys
      : roundOneWeekKeysForDateKeys(datesInLeaveRange(item.range));
    itemWeeks.forEach((week) => weeks.add(week));
    return weeks;
  }, new Set());
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
  if (Number.isFinite(Number(item.round))) return Number(item.round);
  const roundMatch = String(item.notes || item.summary || "").match(/Round\s+(\d+)/i);
  return roundMatch ? Number(roundMatch[1]) : 1;
}

function leaveCommittedItems() {
  return leaveBids
    .filter((item) => ["Approved", "Pending"].includes(item.status))
    .map((item) => ({ ...item, round: leaveRoundForItem(item) }));
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
  const priorItems = leaveCommittedItems().filter((item) => leaveRoundForItem(item) < round);
  return leaveHolidayDateSet(priorItems).size;
}

function leaveAllowanceLimitForRound(round) {
  return ANNUAL_LEAVE_ALLOWANCE_DAYS + leaveHolidayCreditsForRound(round);
}

function leaveProjectedChargedDays(extraItems = []) {
  return [...leaveCommittedItems(), ...leaveDraftQueue, ...extraItems]
    .reduce((total, item) => total + leaveItemChargedDays(item), 0);
}

function leaveHolidayBidCount() {
  return leaveHolidayDateSet([...leaveCommittedItems(), ...leaveDraftQueue]).size;
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
  const capacity = bucket === "dev" ? leaveSlotCapacity.dev : leaveSlotCapacity.cpc;
  const values = visible[bucket] || [];
  if (values.includes(initials)) return;

  if (values.length < capacity) {
    values.push(initials);
  } else if (capacity > 0) {
    values[capacity - 1] = initials;
  }

  visible[bucket] = values.slice(0, capacity);
}

function visibleLeaveSlotDetails(key, area = currentUser.area) {
  const details = leaveSlotsForDate(key, area);
  const visible = {
    ...details,
    cpc: [...(details.cpc || [])],
    dev: [...(details.dev || [])],
  };
  const showCurrentUserOverlay = area === currentUser.area;
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
  const { range, days } = leaveBuilderValues();
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
    var newRoundOneWeeks = weekKeys.filter((week) => !existingWeeks.has(week)).length;
  } else {
    const currentTotal = leaveDraftTotalDays();
    if (currentTotal + days > currentRoundLeaveLimit()) {
      setLeaveBuilderStatus(`Round ${round} can include up to ${currentRoundLeaveLimit()} total days. This batch would be ${currentTotal + days}.`, "error");
      return;
    }

    const rdoConflicts = dateKeys.filter((key) => isRdoDateForInitials(key, currentUser.initials));
    if (rdoConflicts.length) {
      setLeaveBuilderStatus(`You cannot bid your own RDO: ${formatLeaveConflictDates(rdoConflicts)}.`, "error");
      return;
    }
  }

  const projectedChargedDays = leaveProjectedChargedDays([{ range, days, round, weekUnits, weekKeys }]);
  const allowanceLimit = leaveAllowanceLimitForRound(round);
  if (projectedChargedDays > allowanceLimit) {
    const credits = leaveHolidayCreditsForRound(round);
    const creditText = credits ? ` including ${credits} holiday ${credits === 1 ? "credit" : "credits"}` : "";
    setLeaveBuilderStatus(`This would exceed the ${allowanceLimit}-day leave allowance${creditText} for Round ${round}.`, "error");
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

  leaveDraftQueue.push({
    id: `draft-leave-${currentUser.initials.toLowerCase()}-${Date.now()}`,
    range,
    days,
    round,
    weekUnits,
    weekKeys,
  });
  leaveRangeSelectionComplete = true;
  leaveRangePreviewActive = false;

  renderApp();
  setPage("leave");
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

  if (!dateKeys.length) {
    setLeaveBuilderStatus("Enter a date range before previewing leave.", "error");
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

  leaveRangePreviewActive = true;
  selectedLeaveDateKey = dateKeys[0];
  displayedCalendarYear = dateFromKey(dateKeys[0]).getFullYear();
  renderApp();
  setPage("leave");
  const previewMessage = round === 1
    ? `Previewing ${weekUnits} Round 1 bid ${weekUnits === 1 ? "week" : "weeks"} with ${chargeableDates.length} chargeable ${chargeableDates.length === 1 ? "day" : "days"}.`
    : "Previewing this range on the calendar. Use Add to Batch when you want to stage it.";
  setLeaveBuilderStatus(previewMessage, "info");
}

function removeLeaveDraft(id) {
  leaveDraftQueue = leaveDraftQueue.filter((item) => item.id !== id);
  renderApp();
  setPage("leave");
  setLeaveBuilderStatus("Removed from the preview batch.", "info");
}

function submitLeaveDraftBatch() {
  if (!leaveDraftQueue.length) {
    setLeaveBuilderStatus("Add at least one leave request before submitting a batch.", "error");
    return;
  }

  const batchId = `leave-batch-${currentUser.initials.toLowerCase()}-${Date.now()}`;
  const submittedAt = formatDateTime(new Date());
  const newRequests = leaveDraftQueue.map((draft) => ({
    id: `leave-${currentUser.initials.toLowerCase()}-${Date.now()}-${draft.id}`,
    type: "Leave",
    area: currentUser.area,
    name: userFullName(),
    initials: currentUser.initials,
    bidAs: currentUserBidAs(),
    seniority: currentUser.seniorityRank,
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

  newRequests.forEach((request) => {
    intakeQueue.unshift(request);
    leaveBids.push({
      priority: nextLeavePriority(),
      range: request.range,
      days: request.days,
      status: "Pending",
      notes: request.weekUnits ? `Round ${request.round}: ${request.weekUnits} bid week, ${request.days} charged days` : "Pending intake review",
    });
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
  setLeaveBuilderStatus("Leave batch sent to intake review.", "success");
}

function queuePrototypeEmail(to, subject, body) {
  prototypeEmails.unshift({
    to,
    subject,
    body,
    time: formatDateTime(new Date()),
  });
  logHistory(currentUser.area, "Email queued", `${currentUser.initials} queued "${subject}" to ${to}.`);
}

function queueBidVerifiedEmail(item) {
  const subject = `${item.type} verified for ${BID_YEAR}`;
  const recipient = Object.values(testAccounts).find((account) => account.initials === item.initials);
  const detail = item.type === "RDO Line"
    ? `RDO Line ${item.line}, Fatigue Group ${item.fatigueGroup}, Flex ${item.flex}, AWS ${item.aws}, Mid ${item.mid}.`
    : `${item.range}, ${item.days} ${item.days === 1 ? "day" : "days"}.`;
  queuePrototypeEmail(
    recipient?.email || `${item.initials.toLowerCase()}@natcazla.com`,
    subject,
    `Your ${item.type.toLowerCase()} bid has been verified and completed. ${detail} If you need to make changes, please do so before your bid window closes.`
  );
}

function applyRdoApproval(item) {
  const line = rdoLines.find((entry) => entry.line === item.line && lineForArea(entry, item.area));
  if (!line) return;

  syncApprovedRdoItem(item);

  item.status = "Approved";
  item.approvedBy = currentUser.initials;
  item.approvedAt = formatDateTime(new Date());
  item.appliedLine = item.bidAs === "GL" ? null : item.line;
  logHistory(
    item.area,
    "RDO bid approved",
    item.bidAs === "GL"
      ? `${currentUser.initials} approved ${item.initials}'s ghost-line bid for ${item.summary}. GL bids are logged but do not populate public floor templates.`
      : `${currentUser.initials} approved ${item.initials}'s ${item.summary}. The system applied ${item.initials} to Line ${item.line}.`
  );
  queueBidVerifiedEmail(item);
}

function syncApprovedRdoItem(item) {
  const line = rdoLines.find((entry) => entry.line === item.line && lineForArea(entry, item.area));
  if (!line || item.bidAs === "GL") return;

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

  const bid = leaveBids.find((entry) => entry.range === item.range);
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
  if (bidAs === "R-DEV" || bidAs === "D-DEV") return "dev";
  if (bidAs === "CPC" || bidAs === "GL") return "cpc";
  return null;
}

function removeInitialsFromLeaveRange(range, initials) {
  datesInLeaveRange(range).forEach((key) => {
    const details = extraLeaveSlotData[key];
    if (!details) return;
    details.cpc = (details.cpc || []).filter((value) => value !== initials);
    details.dev = (details.dev || []).filter((value) => value !== initials);
  });
}

function syncApprovedLeaveItem(item) {
  const bid = leaveBids.find((entry) => entry.range === item.range);
  if (bid) bid.status = "Approved";
  const bucket = leaveSlotBucketForBidAs(item.bidAs);
  if (!bucket) return;

  leaveApprovalDates(item).forEach((key) => {
    const details = extraLeaveSlotData[key] || { cpc: [], dev: [] };
    const values = details[bucket] || [];
    const capacity = bucket === "cpc" ? leaveSlotCapacity.cpc : leaveSlotCapacity.dev;
    if (!values.includes(item.initials) && values.length < capacity) {
      values.push(item.initials);
    }
    details[bucket] = values;
    extraLeaveSlotData[key] = details;
  });
}

function leaveApprovalBucket(item) {
  return leaveSlotBucketForBidAs(item.bidAs) || "cpc";
}

function leaveApprovalConflicts(item) {
  if (item.type !== "Leave") return [];
  const bucket = leaveApprovalBucket(item);
  const capacity = bucket === "dev" ? leaveSlotCapacity.dev : leaveSlotCapacity.cpc;

  return leaveApprovalDates(item).filter((key) => {
    const details = leaveSlotsForDate(key);
    const values = details[bucket] || [];
    return fullLeaveDates.has(key) || (values.length >= capacity && !values.includes(item.initials));
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
    const bid = leaveBids.find((entry) => entry.range === item.range);
    if (bid) {
      bid.status = "Declined";
      bid.notes = reason;
    }
  }

  logHistory(item.area, `${item.type} denied`, `${currentUser.initials} denied ${item.initials}'s ${item.type} request. Reason: ${reason}`);
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
    ["Pending", "Approved"].includes(item.status)
  );
  if (request?.line) return rdoLines.find((line) => line.line === request.line && lineForArea(line, request.area || currentUser.area)) || null;

  const populatedLine = rdoLines.find((line) => line.cpc === initials && line.status === "Taken" && lineForArea(line, currentUser.area));
  if (populatedLine) return populatedLine;

  if (initials === currentUser.initials) {
    return rdoLinesForArea(currentUser.area).find((line) => line.line === selectedLineId) || null;
  }

  return null;
}

function isRdoDateForInitials(key, initials = currentUser.initials) {
  const line = rdoLineForInitials(initials);
  if (!line) return false;
  return rdoWeekdaysForLine(line).has(dateFromKey(key).getDay());
}

function calendarActiveDate() {
  const activeDate = dateFromKey(selectedLeaveDateKey);
  const day = Math.min(activeDate.getDate(), new Date(displayedCalendarYear, activeDate.getMonth() + 1, 0).getDate());
  return new Date(displayedCalendarYear, activeDate.getMonth(), day);
}

function makeCalendar(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const area = targetId === "public-calendar" ? publicState.area : currentViewArea();
  const showRdo = targetId !== "public-calendar" && area === currentUser.area;
  const showPersonalLeave = targetId !== "public-calendar" && area === currentUser.area;
  const activeDate = calendarActiveDate();
  let monthIndexes = monthNames.map((_, index) => index);

  target.classList.toggle("month-view", calendarView === "month");
  target.classList.toggle("week-view", calendarView === "week");

  if (calendarView === "month") {
    monthIndexes = [activeDate.getMonth()];
  }

  if (calendarView === "week") {
    target.innerHTML = renderWeekCalendar(activeDate, { showRdo, showPersonalLeave, area });
    return;
  }

  target.innerHTML = monthIndexes
    .map((monthIndex) => renderMonthCard(monthIndex, displayedCalendarYear, { showRdo, showPersonalLeave, area }))
    .join("");
}

function renderMonthCard(monthIndex, year, options = {}) {
  const { showRdo = true, showPersonalLeave = true } = options;
  const name = monthNames[monthIndex];
  const date = new Date(year, monthIndex, 1);
  const firstDay = date.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = [];

  dayNames.forEach((day) => cells.push(`<span class="dow">${day[0]}</span>`));
  for (let i = 0; i < firstDay; i += 1) cells.push("<span></span>");

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(renderCalendarDay(monthIndex, day, false, year, { showRdo, showPersonalLeave }));
  }

  return `
    <article class="month-card">
      <h3>${name}</h3>
      <div class="month-grid">${cells.join("")}</div>
    </article>
  `;
}

function renderWeekCalendar(activeDate, options = {}) {
  const { showRdo = true, showPersonalLeave = true } = options;
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
            ${renderCalendarDay(date.getMonth(), date.getDate(), true, date.getFullYear(), { showRdo, showPersonalLeave, area: options.area })}
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function renderCalendarDay(monthIndex, day, includeMonth = false, year = displayedCalendarYear, options = {}) {
  const { showRdo = true, showPersonalLeave = true } = options;
  const weekday = new Date(year, monthIndex, day).getDay();
  const key = dateKey(year, monthIndex + 1, day);
  const isRdo = showRdo && selectedRdoWeekdays().has(weekday);
  const leaveStatus = showPersonalLeave && year === BID_YEAR ? personalLeaveDateStatus(key) : "";
  const canShowLeaveState = !isRdo;
  const isApprovedLeave = leaveStatus === "approved" && canShowLeaveState;
  const isPendingLeave = leaveStatus === "pending" && canShowLeaveState;
  const isDraftLeave = showPersonalLeave && canShowLeaveState && (isDraftLeaveDate(key) || isLeavePreviewRangeDate(key));
  const holidayKind = calendarHolidayKind(key, options);
  const isClosed = canShowLeaveState && isLeaveSlotsFull(key, options.area);
  const hasDetail = true;
  const isSelected = canShowLeaveState && key === selectedLeaveDateKey;
  const slotTooltip = quickLeaveSlotTooltip(key, holidayKind, options.area);
  const className = [
    holidayKind?.className || "",
    isDraftLeave ? "draft-leave-day" : "",
    isPendingLeave ? "pending-leave-day" : "",
    isApprovedLeave ? "leave-day" : "",
    isRdo ? "rdo-day" : "",
    isClosed ? "closed-day" : "",
    hasDetail ? "has-slot-detail" : "",
    isSelected ? "selected-date" : "",
  ].filter(Boolean).join(" ");
  const status = holidayKind?.label || (isRdo ? "RDO - leave bidding unavailable" : isClosed ? "CPC leave slots filled" : "View leave slots");
  const label = includeMonth ? `${monthNames[monthIndex].slice(0, 3)} ${day}` : day;
  const leaveDateAttribute = canShowLeaveState ? `data-leave-date="${key}"` : 'aria-disabled="true"';

  return `
    <button class="${className}" type="button" ${leaveDateAttribute} aria-label="${monthNames[monthIndex]} ${day}, ${year}: ${status}">
      <span class="date-number">${label}</span>
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
  document.querySelectorAll("[data-calendar-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.calendarView === calendarView);
  });
}

function renderCalendars() {
  updateCalendarViewControls();
  updateCalendarYearLabels();
  makeCalendar("public-calendar");
  makeCalendar("dashboard-calendar");
  makeCalendar("leave-calendar");
  makeCalendar("full-calendar");
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

  Object.entries(extraLeaveSlotData).forEach(([date, day]) => {
    if (!slotMatchesArea(day, area)) return;
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

function leaveSlotsForDate(key, area = currentUser.area) {
  const details = leaveSlotMap(area)[key] || {
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
    cpc: details.cpc || [],
    dev: details.dev || [],
    holiday: details.holiday || isHolidayDate(key),
    holidayInLieu,
  };
}

function hasLeaveSlotDetails(key, area = currentUser.area) {
  return Boolean(leaveSlotMap(area)[key]) || isHolidayDate(key) || (area === "Area A" && fullLeaveDates.has(key));
}

function isLeaveSlotsFull(key, area = currentUser.area) {
  const details = leaveSlotsForDate(key, area);
  return details.cpc.length >= leaveSlotCapacity.cpc || (area === "Area A" && fullLeaveDates.has(key));
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

function quickLeaveSlotTooltip(key, holidayKind = calendarHolidayKind(key), area = currentUser.area) {
  const details = visibleLeaveSlotDetails(key, area);
  const cpcSlots = Array.from({ length: leaveSlotCapacity.cpc }, (_, index) => details.cpc[index] || "");
  const devSlots = Array.from({ length: leaveSlotCapacity.dev }, (_, index) => details.dev[index] || "");
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
    <span class="leave-date-tooltip slot-summary" role="tooltip">
      <strong>${formatCalendarDate(key)}</strong>
      ${holidayKind ? `<span class="tooltip-date-kind ${holidayKind.badgeClass}">${holidayKind.label}</span>` : ""}
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
  const cpcFull = details.cpc.length >= leaveSlotCapacity.cpc;
  const devFull = details.dev.length >= leaveSlotCapacity.dev;
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
        <span><b>${details.cpc.length}</b> / ${leaveSlotCapacity.cpc} CPC slots filled</span>
        <span><b>${details.dev.length}</b> / ${leaveSlotCapacity.dev} developmental slots filled</span>
        ${details.holidayInLieu ? "<span><b>Holiday In-Lieu</b> observed for your RDO line</span>" : ""}
        ${details.holiday && !details.holidayInLieu ? "<span><b>Holiday</b> Federal holiday</span>" : ""}
      </div>
      <div class="daily-slot-grid">
        <section class="daily-slot-card cpc">
          <div>
            <h4>CPC Slots</h4>
            <small>${cpcFull ? "Not available for CPC leave" : "Still available for CPC leave"}</small>
          </div>
          ${slotRows("Slot", details.cpc, leaveSlotCapacity.cpc)}
        </section>
        <section class="daily-slot-card dev">
          <div>
            <h4>Developmental Slots</h4>
            <small>${devFull ? "Developmental slots full" : "Developmental slots still open"}</small>
          </div>
          ${slotRows("Dev", details.dev, leaveSlotCapacity.dev)}
        </section>
      </div>
      ${details.unavailable ? '<p class="unavailable-note">This day is blocked or manually unavailable for additional bidding.</p>' : ""}
    </article>
  `;
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
    supabaseState.client = window.supabase.createClient(config.url, config.publishableKey);
  }
  return supabaseState.client;
}

function setAuthStatus(message, status = "info") {
  const target = document.querySelector("[data-auth-status]");
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

function profileFromSupabase(row) {
  const fallbackInitials = [row.first_name?.[0], row.last_name?.[0]].filter(Boolean).join("").toUpperCase();
  return {
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    initials: row.initials || fallbackInitials || "?",
    initialsVerified: Boolean(row.initials_verified),
    seniorityRank: row.seniority_rank,
    bidderCount: Number(row.bidder_count || 0),
    area: row.area_name || "Area A",
    role: row.role || "controller",
    roleLabel: row.role === "admin" ? "Bidding Admin" : "BUE Controller",
    bidAs: row.bid_role || "CPC",
    systemAdmin: row.role === "admin",
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

function showLoggedInApp(page = "dashboard") {
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
  setPage(page);
}

async function initializeSupabaseAuth() {
  const client = supabaseClient();
  if (!client) return;
  const { data } = await client.auth.getSession();
  if (!data.session) return;

  try {
    const profile = await claimSupabaseProfile();
    if (!profile) {
      setAuthStatus("You are signed in, but no BUE profile matches this email yet.", "error");
      return;
    }
    currentUser = profile;
    showLoggedInApp("dashboard");
  } catch (error) {
    setAuthStatus(error.message || "Could not load your BUE profile.", "error");
  }
}

async function sendSupabaseLoginLink(email) {
  const client = supabaseClient();
  if (!client) {
    setAuthStatus("Supabase login is not configured yet.", "error");
    return;
  }

  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.href.split("#")[0],
    },
  });

  if (error) {
    setAuthStatus(error.message, "error");
    return;
  }

  setAuthStatus("Login link sent. Check that email inbox.", "success");
}

async function loginWithUsernamePassword(username, password) {
  const client = supabaseClient();
  if (!client) {
    setAuthStatus("Supabase login is not configured yet.", "error");
    return;
  }

  const { data, error } = await client.rpc("app_login_with_password", {
    login_username: username,
    login_password: password,
  });

  if (error) {
    setAuthStatus(error.message || "Could not check that login.", "error");
    return;
  }

  const profile = Array.isArray(data) ? data[0] : data;
  if (!profile) {
    setAuthStatus("That username or password did not match.", "error");
    return;
  }

  currentUser = profileFromSupabase(profile);
  setAuthStatus("Signed in.", "success");
  showLoggedInApp(currentUser.systemAdmin ? "admin" : "dashboard");
}

async function saveSupabaseProfile() {
  const client = supabaseClient();
  if (!client || !currentUser.supabaseProfileId) return false;
  const initials = document.querySelector("[data-profile-initials]")?.value || "";
  const phone = document.querySelector("[data-profile-phone]")?.value || "";
  const { data, error } = await client.rpc("update_current_bidder_profile", {
    profile_initials: initials,
    profile_phone: phone,
  });
  if (error) {
    alert(error.message);
    return true;
  }
  const profile = Array.isArray(data) ? data[0] : data;
  if (profile) currentUser = profileFromSupabase(profile);
  renderApp();
  return true;
}

function areaNameForRow(row, areaById = new Map()) {
  return areaById.get(row.area_id) || AREA_NAME_BY_CODE[row.area_code] || row.area_name || "Area A";
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

function rdoLinesForArea(area = currentUser.area) {
  return rdoLines.filter((line) => lineForArea(line, area));
}

function slotMatchesArea(details, area = currentUser.area) {
  return (details.area || "Area A") === area;
}

function upsertRdoLinesFromDatabase(rows, lineDays, areaById) {
  rows.forEach((row) => {
    const days = lineDays
      .filter((day) => day.rdo_line_id === row.id)
      .sort((a, b) => a.weekday - b.weekday)
      .map((day) => day.shift_code);
    const area = areaNameForRow(row, areaById);
    const nextLine = {
      area,
      pattern: row.pattern,
      line: row.line_code,
      lineType: row.line_type,
      cpc: "",
      week: days.length === 7 ? days : ["RDO", "RDO", "600", "700", "1300", "1430", "1500"],
      group: row.fatigue_group || "C",
      mid: row.mid || "No",
      aws: row.aws ? "Yes" : "No",
      fourTen: row.four_ten ? "Yes" : "No",
      flex: row.flex ? "Yes" : "No",
      status: row.status === "taken" ? "Taken" : row.status === "locked" ? "Taken" : "Open",
    };
    const existingIndex = rdoLines.findIndex((line) => line.line === nextLine.line && (line.area || "Area A") === area);
    if (existingIndex >= 0) {
      rdoLines[existingIndex] = { ...rdoLines[existingIndex], ...nextLine };
    } else {
      rdoLines.push(nextLine);
    }
  });
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
      unavailable: false,
    };
    const bucket = row.slot_group === "dev" ? "dev" : "cpc";
    const value = row.slot_initials || "";

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
    const existing = extraLeaveSlotData[details.date] || {};
    extraLeaveSlotData[details.date] = {
      ...existing,
      ...details,
      cpc: sortSlots(details.cpc),
      dev: sortSlots(details.dev),
    };
  });
}

async function loadSupabaseReferenceData() {
  const client = supabaseClient();
  if (!client || supabaseState.loading) return;

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

    const [
      areasResult,
      holidaysResult,
      rdoLinesResult,
      rdoLineDaysResult,
      leaveSlotsResult,
    ] = await Promise.all([
      client.from("areas").select("id,code,name,display_order").order("display_order"),
      client.from("holidays").select("holiday_date,name,is_observed").eq("bid_year_id", bidYear.id),
      client.from("rdo_lines").select("id,area_id,line_code,line_type,pattern,fatigue_group,mid,aws,four_ten,flex,status").eq("bid_year_id", bidYear.id),
      client.from("rdo_line_days").select("rdo_line_id,weekday,shift_code"),
      client.from("leave_slots").select("area_id,slot_date,slot_group,slot_code,status,slot_initials").eq("bid_year_id", bidYear.id),
    ]);

    const firstError = [areasResult, holidaysResult, rdoLinesResult, rdoLineDaysResult, leaveSlotsResult].find((result) => result.error)?.error;
    if (firstError) throw firstError;

    const areaById = new Map((areasResult.data || []).map((area) => [area.id, area.name]));

    (holidaysResult.data || []).forEach((holiday) => {
      if (holiday.holiday_date) holidayOverrides.add(holiday.holiday_date);
    });

    upsertRdoLinesFromDatabase(rdoLinesResult.data || [], rdoLineDaysResult.data || [], areaById);
    upsertLeaveSlotsFromDatabase(leaveSlotsResult.data || [], areaById);

    supabaseState.connected = true;
    supabaseState.loadedAt = new Date();
    supabaseState.message = `Connected to Supabase. Loaded ${(areasResult.data || []).length} areas, ${(holidaysResult.data || []).length} holidays, ${(rdoLinesResult.data || []).length} RDO lines, and ${(leaveSlotsResult.data || []).length} leave slots.`;
  } catch (error) {
    supabaseState.connected = false;
    supabaseState.message = `Supabase data unavailable, using prototype fallback. ${error.message || error}`;
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

function latestAreaRound() {
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
  return "Holidays, filled leave slots, and bid windows.";
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

function renderPublicRdoTable(area) {
  const lines = rdoLinesForArea(area);
  return `
    <div class="public-table-heading flat">
      <strong>${area} RDO Bid Lines</strong>
      <small>${supabaseState.connected ? "Loaded from Supabase for this area." : "Prototype data is being used until Supabase is available."}</small>
    </div>
    <div class="table-wrap public-table-wrap flat">
      <table class="line-table public-rdo-table">
        <thead>
          <tr>
            <th>Line #</th>
            <th>CPC</th>
            ${dayNames.map((day) => `<th>${day}</th>`).join("")}
            <th>Flex</th>
            <th>AWS</th>
            <th>Mid</th>
          </tr>
        </thead>
        <tbody>
          ${lines.length ? lines.map((line) => `
            <tr class="${line.status === "Taken" ? "occupied-row" : ""}">
              <td>${line.line}</td>
              <td>${lineOccupant(line)}</td>
              ${line.week.map((value) => `<td>${shiftCell(value)}</td>`).join("")}
              <td>${publicPreferenceCell(line.flex)}</td>
              <td>${publicPreferenceCell(line.aws)}</td>
              <td>${publicPreferenceCell(lineMidReferenceValue(line))}</td>
            </tr>
          `).join("") : `<tr><td colspan="12">No RDO lines have been loaded for ${area} yet.</td></tr>`}
        </tbody>
      </table>
    </div>
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
  const calendarViewControls = document.querySelector(".public-calendar-panel .segmented");
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

function userFullName() {
  return `${currentUser.firstName} ${currentUser.lastName}`;
}

function currentUserBidAs() {
  const seniorityMatch = seniority.find((person) => person.rank === currentUser.seniorityRank || person.initials === currentUser.initials);
  return currentUser.bidAs || seniorityMatch?.bidAs || "CPC";
}

function activeAdminGrant() {
  if (!currentUser.adminGrant) return null;
  const nowDate = new Date();
  const { start, end } = currentUser.adminGrant;
  return nowDate >= start && nowDate <= end ? currentUser.adminGrant : null;
}

function currentUserHasIntakeSchedule() {
  return intakeSchedules.some((schedule) => schedule.initials === currentUser.initials);
}

function activeScheduledIntakeWindow() {
  const nowDate = new Date();
  return intakeSchedules.find((schedule) => {
    const accessStart = new Date(schedule.start.getTime() - 15 * 60 * 1000);
    return schedule.initials === currentUser.initials && nowDate >= accessStart && nowDate <= schedule.end;
  }) || null;
}

function hasIntakeAccess() {
  return currentUser.role === "bidding-intake" || Boolean(activeAdminGrant()) || Boolean(activeScheduledIntakeWindow());
}

function hasSystemAdminAccess() {
  return Boolean(currentUser.systemAdmin);
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
  return Number.isFinite(currentUser.seniorityRank) ? `#${currentUser.seniorityRank} / ${currentUser.bidderCount}` : "Admin";
}

function userSeniorityLongText() {
  return Number.isFinite(currentUser.seniorityRank) ? `#${currentUser.seniorityRank} of ${currentUser.bidderCount}` : "Admin access";
}

function renderCurrentUser() {
  const isAdmin = hasIntakeAccess();
  const hasSeniority = Number.isFinite(currentUser.seniorityRank);
  const bidAs = currentUserBidAs();
  const bidAsClassName = `bid-as-${bidAsClass(bidAs)}`;
  const ahead = hasSeniority ? currentUser.seniorityRank - 1 : "—";
  const behind = hasSeniority ? currentUser.bidderCount - currentUser.seniorityRank : "—";
  const viewArea = currentViewArea();
  setText("[data-user-initials]", currentUser.initials);
  setText("[data-user-name]", userFullName());
  setText("[data-user-area]", currentUser.area);
  document.querySelectorAll("[data-user-context]").forEach((element) => {
    element.innerHTML = `
      <span class="user-context-main">${userFullName()} · ${currentUser.area}</span>
      <label class="view-area-control">
        <span>Change view area</span>
        <select data-view-area-select aria-label="Change view area">
          ${ZLA_AREAS.map((area) => `<option value="${area}" ${area === viewArea ? "selected" : ""}>${area}</option>`).join("")}
        </select>
      </label>
    `;
  });
  setText("[data-user-role]", accessLabel());
  setText("[data-user-seniority]", userSeniorityText());
  setText("[data-user-seniority-long]", userSeniorityLongText());
  setText("[data-user-rank-metric]", hasSeniority ? `#${currentUser.seniorityRank}` : "Admin");
  setText("[data-user-rank-total]", hasSeniority ? `of ${currentUser.bidderCount}` : "all areas");
  setText("[data-ahead-count]", ahead);
  setText("[data-behind-count]", behind);
  setText("[data-user-priority-summary]", hasSeniority ? `${ahead} ahead · ${behind} behind` : "All areas · intake access");
  setText("[data-bidder-count]", `${currentUser.bidderCount} bidders`);
  setText(
    "[data-seniority-summary]",
    isAdmin ? `Temporary bidding intake access for ${userFullName()}. Actions are logged under ${currentUser.initials}.` : `Current bidding order for ${viewArea}. Your position is highlighted in your home area.`
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
  document.querySelectorAll("[data-profile-area]").forEach((select) => { select.value = currentUser.area; });
  document.querySelectorAll("[data-profile-initials]").forEach((input) => { input.value = currentUser.initials; });
  document.querySelectorAll("[data-profile-phone]").forEach((input) => { input.value = currentUser.phone; });
  document.querySelectorAll("[data-profile-email]").forEach((input) => { input.value = currentUser.email; });

  document.querySelectorAll(".seniority-pill").forEach((button) => {
    button.disabled = !hasSeniority;
    button.title = hasSeniority ? "View seniority list" : "Admin accounts are not in the area seniority order.";
  });

  const selectedHomeLine = rdoLinesForArea(currentUser.area).find((line) => line.line === selectedLineId) || rdoLinesForArea(currentUser.area)[0];
  const rdoRequest = currentUserRdoRequest();
  setText("[data-dashboard-rdo-line]", selectedHomeLine ? `Line ${selectedHomeLine.line}` : "No line selected");
  setText("[data-dashboard-rdo-summary]", rdoRequest?.summary || "Choose fatigue group, AWS, Flex, and Mid when you bid.");

  document.querySelectorAll("[data-admin-only]").forEach((element) => {
    element.hidden = !isAdmin;
  });

  document.querySelectorAll("[data-intake-rep-only]").forEach((element) => {
    element.hidden = !(isAdmin || currentUserHasIntakeSchedule());
  });

  document.querySelectorAll("[data-system-admin-only]").forEach((element) => {
    element.hidden = !hasSystemAdminAccess();
  });
}

function hasSubmittedRdoBid() {
  return Boolean(currentUserRdoRequest()) || rdoLines.some((line) => line.status === "Taken" && line.cpc === currentUser.initials);
}

function updateBidWindow() {
  const now = new Date();
  const isBefore = now < userBidWindow.start;
  const isOpen = now >= userBidWindow.start && now <= userBidWindow.end;
  const isAdmin = hasIntakeAccess();
  const activePerson = seniority.find((person) => person.openRound);
  const statusText = isOpen ? "Open" : "Closed";
  const clockLabel = isAdmin ? "Bid Window" : isOpen ? "Your Turn" : isBefore ? "Opens In" : "Window Closed";
  const countdownText = isOpen
    ? formatDuration(userBidWindow.end - now)
    : isBefore
      ? formatDuration(userBidWindow.start - now)
      : "Closed";

  const status = document.getElementById("bid-window-status");
  if (status) {
    status.classList.toggle("closed", !isOpen);
    const copy = status.querySelector(".status-chip-copy");
    if (copy) {
      copy.querySelector("small").textContent = `Round ${latestAreaRound()}`;
      copy.querySelector("b").textContent = statusText;
    }
  }

  const clock = document.getElementById("bid-window-clock");
  if (clock) {
    clock.querySelector("span").textContent = clockLabel;
    clock.querySelector("strong").textContent = countdownText;
  }

  setText("[data-bid-window-text]", statusText);
  setText("[data-bid-window-countdown]", countdownText);
  setText("[data-bid-window-close]", formatDateTime(userBidWindow.end));
  setText("[data-bid-window-range]", formatDateRange(userBidWindow.start, userBidWindow.end));
  setText(
    "[data-current-bidder]",
    isOpen && activePerson ? `Currently Bidding: Seniority #${activePerson.rank} (${activePerson.initials})` : "Closed"
  );
  setText("[data-current-round]", `Round ${latestAreaRound()}`);

  document.querySelectorAll("[data-bid-window-pill]").forEach((pill) => {
    pill.textContent = statusText;
    pill.classList.toggle("closed", !isOpen);
  });

  document.querySelectorAll(".window-action").forEach((button) => {
    const disabled = !isOpen || !isViewingHomeArea();
    button.disabled = disabled;
    button.classList.toggle("disabled", disabled);
  });

  document.querySelectorAll("[data-bid-entry-action]").forEach((button) => {
    if (!isOpen) {
      button.textContent = "Bid Closed";
      return;
    }
    if (!isViewingHomeArea()) {
      button.textContent = "Viewing Only";
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
  if (value === "BID") return '<span class="status open">BID</span>';
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
  return isMidLineByDesign(line) ? "BID" : "UNSELECTED";
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

function rdoLineMatchesFilters(line) {
  if (rdoFilters.openOnly && line.status === "Taken") return false;

  const search = rdoFilters.search.trim().toLowerCase();
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
  if (rdoFilters.mid !== "all" && midValue !== rdoFilters.mid) return false;
  if (rdoFilters.fourTen !== "all" && lineFourTenValue(line) !== rdoFilters.fourTen) return false;

  return true;
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
  if (!line) return;
  const midIsLocked = isForcedMid(line);
  const midValue = selectedMidValue(line);
  const fatigueCapacity = fatigueCapacityForLine(line);

  document.querySelectorAll("[data-selected-line]").forEach((element) => {
    element.textContent = `Line ${line.line}`;
  });
  document.querySelectorAll("[data-selected-initials]").forEach((element) => {
    element.textContent = line.status === "Taken" ? line.cpc || currentUser.initials : currentUser.initials;
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
    element.textContent = selectedLineStatus(line);
    element.classList.toggle("closed", line.status === "Taken");
  });
  document.querySelectorAll("[data-selected-attributes]").forEach((element) => {
    element.innerHTML = `
      <span class="fatigue-picker">
        <em>Fatigue Group</em>
        <span class="fatigue-options">
          ${fatigueCapacity.map((item) => {
            const isSelected = selectedFatigueGroup === item.group;
            const available = canChooseGroup(item, isSelected);
            return `
              <button class="fatigue-option ${isSelected ? "active" : ""}" type="button" data-fatigue-group="${item.group}" ${available ? "" : "disabled"} title="Area ${item.areaUsed}/${item.areaMax}, crew ${item.crewUsed}/${item.crewMax}">
                <strong>${item.group}</strong>
                <small>Area ${item.areaUsed}/${item.areaMax} · Crew ${item.crewUsed}/${item.crewMax}</small>
              </button>
            `;
          }).join("")}
        </span>
      </span>
      <span class="mid-picker">
        <em>Mid${midIsLocked ? " (Line Required)" : ""}</em>
        <span class="mid-options">
          ${midIsLocked
            ? `<button class="mid-option active locked" type="button" disabled>${midValue}</button>`
            : ["Yes", "No"].map((value) => `
                <button class="mid-option ${selectedMidPreference === value ? "active" : ""}" type="button" data-mid-choice="${value}">
                  ${value}
                </button>
              `).join("")}
        </span>
      </span>
      <span class="aws-picker">
        <em>AWS</em>
        <span class="choice-options">
          ${["Yes", "No"].map((value) => `
            <button class="choice-option ${selectedAwsPreference === value ? "active" : ""}" type="button" data-aws-choice="${value}">
              ${value}
            </button>
          `).join("")}
        </span>
      </span>
      <span>4-10 <b>${lineFourTenValue(line)}</b></span>
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
      <span>Status <b>${selectedLineStatus(line)}</b></span>
    `;
  });

  renderWeek("selected-week", line.week);
  renderWeek("rdo-week", line.week);
  renderFatigueCapacity();
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
        <button class="${isSelected ? "active" : ""}" type="button" data-fatigue-group="${item.group}" ${available ? "" : "disabled"}>
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
    .map((bid) => compact
      ? `
        <tr>
          <td><b>${bid.priority}</b></td>
          <td>${bid.range}</td>
          <td>${bid.days}</td>
          <td><span class="status ${bid.status.toLowerCase()}">${bid.status}</span></td>
        </tr>
      `
      : `
        <tr>
          <td><b>${bid.priority}</b></td>
          <td>${bid.range}</td>
          <td>${bid.days}</td>
          <td><span class="status ${bid.status.toLowerCase()}">${bid.status}</span></td>
          <td>${bid.notes}</td>
        </tr>
      `)
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
  submitButton.disabled = leaveDraftQueue.length === 0;

  list.innerHTML = leaveDraftQueue.length
    ? leaveDraftQueue.map((item, index) => `
      <article class="leave-draft-item">
        <span>${index + 1}</span>
        <div>
          <strong>${escapeHtml(item.range)}</strong>
          <small>${item.weekUnits ? `${item.weekUnits} bid week · ` : ""}${item.days} ${item.days === 1 ? "day" : "days"} charged</small>
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

  setText("[data-leave-already-detail]", `Approved: 8 days · Pending: 4 days · ${holidayText}`);
  setText("[data-leave-left-days]", "18");
  setText("[data-leave-bid-days]", "12");
  setText("[data-leave-balance-summary]", `${ANNUAL_LEAVE_ALLOWANCE_DAYS} total · ${holidayText}`);
  setText("[data-leave-holidays-bid]", credits && round >= 4 ? `${holidayCount} (${credits} credit)` : String(holidayCount));
}

function leaveBucketUsage(bucket) {
  return Object.values(leaveSlotMap()).reduce((sum, day) => sum + (day[bucket] || []).length, 0);
}

function renderLeaveBucketCards() {
  const cpcCount = seniority.filter((person) => person.bidAs === "CPC").length;
  const devCount = seniority.filter((person) => person.bidAs === "R-DEV" || person.bidAs === "D-DEV").length;
  const cpcTotal = cpcCount * 36;
  const devTotal = devCount * 36;
  const cpcUsed = leaveBucketUsage("cpc");
  const devUsed = leaveBucketUsage("dev");

  setText("[data-cpc-leave-remaining]", `${Math.max(0, cpcTotal - cpcUsed)} days`);
  setText("[data-dev-leave-remaining]", `${Math.max(0, devTotal - devUsed)} days`);
  setText("[data-cpc-leave-detail]", `${cpcUsed} used of ${cpcTotal}`);
  setText("[data-dev-leave-detail]", `${devUsed} used of ${devTotal}`);
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

function renderEmailLog() {
  const target = document.querySelector("[data-email-log]");
  if (!target) return;

  target.innerHTML = prototypeEmails.length
    ? prototypeEmails.slice(0, 8).map((email) => `
      <article>
        <strong>${escapeHtml(email.subject)}</strong>
        <span>${escapeHtml(email.to)} · ${escapeHtml(email.time)}</span>
      </article>
    `).join("")
    : '<p class="empty-state small">No prototype emails have been queued yet.</p>';
}

function renderAdminConsole() {
  syncAdminScheduleFormDefaults();
  renderEmailLog();

  const target = document.querySelector("[data-admin-user-list]");
  if (!target) return;

  target.innerHTML = Object.entries(testAccounts).map(([key, account]) => {
    const grant = account.adminGrant;
    const grantActive = grant && new Date() >= grant.start && new Date() <= grant.end;
    return `
      <article class="admin-user-card">
        <div>
          <small>${escapeHtml(account.roleLabel || "Controller")}</small>
          <h3>${escapeHtml(account.firstName)} ${escapeHtml(account.lastName)} · ${escapeHtml(account.initials)}</h3>
          <p>${escapeHtml(account.area)} · Seniority ${Number.isFinite(account.seniorityRank) ? `#${account.seniorityRank}` : "Admin"} · ${account.systemAdmin ? "System Admin" : "Standard User"}</p>
          <span class="status ${grantActive ? "approved" : "pending"}">${grantActive ? "Intake access active" : "No active intake access"}</span>
        </div>
        <div class="admin-user-actions">
          <button class="secondary-action small" type="button" data-admin-login-user="${key}">Log In As</button>
          <button class="primary-action small" type="button" data-admin-grant-user="${key}">Grant Intake</button>
          <button class="secondary-action small danger" type="button" data-admin-reset-user="${key}">Reset Access</button>
        </div>
      </article>
    `;
  }).join("");
}

function grantPrototypeIntakePermission(accountKey) {
  if (!hasSystemAdminAccess()) return;
  const account = testAccounts[accountKey];
  if (!account) return;

  const grant = {
    type: "Bidding Intake",
    scope: "All Areas",
    start: new Date(Date.now() - 15 * 60 * 1000),
    end: new Date(Date.now() + 4 * 60 * 60 * 1000),
    grantedBy: `${userFullName()} (${currentUser.initials})`,
  };
  account.adminGrant = grant;
  if (account.initials === currentUser.initials) currentUser.adminGrant = grant;

  logHistory("All Areas", "Intake rights assigned", `${currentUser.initials} granted ${account.initials} intake access through ${formatDateTime(grant.end)}.`);
  renderApp();
}

function resetPrototypeAccount(accountKey) {
  if (!hasSystemAdminAccess()) return;
  const account = testAccounts[accountKey];
  if (!account) return;

  delete account.adminGrant;
  if (account.initials === currentUser.initials) delete currentUser.adminGrant;

  logHistory("All Areas", "User access reset", `${currentUser.initials} reset intake rights for ${account.initials}.`);
  renderApp();
}

function addAdminScheduleFromForm() {
  if (!hasSystemAdminAccess()) {
    setAdminScheduleStatus("Only system admins can schedule intake reps from this page.", "error");
    return;
  }

  const initials = (document.querySelector("[data-admin-schedule-initials]")?.value || "").trim().toUpperCase();
  const nameInput = (document.querySelector("[data-admin-schedule-name]")?.value || "").trim();
  const area = document.querySelector("[data-admin-schedule-area]")?.value || "All Areas";
  const startRaw = document.querySelector("[data-admin-schedule-start]")?.value || "";
  const endRaw = document.querySelector("[data-admin-schedule-end]")?.value || "";
  const start = new Date(startRaw);
  const end = new Date(endRaw);

  if (!initials) {
    setAdminScheduleStatus("Enter the intake rep initials before adding a shift.", "error");
    return;
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    setAdminScheduleStatus("Choose a valid start and end time.", "error");
    return;
  }

  const account = Object.values(testAccounts).find((item) => item.initials === initials);
  const person = seniority.find((item) => item.initials === initials);
  const name = nameInput || (account ? `${account.firstName} ${account.lastName}` : "") || (person ? `${person.firstName} ${person.lastName}` : initials);

  intakeSchedules.push({
    id: `sched-admin-${initials.toLowerCase()}-${Date.now()}`,
    initials,
    name,
    area,
    start,
    end,
  });

  logHistory(area === "All Areas" ? currentUser.area : area, "Intake shift scheduled", `${currentUser.initials} scheduled ${name} (${initials}) for ${formatDateRange(start, end)} · ${area}.`);
  renderApp();
  setAdminScheduleStatus(`${name} is scheduled. Intake access will open 15 minutes before the shift.`, "success");
}

function schedulesForDateKey(key) {
  return intakeSchedules.filter((schedule) => dateKeyFromDate(schedule.start) === key);
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

function renderScheduleMonthCard(monthIndex, year) {
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = [];

  dayNames.forEach((day) => cells.push(`<span class="dow">${day[0]}</span>`));
  for (let i = 0; i < firstDay; i += 1) cells.push("<span></span>");

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = dateKey(year, monthIndex + 1, day);
    const schedules = schedulesForDateKey(key);
    const hasUserSchedule = schedules.some((schedule) => schedule.initials === currentUser.initials);
    cells.push(`
      <button class="schedule-day ${schedules.length ? "has-schedule" : ""} ${hasUserSchedule ? "my-schedule-day" : ""}" type="button" aria-label="${monthNames[monthIndex]} ${day}, ${year}: ${schedules.length ? "intake scheduled" : "no intake scheduled"}">
        <span class="date-number">${day}</span>
        ${renderScheduleTooltip(key)}
      </button>
    `);
  }

  return `
    <article class="month-card">
      <h3>${monthNames[monthIndex]}</h3>
      <div class="month-grid">${cells.join("")}</div>
    </article>
  `;
}

function renderIntakeSchedule() {
  const calendar = document.getElementById("intake-schedule-calendar");
  const list = document.querySelector("[data-intake-schedule-list]");
  syncScheduleFormDefaults();

  if (calendar) {
    calendar.innerHTML = monthNames
      .map((_, monthIndex) => renderScheduleMonthCard(monthIndex, BID_YEAR))
      .join("");
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

  const initials = (document.querySelector("[data-schedule-initials]")?.value || "").trim().toUpperCase();
  const nameInput = (document.querySelector("[data-schedule-name]")?.value || "").trim();
  const area = document.querySelector("[data-schedule-area]")?.value || "All Areas";
  const startRaw = document.querySelector("[data-schedule-start]")?.value || "";
  const endRaw = document.querySelector("[data-schedule-end]")?.value || "";
  const start = new Date(startRaw);
  const end = new Date(endRaw);

  if (!initials) {
    setScheduleFormStatus("Enter the rep initials before adding a shift.", "error");
    return;
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    setScheduleFormStatus("Choose a valid start and end time for the intake shift.", "error");
    return;
  }

  const account = Object.values(testAccounts).find((item) => item.initials === initials);
  const person = seniority.find((item) => item.initials === initials);
  const name = nameInput || (account ? `${account.firstName} ${account.lastName}` : "") || (person ? `${person.firstName} ${person.lastName}` : initials);

  intakeSchedules.push({
    id: `sched-${initials.toLowerCase()}-${Date.now()}`,
    initials,
    name,
    area,
    start,
    end,
  });

  logHistory(area === "All Areas" ? currentUser.area : area, "Intake shift assigned", `${currentUser.initials} scheduled ${name} (${initials}) for ${formatDateRange(start, end)} · ${area}.`);
  renderApp();
  setPage("intake-schedule");
  setScheduleFormStatus(`${name} is scheduled for ${formatDateRange(start, end)}. Access starts 15 minutes before the shift.`, "success");
}

function renderSeniority() {
  const compactTarget = document.getElementById("seniority-list");
  if (compactTarget) {
    compactTarget.innerHTML = seniority
      .map((person) => {
        const isBiddingNow = Boolean(person.openRound);
        return `
        <div class="seniority-row ${isBiddingNow ? "active bidding-now" : person.status === "active" ? "active" : ""}">
          <span>#${person.rank}</span>
          <b>${person.initials}${person.rank === currentUser.seniorityRank ? " · You" : ""}</b>
          <i class="dot ${isBiddingNow ? "active" : person.status}" title="${isBiddingNow ? `Round ${person.openRound} bid window open` : ""}"></i>
        </div>
      `;
      })
      .join("");
  }

  const pageTarget = document.getElementById("seniority-page-list");
  if (!pageTarget) return;

  pageTarget.innerHTML = seniority
    .map((person) => {
      const isBiddingNow = Boolean(person.openRound);
      return `
      <article class="seniority-card ${isBiddingNow ? "active bidding-now" : person.status === "active" ? "active" : ""}">
        <div class="seniority-card-head">
          <span>#${person.rank}</span>
          ${isBiddingNow ? `<i class="open-now" title="Round ${person.openRound} bid window open"></i>` : ""}
        </div>
        <strong>${person.rank === currentUser.seniorityRank ? `${person.firstName} ${person.lastName} · ${person.initials} · You` : `${person.firstName} ${person.lastName}`}</strong>
        <div class="seniority-card-meta">
          <small class="bid-as ${person.bidAs.toLowerCase().replace(/[^a-z0-9]+/g, "-")}">${person.bidAs}</small>
          ${person.rank === currentUser.seniorityRank ? '<button class="secondary-action calendar-download" type="button" data-download-bid-windows>Download .ics</button>' : ""}
        </div>
        <div class="round-times">
          ${person.rounds.map((time, index) => {
            const round = index + 1;
            const isComplete = person.completed.includes(round);
            const isOpen = person.openRound === round;
            return `
              <div class="round-time ${isOpen ? "open" : ""}">
                <span>R${round}</span>
                <b>${time}</b>
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

function currentUserHelpThread() {
  let thread = helpThreads.find((item) => item.initials === currentUser.initials);
  if (!thread) {
    thread = {
      id: `help-${currentUser.initials.toLowerCase()}-${Date.now()}`,
      area: currentUser.area,
      requester: userFullName(),
      initials: currentUser.initials,
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
    return helpThreads.find((thread) => thread.id === activeHelpThreadId) || helpThreads[0] || currentUserHelpThread();
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
  const subtitle = document.querySelector("[data-help-panel-subtitle]");
  const threadList = document.querySelector("[data-help-thread-list]");
  const messageList = document.querySelector("[data-help-message-list]");
  const resolveButton = document.querySelector("[data-help-resolve]");
  panel.classList.toggle("intake-mode", intakeMode);

  if (subtitle) {
    subtitle.textContent = intakeMode
      ? "Reply to saved BUE help conversations from the intake side."
      : "Ask bidding intake for help. This conversation is saved.";
  }

  if (threadList) {
    threadList.hidden = !intakeMode;
    threadList.innerHTML = intakeMode
      ? helpThreads.map((item) => `
        <button class="help-thread-card ${item.id === thread.id ? "active" : ""}" type="button" data-help-thread-open="${item.id}">
          <span>${escapeHtml(item.status)}</span>
          <strong>${escapeHtml(item.requester)} · ${escapeHtml(item.initials)}</strong>
          <small>${escapeHtml(item.area)} · ${escapeHtml(item.updatedAt)}</small>
        </button>
      `).join("")
      : "";
  }

  if (messageList) {
    messageList.innerHTML = thread.messages.length
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
  }

  if (resolveButton) {
    resolveButton.hidden = !intakeMode || thread.status === "Resolved";
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
      <button class="help-thread-card" type="button" data-help-thread-open="${thread.id}">
        <span>${escapeHtml(thread.status)}</span>
        <strong>${escapeHtml(thread.requester)} · ${escapeHtml(thread.initials)}</strong>
        <small>${escapeHtml(thread.area)} · ${escapeHtml(thread.messages.length)} messages · ${escapeHtml(thread.updatedAt)}</small>
      </button>
    `).join("")
    : '<div class="empty-state">No open help conversations.</div>';
}

function sendHelpMessage() {
  const input = document.querySelector("[data-help-message-input]");
  const body = input?.value.trim() || "";
  if (!body) {
    setHelpStatus("Type a message before sending.", "error");
    return;
  }

  const thread = activeHelpThread();
  const role = helpPanelMode === "intake" && hasIntakeAccess() ? "Intake" : "BUE";
  thread.messages.push({
    author: currentUser.initials,
    role,
    time: formatDateTime(new Date()),
    body,
  });
  thread.updatedAt = formatDateTime(new Date());
  thread.status = role === "Intake" ? "Answered" : "Open";
  input.value = "";
  activeHelpThreadId = thread.id;
  logHistory(thread.area, "Help message saved", `${currentUser.initials} added a ${role.toLowerCase()} message to ${thread.initials}'s help thread.`);
  renderApp();
  setHelpStatus(role === "Intake" ? "Reply sent and saved to the thread." : "Message sent to bidding intake and saved.", "success");
}

function resolveHelpThread() {
  if (!hasIntakeAccess()) return;
  const thread = activeHelpThread();
  thread.status = "Resolved";
  thread.updatedAt = formatDateTime(new Date());
  logHistory(thread.area, "Help thread resolved", `${currentUser.initials} marked ${thread.initials}'s help conversation resolved.`);
  renderApp();
  setHelpStatus("Thread marked resolved and saved.", "success");
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
          ${rdoLines.map((line) => `<option value="${line.line}" ${line.line === item.line ? "selected" : ""}>Line ${line.line}</option>`).join("")}
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

function renderIntakeQueue() {
  const target = document.getElementById("intake-queue");
  if (!target) return;

  const canReview = hasIntakeAccess();
  const visibleItems = canReview
    ? intakeQueue
    : intakeQueue.filter((item) => item.area === currentUser.area && item.initials === currentUser.initials);

  target.innerHTML = visibleItems.length
    ? visibleItems.map((item) => `
      <article class="intake-card ${item.status.toLowerCase()}">
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
    : '<div class="empty-state">No intake submissions are waiting for review.</div>';

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
  if (pageName === "intake" && !hasIntakeAccess()) {
    pageName = "history";
  }
  if (pageName === "intake-schedule" && !(hasIntakeAccess() || currentUserHasIntakeSchedule())) {
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
      "Area A",
      `${person.firstName} ${person.lastName}`,
      person.initials,
      person.bidAs,
      person.rank === currentUser.seniorityRank ? "Current User" : "",
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
  seniority = buildSeniority();
  renderCurrentUser();
  renderCalendars();
  syncLeaveBuilderInputs();
  syncRdoFilterControls();
  renderRdoLines();
  updateSelectedLine();
  renderLeaveRows("dashboard-leave-rows");
  renderLeaveRows("leave-page-rows");
  renderLeaveDraftQueue();
  renderLeaveAllowanceSummary();
  renderLeaveDatePicker();
  renderLeaveBucketCards();
  renderLeaveSlotBoard();
  renderSeniority();
  renderIntakeSchedule();
  renderHistory();
  renderIntakeQueue();
  renderAdminConsole();
  renderHelpSummary();
  renderHelpPanel();
  renderAlerts();
  updateBidWindow();
}

function loginAs(accountKey) {
  const account = testAccounts[accountKey] || testAccounts.bue;
  currentUser = { ...account };
  showLoggedInApp(accountKey === "admin" ? "intake" : "dashboard");
}

function logOut() {
  supabaseClient()?.auth.signOut();
  selectedViewArea = null;
  document.querySelector(".app-shell")?.setAttribute("hidden", "");
  document.querySelector("[data-help-menu]")?.setAttribute("hidden", "");
  document.querySelector(".login-screen")?.removeAttribute("hidden");
  updatePublicView();
}

document.addEventListener("click", (event) => {
  primeAlertSound();

  const publicLoginToggle = event.target.closest("[data-public-login-toggle]");
  const publicLoginMenu = document.querySelector("[data-public-login-menu]");
  if (publicLoginToggle && publicLoginMenu) {
    const shouldOpen = publicLoginMenu.hidden;
    publicLoginMenu.hidden = !shouldOpen;
    publicLoginToggle.setAttribute("aria-expanded", String(shouldOpen));
    return;
  }

  const loginButton = event.target.closest("[data-login]");
  if (loginButton) {
    loginAs(loginButton.dataset.login);
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
    selectedLeaveDateKey = leavePickerDateButton.dataset.leavePickerDate;
    selectLeaveBuilderDate(selectedLeaveDateKey);
    renderCalendars();
    renderLeaveSlotBoard();
    renderLeaveDatePicker();
    return;
  }

  if (leavePickerOpen && !event.target.closest(".date-range-picker")) {
    setLeavePickerOpen(false);
  }

  const publicButton = event.target.closest("[data-public-area]");
  if (publicButton && !event.target.closest(".app-shell")) {
    updatePublicView(publicButton.dataset.publicArea, publicButton.dataset.publicSection || "Calendar");
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
    sendHelpMessage();
    return;
  }

  if (event.target.closest("[data-help-resolve]")) {
    resolveHelpThread();
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
    downloadBidWindowsIcs();
    return;
  }

  if (event.target.closest("[data-add-leave-request]")) {
    addOrUpdateLeaveSubmission();
    return;
  }

  if (event.target.closest("[data-save-profile]")) {
    saveSupabaseProfile().then((handled) => {
      if (!handled) renderApp();
    });
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
    submitLeaveDraftBatch();
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

  const adminLogin = event.target.closest("[data-admin-login-user]");
  if (adminLogin) {
    loginAs(adminLogin.dataset.adminLoginUser);
    return;
  }

  const adminGrant = event.target.closest("[data-admin-grant-user]");
  if (adminGrant) {
    grantPrototypeIntakePermission(adminGrant.dataset.adminGrantUser);
    return;
  }

  const adminReset = event.target.closest("[data-admin-reset-user]");
  if (adminReset) {
    resetPrototypeAccount(adminReset.dataset.adminResetUser);
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

  const flexButton = event.target.closest("[data-flex-choice]");
  if (flexButton && !flexButton.disabled) {
    selectedFlexPreference = flexButton.dataset.flexChoice;
    renderRdoLines();
    updateSelectedLine();
    return;
  }

  const selectLineButton = event.target.closest("[data-select-line]");
  if (selectLineButton && !selectLineButton.hidden) {
    const line = rdoLinesForArea(currentUser.area).find((item) => item.line === selectedLineId);
    if (line && line.status !== "Taken") {
      addOrUpdateRdoSubmission();
    }

    renderApp();
    return;
  }

  const row = event.target.closest("[data-line-id]");
  if (row && !row.classList.contains("occupied-row")) {
    selectedLineId = row.dataset.lineId;
    renderRdoLines();
    updateSelectedLine();
    renderCalendars();
    renderLeaveSlotBoard();
    return;
  }

  const leaveDateButton = event.target.closest("[data-leave-date]");
  if (leaveDateButton) {
    selectedLeaveDateKey = leaveDateButton.dataset.leaveDate;
    const isAppCalendar = Boolean(event.target.closest(".app-shell"));
    if (isAppCalendar) {
      selectLeaveBuilderDate(selectedLeaveDateKey);
    }
    renderCalendars();
    syncLeaveBuilderInputs();
    if (!isAppCalendar) return;
    renderLeaveSlotBoard();
    setPage("leave");
    return;
  }

  const calendarViewButton = event.target.closest("[data-calendar-view]");
  if (calendarViewButton) {
    calendarView = calendarViewButton.dataset.calendarView;
    renderCalendars();
    return;
  }

  const calendarYearButton = event.target.closest("[data-calendar-year-action]");
  if (calendarYearButton) {
    const action = calendarYearButton.dataset.calendarYearAction;
    if (action === "next") displayedCalendarYear += 1;
    if (action === "previous") displayedCalendarYear -= 1;
    if (action === "today") displayedCalendarYear = BID_YEAR;
    setSelectedDateYear(displayedCalendarYear);
    renderCalendars();
    renderLeaveSlotBoard();
    return;
  }

  const trigger = event.target.closest("[data-page]");
  if (!trigger) return;
  setPage(trigger.dataset.page);
});

document.querySelector("[data-bid-year-select]")?.addEventListener("change", (event) => {
  updateSelectedBidYear(event.target.value);
});

document.querySelector("[data-email-login-form]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = document.querySelector("[data-email-login-input]")?.value.trim();
  if (!email) {
    setAuthStatus("Enter your email address first.", "error");
    return;
  }
  setAuthStatus("Sending login link...");
  sendSupabaseLoginLink(email);
});

document.querySelector("[data-admin-login-form]")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const username = document.querySelector("[data-admin-username-input]")?.value.trim();
  const password = document.querySelector("[data-admin-password-input]")?.value || "";
  if (!username || !password) {
    setAuthStatus("Enter the admin username and password.", "error");
    return;
  }
  setAuthStatus("Checking admin login...");
  loginWithUsernamePassword(username, password);
});

document.addEventListener("input", (event) => {
  const filter = event.target.closest("[data-rdo-filter]");
  if (!filter || filter.dataset.rdoFilter !== "search") return;
  rdoFilters.search = filter.value;
  renderRdoLines();
});

document.addEventListener("change", (event) => {
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

updatePublicView();
renderApp();
loadSupabaseReferenceData().then(() => {
  updatePublicView();
  renderApp();
  initializeSupabaseAuth();
});
setInterval(updateBidWindow, 1000);
