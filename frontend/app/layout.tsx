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

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
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
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-screen bg-gradient-to-br from-dark-bg via-dark-surface to-dark-elevated antialiased">
        {children}
      </body>
    </html>
  )
}
