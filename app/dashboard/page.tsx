import { isBiddingLandingPage } from '@/lib/auth-landing'

type DashboardPageProps = {
  searchParams: Promise<{ page?: string }>
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { page } = await searchParams
  const frameSrc = isBiddingLandingPage(page)
    ? `/bidding.html?page=${page}&serverSession=1`
    : '/bidding.html?member=1&serverSession=1'

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
