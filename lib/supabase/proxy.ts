import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseEnv } from '@/lib/env'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
  const { url, publishableKey } = getSupabaseEnv()

  const supabase = createServerClient(
    url,
    publishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
          Object.entries(headers).forEach(([name, value]) => {
            response.headers.set(name, value)
          })
        },
      },
    },
  )

  // getClaims verifies the token. Do not replace this with getSession for guards.
  const { data } = await supabase.auth.getClaims()

  const isPilot = process.env.NEXT_PUBLIC_APP_ENVIRONMENT === 'pilot'
  const path = request.nextUrl.pathname
  const isPilotPublicRoute = path === '/login' || path.startsWith('/auth/')

  if (isPilot && !data?.claims && !isPilotPublicRoute) {
    const loginUrl = new URL('/login', request.url)
    const redirectResponse = NextResponse.redirect(loginUrl)

    response.cookies.getAll().forEach(({ name, value, ...options }) => {
      redirectResponse.cookies.set(name, value, options)
    })

    return redirectResponse
  }

  return response
}
