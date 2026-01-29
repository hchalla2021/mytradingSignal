'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function NotFound() {
  const router = useRouter()

  const handleGoBack = () => {
    if (typeof window !== 'undefined') {
      window.history.back()
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-dark-bg via-dark-surface to-dark-elevated flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-6">
        {/* 404 Error */}
        <div className="text-center">
          <h1 className="text-6xl font-bold text-emerald-400 mb-2">404</h1>
          <h2 className="text-2xl font-bold text-gray-100 mb-4">Page Not Found</h2>
          <p className="text-gray-400 mb-8">
            The page you're looking for doesn't exist or has been moved.
          </p>
        </div>

        {/* Mobile-friendly error info */}
        <div className="bg-slate-800/50 border border-gray-700/50 rounded-lg p-4">
          <h3 className="text-emerald-300 font-semibold mb-2 text-sm">🔍 What you can do:</h3>
          <ul className="text-gray-300 text-sm space-y-2">
            <li>• Check the URL for typos</li>
            <li>• Use the navigation menu</li>
            <li>• Go back to the homepage</li>
          </ul>
        </div>

        {/* Navigation buttons */}
        <div className="space-y-3">
          <Link
            href="/"
            className="w-full inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition-colors"
          >
            🏠 Back to Dashboard
          </Link>
          
          <button
            onClick={handleGoBack}
            className="w-full inline-flex items-center justify-center px-6 py-3 border border-gray-600 text-base font-medium rounded-lg text-gray-300 bg-slate-800/50 hover:bg-slate-700/50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
          >
            ← Go Back
          </button>
        </div>

        {/* Trading dashboard link */}
        <div className="text-center pt-4">
          <p className="text-xs text-gray-500">
            Return to live market tracking
          </p>
        </div>
      </div>
    </div>
  )
}