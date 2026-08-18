import type { NextConfig } from 'next'
import { getSupabaseEnv } from './lib/env'

// Fail the deployment during configuration instead of returning runtime 500s.
getSupabaseEnv()

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/*': [
      './bidding.html',
      './bidding.css',
      './bidding.js',
      './supabase-config.js',
      './assets/logo-5v2a.png',
    ],
  },
}

export default nextConfig
