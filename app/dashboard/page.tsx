import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signout } from './actions'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()

  if (error || !data?.claims?.sub) {
    redirect('/login')
  }

  const email = typeof data.claims.email === 'string' ? data.claims.email : 'Signed-in member'

  return (
    <main className="shell dashboard-shell">
      <nav className="dashboard-nav">
        <span className="brand">ZLA Bidding</span>
        <form action={signout}>
          <button className="text-button" type="submit">Sign out</button>
        </form>
      </nav>
      <section className="dashboard-card">
        <p className="eyebrow">Protected route</p>
        <h1>You’re signed in.</h1>
        <p className="lede">This page is available only after Supabase validates your access token.</p>
        <dl className="identity-row">
          <div>
            <dt>Account</dt>
            <dd>{email}</dd>
          </div>
          <div>
            <dt>User ID</dt>
            <dd>{data.claims.sub}</dd>
          </div>
        </dl>
      </section>
    </main>
  )
}
