'use client'

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Auto-reset on error without showing error UI
  useEffect(() => {
    console.log('Error caught:', error.message);
    // Attempt to recover automatically
    const timer = setTimeout(() => {
      reset();
    }, 100);
    return () => clearTimeout(timer);
  }, [error, reset]);

  // Return minimal UI during auto-recovery
  return (
    <html>
      <body className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 min-h-screen">
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="text-emerald-400 text-sm animate-pulse">Loading...</div>
          </div>
        </div>
      </body>
    </html>
  )
}