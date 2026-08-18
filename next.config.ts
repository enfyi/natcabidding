import type { NextConfig } from 'next'
import { getSupabaseEnv } from './lib/env'

// Fail the deployment during configuration instead of returning runtime 500s.
getSupabaseEnv()

const nextConfig: NextConfig = {}

export default nextConfig
