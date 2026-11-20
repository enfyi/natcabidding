export type ScheduleEvent = { label: string; kind: 'round' | 'validation' | 'holiday' | 'change'; start: string; end: string }
export const PHASE_KINDS: ScheduleEvent['kind'][]
export function phaseClass(event: ScheduleEvent | null): string
export function validDate(value: unknown): boolean
export function validateSchedule(events: unknown): string[]
export function sortSchedule(events: ScheduleEvent[]): ScheduleEvent[]
export function todayInLA(now?: number): string
export function scheduleStatus(events: ScheduleEvent[], today?: string): { current: ScheduleEvent | null; next: ScheduleEvent | null; complete: boolean }
export function dateLabel(value: string): string
export function rangeLabel(event: ScheduleEvent): string
export function calendarWeeks(events: ScheduleEvent[]): { date: string; day: number; month: number; event: ScheduleEvent | null }[][]
