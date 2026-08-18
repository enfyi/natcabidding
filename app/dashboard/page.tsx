export default function DashboardPage() {
  return (
    <main className="dashboard-app-shell">
      <iframe
        className="dashboard-app-frame public-dashboard-frame"
        src="/bidding.html"
        title="ZLA bidding dashboard"
      />
    </main>
  )
}
