import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: identity, error: identityError } = await supabase.auth.getUser()
  const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' }
  if (identityError || !identity.user) {
    return Response.json({ error: 'Sign in again.' }, { status: 401, headers })
  }
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session || data.session.user.id !== identity.user.id) {
    return Response.json({ error: 'Could not verify your sign-in.' }, { status: 401, headers })
  }
  return Response.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  }, { headers })
}
