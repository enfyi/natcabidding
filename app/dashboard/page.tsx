import DashboardFrame from './dashboard-frame'
import { isBiddingLandingPage } from '@/lib/auth-landing'

type DashboardPageProps = {
  searchParams: Promise<{ page?: string; area?: string; section?: string; bidYear?: string }>
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { page, area, section, bidYear } = await searchParams
  const publicParams = new URLSearchParams({ page: 'public' })
  if (area) publicParams.set('area', area)
  if (section) publicParams.set('section', section)
  const frameSrc = isBiddingLandingPage(page)
    ? `/bidding.html?page=${page}&serverSession=1`
    : page === 'public'
      ? `/bidding.html?${publicParams}&serverSession=1`
      : '/bidding.html?member=1&serverSession=1'

  const selectedYear = typeof bidYear === 'string' && /^\d{4}$/.test(bidYear) ? `&bidYear=${bidYear}` : ''

  return (
    <main className="dashboard-app-shell">
      <DashboardFrame src={`${frameSrc}${selectedYear}`} />
    </main>
  )
}
