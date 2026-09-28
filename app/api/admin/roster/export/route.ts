import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseEnv } from '@/lib/env'
import { buildSeniorityRosterExport, type SeniorityRosterExportRow } from '@/lib/roster-export'

export const runtime = 'nodejs'

const VALID_AREAS = new Map([
  ['A', 'A'], ['AREA A', 'A'], ['B', 'B'], ['AREA B', 'B'], ['C', 'C'], ['AREA C', 'C'],
  ['D', 'D'], ['AREA D', 'D'], ['E', 'E'], ['AREA E', 'E'], ['F', 'F'], ['AREA F', 'F'], ['TMU', 'TMU'],
])

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') || ''
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
}

export async function GET(request: Request) {
  const token = bearerToken(request)
  if (!token) return Response.json({ error: 'Sign in before exporting a roster.' }, { status: 401 })

  const requestedArea = new URL(request.url).searchParams.get('area')?.trim().toUpperCase() || ''
  const areaCode = VALID_AREAS.get(requestedArea)
  if (!areaCode) return Response.json({ error: 'Choose Area A through F or TMU.' }, { status: 400 })

  const { url, publishableKey } = getSupabaseEnv()
  const supabase = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData.user) return Response.json({ error: 'Your session has expired. Sign in again.' }, { status: 401 })

  const { data: profileData, error: profileError } = await supabase.rpc('claim_current_bidder_profile')
  const profile = Array.isArray(profileData) ? profileData[0] : profileData
  if (profileError || profile?.role !== 'admin') {
    return Response.json({ error: 'System administrator access is required.' }, { status: 403 })
  }

  const { data, error } = await supabase.rpc('export_seniority_roster', { requested_area: areaCode })
  if (error) {
    console.error('[roster-export] Roster query failed', error)
    return Response.json({ error: 'The roster could not be exported. Confirm that the seniority export database helper is installed.' }, { status: 500 })
  }

  try {
    const template = await readFile(join(process.cwd(), 'public', 'templates', 'zla-seniority-roster-template.xlsx'))
    const workbook = await buildSeniorityRosterExport(template, (data || []) as SeniorityRosterExportRow[])
    const workbookBody = Uint8Array.from(workbook).buffer
    const filename = `zla-seniority-roster-${areaCode.toLowerCase()}.xlsx`
    return new Response(workbookBody, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    })
  } catch (exportError) {
    console.error('[roster-export] Workbook generation failed', exportError)
    return Response.json({ error: 'The Excel roster could not be generated.' }, { status: 500 })
  }
}
