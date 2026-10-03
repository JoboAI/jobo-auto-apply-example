// JavaScript, not TypeScript: `next start` would otherwise need the
// typescript package at runtime just to read this file.

/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg optionally requires the native pg-native binding. Next must not try to
  // bundle it.
  serverExternalPackages: ['pg'],
  // Earlier versions of the demo had a tutorial and a standalone apply page.
  // Links to them may still be out there.
  async redirects() {
    return [
      { source: '/learn/:path*', destination: '/jobs', permanent: true },
      { source: '/apply', destination: '/jobs', permanent: true },
    ]
  },
}

export default nextConfig
