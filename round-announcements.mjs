// Shared by the admin preview, website renderer, and scheduling tests.
export const TIME_ZONE = 'America/Los_Angeles';
export function defaultAnnouncement(round, bidYear) {
  return { bid_year: bidYear, round_number: round, enabled: false, color: 'amber', mode: 'automatic',
    title: 'Round {round} bidding starts {start}.', body: 'Check your assigned bid time and review your selections.',
    public_link_label: 'Sign in to view your bid time', public_link_url: 'login',
    member_link_label: 'View my bid window', member_link_url: 'bidding.html?page=dashboard',
    starts_at: null, ends_at: null };
}
export function safeAnnouncementUrl(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith('//')) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  }
  return true;
}
export function announcementWindow(item, schedule) {
  const current = schedule.find(row => Number(row.round_number) === item.round_number);
  const previous = schedule.find(row => Number(row.round_number) === item.round_number - 1);
  const start = item.mode === 'manual' || item.round_number === 1 ? item.starts_at : previous?.ends_at;
  const end = item.mode === 'manual' ? item.ends_at : current?.starts_at;
  const startMs = start ? Date.parse(start) : NaN;
  const endMs = end ? Date.parse(end) : NaN;
  return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs < endMs ? { start: startMs, end: endMs } : null;
}
export function activeAnnouncements(items, schedule, now = Date.now()) {
  return items.filter(item => {
    const window = announcementWindow(item, schedule);
    return item.enabled && window && now >= window.start && now < window.end;
  }).sort((a, b) => a.round_number - b.round_number);
}
function localDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function announcementTitle(item, schedule, now = Date.now()) {
  const current = schedule.find(row => Number(row.round_number) === item.round_number);
  const timestamp = current?.starts_at;
  let start = 'soon';
  if (timestamp) {
    const date = new Date(timestamp);
    const label = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'long', day: 'numeric' }).format(date);
    const today = localDateKey(new Date(now));
    // Compute tomorrow by advancing the local calendar day, not by assuming a 24-hour day.
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const tomorrow = localDateKey(new Date(Date.UTC(+values.year, +values.month - 1, +values.day + 1, 19)));
    start = localDateKey(date) === today ? `today, ${label}` : localDateKey(date) === tomorrow ? `tomorrow, ${label}` : `on ${label}`;
  }
  return item.title.replaceAll('{round}', String(item.round_number)).replaceAll('{start}', start);
}
export function toLocalInput(timestamp) {
  if (!timestamp) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function fromLocalInput(value) {
  if (!value) return null;
  const naive = Date.parse(`${value}Z`);
  if (!Number.isFinite(naive)) throw new Error('Enter a valid date and time.');
  let instant = naive;
  for (let i = 0; i < 3; i++) {
    const represented = Date.parse(`${toLocalInput(new Date(instant).toISOString())}Z`);
    instant += naive - represented;
  }
  const result = new Date(instant).toISOString();
  if (toLocalInput(result) !== value) throw new Error('That time does not exist in Los Angeles because of daylight saving time. Choose another time.');
  return result;
}
