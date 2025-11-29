'use client';

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { TrendingUp, TrendingDown, Activity, RefreshCw, AlertCircle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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
}

export default function Home() {
  const [selectedSymbol, setSelectedSymbol] = useState<'NIFTY' | 'BANKNIFTY' | 'SENSEX'>('NIFTY');
  const [signalData, setSignalData] = useState<Record<string, SignalData>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [useTestData, setUseTestData] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  const fetchSignals = useCallback(async (symbol: string, showLoading = true, retryCount = 0) => {
    if (useTestData) return; // Skip if using test data
    console.log(`[FETCH] Fetching ${symbol} data...`); // Debug log
    if (showLoading) setLoading(true);
    if (!showLoading) setIsRefreshing(true); // Show refresh indicator for background updates
    setError(null);
    
    try {
      const response = await axios.get(`${API_URL}/api/signals/${symbol}`, {
        timeout: 15000, // 15 second timeout for initial fetch (Zerodha API can be slow)
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      console.log(`[FETCH] ${symbol} spot price: ${response.data.spot_price}`); // Debug log
      
      // Cache the data per symbol
      setSignalData(prev => ({
        ...prev,
        [symbol]: response.data
      }));
      setIsAuthenticated(true);
      setError(null); // Clear any previous errors
      setLastUpdate(new Date()); // Track last successful update
    } catch (err: any) {
      console.error('API Error:', err);
      
      // Skip retry for faster performance - just log and continue
      
      // Only show critical errors, ignore timeouts during auto-refresh
      if (err.response?.status === 401) {
        setIsAuthenticated(false);
        setError('Please authenticate with Zerodha first');
      } else if (!showLoading) {
        // Silently fail on background refresh - don't disrupt UI
        console.log('Background refresh failed, will retry in 1s');
      } else {
        setError('Failed to fetch data - Check if backend is running');
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [useTestData]);

  const handleLogin = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/auth/login-url`);
      
      // Store current symbol in sessionStorage to restore after auth
      sessionStorage.setItem('selectedSymbol', selectedSymbol);
      
      // Full page redirect to Zerodha login
      window.location.href = response.data.login_url;
      
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.response?.data?.detail || 'Failed to get login URL. Please check backend is running.');
    }
  };

  useEffect(() => {
    // Fetch live data on startup for the selected symbol
    if (!useTestData) {
      fetchSignals(selectedSymbol, true);
    }
  }, []);

  // Fetch data when selected symbol changes
  useEffect(() => {
    if (!useTestData && !signalData[selectedSymbol]) {
      // If this symbol doesn't have data yet, fetch it
      fetchSignals(selectedSymbol, true);
    }
  }, [selectedSymbol, useTestData, signalData, fetchSignals]);

  // Auto-refresh polling for live data - ultra-fast 1 second updates
  useEffect(() => {
    if (!autoRefresh || useTestData) return; // Skip if test data
    
    const interval = setInterval(() => {
      fetchSignals(selectedSymbol, false); // Don't show loading on auto-refresh
    }, 1000); // Refresh every 1 second for live data
    
    return () => clearInterval(interval);
  }, [autoRefresh, selectedSymbol, useTestData, fetchSignals]);

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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-800/50 border-b border-slate-700 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="w-8 h-8 text-blue-400" />
              <div>
                <h1 className="text-2xl font-bold">Options Trading Signals</h1>
                {autoRefresh && lastUpdate && (
                  <p className="text-xs text-slate-400 flex items-center gap-1">
                    <span className={`inline-block w-2 h-2 rounded-full ${isRefreshing ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'}`}></span>
                    Live • Updated {lastUpdate.toLocaleTimeString()}
                  </p>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <a
                href="/optionchain"
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors font-semibold"
              >
                Full Option Chain
              </a>
              
              {!isAuthenticated && (
                <>
                  <button
                    onClick={handleLogin}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  >
                    Login to Zerodha
                  </button>
                  <button
                    onClick={loadTestData}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg transition-colors text-sm"
                  >
                    Load Test Data
                  </button>
                </>
              )}
              
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                  autoRefresh ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'
                }`}
              >
                {autoRefresh && <span className="inline-block w-2 h-2 bg-white rounded-full animate-pulse"></span>}
                Auto Refresh: {autoRefresh ? 'ON (1s)' : 'OFF'}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Symbol Selection */}
        <div className="flex gap-4 mb-8">
          {(['NIFTY', 'BANKNIFTY', 'SENSEX'] as const).map((symbol) => (
            <button
              key={symbol}
              onClick={() => {
                if (symbol !== selectedSymbol) {
                  setLoading(true); // Show loading immediately
                  setSelectedSymbol(symbol);
                }
              }}
              className={`flex-1 px-6 py-4 rounded-xl font-semibold transition-all ${
                selectedSymbol === symbol
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/50 scale-105'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {symbol}
            </button>
          ))}
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading && !signalData[selectedSymbol] && (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />
          </div>
        )}

        {/* No Data State */}
        {!loading && !signalData[selectedSymbol] && (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-slate-400 mb-4">No data loaded. Click "Load Test Data" to begin.</p>
            {!isAuthenticated && (
              <button
                onClick={loadTestData}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded-lg transition-colors font-semibold"
              >
                Load Test Data
              </button>
            )}
          </div>
        )}

        {/* Spot Price & Market Metrics */}
        {signalData[selectedSymbol] && (
          <>
            <div className="mb-6 p-6 bg-slate-800 rounded-xl border border-slate-700 relative overflow-hidden">
              {isRefreshing && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent animate-pulse"></div>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-3xl font-bold text-blue-400">{signalData[selectedSymbol].symbol}</h2>
                    {autoRefresh && (
                      <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded-full border border-green-500/30 animate-pulse">
                        LIVE
                      </span>
                    )}
                  </div>
                  <p className="text-2xl mt-2">Spot: ₹{signalData[selectedSymbol].spot_price.toFixed(2)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-400">Last Updated</p>
                  <p className="text-sm flex items-center gap-1 justify-end">
                    <span className={`inline-block w-2 h-2 rounded-full ${isRefreshing ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'}`}></span>
                    {new Date(signalData[selectedSymbol].timestamp).toLocaleTimeString()}
                  </p>
                  <p className="text-sm text-slate-400 mt-1">
                    {signalData[selectedSymbol].signals.length} Signals Found
                  </p>
                </div>
              </div>
            </div>

            {/* PCR & Market Direction */}
            {signalData[selectedSymbol].pcr && (
              <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-4 bg-slate-800 rounded-xl border border-slate-700 transition-all duration-300">
                  <p className="text-sm text-slate-400 mb-1">Put-Call Ratio (PCR)</p>
                  <p className={`text-2xl font-bold transition-colors duration-300 ${
                    signalData[selectedSymbol].pcr! > 1.2 ? 'text-green-500' : 
                    signalData[selectedSymbol].pcr! < 0.8 ? 'text-red-500' : 
                    'text-yellow-500'
                  }`}>
                    {signalData[selectedSymbol].pcr!.toFixed(2)}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {signalData[selectedSymbol].pcr! > 1.2 ? 'Bullish' : 
                     signalData[selectedSymbol].pcr! < 0.8 ? 'Bearish' : 'Neutral'}
                  </p>
                </div>

                <div className="p-4 bg-slate-800 rounded-xl border border-slate-700">
                  <p className="text-sm text-slate-400 mb-1">Market Direction</p>
                  <p className={`text-lg font-bold ${
                    signalData[selectedSymbol].market_direction?.includes('BULLISH') ? 'text-green-500' : 
                    signalData[selectedSymbol].market_direction?.includes('BEARISH') ? 'text-red-500' : 
                    'text-yellow-500'
                  }`}>
                    {signalData[selectedSymbol].market_direction}
                  </p>
                  <p className="text-xs text-slate-400 mt-2">
                    PCR: {signalData[selectedSymbol].pcr?.toFixed(2)} | CE OI: {(signalData[selectedSymbol].total_ce_oi! / 100000).toFixed(1)}L | PE OI: {(signalData[selectedSymbol].total_pe_oi! / 100000).toFixed(1)}L
                  </p>
                </div>

                <div className="p-4 bg-slate-800 rounded-xl border border-slate-700">
                  <p className="text-sm text-slate-400 mb-1">Direction %</p>
                  <p className={`text-2xl font-bold ${
                    (signalData[selectedSymbol].bullish_percentage !== undefined && signalData[selectedSymbol].bullish_percentage > 50) ? 'text-green-500' :
                    (signalData[selectedSymbol].bullish_percentage !== undefined && signalData[selectedSymbol].bullish_percentage < 50) ? 'text-red-500' :
                    'text-yellow-500'
                  }`}>
                    {(signalData[selectedSymbol].bullish_percentage !== undefined && signalData[selectedSymbol].bullish_percentage > 50) ? '📈' : 
                     (signalData[selectedSymbol].bullish_percentage !== undefined && signalData[selectedSymbol].bullish_percentage < 50) ? '📉' : 
                     '➡️'} 
                    {signalData[selectedSymbol].bullish_percentage !== undefined ? (signalData[selectedSymbol].bullish_percentage > 50 ? (signalData[selectedSymbol].bullish_percentage - 50).toFixed(1) : (-(50 - signalData[selectedSymbol].bullish_percentage)).toFixed(1)) : '0'}%
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {(signalData[selectedSymbol].bullish_percentage !== undefined && signalData[selectedSymbol].bullish_percentage > 50) ? 'UP' : 
                     (signalData[selectedSymbol].bullish_percentage !== undefined && signalData[selectedSymbol].bullish_percentage < 50) ? 'DOWN' : 'NEUTRAL'}
                  </p>
                  <p className="text-xs text-slate-400 mt-2 pt-2 border-t border-slate-600">
                    📊 Weighted: {signalData[selectedSymbol].bullish_percentage !== undefined ? signalData[selectedSymbol].bullish_percentage : 'N/A'}% Bullish
                  </p>
                </div>

                <div className="p-4 bg-slate-800 rounded-xl border border-slate-700">
                  <p className="text-sm text-slate-400 mb-1">Total Open Interest</p>
                  <div className="flex justify-between mt-2">
                    <div>
                      <p className="text-xs text-slate-500">CE</p>
                      <p className="text-sm font-semibold text-red-400">
                        {(signalData[selectedSymbol].total_ce_oi! / 100000).toFixed(1)}L
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">PE</p>
                      <p className="text-sm font-semibold text-green-400">
                        {(signalData[selectedSymbol].total_pe_oi! / 100000).toFixed(1)}L
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Probability Analysis */}
            {signalData[selectedSymbol].probability_bullish && (
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
                        ~{signalData[selectedSymbol].probability_bullish}%
                      </p>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-green-500 h-2 rounded-full transition-all"
                        style={{ width: `${signalData[selectedSymbol].probability_bullish}%` }}
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
                        ~{signalData[selectedSymbol].probability_range}%
                      </p>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-yellow-500 h-2 rounded-full transition-all"
                        style={{ width: `${signalData[selectedSymbol].probability_range}%` }}
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
                        ~{signalData[selectedSymbol].probability_bearish}%
                      </p>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-red-500 h-2 rounded-full transition-all"
                        style={{ width: `${signalData[selectedSymbol].probability_bearish}%` }}
                      />
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-500 mt-4 border-t border-slate-600 pt-4">
                  💡 PE OI: {(signalData[selectedSymbol].total_pe_oi! / 100000).toFixed(1)}L | CE OI: {(signalData[selectedSymbol].total_ce_oi! / 100000).toFixed(1)}L | Ratio: {(signalData[selectedSymbol].total_pe_oi! / signalData[selectedSymbol].total_ce_oi!).toFixed(2)}
                </p>
              </div>
            )}

            {/* Weighted Market Bias Analysis */}
            {signalData[selectedSymbol].bullish_percentage !== undefined && (
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
                      {signalData[selectedSymbol].bullish_percentage}%
                    </p>
                  </div>
                  <div className="p-4 bg-slate-900 rounded-lg border border-red-500/30">
                    <p className="text-sm text-slate-400 mb-2">Bearish Bias</p>
                    <p className="text-3xl font-bold text-red-400">
                      {signalData[selectedSymbol].bearish_percentage}%
                    </p>
                  </div>
                </div>

                {/* Component Scores Breakdown */}
                {signalData[selectedSymbol].component_scores && (
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
                            {signalData[selectedSymbol].component_scores?.pcr_score?.toFixed(1)}/100
                          </p>
                        </div>
                        <div className="w-full bg-slate-700 rounded-full h-2">
                          <div
                            className="bg-blue-500 h-2 rounded-full"
                            style={{ width: `${signalData[selectedSymbol].component_scores?.pcr_score}%` }}
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
                            {signalData[selectedSymbol].component_scores?.oi_score?.toFixed(1)}/100
                          </p>
                        </div>
                        <div className="w-full bg-slate-700 rounded-full h-2">
                          <div
                            className="bg-purple-500 h-2 rounded-full"
                            style={{ width: `${signalData[selectedSymbol].component_scores?.oi_score}%` }}
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
                            {signalData[selectedSymbol].component_scores?.delta_score?.toFixed(1)}/100
                          </p>
                        </div>
                        <div className="w-full bg-slate-700 rounded-full h-2">
                          <div
                            className="bg-cyan-500 h-2 rounded-full"
                            style={{ width: `${signalData[selectedSymbol].component_scores?.delta_score}%` }}
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
                            {signalData[selectedSymbol].component_scores?.price_action_score}
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
                            {signalData[selectedSymbol].component_scores?.vix_score}
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
          </>
        )}

        {/* Signals Grid */}
        {signalData[selectedSymbol] && signalData[selectedSymbol].signals.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {signalData[selectedSymbol].signals.map((signal, index) => (
              <div
                key={index}
                className="bg-slate-800 rounded-xl border border-slate-700 p-6 hover:shadow-xl hover:shadow-blue-500/10 transition-all"
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
        ) : (
          !loading && signalData[selectedSymbol] && (
            <div className="text-center py-20 text-slate-400">
              <AlertCircle className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-xl">No strong signals found (75%+ strength required)</p>
              <p className="text-sm mt-2">Only showing options with 75%+ signal strength. Try checking another symbol or wait for market conditions to improve.</p>
            </div>
          )
        )}
      </main>

      {/* Footer */}
      <footer className="mt-12 py-6 border-t border-slate-700 text-center text-slate-400 text-sm">
        <p>Live data from Zerodha • Greeks calculated using Black-Scholes model</p>
        <p className="mt-1">⚠️ For educational purposes only • Not financial advice</p>
      </footer>
    </div>
  );
}
