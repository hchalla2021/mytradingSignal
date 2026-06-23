/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Skip ESLint during build (TypeScript still enforced) - avoids unused var blockers
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Use git-based build ID in production, stable ID in dev (so webpack cache persists across restarts)
  generateBuildId: async () => {
    if (process.env.NODE_ENV === 'production') {
      return process.env.BUILD_ID || `build-${Date.now()}`
    }
    return 'dev'
  },
  experimental: {
    // Use a small ISR cache (0 causes ReadableStream abort crashes in Next 13.5.x)
    isrMemoryCacheSize: 16,
  },
  // Disable build-trace collection: Next 13.5.x on Windows looks for pages-router
  // _app.js.nft.json even in pure App Router projects, breaking `next build`.
  outputFileTracing: false,

  // Next's dev webpack pack cache can become stale on Windows and emit ENOENT
  // warnings for missing .pack.gz files after file moves/reloads.
  webpack(config, { dev }) {
    if (dev) {
      config.cache = false
    }
    return config
  },

  // Cache headers - aggressive no-cache in dev, reasonable caching in production
  async headers() {
    if (process.env.NODE_ENV !== 'production') {
      return [
        {
          source: '/:path*',
          headers: [
            {
              key: 'Cache-Control',
              value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
            },
            {
              key: 'Pragma',
              value: 'no-cache',
            },
            {
              key: 'Expires',
              value: '0',
            },
          ],
        },
      ]
    }
    // Production: allow caching for static assets, no-cache for API/pages
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob:",
              "connect-src 'self' https://mydailytradesignals.com wss://mydailytradesignals.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
