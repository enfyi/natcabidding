import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { dashboardPathForRole } from '@/lib/auth-landing'
import { withBasePath } from '@/lib/env'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const tokenHash = request.nextUrl.searchParams.get('token_hash')
  const type = request.nextUrl.searchParams.get('type') as EmailOtpType | null
  const next = request.nextUrl.searchParams.get('next')

  if (code || (tokenHash && type)) {
    const supabase = await createClient()
    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: type! })

    if (!error) {
      if (next === '/update-password' || type === 'recovery') {
        return NextResponse.redirect(
          new URL(withBasePath('/update-password'), request.url),
        )
      }

      const { data, error: profileError } = await supabase.rpc('claim_current_bidder_profile')
      const profile = Array.isArray(data) ? data[0] : data

      if (!profileError && profile && typeof profile === 'object') {
        const role = (profile as { role?: unknown }).role
        return NextResponse.redirect(
          new URL(withBasePath(dashboardPathForRole(typeof role === 'string' ? role : null)), request.url),
        )
      }

      return NextResponse.redirect(
        new URL(withBasePath('/login?error=No+BUE+profile+matches+that+login+email+yet.'), request.url),
      )
    }
  }

  return NextResponse.redirect(
    new URL(withBasePath('/login?error=The+confirmation+link+is+invalid+or+expired.'), request.url),
  )
}
