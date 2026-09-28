export type BiddingLandingPage = 'dashboard' | 'intake' | 'intake-schedule' | 'admin'

const LANDING_PAGES = new Set<string>(['dashboard', 'intake', 'intake-schedule', 'admin'])

export function isBiddingLandingPage(value: unknown): value is BiddingLandingPage {
  return typeof value === 'string' && LANDING_PAGES.has(value)
}

export function biddingLandingPageForRole(role: string | null | undefined): BiddingLandingPage {
  if (role === 'admin') return 'admin'
  if (role === 'intake') return 'intake'
  return 'dashboard'
}

export function dashboardPathForRole(role: string | null | undefined) {
  const page = biddingLandingPageForRole(role)
  return page === 'dashboard' ? '/dashboard' : `/dashboard?page=${page}`
}
