import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MyDailyTradingSignals - Live Market Dashboard',
  description: 'Real-time trading dashboard for NIFTY, BANKNIFTY, and SENSEX with AI-powered analysis',
  keywords: 'trading, NIFTY, BANKNIFTY, SENSEX, stock market, live signals, NSE, BSE',
  authors: [{ name: 'MyDailyTradingSignals' }],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MyDailyTradingSignals',
  },
}

// 🔥 DISABLE ALL CACHING
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
  themeColor: '#0a0e1a',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
        {/* �🖥️ RESPONSIVE VIEWPORT - Works on both mobile and desktop */}
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {/* 🔥 AGGRESSIVE CACHE PREVENTION */}
        <meta httpEquiv="Cache-Control" content="no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
        <meta name="version" content={Date.now().toString()} />
      </head>
      <body className="min-h-screen bg-gradient-to-br from-dark-bg via-dark-surface to-dark-elevated antialiased">
        {children}
        {/* Force reload script */}
        <script dangerouslySetInnerHTML={{
          __html: `
            // Clear all caches on load
            if (typeof window !== 'undefined') {
              // Clear localStorage and sessionStorage
              try { localStorage.clear(); } catch(e) {}
              try { sessionStorage.clear(); } catch(e) {}
              
              // Disable back-forward cache
              window.addEventListener('pageshow', function(event) {
                if (event.persisted) {
                  window.location.reload();
                }
              });
            }
          `
        }} />
      </body>
    </html>
  )
}
