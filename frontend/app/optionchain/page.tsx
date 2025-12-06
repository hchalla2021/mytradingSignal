'use client';

import Link from 'next/link';

export default function OptionChainPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
      <div className="max-w-2xl mx-auto px-4 text-center">
        <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-2xl p-12 shadow-2xl">
          <div className="mb-6">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/30 mb-4">
              <svg className="w-10 h-10 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">
            Option Chain Analysis
          </h1>
          <div className="inline-block px-4 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded-full mb-6">
            <span className="text-yellow-400 font-semibold text-sm">COMING SOON</span>
          </div>
          <p className="text-slate-400 text-lg mb-8 leading-relaxed">
            This feature is currently under development. Advanced option chain analytics with real-time OI tracking will be available soon.
          </p>
          <Link 
            href="/"
            className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
