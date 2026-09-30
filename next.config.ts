import type { NextConfig } from 'next'
import { getBasePath, getSupabaseEnv } from './lib/env'

// Fail the deployment during configuration instead of returning runtime 500s.
getSupabaseEnv()

const nextConfig: NextConfig = {
  basePath: getBasePath(),
  // Next.js 16.3 cannot combine standalone output with Vercel's build adapter.
  // Vercel packages the app itself; retain standalone output only for self-hosting.
  output: process.env.VERCEL ? undefined : 'standalone',
  outputFileTracingIncludes: {
    '/*': [
      './bidding.html',
      './bidding.css',
      './bidding.js',
      './supabase-config.js',
      './assets/logo-5v2a.png',
      './node_modules/@supabase/supabase-js/dist/umd/supabase.js',
    ],
  },
}

export default nextConfig
