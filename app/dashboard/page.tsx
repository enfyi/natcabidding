import DashboardFrame from './dashboard-frame'
import { isBiddingLandingPage } from '@/lib/auth-landing'

type DashboardPageProps = {
  searchParams: Promise<{ page?: string; area?: string; section?: string }>
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { page, area, section } = await searchParams
  const publicParams = new URLSearchParams({ page: 'public' })
  if (area) publicParams.set('area', area)
  if (section) publicParams.set('section', section)
  const frameSrc = isBiddingLandingPage(page)
    ? `/bidding.html?page=${page}`
    : page === 'public'
      ? `/bidding.html?${publicParams}`
      : '/bidding.html?member=1'

  return (
    <main className="dashboard-app-shell">
      <DashboardFrame src={frameSrc} />
    </main>
  )
}
