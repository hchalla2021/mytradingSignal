export default function Loading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-dark-bg via-dark-surface to-dark-elevated flex items-center justify-center">
      <div className="text-center space-y-4">
        {/* Animated loading spinner */}
        <div className="relative">
          <div className="w-16 h-16 border-4 border-emerald-600/30 border-t-emerald-400 rounded-full animate-spin mx-auto"></div>
          <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-emerald-600 rounded-full animate-ping mx-auto"></div>
        </div>
        
        {/* Loading text */}
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-gray-200">Loading Trading Dashboard</h2>
          <p className="text-gray-400 text-sm">Fetching live market data...</p>
        </div>

        {/* Loading indicators */}
        <div className="flex justify-center space-x-2 mt-6">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse delay-75"></div>
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse delay-150"></div>
        </div>

        {/* Mobile loading tip */}
        <div className="mt-8 max-w-sm mx-auto">
          <div className="bg-slate-800/50 border border-gray-700/50 rounded-lg p-3">
            <p className="text-xs text-gray-400">
              📱 On mobile? The dashboard works on all browsers including Safari, Chrome, Firefox & Samsung Internet
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}