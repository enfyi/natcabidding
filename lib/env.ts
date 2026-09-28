const LOCAL_SITE_URL = 'http://localhost:3000'

export function getBasePath() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim()

  if (!basePath || basePath === '/') return ''

  const normalized = basePath.startsWith('/') ? basePath : `/${basePath}`
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

export function withBasePath(path: string) {
  const basePath = getBasePath()
  if (!basePath) return path
  return `${basePath}${path.startsWith('/') ? path : `/${path}`}`
}

function requiredValue(name: string, value: string | undefined) {
  const normalized = value?.trim()

  if (!normalized) {
    throw new Error(
      `[env] ${name} is required. Add it to .env.local and to every production environment.`,
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
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  )
  const publishableKey = requiredValue(
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  )

  return {
    url: normalizedUrl('NEXT_PUBLIC_SUPABASE_URL', url),
    publishableKey,
  }
}

export function getSiteUrl() {
  const basePath = getBasePath()
  const deploymentUrl = process.env.VERCEL_URL?.trim()
  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  let origin: string

  if (process.env.VERCEL_ENV === 'preview' && deploymentUrl) {
    origin = normalizedUrl('VERCEL_URL', deploymentUrl)
    return `${origin}${basePath}`
  }

  if (configuredUrl) {
    origin = normalizedUrl('NEXT_PUBLIC_SITE_URL', configuredUrl)
    return `${origin}${basePath}`
  }

  if (process.env.VERCEL_ENV === 'production' && productionUrl) {
    origin = normalizedUrl('VERCEL_PROJECT_PRODUCTION_URL', productionUrl)
    return `${origin}${basePath}`
  }

  if (deploymentUrl) {
    origin = normalizedUrl('VERCEL_URL', deploymentUrl)
    return `${origin}${basePath}`
  }

  if (process.env.NODE_ENV !== 'production') {
    return `${LOCAL_SITE_URL}${basePath}`
  }

  throw new Error(
    '[env] Cannot determine the site URL. Set NEXT_PUBLIC_SITE_URL or enable Vercel system environment variables.',
  )
}
