import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Options Trading Signals - Live Zerodha Data',
  description: 'Real-time options trading signals with Greeks analysis for NIFTY, BANK NIFTY, and SENSEX',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
