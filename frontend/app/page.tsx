'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { TrendingUp, TrendingDown, Activity, RefreshCw, AlertCircle, Bell } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  price: number;
}

interface Signal {
  symbol: string;
  strike: number;
  option_type: 'CE' | 'PE';
  signal: string;
  signal_strength: string;
  score: number;
  reasons: string[];
  ltp: number;
  greeks: Greeks;
  oi: number;
  tradingsymbol: string;
}

interface SignalData {
  symbol: string;
  spot_price: number;
  signals: Signal[];
  timestamp: string;
  pcr?: number;
  market_direction?: string;
  direction_percentage?: number;
  probability_bullish?: number;
  probability_range?: number;
  probability_bearish?: number;
  bullish_percentage?: number;
  bearish_percentage?: number;
  component_scores?: {
    pcr_score: number;
    oi_score: number;
    delta_score: number;
    price_action_score: number;
    vix_score: number;
  };
  total_ce_oi?: number;
  total_pe_oi?: number;
  atm_strike?: number;
  option_chain?: any[];
}

export default function Home() {
  const [signalData, setSignalData] = useState<Record<string, SignalData>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [useTestData, setUseTestData] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showTestAlert, setShowTestAlert] = useState(false);
  const [testPhoneNumber, setTestPhoneNumber] = useState('+919177242623');
  const [testAlertLoading, setTestAlertLoading] = useState(false);
  const [testAlertResult, setTestAlertResult] = useState<{status: string, message: string} | null>(null);
  const [marketStatus, setMarketStatus] = useState<{status: string, current_time: string, message?: string} | null>(null);
  const symbols = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;

  const loadTestData = useCallback(() => {
    console.log('loadTestData called'); // Debug log
    setUseTestData(true);
    setAutoRefresh(false); // Disable auto-refresh for test data
    const testData: SignalData = {
      symbol: 'NIFTY',
      spot_price: 25959,
      signals: [],
      timestamp: new Date().toISOString(),
      pcr: 1.18,
      market_direction: 'BULLISH',
      direction_percentage: 12.5,
      probability_bullish: 65.2,
      probability_range: 28.3,
      probability_bearish: 6.5,
      bullish_percentage: 62.5,
      bearish_percentage: 37.5,
      component_scores: {
        pcr_score: 75.0,
        oi_score: 54.1,
        delta_score: 60.0,
        price_action_score: 70.0,
        vix_score: 55.0
      },
      total_ce_oi: 916500000,
      total_pe_oi: 1081200000
    };
    console.log('Setting signal data:', testData); // Debug log
    console.log('Bullish percentage:', testData.bullish_percentage); // Debug log
    console.log('Component scores:', testData.component_scores); // Debug log
    setSignalData({
      'NIFTY': testData,
      'BANKNIFTY': testData,
      'SENSEX': testData
    });
    setIsAuthenticated(true);
    setError(null);
  }, []);

  const fetchAllSignals = useCallback(async (showLoading = true) => {
    if (useTestData) return; // Skip if using test data
    console.log(`[FETCH] Fetching all symbols data...`);
    if (showLoading) setLoading(true);
    if (!showLoading) setIsRefreshing(true);
    setError(null);
    
    try {
      // Fetch market status first
      const statusResponse = await axios.get(`${API_URL}/api/market/status`);
      setMarketStatus(statusResponse.data);
      
      // Fetch all three symbols in parallel
      const promises = symbols.map(symbol => 
        axios.get(`${API_URL}/api/signals/${symbol}`, {
          timeout: 15000,
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        }).catch(err => {
          console.error(`Error fetching ${symbol}:`, err);
          return null;
        })
      );
      
      const responses = await Promise.all(promises);
      
      // Update signal data for all symbols
      const newData: Record<string, SignalData> = {};
      let marketMessage = null;
      responses.forEach((response, index) => {
        if (response) {
          newData[symbols[index]] = response.data;
          console.log(`[FETCH] ${symbols[index]} spot: ${response.data.spot_price}`);
          if (response.data.message) {
            marketMessage = response.data.message;
          }
        }
      });
      
      setSignalData(prev => ({ ...prev, ...newData }));
      setIsAuthenticated(true);
      
      // Don't show market closed as error - it's already in header status
      setError(null);
      
      setLastUpdate(new Date());
    } catch (err: any) {
      console.error('API Error:', err);
      if (err.response?.status === 401) {
        setIsAuthenticated(false);
        setError('Please authenticate with Zerodha first');
      } else if (!showLoading) {
        console.log('Background refresh failed, will retry in 1s');
      } else {
        setError('Failed to fetch data - Check if backend is running');
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [useTestData, symbols]);

  const handleLogin = async () => {
    try {
      setError(null);
      setLoading(true);
      console.log('[LOGIN] Starting login...');
      
      // Fast request with reduced timeout
      const response = await axios.get(`${API_URL}/api/auth/login-url`, {
        timeout: 5000,
        headers: { 'Accept': 'application/json' }
      });
      
      console.log('[LOGIN] Received response:', response.data);
      
      if (!response.data?.login_url) {
        throw new Error('Invalid response from server');
      }
      
      const loginUrl = response.data.login_url;
      console.log('[LOGIN] Redirecting to Zerodha...');
      
      // Fast redirect for all devices - no complex detection needed
      // Zerodha Kite Connect handles mobile/desktop automatically
      window.location.href = loginUrl;
      
    } catch (err: any) {
      console.error('[LOGIN ERROR]:', err);
      setLoading(false);
      
      let errorMessage = '❌ Cannot connect to backend';
      
      if (err.code === 'ECONNABORTED') {
        errorMessage = '⏱️ Connection timeout. Backend not responding.';
      } else if (err.response) {
        errorMessage = `❌ Server error: ${err.response.status}`;
      } else if (err.request) {
        errorMessage = '❌ Backend offline. Check if it\'s running on port 8001.';
      } else {
        errorMessage = err.message || '❌ Unknown error';
      }
      
      setError(errorMessage);
      alert(errorMessage);
    }
  };

  // Check authentication status on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/auth/status`);
        console.log('[AUTH CHECK] Status:', response.data);
        if (response.data.is_authenticated) {
          setIsAuthenticated(true);
          console.log('[AUTH CHECK] User is authenticated, fetching data...');
          fetchAllSignals(true);
        } else {
          console.log('[AUTH CHECK] User not authenticated');
          setIsAuthenticated(false);
        }
      } catch (err) {
        console.error('[AUTH CHECK] Failed to check auth status:', err);
        // Try to fetch data anyway - if it fails due to auth, we'll handle it
        if (!useTestData) {
          fetchAllSignals(true);
        }
      }
    };
    
    checkAuth();
  }, []);

  // Refresh data when page becomes visible (e.g., after returning from auth)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !useTestData) {
        console.log('[VISIBILITY] Page visible, checking auth and refreshing data...');
        axios.get(`${API_URL}/api/auth/status`)
          .then(response => {
            if (response.data.is_authenticated) {
              setIsAuthenticated(true);
              fetchAllSignals(false);
            }
          })
          .catch(err => console.error('[VISIBILITY] Auth check failed:', err));
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [useTestData, fetchAllSignals]);

  // Auto-refresh polling for live data - 1 second silent updates (values only)
  useEffect(() => {
    if (!autoRefresh || useTestData) return;
    
    const interval = setInterval(() => {
      fetchAllSignals(false); // Silent refresh - no loading indicator, only values update
    }, 1000); // Refresh every 1 second - instant real-time updates from Zerodha
    
    return () => clearInterval(interval);
  }, [autoRefresh, useTestData, fetchAllSignals]);

  const getSignalColor = (signal: string) => {
    switch (signal) {
      case 'STRONG BUY':
        return 'bg-green-500 text-white';
      case 'BUY':
        return 'bg-green-400 text-white';
      case 'WEAK BUY':
        return 'bg-yellow-500 text-white';
      default:
        return 'bg-gray-400 text-white';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-600 font-bold';
    if (score >= 50) return 'text-green-500 font-semibold';
    if (score >= 30) return 'text-yellow-600';
    return 'text-gray-500';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 text-white relative overflow-hidden">
      {/* Animated Background Overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-900/10 via-transparent to-cyan-900/10 pointer-events-none"></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,_var(--tw-gradient-stops))] from-purple-900/10 via-transparent to-transparent pointer-events-none"></div>
      
      {/* Header */}
      <header className="bg-gradient-to-r from-slate-900/80 via-indigo-950/70 to-slate-900/80 border-b-2 border-indigo-500/30 backdrop-blur-xl sticky top-0 z-50 shadow-2xl">
        <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 sm:gap-4">
              <Activity className="w-8 h-8 sm:w-10 sm:h-10 text-cyan-400 drop-shadow-lg" />
              <div>
                <h1 className="text-2xl sm:text-4xl font-black bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 bg-clip-text text-transparent tracking-tight">Daily Trading Signals</h1>
                <div className="flex items-center gap-3">
                  {marketStatus && (
                    <p className="text-xs sm:text-sm flex items-center gap-2">
                      <span className={`inline-block w-3 h-3 rounded-full ${marketStatus.status === 'OPEN' ? 'bg-green-400 animate-pulse shadow-lg shadow-green-400/50' : 'bg-red-400 shadow-lg shadow-red-400/50'}`}></span>
                      <span className={marketStatus.status === 'OPEN' ? 'text-green-300 font-black uppercase tracking-wider' : 'text-red-300 font-black uppercase tracking-wider'}>
                        {marketStatus.status === 'OPEN' ? '🟢 LIVE' : 'OFFLINE'}
                      </span>
                      <span className="text-slate-300">• {marketStatus.current_time}</span>
                      <span className="text-slate-400 text-[10px] sm:text-xs font-semibold">
                        {marketStatus.status === 'OPEN' ? '(Market Open)' : '(Market Closed)'}
                      </span>
                    </p>
                  )}
                  {autoRefresh && lastUpdate && (() => {
                    // Market crash detection - check all symbols for extreme conditions
                    const isCrashing = symbols.some(symbol => {
                      const data = signalData[symbol];
                      if (!data) return false;
                      
                      // Extreme bearish conditions: PCR < 0.6 OR direction < -40% OR strong bearish signals
                      const extremePCR = data.pcr && data.pcr < 0.6;
                      const extremeBearish = data.direction_percentage && data.direction_percentage < -40;
                      const strongBearishSignals = data.signals && data.signals.filter((s: any) => 
                        s.option_type === 'PE' && s.score >= 90
                      ).length >= 2;
                      
                      return extremePCR || extremeBearish || strongBearishSignals;
                    });
                    
                    return (
                    <p className="text-xs text-slate-400 flex items-center gap-1.5">
                      <span className={`inline-block w-2 h-2 rounded-full ${isRefreshing ? 'bg-yellow-400 animate-pulse' : 'bg-blue-400'}`}></span>
                      Updated {lastUpdate.toLocaleTimeString()}
                      {isCrashing && (
                        <span className="ml-1 text-2xl animate-pulse flex items-center gap-0.5" title="Market Crash Alert!">
                          🔥🔥🔥
                        </span>
                      )}
                    </p>
                    );
                  })()}
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
              {!isAuthenticated && (
                <button
                  onClick={handleLogin}
                  className="px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-sm sm:text-base whitespace-nowrap"
                >
                  <span className="hidden sm:inline">Login to Zerodha</span>
                  <span className="sm:hidden">Login</span>
                </button>
              )}
              
              <button
                onClick={() => setShowTestAlert(true)}
                className="px-3 sm:px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 transition-colors flex items-center gap-1 sm:gap-2 text-sm sm:text-base"
                title="Test SMS Alert"
              >
                <Bell className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">Test Alert</span>
                <span className="sm:hidden">Alert</span>
              </button>
              
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`hidden px-3 sm:px-4 py-2 rounded-lg transition-colors flex items-center gap-1 sm:gap-2 text-sm sm:text-base whitespace-nowrap ${
                  autoRefresh ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'
                }`}
              >
                {autoRefresh && <span className="inline-block w-2 h-2 bg-white rounded-full animate-pulse"></span>}
                <span className="hidden sm:inline">Auto: {autoRefresh ? 'ON (1s)' : 'OFF'}</span>
                <span className="sm:hidden">{autoRefresh ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-2 sm:px-4 py-4 sm:py-8">
        {/* Error Message - Only for actual errors, not market status */}
        {error && !error.includes('Market is closed') && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading && Object.keys(signalData).length === 0 && (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />
          </div>
        )}

        {/* No Data State */}
        {!loading && Object.keys(signalData).length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-slate-400 mb-4">Please authenticate with Zerodha to view live data.</p>
            {!isAuthenticated && (
              <button
                onClick={handleLogin}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors font-semibold"
              >
                Login to Zerodha
              </button>
            )}
          </div>
        )}

        {/* All Indices Overview - Unified View */}
        {Object.keys(signalData).length > 0 && (
          <>
            <div className="mb-6 sm:mb-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {symbols.map((symbol) => {
                const data = signalData[symbol];
                if (!data) return null;
                
                const direction = data.bullish_percentage !== undefined 
                  ? (data.bullish_percentage > 50 ? 'UP' : data.bullish_percentage < 50 ? 'DOWN' : 'NEUTRAL')
                  : (data.pcr && data.pcr > 1.2 ? 'UP' : data.pcr && data.pcr < 0.8 ? 'DOWN' : 'NEUTRAL');
                
                const directionColor = direction === 'UP' ? 'border-green-500/50 bg-green-500/5' : 
                                       direction === 'DOWN' ? 'border-red-500/50 bg-red-500/5' : 
                                       'border-yellow-500/50 bg-yellow-500/5';
                
                const directionIcon = direction === 'UP' ? '📈' : direction === 'DOWN' ? '📉' : '➡️';
                const directionTextColor = direction === 'UP' ? 'text-green-400' : 
                                          direction === 'DOWN' ? 'text-red-400' : 
                                          'text-yellow-400';

                return (
                  <div 
                    key={symbol}
                    className={`p-4 sm:p-6 bg-slate-800 rounded-xl border-2 ${directionColor} relative overflow-hidden hover:shadow-2xl transition-all duration-300`}
                  >
                    {/* Symbol Header */}
                    <div className="flex items-start justify-between mb-3 sm:mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1 sm:mb-2">
                          <h2 className="text-xl sm:text-2xl font-bold text-blue-400">{symbol}</h2>
                          {marketStatus && (
                            <span className={`px-1.5 sm:px-2 py-0.5 sm:py-1 ${marketStatus.status === 'OPEN' ? 'bg-green-500/20 text-green-400 border-green-500/30 animate-pulse' : 'bg-red-500/20 text-red-400 border-red-500/30'} text-[9px] sm:text-[10px] rounded-full border font-semibold`}>
                              {marketStatus.status === 'OPEN' ? 'LIVE' : 'OFFLINE'}
                            </span>
                          )}
                        </div>
                        <p className="text-2xl sm:text-3xl font-bold">₹{data.spot_price.toFixed(2)}</p>
                      </div>
                      
                      <div className="text-right">
                        <div className={`text-3xl sm:text-4xl mb-1`}>{directionIcon}</div>
                        <p className={`text-lg sm:text-xl font-bold ${directionTextColor}`}>{direction}</p>
                      </div>
                    </div>

                    {/* Direction Percentage */}
                    {data.bullish_percentage !== undefined && (
                      <div className="mb-3 sm:mb-4 p-2.5 sm:p-3 bg-slate-900/50 rounded-lg">
                        <div className="flex items-center justify-between mb-1.5 sm:mb-2">
                          <p className="text-[10px] sm:text-xs text-slate-400">Market Bias</p>
                          <p className={`text-base sm:text-lg font-bold ${directionTextColor}`}>
                            {data.bullish_percentage > 50 
                              ? `+${(data.bullish_percentage - 50).toFixed(1)}%` 
                              : `${(data.bullish_percentage - 50).toFixed(1)}%`}
                          </p>
                        </div>
                        <div className="w-full bg-slate-700 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all duration-500 ${
                              data.bullish_percentage > 50 ? 'bg-green-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${Math.abs(data.bullish_percentage - 50) * 2}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* PCR & OI */}
                    <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-3 sm:mb-4">
                      <div className={`p-2.5 sm:p-3 rounded-lg ${
                        data.pcr && data.pcr > 1.3
                          ? 'bg-gradient-to-br from-green-500/30 to-green-600/20 border-2 border-green-500/70 animate-pulse ring-2 ring-green-400/50' 
                          : data.pcr && data.pcr < 0.7
                          ? 'bg-gradient-to-br from-red-500/30 to-red-600/20 border-2 border-red-500/70 animate-pulse ring-2 ring-red-400/50'
                          : 'bg-slate-900/50'
                      }`}>
                        <p className="text-[10px] sm:text-xs text-slate-400 mb-1 flex items-center justify-between">
                          <span>PCR</span>
                          {data.pcr && data.pcr > 1.3 && (
                            <span className="text-[8px] text-green-400 font-bold">STRONG BULLISH</span>
                          )}
                          {data.pcr && data.pcr < 0.7 && (
                            <span className="text-[8px] text-red-400 font-bold">STRONG BEARISH</span>
                          )}
                        </p>
                        <p className={`text-base sm:text-lg font-bold ${
                          data.pcr && data.pcr > 1.3 ? 'text-green-400' : 
                          data.pcr && data.pcr > 1.2 ? 'text-green-300' :
                          data.pcr && data.pcr < 0.7 ? 'text-red-400' : 
                          data.pcr && data.pcr < 0.75 ? 'text-red-300' :
                          data.pcr && data.pcr < 0.8 ? 'text-orange-400' :
                          'text-yellow-400'
                        }`}>
                          {data.pcr?.toFixed(2) || 'N/A'}
                          {data.pcr && data.pcr > 1.3 && (
                            <span className="ml-1 text-xs">🔔📈</span>
                          )}
                          {data.pcr && data.pcr < 0.7 && (
                            <span className="ml-1 text-xs">🔔📉</span>
                          )}
                        </p>
                      </div>
                      <div className="p-2.5 sm:p-3 bg-slate-900/50 rounded-lg">
                        <p className="text-[10px] sm:text-xs text-slate-400 mb-1">Signals</p>
                        <p className="text-base sm:text-lg font-bold text-blue-400">
                          {data.signals.length}
                        </p>
                      </div>
                    </div>

                    {/* Quick Strike View - ATM, ITM, OTM */}
                    {data.option_chain && data.atm_strike && (() => {
                      const atmStrike = data.atm_strike;
                      const strikeStep = symbol === 'SENSEX' ? 100 : 50;
                      
                      // Get ATM, slight ITM, and slight OTM strikes
                      const atmData = data.option_chain.find((s: any) => s.strike === atmStrike);
                      const itmStrike = atmStrike - strikeStep; // One strike ITM
                      const otmStrike = atmStrike + strikeStep; // One strike OTM
                      const itmData = data.option_chain.find((s: any) => s.strike === itmStrike);
                      const otmData = data.option_chain.find((s: any) => s.strike === otmStrike);

                      if (!atmData) return null;

                      return (
                        <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-slate-700">
                          <p className="text-sm sm:text-base font-bold text-slate-300 mb-3 uppercase tracking-wide flex items-center gap-2">
                            <span className="text-base">📊</span> Live Strike Data
                          </p>
                          
                          <div className="space-y-3">
                            {/* ITM Strike - ONE BOX */}
                            {itmData && (() => {
                              const ceVolHighlight = itmData.CE?.volume > 100000; // Only highlight when volume > 1 lakh
                              const peVolHighlight = itmData.PE?.volume > 100000; // Only highlight when volume > 1 lakh
                              return (
                              <div className="p-3 bg-gradient-to-br from-green-950/40 via-slate-900/50 to-emerald-950/30 backdrop-blur-md border border-green-400/40 rounded-lg shadow-lg transition-all duration-300">
                                <div className="text-xs sm:text-sm text-green-300 mb-2 font-bold uppercase tracking-wide flex items-center gap-1.5">
                                  <span className="text-sm">🟢</span> ITM {itmStrike}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  {/* CE - Green Box */}
                                  <div className={`bg-gradient-to-br from-green-600/30 to-emerald-700/20 backdrop-blur-sm border border-green-300/60 p-2.5 rounded-lg shadow-lg transition-transform duration-200 ${ceVolHighlight ? 'animate-pulse ring-2 ring-yellow-300/60' : ''}`}>
                                    <div className="text-[10px] sm:text-xs text-green-100 font-bold mb-1.5 flex items-center gap-1.5 uppercase tracking-wide">
                                      <span>CE ✓</span>
                                      {ceVolHighlight && <span className="text-yellow-200 text-sm animate-bounce">🔥</span>}
                                    </div>
                                    <div className="text-sm sm:text-base text-white font-bold mb-1">₹{itmData.CE?.ltp?.toFixed(2) || '-'}</div>
                                    <div className={`text-[10px] sm:text-xs font-semibold ${ceVolHighlight ? 'text-yellow-200' : 'text-green-200'}`}>Vol: {itmData.CE?.volume ? (itmData.CE.volume / 1000).toFixed(0) + 'K' : '-'}</div>
                                  </div>
                                  {/* PE - Light Red Box */}
                                  <div className={`bg-gradient-to-br from-slate-700/30 to-gray-800/20 backdrop-blur-sm border border-slate-400/40 p-2.5 rounded-lg shadow-lg transition-transform duration-200 ${peVolHighlight ? 'animate-pulse ring-2 ring-yellow-300/60' : ''}`}>
                                    <div className="text-[10px] sm:text-xs text-slate-300 font-bold mb-1.5 flex items-center gap-1.5 uppercase tracking-wide">
                                      <span>PE</span>
                                      {peVolHighlight && <span className="text-yellow-200 text-sm animate-bounce">🔥</span>}
                                    </div>
                                    <div className="text-sm sm:text-base text-white font-bold mb-1">₹{itmData.PE?.ltp?.toFixed(2) || '-'}</div>
                                    <div className={`text-[10px] sm:text-xs font-semibold ${peVolHighlight ? 'text-yellow-200' : 'text-slate-300'}`}>Vol: {itmData.PE?.volume ? (itmData.PE.volume / 1000).toFixed(0) + 'K' : '-'}</div>
                                  </div>
                                </div>
                              </div>
                              );
                            })()}

                            {/* ATM Strike - ONE BOX */}
                            {(() => {
                              const ceVolHighlight = atmData.CE?.volume > 100000; // Only highlight when volume > 1 lakh
                              const peVolHighlight = atmData.PE?.volume > 100000; // Only highlight when volume > 1 lakh
                              return (
                            <div className="p-3 bg-gradient-to-br from-blue-900/30 via-cyan-950/30 to-blue-900/30 backdrop-blur-sm border border-cyan-400/50 rounded-lg shadow-lg transition-all duration-300">
                              <div className="text-xs sm:text-sm text-cyan-200 mb-2 font-bold uppercase tracking-wide flex items-center gap-1.5">
                                <span className="text-sm">🎯</span> ATM {atmStrike}
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                {/* CE - Green Box */}
                                <div className={`bg-gradient-to-br from-green-600/30 to-emerald-700/20 backdrop-blur-sm border border-green-300/60 p-2.5 rounded-lg shadow-lg transition-transform duration-200 ${ceVolHighlight ? 'animate-pulse ring-2 ring-yellow-300/60' : ''}`}>
                                  <div className="text-[10px] sm:text-xs text-green-100 font-bold mb-1.5 flex items-center gap-1.5 uppercase tracking-wide">
                                    <span>CE</span>
                                    {ceVolHighlight && <span className="text-yellow-200 text-sm animate-bounce">🔥</span>}
                                  </div>
                                  <div className="text-sm sm:text-base text-white font-bold mb-1">₹{atmData.CE?.ltp?.toFixed(2) || '-'}</div>
                                  <div className={`text-[10px] sm:text-xs font-semibold ${ceVolHighlight ? 'text-yellow-200' : 'text-green-200'}`}>Vol: {atmData.CE?.volume ? (atmData.CE.volume / 1000).toFixed(0) + 'K' : '-'}</div>
                                </div>
                                {/* PE - Red Box */}
                                <div className={`bg-gradient-to-br from-red-600/30 to-rose-700/20 backdrop-blur-sm border border-red-300/60 p-2.5 rounded-lg shadow-lg transition-transform duration-200 ${peVolHighlight ? 'animate-pulse ring-2 ring-yellow-300/60' : ''}`}>
                                  <div className="text-[10px] sm:text-xs text-red-100 font-bold mb-1.5 flex items-center gap-1.5 uppercase tracking-wide">
                                    <span>PE</span>
                                    {peVolHighlight && <span className="text-yellow-200 text-sm animate-bounce">🔥</span>}
                                  </div>
                                  <div className="text-sm sm:text-base text-white font-bold mb-1">₹{atmData.PE?.ltp?.toFixed(2) || '-'}</div>
                                  <div className={`text-[10px] sm:text-xs font-semibold ${peVolHighlight ? 'text-yellow-200' : 'text-red-200'}`}>Vol: {atmData.PE?.volume ? (atmData.PE.volume / 1000).toFixed(0) + 'K' : '-'}</div>
                                </div>
                              </div>
                            </div>
                              );
                            })()}

                            {/* OTM Strike - ONE BOX */}
                            {otmData && (() => {
                              const ceVolHighlight = otmData.CE?.volume > 100000; // Only highlight when volume > 1 lakh
                              const peVolHighlight = otmData.PE?.volume > 100000; // Only highlight when volume > 1 lakh
                              return (
                              <div className="p-3 bg-gradient-to-br from-slate-900/50 via-gray-900/40 to-slate-950/50 backdrop-blur-md border border-slate-300/30 rounded-lg shadow-lg transition-all duration-300">
                                <div className="text-xs sm:text-sm text-slate-200 mb-2 font-bold uppercase tracking-wide flex items-center gap-1.5">
                                  <span className="text-sm">⚪</span> OTM {otmStrike}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  {/* CE - Green Box */}
                                  <div className={`bg-gradient-to-br from-green-600/25 to-emerald-700/15 backdrop-blur-sm border border-green-300/50 p-2.5 rounded-lg shadow-lg transition-transform duration-200 ${ceVolHighlight ? 'animate-pulse ring-2 ring-yellow-300/60' : ''}`}>
                                    <div className="text-[10px] sm:text-xs text-green-100 font-bold mb-1.5 flex items-center gap-1.5 uppercase tracking-wide">
                                      <span>CE</span>
                                      {ceVolHighlight && <span className="text-yellow-300 text-sm animate-bounce">🔥</span>}
                                    </div>
                                    <div className="text-sm sm:text-base text-white font-bold mb-1">₹{otmData.CE?.ltp?.toFixed(2) || '-'}</div>
                                    <div className={`text-[10px] sm:text-xs font-semibold ${ceVolHighlight ? 'text-yellow-200' : 'text-green-200'}`}>Vol: {otmData.CE?.volume ? (otmData.CE.volume / 1000).toFixed(0) + 'K' : '-'}</div>
                                  </div>
                                  {/* PE - Red Box */}
                                  <div className={`bg-gradient-to-br from-red-600/25 to-rose-700/15 backdrop-blur-sm border border-red-300/50 p-2.5 rounded-lg shadow-lg transition-transform duration-200 ${peVolHighlight ? 'animate-pulse ring-2 ring-yellow-300/60' : ''}`}>
                                    <div className="text-[10px] sm:text-xs text-red-100 font-bold mb-1.5 flex items-center gap-1.5 uppercase tracking-wide">
                                      <span>PE ✓</span>
                                      {peVolHighlight && <span className="text-yellow-200 text-sm animate-bounce">🔥</span>}
                                    </div>
                                    <div className="text-sm sm:text-base text-white font-bold mb-1">₹{otmData.PE?.ltp?.toFixed(2) || '-'}</div>
                                    <div className={`text-[10px] sm:text-xs font-semibold ${peVolHighlight ? 'text-yellow-200' : 'text-red-200'}`}>Vol: {otmData.PE?.volume ? (otmData.PE.volume / 1000).toFixed(0) + 'K' : '-'}</div>
                                  </div>
                                </div>
                              </div>
                              );
                            })()}
                          </div>

                          {/* Legend */}
                          <div className="flex justify-between text-[10px] sm:text-xs mt-3 pt-2 border-t border-slate-700">
                            <span className="text-green-300 font-semibold">✓ ITM</span>
                            <span className="text-yellow-300 font-semibold">🔥 Vol &gt;1L</span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* OI Breakdown */}
                    {data.total_ce_oi && data.total_pe_oi && (
                      <div className="flex justify-between items-center text-[10px] sm:text-xs pt-2.5 sm:pt-3 border-t border-slate-700 mt-3">
                        <div>
                          <p className="text-slate-500">CE OI</p>
                          <p className="text-sm sm:text-base text-red-400 font-semibold">{(data.total_ce_oi / 100000).toFixed(1)}L</p>
                        </div>
                        <div className="text-right">
                          <p className="text-slate-500">PE OI</p>
                          <p className="text-sm sm:text-base text-green-400 font-semibold">{(data.total_pe_oi / 100000).toFixed(1)}L</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Detailed Analysis Sections - Show for each symbol with signals */}
            {symbols.map((symbol) => {
              const data = signalData[symbol];
              if (!data) return null;
              
              return (
                <div key={`${symbol}-details`} className="mb-8">
                  {/* Symbol Section Header */}
                  <div className="mb-3 sm:mb-4 flex items-center gap-2 sm:gap-3">
                    <div className="h-0.5 sm:h-1 flex-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"></div>
                    <h3 className="text-xl sm:text-2xl font-bold text-blue-400">{symbol} Analysis</h3>
                    <div className="h-0.5 sm:h-1 flex-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"></div>
                  </div>

                  {/* PCR & Market Direction */}
                  {data.pcr && (
                    <div className="mb-4 sm:mb-6 grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                      <div className="p-3 sm:p-4 bg-slate-800 rounded-xl border border-slate-700 transition-all duration-300">
                        <p className="text-sm text-slate-400 mb-1">Put-Call Ratio (PCR)</p>
                        <p className={`text-2xl font-bold transition-colors duration-300 ${
                          data.pcr! > 1.2 ? 'text-green-500' : 
                          data.pcr! < 0.8 ? 'text-red-500' : 
                          'text-yellow-500'
                        }`}>
                          {data.pcr!.toFixed(2)}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          {data.pcr! > 1.2 ? 'Bullish' : 
                           data.pcr! < 0.8 ? 'Bearish' : 'Neutral'}
                        </p>
                      </div>

                      <div className="p-4 bg-slate-800 rounded-xl border border-slate-700">
                        <p className="text-sm text-slate-400 mb-1">Market Direction</p>
                        <p className={`text-lg font-bold ${
                          data.market_direction?.includes('BULLISH') ? 'text-green-500' : 
                          data.market_direction?.includes('BEARISH') ? 'text-red-500' : 
                          'text-yellow-500'
                        }`}>
                          {data.market_direction}
                        </p>
                        <p className="text-xs text-slate-400 mt-2">
                          PCR: {data.pcr?.toFixed(2)} | CE OI: {(data.total_ce_oi! / 100000).toFixed(1)}L | PE OI: {(data.total_pe_oi! / 100000).toFixed(1)}L
                        </p>
                      </div>

                      <div className="p-4 bg-slate-800 rounded-xl border border-slate-700">
                        <p className="text-sm text-slate-400 mb-1">Direction %</p>
                        <p className={`text-2xl font-bold ${
                          (data.bullish_percentage !== undefined && data.bullish_percentage > 50) ? 'text-green-500' :
                          (data.bullish_percentage !== undefined && data.bullish_percentage < 50) ? 'text-red-500' :
                          'text-yellow-500'
                        }`}>
                          {(data.bullish_percentage !== undefined && data.bullish_percentage > 50) ? '📈' : 
                           (data.bullish_percentage !== undefined && data.bullish_percentage < 50) ? '📉' : 
                           '➡️'} 
                          {data.bullish_percentage !== undefined ? (data.bullish_percentage > 50 ? (data.bullish_percentage - 50).toFixed(1) : (-(50 - data.bullish_percentage)).toFixed(1)) : '0'}%
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          {(data.bullish_percentage !== undefined && data.bullish_percentage > 50) ? 'UP' : 
                           (data.bullish_percentage !== undefined && data.bullish_percentage < 50) ? 'DOWN' : 'NEUTRAL'}
                        </p>
                        <p className="text-xs text-slate-400 mt-2 pt-2 border-t border-slate-600">
                          📊 Weighted: {data.bullish_percentage !== undefined ? data.bullish_percentage : 'N/A'}% Bullish
                        </p>
                      </div>

                      <div className="p-4 bg-slate-800 rounded-xl border border-slate-700">
                        <p className="text-sm text-slate-400 mb-1">Total Open Interest</p>
                        <div className="flex justify-between mt-2">
                          <div>
                            <p className="text-xs text-slate-500">CE</p>
                            <p className="text-sm font-semibold text-red-400">
                              {(data.total_ce_oi! / 100000).toFixed(1)}L
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-slate-500">PE</p>
                            <p className="text-sm font-semibold text-green-400">
                              {(data.total_pe_oi! / 100000).toFixed(1)}L
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Probability Analysis */}
                  {data.probability_bullish && (
                    <div className="mb-6 p-6 bg-slate-800 rounded-xl border border-slate-700">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-slate-200">Probability (Today)</h3>
                        <p className="text-xs text-slate-400">Based on PCR & OI Data</p>
                      </div>
                      
                      <div className="space-y-4">
                        {/* Bullish Continuation */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-semibold text-slate-300">
                              📈 Bullish Continuation
                            </p>
                            <p className="text-sm font-bold text-green-400">
                              ~{data.probability_bullish}%
                            </p>
                          </div>
                          <div className="w-full bg-slate-700 rounded-full h-2">
                            <div
                              className="bg-green-500 h-2 rounded-full transition-all"
                              style={{ width: `${data.probability_bullish}%` }}
                            />
                          </div>
                        </div>

                        {/* Range / Pullback */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-semibold text-slate-300">
                              ➡️ Range / Pullback
                            </p>
                            <p className="text-sm font-bold text-yellow-400">
                              ~{data.probability_range}%
                            </p>
                          </div>
                          <div className="w-full bg-slate-700 rounded-full h-2">
                            <div
                              className="bg-yellow-500 h-2 rounded-full transition-all"
                              style={{ width: `${data.probability_range}%` }}
                            />
                          </div>
                        </div>

                        {/* Bearish Reversal */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-semibold text-slate-300">
                              📉 Sharp Bearish Reversal
                            </p>
                            <p className="text-sm font-bold text-red-400">
                              ~{data.probability_bearish}%
                            </p>
                          </div>
                          <div className="w-full bg-slate-700 rounded-full h-2">
                            <div
                              className="bg-red-500 h-2 rounded-full transition-all"
                              style={{ width: `${data.probability_bearish}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <p className="text-xs text-slate-500 mt-4 border-t border-slate-600 pt-4">
                        💡 PE OI: {(data.total_pe_oi! / 100000).toFixed(1)}L | CE OI: {(data.total_ce_oi! / 100000).toFixed(1)}L | Ratio: {(data.total_pe_oi! / data.total_ce_oi!).toFixed(2)}
                      </p>
                    </div>
                  )}

                  {/* Weighted Market Bias Analysis */}
                  {data.bullish_percentage !== undefined && (
                    <div className="mb-6 p-6 bg-slate-800 rounded-xl border border-slate-700">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-slate-200">Market Bias (Weighted Analysis)</h3>
                        <p className="text-xs text-slate-400">5 Parameter Formula</p>
                      </div>

                      {/* Main Bullish vs Bearish */}
                      <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="p-4 bg-slate-900 rounded-lg border border-green-500/30">
                          <p className="text-sm text-slate-400 mb-2">Bullish Bias</p>
                          <p className="text-3xl font-bold text-green-400">
                            {data.bullish_percentage}%
                          </p>
                        </div>
                        <div className="p-4 bg-slate-900 rounded-lg border border-red-500/30">
                          <p className="text-sm text-slate-400 mb-2">Bearish Bias</p>
                          <p className="text-3xl font-bold text-red-400">
                            {data.bearish_percentage}%
                          </p>
                        </div>
                      </div>

                      {/* Component Scores Breakdown */}
                      {data.component_scores && (
                        <div>
                          <p className="text-sm font-semibold text-slate-300 mb-3">Component Scores (Weights):</p>
                          <div className="space-y-3">
                            {/* PCR Score (35%) */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-xs font-medium text-slate-400">
                                  📊 PCR Score
                                  <span className="text-slate-500 ml-1">(35%)</span>
                                </p>
                                <p className="text-sm font-bold text-blue-400">
                                  {data.component_scores?.pcr_score?.toFixed(1)}/100
                                </p>
                              </div>
                              <div className="w-full bg-slate-700 rounded-full h-2">
                                <div
                                  className="bg-blue-500 h-2 rounded-full"
                                  style={{ width: `${data.component_scores?.pcr_score}%` }}
                                />
                              </div>
                            </div>

                            {/* OI Score (30%) */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-xs font-medium text-slate-400">
                                  🔄 OI Score
                                  <span className="text-slate-500 ml-1">(30%)</span>
                                </p>
                                <p className="text-sm font-bold text-purple-400">
                                  {data.component_scores?.oi_score?.toFixed(1)}/100
                                </p>
                              </div>
                              <div className="w-full bg-slate-700 rounded-full h-2">
                                <div
                                  className="bg-purple-500 h-2 rounded-full"
                                  style={{ width: `${data.component_scores?.oi_score}%` }}
                                />
                              </div>
                            </div>

                            {/* Delta Score (20%) */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-xs font-medium text-slate-400">
                                  ⚡ Delta Score
                                  <span className="text-slate-500 ml-1">(20%)</span>
                                </p>
                                <p className="text-sm font-bold text-cyan-400">
                                  {data.component_scores?.delta_score?.toFixed(1)}/100
                                </p>
                              </div>
                              <div className="w-full bg-slate-700 rounded-full h-2">
                                <div
                                  className="bg-cyan-500 h-2 rounded-full"
                                  style={{ width: `${data.component_scores?.delta_score}%` }}
                                />
                              </div>
                            </div>

                            {/* Price Action Score (10%) */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-xs font-medium text-slate-400">
                                  💹 Price Action
                                  <span className="text-slate-500 ml-1">(10%)</span>
                                </p>
                                <p className="text-sm font-bold text-orange-400">
                                  {data.component_scores?.price_action_score}
                                </p>
                              </div>
                            </div>

                            {/* VIX Score (5%) */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-xs font-medium text-slate-400">
                                  📈 VIX Score
                                  <span className="text-slate-500 ml-1">(5%)</span>
                                </p>
                                <p className="text-sm font-bold text-indigo-400">
                                  {data.component_scores?.vix_score}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      <p className="text-xs text-slate-400 mt-4 pt-4 border-t border-slate-600">
                        ✅ Formula: (0.35×PCR) + (0.30×OI) + (0.20×Delta) + (0.10×Price) + (0.05×VIX)
                      </p>
                    </div>
                  )}

                  {/* Signals for this symbol */}
                  {data.signals.length > 0 && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
                      {data.signals.map((signal, index) => (
                        <div
                          key={`${symbol}-${index}`}
                          className="bg-slate-800 rounded-xl border border-slate-700 p-4 sm:p-6 hover:shadow-xl hover:shadow-blue-500/10 transition-all"
                        >
                          {/* Signal Header */}
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-3">
                              {signal.option_type === 'CE' ? (
                                <TrendingUp className="w-8 h-8 text-green-400" />
                              ) : (
                                <TrendingDown className="w-8 h-8 text-red-400" />
                              )}
                              <div>
                                <h3 className="text-xl font-bold">
                                  {signal.strike} {signal.option_type}
                                </h3>
                                <p className="text-sm text-slate-400">{signal.tradingsymbol}</p>
                              </div>
                            </div>
                            
                            <div className="text-right">
                              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getSignalColor(signal.signal)}`}>
                                {signal.signal}
                              </span>
                              <p className={`text-2xl font-bold mt-2 ${getScoreColor(signal.score)}`}>
                                {signal.score}%
                              </p>
                              <p className="text-xs text-slate-400 mt-1">Signal Strength</p>
                            </div>
                          </div>

                          {/* Price Info */}
                          <div className="grid grid-cols-2 gap-4 mb-4 p-4 bg-slate-900/50 rounded-lg">
                            <div>
                              <p className="text-sm text-slate-400">LTP</p>
                              <p className="text-xl font-bold text-blue-400">₹{signal.ltp.toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-sm text-slate-400">Open Interest</p>
                              <p className="text-xl font-bold">{signal.oi.toLocaleString()}</p>
                            </div>
                          </div>

                          {/* Greeks */}
                          <div className="grid grid-cols-4 gap-3 mb-4">
                            <div className="p-3 bg-slate-900/50 rounded-lg">
                              <p className="text-xs text-slate-400">Delta</p>
                              <p className="text-lg font-semibold">{signal.greeks.delta.toFixed(3)}</p>
                            </div>
                            <div className="p-3 bg-slate-900/50 rounded-lg">
                              <p className="text-xs text-slate-400">Gamma</p>
                              <p className="text-lg font-semibold">{signal.greeks.gamma.toFixed(4)}</p>
                            </div>
                            <div className="p-3 bg-slate-900/50 rounded-lg">
                              <p className="text-xs text-slate-400">Theta</p>
                              <p className="text-lg font-semibold">{signal.greeks.theta.toFixed(2)}</p>
                            </div>
                            <div className="p-3 bg-slate-900/50 rounded-lg">
                              <p className="text-xs text-slate-400">Vega</p>
                              <p className="text-lg font-semibold">{signal.greeks.vega.toFixed(2)}</p>
                            </div>
                          </div>

                          {/* Reasons */}
                          <div className="space-y-2">
                            <p className="text-sm font-semibold text-slate-300">Signal Reasons:</p>
                            <div className="flex flex-wrap gap-2">
                              {signal.reasons.map((reason, idx) => (
                                <span
                                  key={idx}
                                  className="px-3 py-1 bg-blue-500/20 text-blue-300 rounded-full text-xs"
                                >
                                  {reason}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* No Signals State */}
        {!loading && Object.keys(signalData).length > 0 && 
         Object.values(signalData).every(data => data.signals.length === 0) && (
          <div className="text-center py-20 text-slate-400">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-xl">No strong signals found (80%+ strength required)</p>
            <p className="text-sm mt-2">🎯 BUYER FOCUSED: Only showing HIGH CONFIDENCE options with 80%+ signal strength. Quality opportunities with strong probability.</p>
            <p className="text-sm mt-1">💡 When market moves strongly in one direction with heavy OI build, signals will appear here.</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-8 sm:mt-12 py-4 sm:py-6 border-t border-slate-700 text-center text-slate-400 text-xs sm:text-sm px-4">
        <p>Live data from Zerodha • Greeks calculated using Black-Scholes model</p>
        <p className="mt-1">⚠️ For educational purposes only • Not financial advice</p>
      </footer>

      {/* Test Alert Modal */}
      {showTestAlert && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl p-4 sm:p-6 max-w-md w-full border border-slate-700 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <Bell className="w-6 h-6 text-purple-400" />
                Test SMS Alert
              </h3>
              <button
                onClick={() => {
                  setShowTestAlert(false);
                  setTestAlertResult(null);
                }}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-sm text-slate-400 mb-4">
              Send a test SMS to verify your Twilio configuration is working correctly.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Phone Number (with country code)
                </label>
                <input
                  type="tel"
                  value={testPhoneNumber}
                  onChange={(e) => setTestPhoneNumber(e.target.value)}
                  placeholder="+919177242623"
                  className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-purple-500"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Format: +[country code][number] (e.g., +919177242623)
                </p>
              </div>

              {testAlertResult && (
                <div className={`p-3 rounded-lg ${
                  testAlertResult.status === 'success' 
                    ? 'bg-green-500/10 border border-green-500 text-green-400' 
                    : 'bg-red-500/10 border border-red-500 text-red-400'
                }`}>
                  <p className="text-sm">{testAlertResult.message}</p>
                </div>
              )}

              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                <p className="text-sm text-slate-400 mb-2">Test message preview:</p>
                <div className="text-xs text-slate-300 whitespace-pre-line font-mono">
                  🚨 STRONG BUY Alert!{'\n'}
                  NIFTY 25900 CE{'\n'}
                  Score: 85.5%{'\n'}
                  LTP: ₹125.50{'\n'}
                  Symbol: NIFTY25900CE
                </div>
              </div>

              <button
                onClick={async () => {
                  setTestAlertLoading(true);
                  setTestAlertResult(null);
                  try {
                    const response = await axios.post(
                      `${API_URL}/api/alerts/test?phone_number=${encodeURIComponent(testPhoneNumber)}`
                    );
                    setTestAlertResult(response.data);
                  } catch (err: any) {
                    setTestAlertResult({
                      status: 'error',
                      message: err.response?.data?.message || 'Failed to send test SMS'
                    });
                  } finally {
                    setTestAlertLoading(false);
                  }
                }}
                disabled={testAlertLoading || !testPhoneNumber}
                className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {testAlertLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Bell className="w-4 h-4" />
                    Send Test SMS
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
