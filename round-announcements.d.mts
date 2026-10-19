export type Announcement = {
  bid_year: number; round_number: number; enabled: boolean; color: 'amber' | 'blue'; mode: 'automatic' | 'manual';
  title: string; body: string; public_link_label: string; public_link_url: string; member_link_label: string; member_link_url: string;
  starts_at: string | null; ends_at: string | null;
}
export type RoundBounds = { round_number: number; starts_at: string; ends_at: string }
export const TIME_ZONE: string
export function defaultAnnouncement(round: number, bidYear: number): Announcement
export function safeAnnouncementUrl(value: string): boolean
export function announcementWindow(item: Announcement, schedule: RoundBounds[]): { start: number; end: number } | null
export function activeAnnouncements(items: Announcement[], schedule: RoundBounds[], now?: number): Announcement[]
export function announcementTitle(item: Announcement, schedule: RoundBounds[], now?: number): string
export function toLocalInput(timestamp: string | null): string
export function fromLocalInput(value: string): string | null
