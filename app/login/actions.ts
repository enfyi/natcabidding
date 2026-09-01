'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { dashboardPathForRole } from '@/lib/auth-landing'
import { getSiteUrl } from '@/lib/env'
import { createClient } from '@/lib/supabase/server'

function credentials(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')

  if (!email || !email.includes('@') || password.length < 8) {
    redirect('/login?error=Enter+a+valid+email+and+a+password+of+at+least+8+characters.')
  }

  return { email, password }
}

async function requireRecognizedEmail(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string,
) {
  const { data, error } = await supabase.rpc('can_request_login_link', { login_email: email })

  if (error) {
    redirect('/login?error=Could+not+verify+that+email+against+the+BUE+roster.')
  }

  if (data !== true) {
    redirect('/login?error=Use+the+email+address+listed+for+you+in+the+BUE+roster.')
  }
}

async function landingPathForAuthenticatedBidder(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const { data, error } = await supabase.rpc('claim_current_bidder_profile')

  if (error) {
    redirect('/login?error=Could+not+load+your+BUE+profile.')
  }

  const profile = Array.isArray(data) ? data[0] : data
  if (!profile || typeof profile !== 'object') {
    redirect('/login?error=No+BUE+profile+matches+that+login+email+yet.')
  }

  const role = (profile as { role?: unknown }).role
  return dashboardPathForRole(typeof role === 'string' ? role : null)
}

export async function login(formData: FormData) {
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(credentials(formData))

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`)
  }

  const landingPath = await landingPathForAuthenticatedBidder(supabase)

  revalidatePath('/', 'layout')
  redirect(landingPath)
}

export async function signup(formData: FormData) {
  const supabase = await createClient()
  const userCredentials = credentials(formData)

  await requireRecognizedEmail(supabase, userCredentials.email)

  const { data, error } = await supabase.auth.signUp({
    ...userCredentials,
    options: { emailRedirectTo: `${getSiteUrl()}/auth/callback` },
  })

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath('/', 'layout')

  if (data.session) {
    const landingPath = await landingPathForAuthenticatedBidder(supabase)
    redirect(landingPath)
  }

  redirect('/login?message=Check+your+email+to+confirm+your+account.')
}
