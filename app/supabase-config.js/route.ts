import { getSiteUrl, getSupabaseEnv } from '@/lib/env'

export async function GET() {
  const { url, publishableKey } = getSupabaseEnv()
  const config = {
    url,
    publishableKey,
    authRedirectUrl: getSiteUrl(),
    environment: process.env.NEXT_PUBLIC_APP_ENVIRONMENT?.trim() || 'production',
  }

  return new Response(`window.NATCA_SUPABASE_CONFIG = ${JSON.stringify(config)};\n`, {
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': 'text/javascript; charset=utf-8',
    },
  })
}
