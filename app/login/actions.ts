'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
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

export async function login(formData: FormData) {
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(credentials(formData))

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
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
    redirect('/dashboard')
  }

  redirect('/login?message=Check+your+email+to+confirm+your+account.')
}
