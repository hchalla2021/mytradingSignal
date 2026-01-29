'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const isMobile = typeof navigator !== 'undefined' && 
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(navigator.userAgent);

  const getBrowserName = () => {
    if (typeof navigator === 'undefined') return 'Unknown';
    const ua = navigator.userAgent;
    if (/Chrome/i.test(ua) && !/Edg|OPR|Samsung/i.test(ua)) return 'Chrome';
    if (/Safari/i.test(ua) && !/Chrome|Edg|OPR/i.test(ua)) return 'Safari';
    if (/Firefox/i.test(ua)) return 'Firefox';
    if (/Samsung/i.test(ua)) return 'Samsung Internet';
    if (/OPR|Opera/i.test(ua)) return 'Opera';
    if (/Edg/i.test(ua)) return 'Edge';
    return 'Unknown';
  };

  const handleReturnToDashboard = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/'
    }
  };

  return (
    <html>
      <body className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 min-h-screen">
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="max-w-lg w-full space-y-6">
            {/* Global Error Header */}
            <div className="text-center">
              <h1 className="text-4xl font-bold text-red-400 mb-4">⚠️ System Error</h1>
              <p className="text-gray-300 text-lg mb-6">
                Something went wrong with the trading dashboard
              </p>
            </div>

            {/* Error Details */}
            <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 space-y-3">
              <h3 className="text-red-300 font-semibold text-sm">Error Details:</h3>
              <p className="text-red-200 text-xs font-mono break-words">
                {error.message || 'Unknown error occurred'}
              </p>
              {error.digest && (
                <p className="text-red-300 text-xs">
                  Error ID: {error.digest}
                </p>
              )}
            </div>

            {/* Mobile Browser Info */}
            {isMobile && (
              <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-4">
                <h3 className="text-amber-300 font-semibold mb-2 text-sm">
                  📱 Mobile Browser: {getBrowserName()}
                </h3>
                <ul className="text-amber-200 text-xs space-y-1">
                  <li>• Try refreshing the page</li>
                  <li>• Clear browser cache and cookies</li>
                  <li>• Update your browser to latest version</li>
                  <li>• Try switching to Chrome mobile if available</li>
                </ul>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                onClick={reset}
                className="w-full px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-colors"
              >
                🔄 Try Again
              </button>
              
              <button
                onClick={handleReturnToDashboard}
                className="w-full px-6 py-3 border border-gray-600 text-gray-300 hover:bg-gray-700/50 font-medium rounded-lg transition-colors"
              >
                🏠 Return to Dashboard
              </button>
            </div>

            {/* Support Info */}
            <div className="text-center pt-4">
              <p className="text-xs text-gray-500">
                If this problem persists, try clearing your browser cache or using a different browser.
              </p>
            </div>
          </div>
        </div>
      </body>
    </html>
  )
}