export default function Loading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0e1a] via-[#0f1421] to-[#1f2937] flex items-center justify-center">
      <div className="text-center">
        {/* Clean spinner */}
        <div className="relative w-14 h-14 mx-auto mb-4">
          <div className="absolute inset-0 border-[3px] border-emerald-500/20 rounded-full"></div>
          <div className="absolute inset-0 border-[3px] border-transparent border-t-emerald-400 rounded-full animate-spin"></div>
        </div>
        <h2 className="text-base font-semibold text-white tracking-tight">MyDailyTradingSignals</h2>
      </div>
    </div>
  )
}