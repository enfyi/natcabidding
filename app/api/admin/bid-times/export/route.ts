import { createClient } from '@supabase/supabase-js'
import { getSupabaseEnv } from '@/lib/env'
import { buildBidTimeExport, type BidTimeExportBidder, type BidTimeExportWindow } from '@/lib/bid-time-export'

export const runtime = 'nodejs'
const AREAS = ['Area A', 'Area B', 'Area C', 'Area D', 'Area E', 'Area F', 'TMU']

export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
  if (!token) return Response.json({ error: 'Sign in before exporting bid times.' }, { status: 401 })
  const params = new URL(request.url).searchParams
  const year = Number(params.get('year'))
  const areas = params.getAll('area')
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !areas.length || areas.some(area => !AREAS.includes(area))) {
    return Response.json({ error: 'Choose a valid bid year and at least one area.' }, { status: 400 })
  }
  const { url, publishableKey } = getSupabaseEnv()
  const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: user, error: authError } = await client.auth.getUser(token)
  if (authError || !user.user) return Response.json({ error: 'Your session has expired. Sign in again.' }, { status: 401 })
  const { data: profileData, error: profileError } = await client.rpc('claim_current_bidder_profile')
  const profile = Array.isArray(profileData) ? profileData[0] : profileData
  if (profileError || profile?.role !== 'admin') return Response.json({ error: 'System administrator access is required.' }, { status: 403 })
  try {
    const [roster, windows] = await Promise.all([
      client.rpc('read_bidding_roster'),
      client.rpc('read_public_bid_windows', { requested_bid_year: year }),
    ])
    if (roster.error || windows.error) throw new Error('Could not read the saved bid-time schedule. Refresh and try again.')
    const bidders = (roster.data as BidTimeExportBidder[] || []).filter(bidder => areas.includes(bidder.area_name) && !['ADM', 'NB'].includes(bidder.bid_role))
    if (!bidders.length) return Response.json({ error: 'No active bidders were found for the selected areas.' }, { status: 404 })
    const workbook = await buildBidTimeExport(bidders, (windows.data || []) as BidTimeExportWindow[], year)
    return new Response(Uint8Array.from(workbook).buffer, { headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="zla-bid-times-${year}.xlsx"`,
    } })
  } catch (error) {
    console.error('[bid-time-export]', error)
    return Response.json({ error: 'The bid times could not be exported. Refresh and try again.' }, { status: 500 })
  }
}
