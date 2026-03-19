/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // 🔥 DISABLE ALL CACHING IN DEVELOPMENT
  generateBuildId: async () => {
    return `build-${Date.now()}`
  },
  experimental: {
    // Use a small ISR cache (0 causes ReadableStream abort crashes in Next 13.5.x)
    isrMemoryCacheSize: 16,
  },
  // Add cache-busting headers
  async headers() {
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
  },
}

module.exports = nextConfig
