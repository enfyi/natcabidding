import type { ArchiveLayout } from './previous-years'

export function archiveLayoutForAgent(agent: string, override?: string): ArchiveLayout {
  if (override === 'mobile' || override === 'desktop') return override
  return /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(agent) ? 'mobile' : 'desktop'
}

export function selectArchiveVariant<T extends { layout: string }>(entries: T[], preferred: ArchiveLayout): T | undefined {
  return entries.find((entry) => entry.layout === preferred)
    || entries.find((entry) => entry.layout === 'desktop')
    || entries[0]
}
