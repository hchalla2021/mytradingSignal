'use client';

import React, { useMemo } from 'react';
import { useChartPOI } from '@/hooks/useChartPOI';
import { useMarketSocket } from '@/hooks/useMarketSocket';
import { POILegend } from '@/components/POILegend';

/**
 * PRACTICAL EXAMPLE: Integrated Chart with Real-Time POI
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This example shows how to integrate the POI system into an existing chart component.
 * Copy this pattern to your own chart implementation.
 */

interface ChartWithPOIProps {
  symbol: 'NIFTY' | 'BANKNIFTY' | 'SENSEX';
  onPOIProximity?: (poi: any) => void;
}

export function ChartWithPOI({ symbol, onPOIProximity }: ChartWithPOIProps) {
  // ────────────────────────────────────────────────────────────────────────────
  // 1. FETCH REAL-TIME POI DATA
  // ────────────────────────────────────────────────────────────────────────────
  const poi = useChartPOI(symbol, true);
  
  // ────────────────────────────────────────────────────────────────────────────
  // 2. GET CURRENT PRICE FROM WEBSOCKET
  // ────────────────────────────────────────────────────────────────────────────
  const { marketData } = useMarketSocket();
  const currentPrice = useMemo(
    () => marketData[symbol]?.price ?? 0,
    [marketData, symbol]
  );

  // ────────────────────────────────────────────────────────────────────────────
  // 3. DETECT PROXIMITY TO ANY POI
  // ────────────────────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (poi.data?.closest_poi && onPOIProximity) {
      // Check if within 0.5% of POI
      if (poi.isNearPOI(0.005)) {
        onPOIProximity(poi.data.closest_poi);
      }
    }
  }, [poi, onPOIProximity]);

  // ────────────────────────────────────────────────────────────────────────────
  // 4. RENDER LAYOUT
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex gap-6 h-full bg-[#0a0e1a] rounded-lg border border-slate-700/30 overflow-hidden">
      
      {/* LEFT: CHART AREA (70%) */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar: Symbol Info + Live Status */}
        <div className="px-4 py-3 border-b border-slate-700/30 bg-slate-800/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-100">{symbol}</h2>
            <span className="text-2xl font-mono font-semibold text-emerald-400">
              ₹{currentPrice.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">POI Analysis Active</span>
            {poi.loading && <span className="text-amber-400 animate-pulse">⏳ Updating...</span>}
            {poi.data && !poi.loading && (
              <span className="text-emerald-400">✓ {poi.data.poi_count} detected</span>
            )}
          </div>
        </div>

        {/* Main Chart Area */}
        <div className="flex-1 overflow-hidden relative bg-[#0f1421]">
          {/* 
            YOUR CHART COMPONENT HERE
            
            <SymbolChartCard
              data={chartData[symbol]}
              name={symbol}
              liveSpot={currentPrice}
              pois={poi.data?.pois}  // Pass POI array to render on canvas
              onMaximize={...}
            />
          */}
          <div className="w-full h-full flex items-center justify-center text-slate-600">
            {/* Placeholder for actual chart */}
            <span>📊 Chart would render here</span>
          </div>
        </div>

        {/* Bottom: Proximity Alert (if needed) */}
        {poi.getProximityWarning(0.003) && (
          <div className="px-4 py-2 bg-red-900/40 border-t border-red-700/30 text-red-300 text-sm flex items-center gap-2">
            <span className="animate-pulse text-lg">⚠️</span>
            <span>{poi.getProximityWarning(0.003)}</span>
          </div>
        )}
      </div>

      {/* RIGHT: POI PANEL (30%) */}
      <div className="w-96 flex flex-col gap-4 p-4 border-l border-slate-700/30 bg-slate-900/20 overflow-y-auto">
        
        {/* POI Legend - Real-time POI Display */}
        <POILegend 
          poiData={poi.data}
          currentPrice={currentPrice}
          loading={poi.loading}
          error={poi.error}
        />

        {/* POI Statistics */}
        {poi.data && (
          <div className="px-3 py-3 bg-slate-800/30 border border-slate-700/30 rounded space-y-2">
            <h3 className="text-sm font-semibold text-slate-300">📊 POI Statistics</h3>
            
            <div className="space-y-1.5 text-xs">
              {/* Total POIs */}
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Total POIs:</span>
                <span className="text-slate-200 font-mono font-semibold">
                  {poi.data.poi_count}
                </span>
              </div>

              {/* Premium POIs */}
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Premium Quality:</span>
                <span className="text-emerald-400 font-semibold">
                  {poi.data.pois.filter(p => p.quality === 'PREMIUM').length}
                </span>
              </div>

              {/* Average Heat Level */}
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Avg Heat Level:</span>
                <span className="text-amber-400 font-semibold">
                  {(poi.data.pois.reduce((s, p) => s + p.heat_level, 0) / Math.max(poi.data.pois.length, 1)).toFixed(1)}/5
                </span>
              </div>

              {/* Closest Distance */}
              {poi.data.closest_poi && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Closest POI:</span>
                  <span className="text-slate-300 font-mono">
                    {Math.abs(poi.data.closest_poi.distance_pct).toFixed(3)}%
                  </span>
                </div>
              )}

              {/* Confidence */}
              <div className="flex items-center justify-between pt-1 border-t border-slate-700/30">
                <span className="text-slate-400">Analysis Confidence:</span>
                <span className="text-blue-400 font-semibold">
                  {Math.round(poi.data.analysis_confidence)}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Manual Refresh Button */}
        <button
          onClick={() => poi.refreshPOI()}
          disabled={poi.loading}
          className="w-full px-3 py-2 bg-indigo-600/30 hover:bg-indigo-600/40 border border-indigo-700/40 rounded text-indigo-300 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {poi.loading ? '🔄 Analyzing...' : '🔄 Refresh POI Analysis'}
        </button>

        {/* POI Type Legend */}
        <div className="px-3 py-3 bg-slate-800/20 border border-slate-700/30 rounded">
          <h3 className="text-xs font-semibold text-slate-300 mb-2">📍 POI Types</h3>
          <div className="space-y-1 text-xs text-slate-400">
            <div>📊 <span className="text-slate-300">Volume Cluster</span> - Accumulated volume zone</div>
            <div>🔄 <span className="text-slate-300">Multiple Touch</span> - Tested support/resistance</div>
            <div>═  <span className="text-slate-300">Inducement</span> - Institutional trap level</div>
            <div>⚡ <span className="text-slate-300">Volume Imbalance</span> - Large volume spike</div>
          </div>
        </div>

        {/* Data Source Info */}
        <div className="px-3 py-2 bg-slate-800/10 border border-slate-700/20 rounded text-xs text-slate-500">
          <span className="block font-semibold text-slate-400 mb-1">ℹ️ Data Source</span>
          <span>✓ Real Zerodha market data</span><br/>
          <span>✓ No synthetic analysis</span><br/>
          <span>✓ 120 candle lookback</span>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// EXAMPLE 2: Multi-Symbol POI Dashboard
// ════════════════════════════════════════════════════════════════════════════

import { useChartPOIMulti } from '@/hooks/useChartPOI';

export function MultiSymbolPOIDashboard() {
  const multiPOI = useChartPOIMulti(['NIFTY', 'BANKNIFTY', 'SENSEX']);
  const { marketData } = useMarketSocket();

  const symbols: Array<'NIFTY' | 'BANKNIFTY' | 'SENSEX'> = [
    'NIFTY',
    'BANKNIFTY',
    'SENSEX',
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-[#0a0e1a]">
      {symbols.map(symbol => {
        const poiData = multiPOI.data[symbol];
        const currentPrice = marketData[symbol]?.price ?? 0;

        return (
          <div
            key={symbol}
            className="bg-slate-900/40 border border-slate-700/30 rounded-lg p-4 space-y-3"
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-100">{symbol}</h3>
              <span className="text-xl font-mono text-emerald-400">
                ₹{currentPrice.toFixed(1)}
              </span>
            </div>

            {/* Loading State */}
            {multiPOI.loading && (
              <div className="text-slate-400 text-sm animate-pulse">
                ⏳ Analyzing...
              </div>
            )}

            {/* Error State */}
            {multiPOI.error && (
              <div className="text-red-400 text-sm">
                ❌ {multiPOI.error}
              </div>
            )}

            {/* Data Display */}
            {poiData && (
              <>
                {/* POI Count */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">POIs Detected:</span>
                  <span className="text-emerald-400 font-semibold">
                    {poiData.poi_count}
                  </span>
                </div>

                {/* Closest POI */}
                {poiData.closest_poi && (
                  <div className="px-3 py-2 bg-slate-800/50 border border-slate-700/40 rounded">
                    <div className="text-xs text-slate-400 mb-1">Closest POI</div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-100 font-mono font-semibold">
                        ₹{poiData.closest_poi.level.toFixed(1)}
                      </span>
                      <span className="text-sm text-slate-400">
                        {Math.abs(poiData.closest_poi.distance_pct).toFixed(2)}% away
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {poiData.closest_poi.type.replace(/_/g, ' ')}
                    </div>
                  </div>
                )}

                {/* Top 3 POIs */}
                {poiData.top_pois.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs text-slate-400 font-semibold">
                      Top POIs
                    </div>
                    {poiData.top_pois.slice(0, 3).map((poi, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between text-xs px-2 py-1 bg-slate-800/30 rounded"
                      >
                        <span className="text-slate-300">
                          ₹{poi.level.toFixed(1)}
                        </span>
                        <span
                          className={`text-xs font-semibold ${
                            poi.quality === 'PREMIUM'
                              ? 'text-emerald-400'
                              : 'text-amber-400'
                          }`}
                        >
                          {poi.quality}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Confidence */}
                <div className="pt-2 border-t border-slate-700/30 flex items-center justify-between text-xs">
                  <span className="text-slate-400">Confidence:</span>
                  <span className="text-blue-400 font-semibold">
                    {Math.round(poiData.analysis_confidence)}%
                  </span>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// EXAMPLE 3: POI-Aware Trading Setup Detector
// ════════════════════════════════════════════════════════════════════════════

export function POITradingSetup({ symbol }: { symbol: string }) {
  const poi = useChartPOI(symbol);

  if (!poi.data) {
    return <div className="text-slate-400">Loading setup analysis...</div>;
  }

  // Detect setup quality based on POI proximity
  const premiumPOIs = poi.data.pois.filter(p => p.quality === 'PREMIUM');
  const closestDistance = poi.data.closest_poi
    ? Math.abs(poi.data.closest_poi.distance_pct)
    : Infinity;

  const setupQuality =
    premiumPOIs.length >= 3 && closestDistance < 0.5
      ? '⭐⭐⭐ OPTIMAL'
      : premiumPOIs.length >= 2 && closestDistance < 1
      ? '⭐⭐ GOOD'
      : closestDistance < 2
      ? '⭐ FAIR'
      : '❌ NO SETUP';

  return (
    <div className="space-y-3 p-4 bg-slate-800/40 border border-slate-700/30 rounded">
      <h3 className="font-semibold text-slate-100">🎯 Trading Setup Quality</h3>

      <div className="flex items-center justify-between">
        <span className="text-slate-400">Setup Rating:</span>
        <span className="text-lg font-bold text-emerald-400">
          {setupQuality}
        </span>
      </div>

      <div className="space-y-1 text-sm text-slate-400">
        <div>
          Premium POIs:{' '}
          <span className="text-slate-200 font-semibold">
            {premiumPOIs.length}
          </span>
        </div>
        <div>
          Closest POI:{' '}
          <span className="text-slate-200 font-semibold">
            {closestDistance.toFixed(2)}%
          </span>
        </div>
        <div>
          POI Type:{' '}
          <span className="text-slate-200 font-semibold">
            {poi.data.closest_poi?.type.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {setupQuality.includes('OPTIMAL') && (
        <div className="px-3 py-2 bg-emerald-900/40 border border-emerald-700/30 rounded text-emerald-300 text-sm">
          ✅ High quality setup detected. Price near institutional level.
        </div>
      )}

      {setupQuality.includes('NO SETUP') && (
        <div className="px-3 py-2 bg-slate-800/40 border border-slate-700/30 rounded text-slate-300 text-sm">
          ⏸️ No immediate setup. Wait for price to approach POI levels.
        </div>
      )}
    </div>
  );
}
