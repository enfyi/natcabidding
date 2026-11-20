import { createClient } from '@supabase/supabase-js'
import { getSupabaseEnv } from '@/lib/env'
import { parseBiddingSchedule } from '@/lib/bidding-schedule-import'

export const runtime = 'nodejs'
export async function POST(request: Request) {
  const authorization = request.headers.get('authorization') || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token) return Response.json({ error: 'Sign in before importing a schedule.' }, { status: 401 })
  const { url, publishableKey } = getSupabaseEnv()
  const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  const user = await client.auth.getUser(token)
  if (user.error || !user.data.user) return Response.json({ error: 'Your session has expired. Sign in again.' }, { status: 401 })
  const profile = await client.rpc('claim_current_bidder_profile')
  if (profile.error || (Array.isArray(profile.data) ? profile.data[0] : profile.data)?.role !== 'admin') return Response.json({ error: 'System administrator access is required.' }, { status: 403 })
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return Response.json({ error: 'Choose an Excel .xlsx workbook.' }, { status: 400 })
    return Response.json(await parseBiddingSchedule(file), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'The workbook could not be read. Recalculate it in Excel and save as .xlsx.' }, { status: 422 })
  }
}
