import { createClient } from '@supabase/supabase-js'
import { BidLineImportError, parseBidLineImport } from '@/lib/bid-line-import'
import { getSupabaseEnv } from '@/lib/env'

export const runtime = 'nodejs'

const MAX_FILE_BYTES = 8 * 1024 * 1024

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || ''
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
}

export async function POST(request: Request) {
  const token = bearerToken(request)
  if (!token) return Response.json({ error: 'Sign in before previewing an import.' }, { status: 401 })

  const { url, publishableKey } = getSupabaseEnv()
  const supabase = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userData, error: userError } = await supabase.auth.getUser(token)

  if (userError || !userData.user) {
    return Response.json({ error: 'Your session has expired. Sign in again.' }, { status: 401 })
  }

  const { data: profileData, error: profileError } = await supabase.rpc('claim_current_bidder_profile')
  const profile = Array.isArray(profileData) ? profileData[0] : profileData
  if (profileError || profile?.role !== 'admin') {
    return Response.json({ error: 'System administrator access is required.' }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'Choose an Excel or CSV file.' }, { status: 400 })
  if (file.size > MAX_FILE_BYTES) return Response.json({ error: 'The upload must be 8 MB or smaller.' }, { status: 413 })

  try {
    return Response.json(await parseBidLineImport(file))
  } catch (error) {
    if (error instanceof BidLineImportError) {
      return Response.json({ error: error.message, issues: error.issues }, { status: 422 })
    }
    console.error('[bid-line-import] Preview failed', error)
    return Response.json({ error: 'The workbook could not be read. Confirm that it is a valid .xlsx or .csv file.' }, { status: 422 })
  }
}
