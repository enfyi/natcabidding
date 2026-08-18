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
  const { data, error } = await supabase.auth.signUp({
    ...credentials(formData),
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
