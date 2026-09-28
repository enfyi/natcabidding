'use server'

import { redirect } from 'next/navigation'
import { getSiteUrl, withBasePath } from '@/lib/env'
import { createClient } from '@/lib/supabase/server'

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()

  if (!email || !email.includes('@')) {
    redirect(withBasePath('/forgot-password?error=Enter+a+valid+email+address.'))
  }

  const supabase = await createClient()
  const recoveryUrl = new URL(`${getSiteUrl()}/auth/callback`)
  recoveryUrl.searchParams.set('next', '/update-password')

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: recoveryUrl.toString(),
  })

  if (error) {
    redirect(
      withBasePath(`/forgot-password?error=${encodeURIComponent(error.message)}`),
    )
  }

  redirect(
    withBasePath('/forgot-password?message=If+an+account+exists+for+that+email%2C+we+sent+a+password+reset+link.'),
  )
}
