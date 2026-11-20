export const PHASE_KINDS = ['round', 'validation', 'holiday', 'change'];
export function phaseClass(event) {
  if (!event) return 'schedule-kind-none';
  if (event.kind !== 'round') return `schedule-kind-${event.kind}`;
  const round = event.label.match(/[1-7]/)?.[0] || '1';
  return `schedule-round-${round}`;
}
export function validDate(value) {
  return typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
export function validateSchedule(events) {
  if (!Array.isArray(events) || !events.length || events.length > 200) return ['Add between 1 and 200 schedule entries.'];
  const issues = [];
  events.forEach((event, index) => {
    if (!event || typeof event.label !== 'string' || !event.label.trim() || event.label.length > 100) issues.push(`Entry ${index + 1}: enter a label of 1–100 characters.`);
    if (!event || !PHASE_KINDS.includes(event.kind)) issues.push(`Entry ${index + 1}: choose a phase type.`);
    if (!event || !validDate(event.start) || !validDate(event.end) || event.end < event.start) issues.push(`Entry ${index + 1}: enter valid start and end dates, in order.`);
  });
  if (issues.length) return issues;
  const sorted = sortSchedule(events);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].start <= sorted[i - 1].end) issues.push(`${sorted[i].label} overlaps ${sorted[i - 1].label}. Split date ranges around holidays and validation days.`);
  if (Date.parse(sorted.at(-1).end) - Date.parse(sorted[0].start) > 366 * 86400000) issues.push('Keep the schedule within a 366-day span.');
  return issues;
}
export function sortSchedule(events) { return [...events].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end)); }
export function todayInLA(now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function scheduleStatus(events, today = todayInLA()) {
  const sorted = sortSchedule(events);
  return { current: sorted.find(e => e.start <= today && e.end >= today) || null, next: sorted.find(e => e.start > today) || null, complete: sorted.length > 0 && sorted.at(-1).end < today };
}
export function dateLabel(value) { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)); }
export function rangeLabel(event) { return event.start === event.end ? dateLabel(event.start) : `${dateLabel(event.start)} – ${dateLabel(event.end)}`; }
export function calendarWeeks(events) {
  if (validateSchedule(events).length) return [];
  const sorted = sortSchedule(events);
  const start = new Date(`${sorted[0].start}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const last = new Date(`${sorted.at(-1).end}T12:00:00Z`);
  last.setUTCDate(last.getUTCDate() + 6 - last.getUTCDay());
  const weeks = [];
  while (start <= last) {
    const week = [];
    for (let day = 0; day < 7; day++) {
      const date = start.toISOString().slice(0, 10);
      week.push({ date, day: start.getUTCDate(), month: start.getUTCMonth() + 1, event: sorted.find(e => e.start <= date && e.end >= date) || null });
      start.setUTCDate(start.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}
