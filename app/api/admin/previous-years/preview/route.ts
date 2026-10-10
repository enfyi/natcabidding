import { createClient } from '@supabase/supabase-js'
import { getSupabaseEnv } from '@/lib/env'
import { previewArchiveWorkbook } from '@/lib/archive-workbook'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const authorization = request.headers.get('authorization') || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token) return Response.json({ error: 'Sign in before previewing a workbook.' }, { status: 401 })
  const { url, publishableKey } = getSupabaseEnv()
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return Response.json({ error: 'Your session has expired. Sign in again.' }, { status: 401 })
  const profileResult = await client.rpc('claim_current_bidder_profile')
  const profile = Array.isArray(profileResult.data) ? profileResult.data[0] : profileResult.data
  if (profileResult.error || profile?.role !== 'admin') {
    return Response.json({ error: 'System administrator access is required.' }, { status: 403 })
  }
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return Response.json({ error: 'Choose an Excel workbook.' }, { status: 400 })
    return Response.json(await previewArchiveWorkbook(file), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return Response.json({ error: error instanceof Error && /workbook|import|Choose|Upload|filename|worksheet/i.test(error.message)
      ? error.message : 'The file could not be read. Export it again from Google Sheets as Excel (.xlsx).' }, { status: 422 })
  }
}
