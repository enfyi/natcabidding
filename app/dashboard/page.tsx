import { isBiddingLandingPage } from '@/lib/auth-landing'

type DashboardPageProps = {
  searchParams: Promise<{ page?: string }>
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { page } = await searchParams
  const frameSrc = isBiddingLandingPage(page) && page !== 'dashboard'
    ? `/bidding.html?page=${page}`
    : '/bidding.html'

  return (
    <main className="dashboard-app-shell">
      <iframe
        className="dashboard-app-frame public-dashboard-frame"
        src={frameSrc}
        title="ZLA bidding dashboard"
      />
    </main>
  )
}
