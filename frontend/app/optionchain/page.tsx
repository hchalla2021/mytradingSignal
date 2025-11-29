'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import { TrendingUp, TrendingDown, Activity, RefreshCw, AlertCircle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7777';

interface OptionData {
  ltp: number;
  change: number;
  change_percent: number;
  volume: number;
  oi: number;
  oi_change: number;
  iv: number;
  bid: number;
  ask: number;
  signal: string;
  score: number;
  tradingsymbol: string;
  greeks: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  };
}

interface StrikeData {
  strike: number;
  CE?: OptionData;
  PE?: OptionData;
}

interface OptionChainData {
  symbol: string;
  spot_price: number;
  atm_strike: number;
  pcr: number;
  market_direction: string;
  total_ce_oi: number;
  total_pe_oi: number;
  option_chain: StrikeData[];
  timestamp: string;
}

export default function OptionChainPage() {
  const [selectedSymbol, setSelectedSymbol] = useState<'NIFTY' | 'BANKNIFTY' | 'SENSEX'>('NIFTY');
  const [chainData, setChainData] = useState<Record<string, OptionChainData>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [useTestData, setUseTestData] = useState(false);

  const generateTestOptionChain = (symbol: string): OptionChainData => {
    const spotPrices: Record<string, number> = {
      'NIFTY': 25959,
      'BANKNIFTY': 51500,
      'SENSEX': 81500
    };
    const spot = spotPrices[symbol] || 25959;
    const atmStrike = Math.round(spot / 100) * 100;
    
    const generateStrikeData = (strike: number): StrikeData => ({
      strike,
      CE: {
        ltp: Math.max(strike - atmStrike, 10) * 0.5,
        change: Math.random() * 20 - 10,
        change_percent: Math.random() * 10 - 5,
        volume: Math.floor(Math.random() * 100000),
        oi: Math.floor(Math.random() * 500000),
        oi_change: Math.floor(Math.random() * 50000),
        iv: 15 + Math.random() * 10,
        bid: Math.max(strike - atmStrike, 10) * 0.45,
        ask: Math.max(strike - atmStrike, 10) * 0.55,
        signal: Math.random() > 0.5 ? 'BUY' : 'SELL',
        score: Math.floor(Math.random() * 100),
        tradingsymbol: `${symbol}${atmStrike}CE`,
        greeks: {
          delta: Math.random() * 0.8,
          gamma: Math.random() * 0.05,
          theta: -Math.random() * 0.5,
          vega: Math.random() * 5
        }
      },
      PE: {
        ltp: Math.max(atmStrike - strike, 10) * 0.5,
        change: Math.random() * 20 - 10,
        change_percent: Math.random() * 10 - 5,
        volume: Math.floor(Math.random() * 100000),
        oi: Math.floor(Math.random() * 500000),
        oi_change: Math.floor(Math.random() * 50000),
        iv: 15 + Math.random() * 10,
        bid: Math.max(atmStrike - strike, 10) * 0.45,
        ask: Math.max(atmStrike - strike, 10) * 0.55,
        signal: Math.random() > 0.5 ? 'BUY' : 'SELL',
        score: Math.floor(Math.random() * 100),
        tradingsymbol: `${symbol}${atmStrike}PE`,
        greeks: {
          delta: -Math.random() * 0.8,
          gamma: Math.random() * 0.05,
          theta: -Math.random() * 0.5,
          vega: Math.random() * 5
        }
      }
    });

    const optionChain: StrikeData[] = [];
    for (let i = atmStrike - 500; i <= atmStrike + 500; i += 100) {
      optionChain.push(generateStrikeData(i));
    }

    return {
      symbol,
      spot_price: spot,
      atm_strike: atmStrike,
      pcr: 1.2,
      market_direction: 'BULLISH',
      total_ce_oi: 5000000,
      total_pe_oi: 6000000,
      option_chain: optionChain,
      timestamp: new Date().toISOString()
    };
  };

  const loadTestOptionChain = () => {
    console.log('Loading test option chain data');
    setUseTestData(true);
    setAutoRefresh(false); // Disable auto-refresh for test data
    setChainData({
      'NIFTY': generateTestOptionChain('NIFTY'),
      'BANKNIFTY': generateTestOptionChain('BANKNIFTY'),
      'SENSEX': generateTestOptionChain('SENSEX')
    });
    setError(null);
  };

  const fetchOptionChain = async (symbol: string, showLoading = true) => {
    if (useTestData) return; // Skip if using test data
    if (showLoading) setLoading(true);
    setError(null);
    
    try {
      console.log(`[FETCH] Fetching ${symbol} option chain data...`);
      const response = await axios.get(`${API_URL}/api/optionchain/${symbol}`, {
        timeout: 15000,
      });
      
      console.log(`[FETCH] ${symbol} option chain data received:`, response.data);
      setChainData(prev => ({
        ...prev,
        [symbol]: response.data
      }));
      setError(null);
    } catch (err: any) {
      console.error(`[ERROR] Error fetching ${symbol} option chain:`, err);
      if (showLoading) {
        setError(err.response?.data?.detail || 'Failed to fetch option chain data');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Fetch live data on mount for the selected symbol
    if (!useTestData) {
      fetchOptionChain(selectedSymbol);
    }
  }, []);

  useEffect(() => {
    if (!chainData[selectedSymbol]) {
      fetchOptionChain(selectedSymbol);
    }
  }, [selectedSymbol]);

  useEffect(() => {
    if (!autoRefresh || useTestData) return;
    
    const interval = setInterval(() => {
      fetchOptionChain(selectedSymbol, false);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [autoRefresh, selectedSymbol, useTestData]);

  const getSignalColor = (signal: string, score: number) => {
    if (signal === 'STRONG BUY' && score >= 85) return 'bg-green-600 text-white font-bold';
    if (signal === 'STRONG BUY' && score >= 75) return 'bg-green-500 text-white';
    if (signal === 'BUY') return 'bg-green-400 text-white';
    return 'bg-gray-700 text-gray-400';
  };

  const currentData = chainData[selectedSymbol];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-800/50 border-b border-slate-700 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="w-8 h-8 text-blue-400" />
              <h1 className="text-2xl font-bold">Live Option Chain</h1>
              {!useTestData && autoRefresh && (
                <span className="flex items-center gap-2 text-xs bg-green-600 px-3 py-1 rounded-full">
                  <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                  LIVE (1s)
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-3">
              <button
                onClick={loadTestOptionChain}
                className="px-4 py-2 rounded-lg bg-yellow-600 hover:bg-yellow-700 transition-colors"
              >
                Load Test Data
              </button>
              <button
                onClick={() => {
                  setUseTestData(false);
                  fetchOptionChain(selectedSymbol);
                }}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors"
              >
                Load Live Data
              </button>
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  autoRefresh ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'
                }`}
              >
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
              onClick={() => setSelectedSymbol(symbol)}
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
        {loading && !currentData && (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />
          </div>
        )}

        {/* Market Info & PCR */}
        {currentData && (
          <>
            <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="p-4 bg-slate-800 rounded-xl border border-slate-700">
                <p className="text-sm text-slate-400 mb-1">Spot Price</p>
                <p className="text-2xl font-bold text-blue-400">₹{currentData.spot_price.toFixed(2)}</p>
              </div>

              <div className="p-4 bg-slate-800 rounded-xl border border-slate-700">
                <p className="text-sm text-slate-400 mb-1">PCR</p>
                <p className={`text-2xl font-bold ${
                  currentData.pcr > 1.2 ? 'text-green-500' : 
                  currentData.pcr < 0.8 ? 'text-red-500' : 'text-yellow-500'
                }`}>
                  {currentData.pcr.toFixed(2)}
                </p>
              </div>

              <div className="p-4 bg-slate-800 rounded-xl border border-slate-700">
                <p className="text-sm text-slate-400 mb-1">Market Direction</p>
                <p className={`text-sm font-bold ${
                  currentData.market_direction.includes('BULLISH') ? 'text-green-500' : 
                  currentData.market_direction.includes('BEARISH') ? 'text-red-500' : 'text-yellow-500'
                }`}>
                  {currentData.market_direction}
                </p>
              </div>

              <div className="p-4 bg-slate-800 rounded-xl border border-slate-700">
                <p className="text-sm text-slate-400 mb-1">Last Update</p>
                <p className="text-sm">{new Date(currentData.timestamp).toLocaleTimeString()}</p>
              </div>
            </div>

            {/* Option Chain Table */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-900">
                    <tr>
                      {/* Call Side Headers */}
                      <th className="px-3 py-3 text-xs text-left text-slate-400 border-r border-slate-700">Signal</th>
                      <th className="px-3 py-3 text-xs text-right text-slate-400">OI</th>
                      <th className="px-3 py-3 text-xs text-right text-slate-400">Volume</th>
                      <th className="px-3 py-3 text-xs text-right text-slate-400">LTP</th>
                      <th className="px-3 py-3 text-xs text-right text-slate-400 border-r border-slate-700">Delta</th>
                      
                      {/* Strike */}
                      <th className="px-4 py-3 text-sm font-bold text-center bg-blue-900 text-white">STRIKE</th>
                      
                      {/* Put Side Headers */}
                      <th className="px-3 py-3 text-xs text-left text-slate-400 border-l border-slate-700">Delta</th>
                      <th className="px-3 py-3 text-xs text-left text-slate-400">LTP</th>
                      <th className="px-3 py-3 text-xs text-left text-slate-400">Volume</th>
                      <th className="px-3 py-3 text-xs text-left text-slate-400">OI</th>
                      <th className="px-3 py-3 text-xs text-right text-slate-400 border-l border-slate-700">Signal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentData.option_chain.map((strike) => {
                      const isATM = strike.strike === currentData.atm_strike;
                      return (
                        <tr 
                          key={strike.strike} 
                          className={`border-b border-slate-700 hover:bg-slate-700/50 ${
                            isATM ? 'bg-blue-900/20' : ''
                          }`}
                        >
                          {/* Call Side */}
                          {strike.CE ? (
                            <>
                              <td className="px-3 py-2 border-r border-slate-700">
                                <span className={`text-xs px-2 py-1 rounded ${getSignalColor(strike.CE.signal, strike.CE.score)}`}>
                                  {strike.CE.signal === 'STRONG BUY' ? `BUY ${strike.CE.score}` : ''}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-sm text-right text-green-400">
                                {(strike.CE.oi / 1000).toFixed(0)}K
                              </td>
                              <td className="px-3 py-2 text-sm text-right">
                                {(strike.CE.volume / 1000).toFixed(0)}K
                              </td>
                              <td className="px-3 py-2 text-sm text-right font-semibold">
                                ₹{strike.CE.ltp.toFixed(2)}
                              </td>
                              <td className="px-3 py-2 text-sm text-right text-slate-400 border-r border-slate-700">
                                {strike.CE.greeks.delta.toFixed(2)}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-2 border-r border-slate-700"></td>
                              <td className="px-3 py-2"></td>
                              <td className="px-3 py-2"></td>
                              <td className="px-3 py-2"></td>
                              <td className="px-3 py-2 border-r border-slate-700"></td>
                            </>
                          )}

                          {/* Strike Price */}
                          <td className={`px-4 py-2 text-center font-bold ${
                            isATM ? 'bg-blue-900 text-white' : 'bg-slate-900'
                          }`}>
                            {strike.strike}
                          </td>

                          {/* Put Side */}
                          {strike.PE ? (
                            <>
                              <td className="px-3 py-2 text-sm text-left text-slate-400 border-l border-slate-700">
                                {strike.PE.greeks.delta.toFixed(2)}
                              </td>
                              <td className="px-3 py-2 text-sm text-left font-semibold">
                                ₹{strike.PE.ltp.toFixed(2)}
                              </td>
                              <td className="px-3 py-2 text-sm text-left">
                                {(strike.PE.volume / 1000).toFixed(0)}K
                              </td>
                              <td className="px-3 py-2 text-sm text-left text-red-400">
                                {(strike.PE.oi / 1000).toFixed(0)}K
                              </td>
                              <td className="px-3 py-2 text-right border-l border-slate-700">
                                <span className={`text-xs px-2 py-1 rounded ${getSignalColor(strike.PE.signal, strike.PE.score)}`}>
                                  {strike.PE.signal === 'STRONG BUY' ? `BUY ${strike.PE.score}` : ''}
                                </span>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-2 border-l border-slate-700"></td>
                              <td className="px-3 py-2"></td>
                              <td className="px-3 py-2"></td>
                              <td className="px-3 py-2"></td>
                              <td className="px-3 py-2 border-l border-slate-700"></td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Legend */}
            <div className="mt-4 p-4 bg-slate-800 rounded-lg border border-slate-700">
              <div className="flex items-center gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-600 rounded"></div>
                  <span className="text-slate-400">Strong Buy Signal (85+)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded"></div>
                  <span className="text-slate-400">Buy Signal (75-84)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-blue-900 rounded"></div>
                  <span className="text-slate-400">ATM Strike</span>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
