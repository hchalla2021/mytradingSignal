import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MyDailyTradingSignals - Live Market Dashboard',
  description: 'Real-time trading dashboard for NIFTY, BANKNIFTY, and SENSEX',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gradient-to-br from-dark-bg via-dark-surface to-dark-elevated">
        {children}
      </body>
    </html>
  )
}
