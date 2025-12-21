'use client';

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import axios from 'axios';
import { TrendingUp, TrendingDown, Activity, RefreshCw, Filter, X } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

// ⚡ PERFORMANCE: Axios instance with optimized config
const api = axios.create({
  baseURL: API_URL,
  timeout: 5000,
  headers: {
    'Content-Type': 'application/json',
  },
});

interface StockData {
  symbol: string;
  ltp: number;
  change: number;
  change_percent: number;
  volume: number;
  avg_volume: number;
  volume_spike: boolean;
  oi: number;
  oi_change: number;
  oi_change_percent: number;
  iv: number;
  sector: string;
  liquid: boolean;
  oi_classification: 'LONG_BUILDUP' | 'SHORT_COVERING' | 'LONG_UNWINDING' | 'SHORT_BUILDUP' | 'NEUTRAL';
  market_stress_score: number;
  color: string;
  ai_prediction?: {
    direction: string;
    predicted_move: number;
    confidence: number;
    big_player: boolean;
    action: string;
    win_probability: number;
    time_to_move: string;
    key_reasons: string[];
  };
}

interface HeatmapData {
  stocks: StockData[];
  timestamp: string;
  market_summary: {
    total_stocks: number;
    bullish_count: number;
    bearish_count: number;
    neutral_count: number;
    avg_volume_spike: number;
  };
}

// ⚡ PERFORMANCE: Frozen constant objects for zero re-creation
const OI_LABELS = Object.freeze({
  'LONG_BUILDUP': Object.freeze({ label: 'LB', color: 'bg-green-600', tooltip: 'Long Buildup: Price↑ OI↑' }),
  'SHORT_COVERING': Object.freeze({ label: 'SC', color: 'bg-emerald-500', tooltip: 'Short Covering: Price↑ OI↓' }),
  'LONG_UNWINDING': Object.freeze({ label: 'LU', color: 'bg-red-400', tooltip: 'Long Unwinding: Price↓ OI↓' }),
  'SHORT_BUILDUP': Object.freeze({ label: 'SB', color: 'bg-red-600', tooltip: 'Short Buildup: Price↓ OI↑' }),
  'NEUTRAL': Object.freeze({ label: 'N', color: 'bg-gray-500', tooltip: 'Neutral: No clear pattern' })
});

const COLOR_CLASSES = Object.freeze({
  'dark-green': 'bg-green-600 text-white border-green-400',
  'green': 'bg-green-500 text-white border-green-300',
  'light-green': 'bg-green-400 text-white border-green-200',
  'gray': 'bg-gray-700 text-white border-gray-500',
  'light-red': 'bg-red-400 text-white border-red-200',
  'red': 'bg-red-500 text-white border-red-300',
  'dark-red': 'bg-red-600 text-white border-red-400'
});

// ⚡ PERFORMANCE: Memoized Stock Tile Component
const StockTile = memo(({ stock, oiInfo, hasAI, isBigPlayer, getColorClass }: any) => (
  <div
    className={`relative p-3 rounded-lg border-2 transition-all duration-300 hover:scale-105 cursor-pointer ${getColorClass(stock.change_percent, stock.market_stress_score)} ${isBigPlayer ? 'ring-2 ring-yellow-400 shadow-lg shadow-yellow-400/50' : ''}`}
    title={`${stock.symbol}\nLTP: ₹${stock.ltp}\nChange: ${stock.change_percent.toFixed(2)}%\nVolume: ${(stock.volume / 1000).toFixed(0)}K\nOI Change: ${stock.oi_change_percent.toFixed(1)}%\n${oiInfo.tooltip}${hasAI ? `\n\n🤖 AI: ${stock.ai_prediction!.action} (${stock.ai_prediction!.confidence}% confidence)\n${stock.ai_prediction!.key_reasons.join(', ')}` : ''}`}
  >
    {isBigPlayer && (
      <div className="absolute -top-1 -left-1 bg-yellow-500 text-black text-[8px] px-1.5 py-0.5 rounded-full font-black animate-pulse shadow-lg">
        💰 BIG
      </div>
    )}
    <div className={`absolute top-1 right-1 ${oiInfo.color} text-[8px] px-1.5 py-0.5 rounded font-bold`}>
      {oiInfo.label}
    </div>
    {stock.volume_spike && (
      <div className="absolute top-1 left-1 bg-orange-500 text-white text-[8px] px-1.5 py-0.5 rounded font-bold">
        🔥
      </div>
    )}
    <div className="text-sm font-bold mb-1">{stock.symbol}</div>
    <div className="text-lg font-black">₹{stock.ltp.toFixed(1)}</div>
    <div className="text-xs font-semibold flex items-center gap-1">
      {stock.change_percent > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {stock.change_percent > 0 ? '+' : ''}{stock.change_percent.toFixed(2)}%
    </div>
    <div className="text-[10px] opacity-75 mt-1">
      Vol: {(stock.volume / 1000).toFixed(0)}K
    </div>
    {hasAI && (
      <div className="mt-2 p-1.5 bg-black/40 rounded border border-yellow-500/30">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[9px] text-yellow-400 font-bold">🤖 AI</span>
          <span className="text-white/60">({stock.ai_prediction!.confidence}%)</span>
        </div>
        {stock.ai_prediction!.time_to_move !== 'WAIT' && (
          <div className="text-[8px] text-yellow-200 font-semibold mt-0.5">
            ⏰ {stock.ai_prediction!.time_to_move}
          </div>
        )}
      </div>
    )}
  </div>
), (prevProps, nextProps) => {
  // ⚡ PERFORMANCE: Custom comparison - only re-render if relevant props change
  return prevProps.stock.ltp === nextProps.stock.ltp &&
         prevProps.stock.change_percent === nextProps.stock.change_percent &&
         prevProps.hasAI === nextProps.hasAI;
});

export default function StocksHeatmap() {
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  
  // Filters
  const [selectedSector, setSelectedSector] = useState('ALL');
  const [volumeSpikeOnly, setVolumeSpikeOnly] = useState(false);
  const [liquidOnly, setLiquidOnly] = useState(true);
  const [selectedOI, setSelectedOI] = useState<string[]>([]);
  const [minIV, setMinIV] = useState(10);
  const [maxIV] = useState(50);

  // ⚡ PERFORMANCE: Frozen array prevents re-creation
  const sectors = useMemo(() => ['ALL', 'IT', 'BANK', 'AUTO', 'PHARMA', 'FMCG', 'METAL', 'ENERGY', 'REALTY'], []);

  // ⚡ PERFORMANCE: Optimized fetch with abort controller for cleanup
  const fetchHeatmapData = useCallback(async () => {
    const controller = new AbortController();
    try {
      const response = await api.get('/api/heatmap/stocks', {
        params: {
          sector: selectedSector,
          volume_spike_only: volumeSpikeOnly,
          liquid_only: liquidOnly,
          oi_types: selectedOI.length > 0 ? selectedOI.join(',') : undefined,
          min_iv: minIV,
          max_iv: maxIV
        },
        signal: controller.signal
      });
      setHeatmapData(response.data);
      setLastUpdate(new Date());
      setLoading(false);
    } catch (err: any) {
      if (err.name !== 'CanceledError') {
        console.error('Failed to fetch heatmap data:', err);
        setLoading(false);
      }
    }
    return () => controller.abort();
  }, [selectedSector, volumeSpikeOnly, liquidOnly, selectedOI, minIV, maxIV]);

  // ⚡ PERFORMANCE: Memoized color lookup for zero computation
  const getColorClass = useCallback((changePercent: number, score: number) => {
    if (changePercent > 2) return COLOR_CLASSES['dark-green'];
    if (changePercent > 1) return COLOR_CLASSES['green'];
    if (changePercent > 0.2) return COLOR_CLASSES['light-green'];
    if (changePercent > -0.2) return COLOR_CLASSES['gray'];
    if (changePercent > -1) return COLOR_CLASSES['light-red'];
    if (changePercent > -2) return COLOR_CLASSES['red'];
    return COLOR_CLASSES['dark-red'];
  }, []);

  // ⚡ PERFORMANCE: Memoized filtered stocks - only recompute when data changes
  const filteredStocks = useMemo(() => heatmapData?.stocks || [], [heatmapData]);

  useEffect(() => {
    fetchHeatmapData();
  }, [fetchHeatmapData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchHeatmapData, 5000); // 5 second refresh
    return () => clearInterval(interval);
  }, [autoRefresh, fetchHeatmapData]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 text-white">
      {/* Header */}
      <header className="bg-slate-900/80 border-b-2 border-indigo-500/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Activity className="w-8 h-8 text-cyan-400" />
              <div>
                <h1 className="text-2xl font-black bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 bg-clip-text text-transparent">
                  Live Stock Heatmap
                </h1>
                <p className="text-xs text-slate-400">
                  {filteredStocks.length} stocks • Updated {lastUpdate?.toLocaleTimeString() || '...'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors flex items-center gap-2"
              >
                <Filter className="w-4 h-4" />
                Filters
              </button>
              
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                  autoRefresh ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'
                }`}
              >
                <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} />
                Auto: {autoRefresh ? 'ON' : 'OFF'}
              </button>

              <button
                onClick={() => window.location.href = '/'}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
              >
                ← Back
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Filters Panel */}
      {showFilters && (
        <div className="bg-slate-800 border-b border-slate-700 p-4">
          <div className="container mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Filters</h3>
              <button onClick={() => setShowFilters(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Sector Filter */}
              <div>
                <label className="block text-sm font-medium mb-2">Sector</label>
                <select
                  value={selectedSector}
                  onChange={(e) => setSelectedSector(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg"
                >
                  {sectors.map(sector => (
                    <option key={sector} value={sector}>{sector}</option>
                  ))}
                </select>
              </div>

              {/* OI Classification */}
              <div>
                <label className="block text-sm font-medium mb-2">OI Action</label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(OI_LABELS).map(([key, { label, color }]) => (
                    <button
                      key={key}
                      onClick={() => {
                        setSelectedOI(prev =>
                          prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
                        );
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-bold ${
                        selectedOI.includes(key) ? color : 'bg-slate-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Toggles */}
              <div>
                <label className="block text-sm font-medium mb-2">Options</label>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={volumeSpikeOnly}
                      onChange={(e) => setVolumeSpikeOnly(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Volume Spike Only</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={liquidOnly}
                      onChange={(e) => setLiquidOnly(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">Liquid Only</span>
                  </label>
                </div>
              </div>

              {/* IV Range */}
              <div className="col-span-full">
                <label className="block text-sm font-medium mb-2">
                  IV Range: {minIV}% - {maxIV}%
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={minIV}
                    onChange={(e) => setMinIV(parseInt(e.target.value))}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stocks Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
          {filteredStocks.map((stock) => {
            const oiInfo = OI_LABELS[stock.oi_classification];
            const hasAI = stock.ai_prediction && stock.ai_prediction.confidence > 60;
            const isBigPlayer = hasAI && stock.ai_prediction!.big_player;
            
            return (
              <StockTile
                key={stock.symbol}
                stock={stock}
                oiInfo={oiInfo}
                hasAI={hasAI}
                isBigPlayer={isBigPlayer}
                getColorClass={getColorClass}
              />
            );
          })}
        </div>
      )}

      {!loading && filteredStocks.length === 0 && (
        <div className="text-center py-20">
          <p className="text-slate-400">No stocks match your filters</p>
        </div>
      )}

      {/* Legend */}
      <footer className="fixed bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-700 p-3">
        <div className="container mx-auto">
          <div className="flex items-center justify-between text-xs mb-2">
            <div className="flex items-center gap-4">
              <span className="font-bold">OI Actions:</span>
              {Object.entries(OI_LABELS).map(([key, { label, color, tooltip }]) => (
                <div key={key} className="flex items-center gap-1" title={tooltip}>
                  <div className={`${color} w-4 h-4 rounded text-[8px] flex items-center justify-center font-bold`}>
                    {label}
                  </div>
                  <span className="text-slate-400 hidden md:inline">{tooltip.split(':')[0]}</span>
                </div>
              ))}
            </div>
            <div className="text-slate-400">
              Updates every 5 seconds
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span>🔥 = Volume Spike</span>
            <span className="text-yellow-300">💰 BIG = Big Player Detected (AI)</span>
            <span className="text-yellow-300">🤖 = AI Prediction Active</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
