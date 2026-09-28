import Link from 'next/link'
import { redirect } from 'next/navigation'
import { withBasePath } from '@/lib/env'
import { createClient } from '@/lib/supabase/server'
import { updatePassword } from './actions'

type UpdatePasswordPageProps = {
  searchParams: Promise<{ error?: string }>
}

export default async function UpdatePasswordPage({ searchParams }: UpdatePasswordPageProps) {
  const supabase = await createClient()
  const [{ error }, { data, error: claimsError }] = await Promise.all([
    searchParams,
    supabase.auth.getClaims(),
  ])

  if (claimsError || !data?.claims) {
    redirect(
      withBasePath('/login?error=Your+password+reset+link+is+invalid+or+expired.'),
    )
  }

  return (
    <main className="shell auth-shell">
      <section className="auth-card">
        <Link className="brand" href="/">ZLA Bidding</Link>
        <div>
          <p className="eyebrow">Account recovery</p>
          <h1>Choose a new password.</h1>
          <p className="muted">Use at least 8 characters.</p>
        </div>

        {error ? <p className="notice error" role="alert">{error}</p> : null}

        <form className="auth-form" action={updatePassword}>
          <label htmlFor="password">New password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />

          <label htmlFor="passwordConfirmation">Confirm new password</label>
          <input
            id="passwordConfirmation"
            name="passwordConfirmation"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />

          <button className="button primary" type="submit">Update password</button>
        </form>
      </section>
    </main>
  )
}
