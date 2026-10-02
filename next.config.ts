import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // pg optionally requires the native pg-native binding. Next must not try to
  // bundle it.
  serverExternalPackages: ['pg'],
}

export default nextConfig
