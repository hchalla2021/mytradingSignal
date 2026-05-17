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

const FLOATING_PARTICLES = [
  { top: '10%', left: '18%', size: '5px', delay: 0.1, duration: 5.2 },
  { top: '20%', left: '72%', size: '4px', delay: 0.8, duration: 6.0 },
  { top: '58%', left: '12%', size: '3px', delay: 1.4, duration: 4.9 },
  { top: '72%', left: '64%', size: '5px', delay: 0.4, duration: 5.6 },
  { top: '84%', left: '28%', size: '4px', delay: 1.2, duration: 6.4 },
  { top: '40%', left: '86%', size: '3px', delay: 0.6, duration: 5.0 },
];

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

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
      <>
        <div className="relative min-h-screen overflow-hidden bg-[#030814] text-slate-100">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(circle at 18% 22%, rgba(6,182,212,0.13), transparent 42%), radial-gradient(circle at 78% 76%, rgba(37,99,235,0.16), transparent 44%), linear-gradient(120deg, #020611 0%, #040B1E 45%, #030814 100%)',
              backgroundSize: '130% 130%',
            }}
          />

          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                'linear-gradient(rgba(56,189,248,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.06) 1px, transparent 1px)',
              backgroundSize: '46px 46px',
              maskImage: 'radial-gradient(circle at center, rgba(0,0,0,0.95) 26%, transparent 82%)',
            }}
          />

          {FLOATING_PARTICLES.map((particle, idx) => (
            <span
              key={`loading-particle-${idx}`}
              className="pointer-events-none absolute rounded-full bg-cyan-300/80 shadow-[0_0_20px_rgba(103,232,249,0.45)] animate-[floatParticle_6s_ease-in-out_infinite]"
              style={{ top: particle.top, left: particle.left, width: particle.size, height: particle.size }}
            />
          ))}

          <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10 sm:px-6 lg:px-10">
            <div className="relative w-full max-w-[26rem] rounded-[1.8rem] border border-cyan-400/20 bg-slate-950/55 p-[1px] shadow-[0_26px_70px_rgba(8,47,73,0.5)]">
              <div className="rounded-[1.72rem] border border-white/10 bg-[linear-gradient(180deg,rgba(8,14,32,0.92),rgba(7,13,28,0.84))] px-5 py-7 backdrop-blur-xl sm:px-8 sm:py-8">
                <div className="mb-6 flex justify-center">
                  <div className="relative h-16 w-16 rounded-2xl border border-cyan-300/20 bg-cyan-500/5">
                    <div className="absolute inset-0 rounded-2xl border-2 border-transparent border-t-cyan-300 border-r-blue-400 animate-spin" />
                    <div className="absolute inset-2 flex items-center justify-center rounded-xl border border-cyan-200/20 bg-slate-900/90">
                      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} className="text-cyan-300">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.34em] text-cyan-200/90">Secure Access Check</p>
                  <h1 className="text-[1.55rem] font-semibold tracking-tight text-white sm:text-[1.8rem]">Preparing your trading workspace</h1>
                  <p className="mx-auto max-w-sm text-sm leading-relaxed text-slate-300/90 sm:text-[15px]">
                    Validating authenticated session, trusted device, and encrypted access before loading real-time AI market intelligence.
                  </p>
                </div>

                <div className="mt-6 rounded-2xl border border-cyan-300/20 bg-cyan-400/[0.04] px-4 py-3 text-center text-[11px] text-cyan-100 sm:text-xs">
                  <span className="inline-flex items-center gap-2">
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300">
                      <span className="absolute inset-0 rounded-full bg-cyan-300 animate-ping" />
                    </span>
                    Establishing secure session handshake
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  {['Session', 'Trust', 'Access'].map((item, index) => (
                    <div
                      key={`loading-step-${item}`}
                      className={cn(
                        'rounded-xl border px-2.5 py-2 text-center',
                        index === 1
                          ? 'border-cyan-300/35 bg-cyan-400/10 text-cyan-100 shadow-[inset_0_0_14px_rgba(34,211,238,0.09)]'
                          : 'border-white/10 bg-white/[0.03] text-slate-200',
                      )}
                    >
                      <p className="text-[9px] uppercase tracking-[0.18em] text-slate-400 sm:text-[10px]">Step {index + 1}</p>
                      <p className="mt-1 text-[11px] font-medium leading-tight sm:text-xs">{item}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (authenticated) {
    return <>{children}</>;
  }

  return (
    <>
      <div className="relative min-h-screen overflow-hidden bg-[#030814] text-slate-100">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 18% 18%, rgba(6,182,212,0.18), transparent 38%), radial-gradient(circle at 76% 82%, rgba(37,99,235,0.18), transparent 42%), linear-gradient(120deg, #020611 0%, #040B1E 48%, #030814 100%)',
            backgroundSize: '130% 130%',
          }}
        />

        <div
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{
            backgroundImage:
              'linear-gradient(rgba(56,189,248,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.07) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(circle at 50% 45%, rgba(0,0,0,1) 22%, transparent 80%)',
          }}
        />

        <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-1/2 bg-[radial-gradient(circle_at_65%_35%,rgba(56,189,248,0.16),transparent_56%)] lg:block" />

        {FLOATING_PARTICLES.map((particle, idx) => (
          <span
            key={`login-particle-${idx}`}
            className="pointer-events-none absolute rounded-full bg-cyan-300/80 shadow-[0_0_22px_rgba(103,232,249,0.48)] animate-[floatParticle_6s_ease-in-out_infinite]"
            style={{ top: particle.top, left: particle.left, width: particle.size, height: particle.size }}
          />
        ))}

        <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[1600px] items-start justify-center px-3 py-4 sm:px-6 sm:py-8 lg:items-center lg:px-10">
          <div
            className={cn(
              'relative w-full max-w-[30rem] rounded-[1.9rem] border border-cyan-300/20 bg-slate-950/55 p-[1px] shadow-[0_24px_80px_rgba(7,29,60,0.6)] transition-all duration-300',
              shake && 'animate-[shake_0.5s_ease-in-out]'
            )}
          >
            <div className="rounded-[1.82rem] border border-white/10 bg-[linear-gradient(180deg,rgba(7,13,28,0.96),rgba(5,10,24,0.9))] p-5 backdrop-blur-xl sm:p-7 lg:p-8">
              <div className="mb-6 flex flex-col gap-3 text-left sm:flex-row sm:items-start sm:justify-between sm:gap-5">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] leading-tight text-cyan-200/90 sm:tracking-[0.24em]">MyDailyTradingSignals</p>
                  <h1 className="text-[1.85rem] font-semibold leading-[1.12] tracking-[-0.01em] text-white sm:text-[2.15rem]">Welcome Back</h1>
                  <p className="max-w-[35ch] text-[13.5px] leading-[1.55] text-slate-300/95 sm:text-[15px]">Access real-time AI trading intelligence with institutional-grade security.</p>
                </div>

                <div className="self-start rounded-xl border border-cyan-300/25 bg-cyan-500/8 px-3 py-2 text-left shadow-[inset_0_0_20px_rgba(34,211,238,0.08)] sm:ml-2 sm:min-w-[118px] sm:text-right">
                  <div className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-cyan-100 sm:justify-end">
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300">
                      <span className="absolute inset-0 animate-ping rounded-full bg-emerald-300" />
                    </span>
                    Live Pulse
                  </div>
                  <p className="mt-1 text-[11px] leading-tight text-slate-300">Terminal Secure</p>
                </div>
              </div>

              <div className="mb-5 rounded-[1.1rem] border border-cyan-300/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] px-3.5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_28px_rgba(8,47,73,0.35)] backdrop-blur-md">
                <svg viewBox="0 0 400 84" className="h-20 w-full" role="img" aria-label="Candlestick swing pattern preview">
                  <defs>
                    <linearGradient id="bullBody" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(110,255,176,0.98)" />
                      <stop offset="100%" stopColor="rgba(16,185,129,0.86)" />
                    </linearGradient>
                    <linearGradient id="bearBody" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(255,132,132,0.98)" />
                      <stop offset="100%" stopColor="rgba(239,68,68,0.88)" />
                    </linearGradient>
                    <filter id="bullGlow" x="-40%" y="-40%" width="180%" height="180%">
                      <feDropShadow dx="0" dy="0" stdDeviation="1.6" floodColor="rgba(74,222,128,0.7)" />
                    </filter>
                    <filter id="bearGlow" x="-40%" y="-40%" width="180%" height="180%">
                      <feDropShadow dx="0" dy="0" stdDeviation="1.6" floodColor="rgba(248,113,113,0.7)" />
                    </filter>
                    <linearGradient id="glassShine" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(255,255,255,0.20)" />
                      <stop offset="55%" stopColor="rgba(255,255,255,0.04)" />
                      <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                    </linearGradient>
                  </defs>

                  <rect x="1" y="1" width="398" height="82" rx="13" fill="url(#glassShine)" opacity="0.5" />

                  <path
                    d="M10 52 C 28 40, 44 28, 62 34 C 80 40, 96 54, 114 48 C 132 42, 148 24, 166 30 C 184 36, 200 52, 218 46 C 236 40, 252 22, 270 30 C 288 38, 304 56, 322 50 C 340 44, 356 26, 374 30"
                    stroke="rgba(56,189,248,0.28)"
                    strokeWidth="2"
                    fill="none"
                    strokeLinecap="round"
                  />

                  <g>
                    <line x1="34" y1="58" x2="34" y2="36" stroke="rgba(248,113,113,0.82)" strokeWidth="2" strokeLinecap="round" />
                    <rect x="28" y="44" width="12" height="12" rx="2" fill="url(#bearBody)" filter="url(#bearGlow)" />

                    <line x1="62" y1="54" x2="62" y2="26" stroke="rgba(74,222,128,0.82)" strokeWidth="2" strokeLinecap="round" />
                    <rect x="56" y="34" width="12" height="16" rx="2" fill="url(#bullBody)" filter="url(#bullGlow)" />

                    <line x1="90" y1="56" x2="90" y2="30" stroke="rgba(74,222,128,0.82)" strokeWidth="2" strokeLinecap="round" />
                    <rect x="84" y="37" width="12" height="14" rx="2" fill="url(#bullBody)" filter="url(#bullGlow)" />

                    <line x1="118" y1="60" x2="118" y2="38" stroke="rgba(248,113,113,0.82)" strokeWidth="2" strokeLinecap="round" />
                    <rect x="112" y="46" width="12" height="12" rx="2" fill="url(#bearBody)" filter="url(#bearGlow)" />

                    <line x1="146" y1="52" x2="146" y2="22" stroke="rgba(74,222,128,0.82)" strokeWidth="2" strokeLinecap="round" />
                    <rect x="140" y="30" width="12" height="18" rx="2" fill="url(#bullBody)" filter="url(#bullGlow)" />

                    <line x1="174" y1="58" x2="174" y2="32" stroke="rgba(248,113,113,0.82)" strokeWidth="2" strokeLinecap="round" />
                    <rect x="168" y="40" width="12" height="14" rx="2" fill="url(#bearBody)" filter="url(#bearGlow)" />

                    <line x1="202" y1="54" x2="202" y2="26" stroke="rgba(74,222,128,0.82)" strokeWidth="2" strokeLinecap="round" />
                    <rect x="196" y="34" width="12" height="16" rx="2" fill="url(#bullBody)" filter="url(#bullGlow)" />

                    <line x1="230" y1="60" x2="230" y2="36" stroke="rgba(248,113,113,0.82)" strokeWidth="2" strokeLinecap="round" />
                    <rect x="224" y="45" width="12" height="13" rx="2" fill="url(#bearBody)" filter="url(#bearGlow)" />

                    <line x1="258" y1="56" x2="258" y2="24" stroke="rgba(74,222,128,0.82)" strokeWidth="2" strokeLinecap="round" />
                    <rect x="252" y="32" width="12" height="18" rx="2" fill="url(#bullBody)" filter="url(#bullGlow)" />

                    <line x1="286" y1="62" x2="286" y2="40" stroke="rgba(248,113,113,0.82)" strokeWidth="2" strokeLinecap="round" />
                    <rect x="280" y="48" width="12" height="12" rx="2" fill="url(#bearBody)" filter="url(#bearGlow)" />

                    <line x1="314" y1="56" x2="314" y2="26" stroke="rgba(74,222,128,0.82)" strokeWidth="2" strokeLinecap="round" />
                    <rect x="308" y="34" width="12" height="17" rx="2" fill="url(#bullBody)" filter="url(#bullGlow)" />

                    <line x1="342" y1="60" x2="342" y2="34" stroke="rgba(248,113,113,0.82)" strokeWidth="2" strokeLinecap="round" />
                    <rect x="336" y="42" width="12" height="14" rx="2" fill="url(#bearBody)" filter="url(#bearGlow)" />

                    <line x1="370" y1="54" x2="370" y2="24" stroke="rgba(74,222,128,0.82)" strokeWidth="2" strokeLinecap="round" />
                    <rect x="364" y="31" width="12" height="18" rx="2" fill="url(#bullBody)" filter="url(#bullGlow)" />
                  </g>
                </svg>
              </div>

              <form onSubmit={onSubmit} className="space-y-3.5" autoComplete="on" noValidate>
                <div className="space-y-3">
                  <label htmlFor="gate-username" className="block text-xs font-medium tracking-wide text-slate-300">Username</label>
                  <div className="group relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-cyan-300">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </span>

                    <input
                      id="gate-username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.02] pl-11 pr-4 text-sm text-white outline-none transition-all duration-200 placeholder:text-slate-500/85 focus:border-cyan-300/70 focus:bg-cyan-400/[0.05] focus:shadow-[0_0_0_3px_rgba(34,211,238,0.14)]"
                      autoComplete="username"
                      required
                      placeholder="Username"
                    />
                  </div>

                  <label htmlFor="gate-password" className="block text-xs font-medium tracking-wide text-slate-300">Password</label>
                  <div className="group relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-cyan-300">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </span>

                    <input
                      id="gate-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.02] pl-11 pr-12 text-sm text-white outline-none transition-all duration-200 placeholder:text-slate-500/85 focus:border-cyan-300/70 focus:bg-cyan-400/[0.05] focus:shadow-[0_0_0_3px_rgba(34,211,238,0.14)]"
                      autoComplete="current-password"
                      required
                      placeholder="Password"
                    />

                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition-colors hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      <EyeIcon open={showPassword} />
                    </button>
                  </div>
                </div>

                {error && (
                  <div
                    className="flex items-start gap-2.5 rounded-xl border border-rose-400/35 bg-rose-400/10 px-4 py-3 text-xs text-rose-100"
                    role="alert"
                    aria-live="assertive"
                  >
                    <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !username || !password}
                  className="group relative mt-1 inline-flex min-h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl border border-cyan-300/40 bg-[linear-gradient(90deg,#0e7490,#2563eb)] px-4 py-3 text-center text-sm font-semibold leading-tight tracking-wide text-white shadow-[0_12px_30px_rgba(8,47,73,0.45)] transition-all duration-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-700 disabled:shadow-none"
                >
                  <span className="absolute inset-0 -translate-x-[110%] bg-[linear-gradient(115deg,transparent_25%,rgba(255,255,255,0.28)_50%,transparent_75%)] transition-transform duration-700 group-hover:translate-x-[110%]" />
                  {submitting ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                      <span className="whitespace-normal">Authorizing Terminal...</span>
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 018 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                      </svg>
                      <span className="whitespace-normal">Unlock Trading Terminal</span>
                    </>
                  )}
                </button>

                <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                  <button
                    type="button"
                    className="h-10 rounded-lg border border-white/10 bg-white/[0.03] text-xs text-slate-300 transition hover:border-cyan-300/35 hover:text-cyan-100"
                  >
                    Biometric Sign-In (Preview)
                  </button>
                  <div className="flex h-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] px-2 text-center text-[10px] uppercase tracking-[0.12em] text-slate-400 sm:text-[11px] sm:tracking-[0.18em]">
                    AES-256 Session Shield
                  </div>
                </div>
              </form>

              <p className="mt-4 text-center text-[11px] text-slate-400">Session valid for 24 hours. Keyboard navigation and autofill supported.</p>
            </div>
          </div>
        </div>

        <style jsx global>{`
          @keyframes floatParticle {
            0%,
            100% {
              transform: translateY(0);
              opacity: 0.25;
            }
            50% {
              transform: translateY(-12px);
              opacity: 0.9;
            }
          }

          @keyframes shake {
            0%,
            100% {
              transform: translateX(0);
            }
            15% {
              transform: translateX(-6px);
            }
            30% {
              transform: translateX(6px);
            }
            45% {
              transform: translateX(-5px);
            }
            60% {
              transform: translateX(5px);
            }
            75% {
              transform: translateX(-3px);
            }
            90% {
              transform: translateX(3px);
            }
          }
        `}</style>
      </div>
    </>
  );
}
