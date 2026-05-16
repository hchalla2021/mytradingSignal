'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, TrendingUp, TrendingDown, Target, Zap } from 'lucide-react';

/**
 * 🏗️ STRUCTURE VISUALIZATION
 * Advanced market structure, support/resistance, and supply/demand zone display
 * 
 * Features:
 * - Support and resistance level visualization
 * - Supply/demand zone identification
 * - Fractal analysis
 * - Structure break alerts
 * - Confluence point highlighting
 * - Interactive level management
 */

interface SupportResistanceLevel {
  price: number;
  strength: number;
  testCount: number;
}

interface SupplyDemandZone {
  high: number;
  low: number;
  mid: number;
  strength: number;
  confluenceCount: number;
}

interface ConfluencePoint {
  price: number;
  type: string;
  confluenceCount: number;
  sources: string[];
  strength: number;
}

interface StructureReport {
  immediateSupport?: number;
  immediateResistance?: number;
  nextSupport?: number;
  nextResistance?: number;
  supportLevels: SupportResistanceLevel[];
  resistanceLevels: SupportResistanceLevel[];
  supplyZones: SupplyDemandZone[];
  demandZones: SupplyDemandZone[];
  fractalsBullish: number;
  fractalsBearish: number;
  confluencePoints: ConfluencePoint[];
}

interface StructureVisualizationProps {
  symbol: string;
}

export const StructureVisualization: React.FC<StructureVisualizationProps> = ({ symbol }) => {
  const [structure, setStructure] = useState<StructureReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'levels' | 'zones' | 'fractals' | 'confluence'>('levels');
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStructure = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch(`/api/trend-base/structure/${symbol}`);
      if (!response.ok) throw new Error('Failed to fetch structure');
      const data = await response.json();
      setStructure(data.structure);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [symbol]);

  useEffect(() => {
    Promise.resolve(fetchStructure()).then(() => setLoading(false));
    refreshIntervalRef.current = setInterval(fetchStructure, 5000);

    return () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
    };
  }, [symbol, fetchStructure]);

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-lg border border-slate-700 p-6 animate-pulse">
        <div className="h-96 bg-slate-700 rounded"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-700 rounded-lg p-6 flex items-center gap-3">
        <AlertCircle className="w-5 h-5 text-red-400" />
        <div>
          <h3 className="font-semibold text-red-400">Error</h3>
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!structure) {
    return <div className="text-center text-slate-400 py-8">No structure data available</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Market Structure</h2>
        <p className="text-slate-400 text-sm">{symbol} • Support, Resistance & Zones</p>
      </div>

      {/* Key Levels Card */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Key Price Levels</h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-emerald-900/30 border border-emerald-700 rounded-lg p-4">
            <p className="text-emerald-400 text-xs uppercase tracking-wide mb-2">Immediate Support</p>
            <p className="text-2xl font-bold text-white">
              {structure.immediateSupport ? structure.immediateSupport.toFixed(2) : '—'}
            </p>
          </div>

          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
            <p className="text-red-400 text-xs uppercase tracking-wide mb-2">Immediate Resistance</p>
            <p className="text-2xl font-bold text-white">
              {structure.immediateResistance ? structure.immediateResistance.toFixed(2) : '—'}
            </p>
          </div>

          <div className="bg-emerald-900/30 border border-emerald-700 rounded-lg p-4">
            <p className="text-emerald-400 text-xs uppercase tracking-wide mb-2">Next Support</p>
            <p className="text-2xl font-bold text-white">
              {structure.nextSupport ? structure.nextSupport.toFixed(2) : '—'}
            </p>
          </div>

          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4">
            <p className="text-red-400 text-xs uppercase tracking-wide mb-2">Next Resistance</p>
            <p className="text-2xl font-bold text-white">
              {structure.nextResistance ? structure.nextResistance.toFixed(2) : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* View Selector */}
      <div className="flex gap-2 border-b border-slate-700">
        {(['levels', 'zones', 'fractals', 'confluence'] as const).map((view) => (
          <button
            key={view}
            onClick={() => setActiveView(view)}
            className={`px-4 py-3 font-medium text-sm uppercase tracking-wide transition border-b-2 ${
              activeView === view
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            {view === 'levels' && 'Levels'}
            {view === 'zones' && 'Zones'}
            {view === 'fractals' && 'Fractals'}
            {view === 'confluence' && 'Confluence'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
        {activeView === 'levels' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Support Levels */}
            <div>
              <h4 className="text-white font-semibold mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                Support Levels
              </h4>
              <div className="space-y-3">
                {structure.supportLevels.map((level, idx) => (
                  <div key={idx} className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-emerald-400 font-semibold">S{idx + 1}</span>
                      <span className="text-white text-lg font-bold">{level.price.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-slate-400">
                      <span>Tests: {level.testCount}</span>
                      <span>Strength: {(level.strength * 100).toFixed(0)}%</span>
                    </div>
                    <div className="mt-2 w-full bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-emerald-500 h-2 rounded-full"
                        style={{ width: `${level.strength * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Resistance Levels */}
            <div>
              <h4 className="text-white font-semibold mb-4 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-red-400" />
                Resistance Levels
              </h4>
              <div className="space-y-3">
                {structure.resistanceLevels.map((level, idx) => (
                  <div key={idx} className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-red-400 font-semibold">R{idx + 1}</span>
                      <span className="text-white text-lg font-bold">{level.price.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-slate-400">
                      <span>Tests: {level.testCount}</span>
                      <span>Strength: {(level.strength * 100).toFixed(0)}%</span>
                    </div>
                    <div className="mt-2 w-full bg-slate-700 rounded-full h-2">
                      <div
                        className="bg-red-500 h-2 rounded-full"
                        style={{ width: `${level.strength * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeView === 'zones' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Supply Zones */}
            <div>
              <h4 className="text-white font-semibold mb-4">Supply Zones</h4>
              <div className="space-y-3">
                {structure.supplyZones.length > 0 ? (
                  structure.supplyZones.map((zone, idx) => (
                    <div key={idx} className="bg-red-900/20 border border-red-700/50 rounded-lg p-4">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-red-400 font-semibold">Supply Zone {idx + 1}</span>
                        <Zap className="w-4 h-4 text-red-400" />
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-400">High:</span>
                          <span className="text-white font-semibold">{zone.high.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Mid:</span>
                          <span className="text-white font-semibold">{zone.mid.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Low:</span>
                          <span className="text-white font-semibold">{zone.low.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-red-700/30">
                          <span className="text-slate-400">Confluence:</span>
                          <span className="text-red-400 font-semibold">{zone.confluenceCount}</span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-slate-400 text-center py-4">No supply zones identified</p>
                )}
              </div>
            </div>

            {/* Demand Zones */}
            <div>
              <h4 className="text-white font-semibold mb-4">Demand Zones</h4>
              <div className="space-y-3">
                {structure.demandZones.length > 0 ? (
                  structure.demandZones.map((zone, idx) => (
                    <div key={idx} className="bg-emerald-900/20 border border-emerald-700/50 rounded-lg p-4">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-emerald-400 font-semibold">Demand Zone {idx + 1}</span>
                        <Zap className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-400">High:</span>
                          <span className="text-white font-semibold">{zone.high.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Mid:</span>
                          <span className="text-white font-semibold">{zone.mid.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Low:</span>
                          <span className="text-white font-semibold">{zone.low.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-emerald-700/30">
                          <span className="text-slate-400">Confluence:</span>
                          <span className="text-emerald-400 font-semibold">{zone.confluenceCount}</span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-slate-400 text-center py-4">No demand zones identified</p>
                )}
              </div>
            </div>
          </div>
        )}

        {activeView === 'fractals' && (
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-emerald-900/20 border border-emerald-700 rounded-lg p-6">
              <p className="text-emerald-400 text-xs uppercase tracking-wide mb-3">Bullish Fractals</p>
              <p className="text-5xl font-bold text-emerald-400">{structure.fractalsBullish}</p>
              <p className="text-slate-400 text-sm mt-2">5-bar bullish patterns detected</p>
            </div>

            <div className="bg-red-900/20 border border-red-700 rounded-lg p-6">
              <p className="text-red-400 text-xs uppercase tracking-wide mb-3">Bearish Fractals</p>
              <p className="text-5xl font-bold text-red-400">{structure.fractalsBearish}</p>
              <p className="text-slate-400 text-sm mt-2">5-bar bearish patterns detected</p>
            </div>
          </div>
        )}

        {activeView === 'confluence' && (
          <div className="space-y-3">
            {structure.confluencePoints.length > 0 ? (
              structure.confluencePoints.map((point, idx) => (
                <div key={idx} className="bg-slate-700/50 border border-slate-600 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white font-semibold">{point.price.toFixed(2)}</span>
                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4 text-amber-400" />
                      <span className="text-amber-400 font-semibold">+{point.confluenceCount}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {point.sources.map((source, sidx) => (
                      <span
                        key={sidx}
                        className="inline-block bg-slate-600/50 text-slate-300 text-xs px-3 py-1 rounded-full"
                      >
                        {source}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-center text-slate-400 py-8">No confluence points identified</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default StructureVisualization;
