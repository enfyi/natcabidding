'use client'

import { useLinkStatus } from 'next/link'

export function ArchiveLinkLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus()
  return <span className={`archive-link-label${pending ? ' is-pending' : ''}`} aria-busy={pending}>
    <span className="archive-link-text">{label}</span>
    {pending && <span className="archive-link-progress" aria-hidden="true">Loading…</span>}
    <span className="sr-only" role="status">{pending ? `Loading ${label}…` : ''}</span>
  </span>
}
