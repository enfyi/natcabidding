import Link from 'next/link'
import { requestPasswordReset } from './actions'

type ForgotPasswordPageProps = {
  searchParams: Promise<{ error?: string; message?: string }>
}

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const { error, message } = await searchParams

  return (
    <main className="shell auth-shell">
      <section className="auth-card">
        <Link className="brand" href="/">ZLA Bidding</Link>
        <div>
          <p className="eyebrow">Account recovery</p>
          <h1>Reset your password.</h1>
          <p className="muted">
            Enter the email address on your account and we’ll send you a secure reset link.
          </p>
        </div>

        {error ? <p className="notice error" role="alert">{error}</p> : null}
        {message ? <p className="notice success" role="status">{message}</p> : null}

        <form className="auth-form" action={requestPasswordReset}>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />

          <button className="button primary" type="submit">Send reset link</button>
        </form>

        <p className="muted"><Link href="/login">Back to sign in</Link></p>
      </section>
    </main>
  )
}
