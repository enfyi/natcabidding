import { getSupabaseEnv } from '@/lib/env'

export const maxDuration = 60

const publicRoutines = new Set([
  'read_bid_year_catalog', 'read_bidding_roster', 'read_public_bid_windows',
  'read_public_leave_slots', 'read_public_gl_rdo_assignments',
  'read_public_ghost_rdo_bids', 'read_bid_year_settings',
  'read_round_rules', 'read_approval_rules',
])
const publicTables: Record<string, string> = {
  areas: 'select=id,code,name,display_order&order=display_order.asc',
  bid_years: 'select=id,bid_year,annual_leave_allowance_days',
  holidays: 'select=holiday_date,name,is_observed',
  rdo_lines: 'select=id,area_id,line_code,display_order,line_type,pattern,fatigue_group,mid,aws,four_ten,flex,status,assigned_bidder_id,assigned_initials,rdo_line_days(weekday,shift_code)',
  faq_entries: 'select=question,answer,display_order&published=eq.true&order=display_order.asc,created_at.asc',
  mou_documents: 'select=title,description,file_url,display_order&published=eq.true&order=display_order.asc,created_at.asc',
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const resource = params.get('resource') || ''
  const year = Number(params.get('year'))
  const yearId = params.get('yearId') || ''
  if ((!publicRoutines.has(resource) && !Object.hasOwn(publicTables, resource))
    || !Number.isInteger(year) || year < 2000 || year > 2100
    || (['holidays', 'rdo_lines'].includes(resource)
      && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(yearId))) {
    return Response.json({ message: 'Invalid public bidding resource.' }, { status: 400 })
  }
  const { url, publishableKey } = getSupabaseEnv()
  const rpc = publicRoutines.has(resource)
  const upstream = new URL(`${url}/rest/v1/${rpc ? 'rpc/' : ''}${resource}`)
  if (!rpc) {
    upstream.search = publicTables[resource]
    if (resource === 'bid_years') upstream.searchParams.set('bid_year', `eq.${year}`)
    if (['holidays', 'rdo_lines'].includes(resource)) upstream.searchParams.set('bid_year_id', `eq.${yearId}`)
  }
  try {
    // Always use the anonymous key. Never forward cookies or member credentials
    // into a shared cache, even when a signed-in visitor requests this URL.
    const response = await fetch(upstream, {
      method: rpc ? 'POST' : 'GET',
      headers: {
        apikey: publishableKey,
        'Content-Type': 'application/json',
        Accept: resource === 'bid_years' ? 'application/vnd.pgrst.object+json' : 'application/json',
      },
      ...(rpc ? { body: JSON.stringify(
        resource === 'read_bidding_roster' ? { include_inactive: false }
          : resource === 'read_bid_year_catalog' ? {} : { requested_bid_year: year },
      ) } : {}),
      cache: 'force-cache',
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(45000),
    })
    if (!response.ok) {
      return Response.json({ message: 'Public bidding data is temporarily unavailable.' }, {
        status: response.status, headers: { 'Cache-Control': 'no-store' },
      })
    }
    const data = await response.json()
    if (resource === 'read_bidding_roster' && Array.isArray(data)) {
      for (const bidder of data) { bidder.email = null; bidder.phone = null }
    }
    return Response.json(data, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=300' },
    })
  } catch {
    return Response.json({ message: 'Public bidding data is temporarily unavailable. Please retry.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    })
  }
}
