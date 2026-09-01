import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { dashboardPathForRole } from '@/lib/auth-landing'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash')
  const type = request.nextUrl.searchParams.get('type') as EmailOtpType | null

  if (tokenHash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })

    if (!error) {
      const { data, error: profileError } = await supabase.rpc('claim_current_bidder_profile')
      const profile = Array.isArray(data) ? data[0] : data

      if (!profileError && profile && typeof profile === 'object') {
        const role = (profile as { role?: unknown }).role
        return NextResponse.redirect(
          new URL(dashboardPathForRole(typeof role === 'string' ? role : null), request.url),
        )
      }

      return NextResponse.redirect(
        new URL('/login?error=No+BUE+profile+matches+that+login+email+yet.', request.url),
      )
    }
  }

  return NextResponse.redirect(
    new URL('/login?error=The+confirmation+link+is+invalid+or+expired.', request.url),
  )
}
