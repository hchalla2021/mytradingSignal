/**
 * System Status Banner Component
 * Shows priority status: AUTH_REQUIRED → FEED_DISCONNECTED → MARKET_SESSION
 * Auto-shows login when needed
 * Clear user communication
 */
'use client';

import React, { useState, useEffect } from 'react';

interface SystemHealth {
  priority_status: 'AUTH_REQUIRED' | 'FEED_DISCONNECTED' | 'MARKET_SESSION';
  priority_message: string;
  market: {
    phase: string;
    title: string;
    description: string;
    icon: string;
    color: string;
    is_trading_hours: boolean;
  };
  auth: {
    state: string;
    is_valid: boolean;
    requires_login: boolean;
    token_age_hours: number | null;
  };
  feed: {
    state: string;
    is_healthy: boolean;
    is_stale: boolean;
    last_tick_seconds_ago: number | null;
    connection_quality: number;
  };
}

export default function SystemStatusBanner() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // Check if we're returning from Zerodha login on mobile
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const loginPending = sessionStorage.getItem('zerodha_login_pending');
      const urlParams = new URLSearchParams(window.location.search);
      const authSuccess = urlParams.get('auth') === 'success';
      
      if (loginPending === 'true') {
        // Clear the flag
        sessionStorage.removeItem('zerodha_login_pending');
        
        if (authSuccess) {
          // Success! Wait for backend to reconnect
          setTimeout(() => {
            window.location.reload();
          }, 5000);
        }
      }
    }
  }, []);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
        const response = await fetch(`${apiUrl}/api/system/health`);
        if (response.ok) {
          const data = await response.json();
          setHealth(data);
        }
      } catch (error) {
        console.error('Failed to fetch system health:', error);
      }
    };

    // Initial fetch
    fetchHealth();

    // Poll every 10 seconds
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  if (!health) return null;

  const handleLogin = () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
    const loginUrl = `${apiUrl}/api/auth/login`;
    
    // Detect mobile device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
    
    if (isMobile) {
      // Mobile: Show instructions for Kite app users
      const hasKiteApp = confirm(
        '📱 Mobile Login\n\n' +
        'If you have Kite app installed:\n' +
        '• Tap OK to continue\n' +
        '• If Kite app opens, complete login there\n' +
        '• Then return to this browser tab\n' +
        '• Refresh the page manually\n\n' +
        'Tap OK to proceed with login'
      );
      
      if (hasKiteApp) {
        // Store a flag that we're in login flow
        sessionStorage.setItem('zerodha_login_pending', 'true');
        window.location.href = loginUrl;
      }
    } else {
      // Desktop: Use popup
      const popup = window.open(
        loginUrl, 
        'ZerodhaLogin',
        'width=600,height=700,scrollbars=yes,resizable=yes'
      );
      
      if (!popup) {
        // Popup blocked - fallback to direct navigation
        window.location.href = loginUrl;
        return;
      }
      
      // Check popup status every 500ms (ultra-fast)
      const checkPopup = setInterval(() => {
        if (!popup || popup.closed) {
          clearInterval(checkPopup);
          
          // Wait 5 seconds for backend to:
          // 1. Save token to .env (0.5s)
          // 2. Token watcher detect change (0.3s)
          // 3. WebSocket close old connection (3s)
          // 4. WebSocket start new connection (1s)
          // Total: ~5 seconds for complete reconnection
          setTimeout(() => {
            window.location.reload();
          }, 5000);
        } else {
          // Check if popup redirected to success page
          try {
            const popupUrl = popup.location.href;
            if (popupUrl.includes('auth=success')) {
              popup.close();
              clearInterval(checkPopup);
              
              // Wait 5 seconds for backend reconnection
              setTimeout(() => {
                window.location.reload();
              }, 5000);
            }
          } catch (e) {
            // Cross-origin error - popup is still on Zerodha domain
            // This is expected, keep checking
          }
        }
      }, 500);
      
      // Safety timeout - reload after 30 seconds regardless
      setTimeout(() => {
        clearInterval(checkPopup);
        if (popup && !popup.closed) {
          popup.close();
        }
      }, 30000);
    }
  };

  // AUTH_REQUIRED - Critical (Show login)
  if (health.priority_status === 'AUTH_REQUIRED') {
    return (
      <div className="bg-gradient-to-r from-red-900/30 to-orange-900/30 border-b border-red-500/30 backdrop-blur-md sticky top-[72px] z-40 shadow-lg">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2">
          <div className="flex items-center justify-between gap-2 sm:gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="flex-shrink-0 w-6 h-6 sm:w-7 sm:h-7 bg-red-500/20 rounded-full flex items-center justify-center">
                <svg className="w-3 h-3 sm:w-4 sm:h-4 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-xs sm:text-sm font-semibold text-red-300 truncate">Login Required</p>
                  {health.auth.token_age_hours && (
                    <span className="hidden sm:inline-block px-1.5 py-0.5 bg-red-500/20 rounded text-[10px] text-red-300 font-medium">
                      {health.auth.token_age_hours.toFixed(0)}h old
                    </span>
                  )}
                </div>
                <p className="text-[10px] sm:text-xs text-red-200/70 truncate">{health.priority_message}</p>
              </div>
            </div>
            <button
              onClick={handleLogin}
              className="flex-shrink-0 px-3 py-1.5 sm:px-4 sm:py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-md transition-all active:scale-95 shadow-md text-xs sm:text-sm flex items-center gap-1.5"
            >
              <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              <span className="hidden sm:inline">Login</span>
              <span className="sm:hidden">Login</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // FEED_DISCONNECTED - Warning (during market hours)
  if (health.priority_status === 'FEED_DISCONNECTED') {
    return (
      <div className="bg-gradient-to-r from-yellow-900/30 to-orange-900/30 border-b border-yellow-500/30 backdrop-blur-md sticky top-[72px] z-40 shadow-lg">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2">
          <div className="flex items-center justify-between gap-2 sm:gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="flex-shrink-0 w-6 h-6 sm:w-7 sm:h-7 bg-yellow-500/20 rounded-full flex items-center justify-center animate-pulse">
                <svg className="w-3 h-3 sm:w-4 sm:h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-xs sm:text-sm font-semibold text-yellow-300 truncate">Reconnecting</p>
                  {health.feed.last_tick_seconds_ago && (
                    <span className="hidden sm:inline-block px-1.5 py-0.5 bg-yellow-500/20 rounded text-[10px] text-yellow-300 font-medium">
                      {health.feed.last_tick_seconds_ago}s ago
                    </span>
                  )}
                </div>
                <p className="text-[10px] sm:text-xs text-yellow-200/70 truncate">{health.priority_message}</p>
              </div>
            </div>
            <div className="flex gap-1">
              <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-yellow-400 rounded-full animate-bounce"></div>
              <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // MARKET_SESSION - Normal status
  const getMarketStatusConfig = () => {
    switch (health.market.phase) {
      case 'PRE_OPEN':
        return { 
          bg: 'from-blue-900/30 to-cyan-900/30', 
          border: 'border-blue-500/30',
          iconBg: 'bg-blue-500/20',
          iconColor: 'text-blue-400',
          textColor: 'text-blue-300'
        };
      case 'AUCTION_FREEZE':
        return { 
          bg: 'from-yellow-900/30 to-amber-900/30', 
          border: 'border-yellow-500/30',
          iconBg: 'bg-yellow-500/20',
          iconColor: 'text-yellow-400',
          textColor: 'text-yellow-300'
        };
      case 'LIVE':
        return { 
          bg: 'from-green-900/30 to-emerald-900/30', 
          border: 'border-green-500/30',
          iconBg: 'bg-green-500/20',
          iconColor: 'text-green-400',
          textColor: 'text-green-300'
        };
      case 'CLOSED':
        return { 
          bg: 'from-gray-900/30 to-slate-900/30', 
          border: 'border-gray-500/30',
          iconBg: 'bg-gray-500/20',
          iconColor: 'text-gray-400',
          textColor: 'text-gray-300'
        };
      default:
        return { 
          bg: 'from-gray-900/30 to-slate-900/30', 
          border: 'border-gray-500/30',
          iconBg: 'bg-gray-500/20',
          iconColor: 'text-gray-400',
          textColor: 'text-gray-300'
        };
    }
  };

  const statusConfig = getMarketStatusConfig();

  return (
    <div className={`bg-gradient-to-r ${statusConfig.bg} border-b ${statusConfig.border} backdrop-blur-md sticky top-[72px] z-40 shadow-lg`}>
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2">
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className={`flex-shrink-0 w-6 h-6 sm:w-7 sm:h-7 ${statusConfig.iconBg} rounded-full flex items-center justify-center`}>
              <span className="text-sm sm:text-base">{health.market.icon}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-xs sm:text-sm font-semibold ${statusConfig.textColor} truncate`}>{health.market.title}</p>
              <p className="text-[10px] sm:text-xs text-white/60 truncate">{health.market.description}</p>
            </div>
          </div>
          
          {/* System Health Indicator */}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex-shrink-0 flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 bg-white/10 hover:bg-white/20 rounded-md transition-all text-[10px] sm:text-xs"
          >
            <div className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${health.feed.is_healthy ? 'bg-green-400' : 'bg-red-400'}`}></div>
              <span className="hidden sm:inline text-white/90">Feed</span>
            </div>
            <div className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${health.auth.is_valid ? 'bg-green-400' : 'bg-red-400'}`}></div>
              <span className="hidden sm:inline text-white/90">Auth</span>
            </div>
            <svg className="w-3 h-3 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={showDetails ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
            </svg>
          </button>
        </div>

        {/* Detailed Status (Expandable) */}
        {showDetails && (
          <div className="mt-2 pt-2 border-t border-white/10 text-[10px] sm:text-xs text-white/70">
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              <div>
                <p className="font-semibold text-white/90 mb-1">Market</p>
                <p className="truncate">{health.market.phase}</p>
                <p className="truncate">{health.market.is_trading_hours ? '🟢 Open' : '🔴 Closed'}</p>
              </div>
              <div>
                <p className="font-semibold text-white/90 mb-1">Feed</p>
                <p className="truncate">{health.feed.state}</p>
                <p className="truncate">{health.feed.connection_quality.toFixed(0)}% quality</p>
              </div>
              <div>
                <p className="font-semibold text-white/90 mb-1">Auth</p>
                <p className="truncate">{health.auth.state}</p>
                <p className="truncate">{health.auth.token_age_hours?.toFixed(1)}h old</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
