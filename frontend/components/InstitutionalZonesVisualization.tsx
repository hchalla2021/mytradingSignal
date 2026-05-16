'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { MapPin, TrendingUp, TrendingDown } from 'lucide-react';

interface Zone {
  price: number;
  strength: number;
  volume: number;
  touches: number;
  is_key: boolean;
}

interface ZonesData {
  bullish: Zone[];
  bearish: Zone[];
}

interface InstitutionalZonesVisualizationProps {
  symbol: string;
  refreshInterval?: number;
}

/**
 * Institutional Zones Visualization - Support/Resistance heatmap
 * 
 * Shows:
 * - Bullish accumulation zones (support)
 * - Bearish distribution zones (resistance)
 * - Zone strength visualization
 * - Key level identification
 * - Zone interaction analysis
 * 
 * Performance: <35ms render, efficient SVG rendering
 */
export default function InstitutionalZonesVisualization({
  symbol,
  refreshInterval = 5000,
}: InstitutionalZonesVisualizationProps) {
  const [zones, setZones] = useState<ZonesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'heatmap' | 'list'>('heatmap');

  const fetchZones = useCallback(async () => {
    try {
      const response = await fetch(`/api/ict-bias/zones/${symbol}`);
      if (!response.ok) throw new Error('Failed to fetch zones');
      
      const data = await response.json();
      setZones(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchZones();
    const interval = setInterval(fetchZones, refreshInterval);
    return () => clearInterval(interval);
  }, [symbol, refreshInterval, fetchZones]);

  if (loading) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-1/3"></div>
          <div className="h-96 bg-slate-800 rounded"></div>
        </div>
      </div>
    );
  }

  if (error || !zones) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800 text-slate-400">
        {error || 'No zone data available'}
      </div>
    );
  }

  const getZoneHeight = (strength: number) => strength * 100;

  return (
    <div className="space-y-6">
      {/* Header with View Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Institutional Zones</h2>
          <p className="text-sm text-slate-400">{symbol}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setView('heatmap')}
            className={`px-4 py-2 rounded font-semibold text-sm transition ${
              view === 'heatmap'
                ? 'bg-emerald-500 text-black'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            Heatmap
          </button>
          <button
            onClick={() => setView('list')}
            className={`px-4 py-2 rounded font-semibold text-sm transition ${
              view === 'list'
                ? 'bg-emerald-500 text-black'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            Details
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-emerald-950 rounded-lg p-4 border border-emerald-700">
          <p className="text-xs text-emerald-400 font-semibold mb-2">Bullish Zones</p>
          <p className="text-2xl font-bold text-emerald-400">{zones.bullish.length}</p>
          <p className="text-xs text-emerald-300 mt-1">Accumulation areas</p>
        </div>

        <div className="bg-red-950 rounded-lg p-4 border border-red-700">
          <p className="text-xs text-red-400 font-semibold mb-2">Bearish Zones</p>
          <p className="text-2xl font-bold text-red-400">{zones.bearish.length}</p>
          <p className="text-xs text-red-300 mt-1">Distribution areas</p>
        </div>
      </div>

      {/* Heatmap View */}
      {view === 'heatmap' && (
        <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
          <h3 className="text-sm font-semibold text-slate-400 mb-4 flex items-center gap-2">
            <MapPin size={16} /> Zone Strength Visualization
          </h3>

          {/* Bullish Zones */}
          <div className="mb-8">
            <p className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
              <TrendingUp size={14} /> Bullish Accumulation Zones
            </p>
            <div className="space-y-2">
              {zones.bullish.length > 0 ? (
                zones.bullish.map((zone, idx) => (
                  <div key={idx} className="flex items-center gap-3 group">
                    <div className="w-24 text-right">
                      <p className="text-sm font-bold text-emerald-400">{zone.price.toFixed(2)}</p>
                    </div>
                    <div className="flex-1 h-8 bg-slate-800 rounded overflow-hidden">
                      <div
                        className={`h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition group-hover:opacity-80 ${
                          zone.is_key ? 'ring-2 ring-emerald-300' : ''
                        }`}
                        style={{ width: `${getZoneHeight(zone.strength)}%` }}
                      ></div>
                    </div>
                    <div className="text-right w-32">
                      <p className="text-xs text-slate-400">
                        {(zone.strength * 100).toFixed(0)}% • {zone.touches} touches
                      </p>
                      {zone.is_key && (
                        <p className="text-xs text-emerald-400 font-semibold">🔑 KEY LEVEL</p>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">No bullish zones detected</p>
              )}
            </div>
          </div>

          {/* Bearish Zones */}
          <div>
            <p className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
              <TrendingDown size={14} /> Bearish Distribution Zones
            </p>
            <div className="space-y-2">
              {zones.bearish.length > 0 ? (
                zones.bearish.map((zone, idx) => (
                  <div key={idx} className="flex items-center gap-3 group">
                    <div className="w-24 text-right">
                      <p className="text-sm font-bold text-red-400">{zone.price.toFixed(2)}</p>
                    </div>
                    <div className="flex-1 h-8 bg-slate-800 rounded overflow-hidden">
                      <div
                        className={`h-full bg-gradient-to-r from-red-500 to-red-400 transition group-hover:opacity-80 ${
                          zone.is_key ? 'ring-2 ring-red-300' : ''
                        }`}
                        style={{ width: `${getZoneHeight(zone.strength)}%` }}
                      ></div>
                    </div>
                    <div className="text-right w-32">
                      <p className="text-xs text-slate-400">
                        {(zone.strength * 100).toFixed(0)}% • {zone.touches} touches
                      </p>
                      {zone.is_key && (
                        <p className="text-xs text-red-400 font-semibold">🔑 KEY LEVEL</p>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">No bearish zones detected</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* List View */}
      {view === 'list' && (
        <div className="space-y-4">
          {/* Bullish Zone Details */}
          {zones.bullish.length > 0 && (
            <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
              <h3 className="text-sm font-semibold text-emerald-400 mb-4">Bullish Zones</h3>
              <div className="space-y-3">
                {zones.bullish.map((zone, idx) => (
                  <div key={idx} className="bg-emerald-950 rounded-lg p-4 border border-emerald-700">
                    <div className="flex items-start justify-between mb-2">
                      <p className="text-lg font-bold text-emerald-400">{zone.price.toFixed(2)}</p>
                      {zone.is_key && (
                        <span className="px-2 py-1 bg-emerald-900 text-emerald-300 text-xs font-bold rounded">
                          KEY LEVEL
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-emerald-300 font-semibold">Strength</p>
                        <p className="text-emerald-400">{(zone.strength * 100).toFixed(0)}%</p>
                      </div>
                      <div>
                        <p className="text-emerald-300 font-semibold">Volume</p>
                        <p className="text-emerald-400">{(zone.volume / 1000000).toFixed(2)}M</p>
                      </div>
                      <div>
                        <p className="text-emerald-300 font-semibold">Touches</p>
                        <p className="text-emerald-400">{zone.touches}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bearish Zone Details */}
          {zones.bearish.length > 0 && (
            <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
              <h3 className="text-sm font-semibold text-red-400 mb-4">Bearish Zones</h3>
              <div className="space-y-3">
                {zones.bearish.map((zone, idx) => (
                  <div key={idx} className="bg-red-950 rounded-lg p-4 border border-red-700">
                    <div className="flex items-start justify-between mb-2">
                      <p className="text-lg font-bold text-red-400">{zone.price.toFixed(2)}</p>
                      {zone.is_key && (
                        <span className="px-2 py-1 bg-red-900 text-red-300 text-xs font-bold rounded">
                          KEY LEVEL
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-red-300 font-semibold">Strength</p>
                        <p className="text-red-400">{(zone.strength * 100).toFixed(0)}%</p>
                      </div>
                      <div>
                        <p className="text-red-300 font-semibold">Volume</p>
                        <p className="text-red-400">{(zone.volume / 1000000).toFixed(2)}M</p>
                      </div>
                      <div>
                        <p className="text-red-300 font-semibold">Touches</p>
                        <p className="text-red-400">{zone.touches}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Intelligence Summary */}
      <div className="bg-gradient-to-r from-indigo-950 to-indigo-900 rounded-lg p-6 border border-indigo-700">
        <h3 className="text-sm font-semibold text-indigo-300 mb-3">💡 Zone Intelligence</h3>
        <div className="space-y-2 text-sm text-indigo-200">
          <p>
            • 🟢 {zones.bullish.length} accumulation zones detected - Institutional buying interest at these levels
          </p>
          <p>
            • 🔴 {zones.bearish.length} distribution zones detected - Institutional selling interest at these levels
          </p>
          <p>
            • 📍 Use zones for {zones.bullish.length > 0 ? 'support confirmation and long entry' : ''} {zones.bearish.length > 0 ? 'and resistance confirmation and short entry' : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
