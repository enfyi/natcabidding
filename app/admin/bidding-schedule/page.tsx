import type { Metadata } from 'next'
import { BiddingScheduleAdmin } from './schedule-admin'

export const metadata: Metadata = { title: 'Bidding Schedule | ZLA Bidding Admin' }
export default function BiddingSchedulePage() { return <div className="schedule-site-theme"><BiddingScheduleAdmin /></div> }
