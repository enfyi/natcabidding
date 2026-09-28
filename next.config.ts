import type { NextConfig } from 'next'
import { getBasePath, getSupabaseEnv } from './lib/env'

// Fail the deployment during configuration instead of returning runtime 500s.
getSupabaseEnv()

const nextConfig: NextConfig = {
  basePath: getBasePath(),
  output: 'standalone',
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
