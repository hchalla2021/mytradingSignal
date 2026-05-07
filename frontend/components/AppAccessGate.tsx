'use client';

import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import { getOrCreateVisitorId } from '@/lib/visitor-id';

type SessionResponse = {
  authenticated: boolean;
  username?: string;
  expires_at?: string;
  reason?: string;
};

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  );
}

export function AppAccessGate({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  const visitorId = useMemo(() => {
    if (typeof window === 'undefined') return 'server';
    return getOrCreateVisitorId();
  }, []);

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch(API_CONFIG.endpoint('/api/app-access/session'), {
        method: 'GET',
        credentials: 'include',
        mode: 'cors',
        headers: { 'X-Device-Id': visitorId },
        cache: 'no-store',
      });
      if (!res.ok) { setAuthenticated(false); return; }
      const payload = (await res.json()) as SessionResponse;
      setAuthenticated(Boolean(payload.authenticated));
    } catch {
      setAuthenticated(false);
    }
  }, [visitorId]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      await checkSession();
      if (mounted) setChecking(false);
    };
    run();
    return () => { mounted = false; };
  }, [checkSession]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const res = await fetch(API_CONFIG.endpoint('/api/app-access/login'), {
        method: 'POST',
        credentials: 'include',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': visitorId,
        },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: `Login failed (${res.status})` }));
        setError(data?.detail || `Invalid username or password (${res.status})`);
        setShake(true);
        setTimeout(() => setShake(false), 600);
        setSubmitting(false);
        return;
      }

      setPassword('');
      await checkSession();
      setSubmitting(false);
    } catch (err) {
      // Surface the exact endpoint to simplify production debugging on mobile browsers.
      const message = err instanceof Error ? err.message : 'Unknown network error';
      setError(`Unable to reach server (${message}). Endpoint: ${API_CONFIG.endpoint('/api/app-access/login')}`);
      setShake(true);
      setTimeout(() => setShake(false), 600);
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-[#0a0e17] flex items-center justify-center p-4">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] h-[480px] bg-cyan-500/5 rounded-full blur-3xl" />
          <div className="absolute top-2/3 left-1/3 w-[280px] h-[280px] bg-blue-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/85 backdrop-blur-xl shadow-2xl overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500" />
          <div className="px-6 sm:px-8 py-8 sm:py-10 text-center space-y-5 sm:space-y-6">
            <div className="relative w-20 h-20 mx-auto shrink-0">
              <div className="absolute inset-0 rounded-full border-4 border-cyan-500/20" />
              <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-cyan-400 animate-spin" />
              <div className="absolute inset-2 rounded-full bg-cyan-500/10 flex items-center justify-center shadow-[inset_0_0_20px_rgba(34,211,238,0.08)]">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" className="text-cyan-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] sm:text-xs font-black tracking-[0.28em] uppercase text-cyan-300/90">Secure Access Check</p>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white leading-tight">
                Preparing your trading workspace
              </h1>
              <p className="text-sm sm:text-[15px] leading-relaxed text-slate-300 max-w-sm mx-auto">
                We are validating your authenticated session, device trust, and protected access before loading live market intelligence.
              </p>
            </div>

            <div className="rounded-2xl border border-white/8 bg-slate-950/50 px-4 py-3">
              <div className="flex items-center justify-center gap-2 text-[11px] sm:text-xs text-slate-400">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                <span className="font-medium">Establishing secure session handshake</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-left">
              <div className="rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Step 1</div>
                <div className="mt-1 text-[11px] font-semibold text-slate-200">Session</div>
              </div>
              <div className="rounded-xl border border-cyan-400/15 bg-cyan-500/[0.04] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-400/70">Step 2</div>
                <div className="mt-1 text-[11px] font-semibold text-cyan-100">Trust</div>
              </div>
              <div className="rounded-xl border border-white/6 bg-white/[0.03] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Step 3</div>
                <div className="mt-1 text-[11px] font-semibold text-slate-200">Access</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (authenticated) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-[#0a0e17] flex items-center justify-center p-4">
      {/* Subtle background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-cyan-500/5 rounded-full blur-3xl" />
        <div className="absolute top-2/3 left-1/3 w-[300px] h-[300px] bg-indigo-500/5 rounded-full blur-3xl" />
      </div>

      <div
        className={`relative w-full max-w-sm sm:max-w-md transition-all duration-300 ${shake ? 'animate-[shake_0.5s_ease-in-out]' : ''}`}
        style={shake ? { animation: 'shake 0.5s ease-in-out' } : {}}
      >
        {/* Card */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 backdrop-blur-xl shadow-2xl overflow-hidden">

          {/* Top accent bar */}
          <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500" />

          <div className="px-6 py-8 sm:px-8 sm:py-10">

            {/* Logo / Icon */}
            <div className="flex flex-col items-center mb-8">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 border border-cyan-500/30 flex items-center justify-center mb-4 shadow-lg shadow-cyan-900/30">
                <svg className="w-7 h-7 sm:w-8 sm:h-8 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5l4-4 3 3 4-5 4 3" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 20h18M3 4h18" />
                </svg>
              </div>
              <p className="text-[10px] sm:text-xs font-bold tracking-[0.2em] text-cyan-400 uppercase mb-1">
                MyDailyTradingSignals
              </p>
              <h1 className="text-xl sm:text-2xl font-bold text-white">Welcome Back</h1>
              <p className="text-slate-400 text-xs sm:text-sm mt-1.5 text-center">
                Sign in to access live market signals
              </p>
            </div>

            {/* Form */}
            <form onSubmit={onSubmit} className="space-y-4" autoComplete="on">

              {/* Username */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300 tracking-wide">
                  Username
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-500">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter username"
                    className="w-full rounded-xl bg-slate-800/80 border border-slate-700 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none pl-10 pr-4 py-3 text-sm text-slate-100 placeholder-slate-500 transition-all"
                    autoComplete="username"
                    required
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300 tracking-wide">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-500">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full rounded-xl bg-slate-800/80 border border-slate-700 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 outline-none pl-10 pr-11 py-3 text-sm text-slate-100 placeholder-slate-500 transition-all"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-3 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2.5 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
                  <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting || !username || !password}
                className="w-full rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:from-slate-700 disabled:to-slate-700 disabled:cursor-not-allowed text-white font-semibold py-3 text-sm tracking-wide transition-all duration-200 shadow-lg shadow-cyan-900/30 hover:shadow-cyan-900/50 mt-2 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Authenticating...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 018 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                    </svg>
                    <span>Unlock Application</span>
                  </>
                )}
              </button>
            </form>

            {/* Footer note */}
            <p className="text-center text-[11px] text-slate-600 mt-6">
              Session valid for 24 hours &bull; Secure encrypted access
            </p>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-6px); }
          30% { transform: translateX(6px); }
          45% { transform: translateX(-5px); }
          60% { transform: translateX(5px); }
          75% { transform: translateX(-3px); }
          90% { transform: translateX(3px); }
        }
      `}</style>
    </div>
  );
}
