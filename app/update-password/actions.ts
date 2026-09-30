'use server'

import { redirect } from 'next/navigation'
import { withBasePath } from '@/lib/env'
import { createClient } from '@/lib/supabase/server'

export async function updatePassword(formData: FormData) {
  const password = String(formData.get('password') ?? '')
  const confirmation = String(formData.get('passwordConfirmation') ?? '')

  if (password.length < 8) {
    redirect(
      withBasePath('/update-password?error=Your+password+must+be+at+least+8+characters.'),
    )
  }

  if (password !== confirmation) {
    redirect(withBasePath('/update-password?error=The+passwords+do+not+match.'))
  }

  const supabase = await createClient()
  const { data, error: claimsError } = await supabase.auth.getClaims()

  if (claimsError || !data?.claims) {
    redirect(
      withBasePath('/login?error=Your+password+reset+link+is+invalid+or+expired.'),
    )
  }

  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    redirect(
      withBasePath(`/update-password?error=${encodeURIComponent(error.message)}`),
    )
  }

  await supabase.auth.signOut()
  redirect(withBasePath('/login?message=Your+password+was+updated.+Sign+in+with+your+new+password.'))
}
