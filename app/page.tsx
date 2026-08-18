import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function HomePage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const isAuthenticated = Boolean(data?.claims?.sub)

  return (
    <main className="shell hero-shell">
      <section className="hero-card">
        <p className="eyebrow">ZLA Bidding</p>
        <h1>A secure home for your bidding workflow.</h1>
        <p className="lede">
          Sign in to reach the protected dashboard. Sessions are validated on the
          server and refreshed securely with Supabase Auth.
        </p>
        <Link className="button primary" href={isAuthenticated ? '/dashboard' : '/login'}>
          {isAuthenticated ? 'Open dashboard' : 'Sign in to continue'}
        </Link>
      </section>
    </main>
  )
}
