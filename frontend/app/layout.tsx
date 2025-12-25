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
      <body className="bg-dark-bg min-h-screen">
        {children}
      </body>
    </html>
  )
}
