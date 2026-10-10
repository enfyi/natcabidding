import type { Metadata } from 'next'
import { PreviousYearsAdmin } from './previous-years-admin'

export const metadata: Metadata = { title: 'Previous Years | ZLA Bidding Admin' }

export default function PreviousYearsPage() {
  return <div className="archive-site-theme"><PreviousYearsAdmin /></div>
}
