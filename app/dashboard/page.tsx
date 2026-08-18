import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signout } from './actions'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()

  if (error || !data?.claims?.sub) {
    redirect('/login')
  }

  return (
    <main className="dashboard-app-shell">
      <nav className="dashboard-nav dashboard-app-nav">
        <span className="brand">ZLA Bidding</span>
        <form action={signout}>
          <button className="text-button" type="submit">Sign out</button>
        </form>
      </nav>
      <iframe
        className="dashboard-app-frame"
        src="/bidding.html"
        title="ZLA bidding dashboard"
      />
    </main>
  )
}
