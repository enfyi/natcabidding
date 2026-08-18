const LOCAL_SITE_URL = 'http://localhost:3000'
// These are public client credentials for the same Supabase project already used
// by the static bidding prototype. Deployment environment variables can override
// them, but a missing Vercel variable should not make the application unbuildable.
const DEFAULT_SUPABASE_URL = 'https://ohufaffutpkjhmkpstpr.supabase.co'
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_yRSPVRYC6dQ_GgoIQhJpHA_UvEWh_tr'

function requiredValue(name: string, value: string | undefined) {
  const normalized = value?.trim()

  if (!normalized) {
    throw new Error(
      `[env] ${name} is required. Add it to .env.local for local development and to every Vercel deployment environment.`,
    )
  }

  return normalized
}

function normalizedUrl(name: string, value: string) {
  const withProtocol = value.startsWith('http://') || value.startsWith('https://')
    ? value
    : `https://${value}`

  let url: URL

  try {
    url = new URL(withProtocol)
  } catch {
    throw new Error(`[env] ${name} must be a valid absolute URL.`)
  }

  return url.origin
}

export function getSupabaseEnv() {
  const url = requiredValue(
    'NEXT_PUBLIC_SUPABASE_URL',
    process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL,
  )
  const publishableKey = requiredValue(
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY,
  )

  return {
    url: normalizedUrl('NEXT_PUBLIC_SUPABASE_URL', url),
    publishableKey,
  }
}

export function getSiteUrl() {
  const deploymentUrl = process.env.VERCEL_URL?.trim()
  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim()

  if (process.env.VERCEL_ENV === 'preview' && deploymentUrl) {
    return normalizedUrl('VERCEL_URL', deploymentUrl)
  }

  if (configuredUrl) {
    return normalizedUrl('NEXT_PUBLIC_SITE_URL', configuredUrl)
  }

  if (process.env.VERCEL_ENV === 'production' && productionUrl) {
    return normalizedUrl('VERCEL_PROJECT_PRODUCTION_URL', productionUrl)
  }

  if (deploymentUrl) {
    return normalizedUrl('VERCEL_URL', deploymentUrl)
  }

  if (process.env.NODE_ENV !== 'production') {
    return LOCAL_SITE_URL
  }

  throw new Error(
    '[env] Cannot determine the site URL. Set NEXT_PUBLIC_SITE_URL or enable Vercel system environment variables.',
  )
}
