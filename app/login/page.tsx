import Link from 'next/link'
import { login, signup } from './actions'

type LoginPageProps = {
  searchParams: Promise<{ error?: string; message?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, message } = await searchParams

  return (
    <main className="shell auth-shell">
      <section className="auth-card">
        <Link className="brand" href="/">ZLA Bidding</Link>
        <div>
          <p className="eyebrow">Member access</p>
          <h1>Welcome back.</h1>
          <p className="muted">Use your email and password to continue.</p>
        </div>

        {error ? <p className="notice error" role="alert">{error}</p> : null}
        {message ? <p className="notice success" role="status">{message}</p> : null}

        <form className="auth-form">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            minLength={8}
            required
          />

          <div className="button-row">
            <button className="button primary" formAction={login}>Sign in</button>
            <button className="button secondary" formAction={signup}>Create account</button>
          </div>
        </form>
      </section>
    </main>
  )
}
