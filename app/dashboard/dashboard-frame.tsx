'use client'

import { useEffect, useRef, useState } from 'react'
import { isBiddingLandingPage } from '@/lib/auth-landing'

export default function DashboardFrame({ src }: { src: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  // URL synchronization must not reload the frame and discard its active view.
  const [initialSrc] = useState(src)

  useEffect(() => {
    function receiveNavigation(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return
      if (event.data?.type !== 'bidding-navigation' || typeof event.data.search !== 'string') return
      const params = new URLSearchParams(event.data.search)
      const page = params.get('page')
      if (page !== 'public' && !isBiddingLandingPage(page)) return
      const url = new URL(window.location.href)
      for (const key of ['page', 'member', 'area', 'section']) {
        const value = params.get(key)
        if (value !== null) url.searchParams.set(key, value)
        else url.searchParams.delete(key)
      }
      window.history.replaceState(window.history.state, '', url.toString())
    }
    window.addEventListener('message', receiveNavigation)
    return () => window.removeEventListener('message', receiveNavigation)
  }, [])

  return <iframe ref={frame} className="dashboard-app-frame public-dashboard-frame" src={initialSrc} title="ZLA bidding dashboard" />
}
