'use client';

import React, { memo } from 'react';
import { POIAnalysisResponse, POILevel } from '@/hooks/useChartPOI';

interface POILegendProps {
  poiData: POIAnalysisResponse | null;
  currentPrice: number;
  loading: boolean;
  error: string | null;
}

/**
 * POI Legend Component
 * ════════════════════════════════════════════════════════════════
 * Displays real-time Point of Interest levels detected from market data.
 * Shows institutional strength, proximity warnings, and heat mapping.
 * 
 * Visual Indicators:
 * - Heat levels (1-5): Color intensity of POI strength
 * - Proximity warning: When price approaches POI
 * - Confluence factors: What makes each POI strong
 * - Age indicator: How recent the POI is
 */
export const POILegend = memo<POILegendProps>(
  ({ poiData, currentPrice, loading, error }) => {
    if (error) {
      return (
        <div className="px-3 py-2 bg-red-900/20 border border-red-700/30 rounded text-red-400 text-xs">
          <span className="font-medium">⚠️ POI Error:</span> {error}
        </div>
      );
    }

    if (loading) {
      return (
        <div className="px-3 py-2 bg-slate-900/30 border border-slate-700/30 rounded text-slate-400 text-xs animate-pulse">
          📊 Loading POI levels...
        </div>
      );
    }

    if (!poiData || poiData.poi_count === 0) {
      return (
        <div className="px-3 py-2 bg-slate-900/30 border border-slate-700/30 rounded text-slate-500 text-xs">
          📍 No POI detected
        </div>
      );
    }

    const { top_pois, closest_poi, poi_count, analysis_confidence } = poiData;

    return (
      <div className="space-y-2">
        {/* Header */}
        <div className="px-3 py-2 bg-gradient-to-r from-indigo-900/40 to-purple-900/40 border border-indigo-700/40 rounded">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-indigo-400 text-sm font-semibold">🎯 POI Analysis</span>
              <span className="text-indigo-500/60 text-xs">({poi_count} detected)</span>
            </div>
            <span className="text-indigo-400/60 text-xs font-mono">
              Confidence: {Math.round(analysis_confidence)}%
            </span>
          </div>
        </div>

        {/* Closest POI Warning */}
        {closest_poi && (
          <ClosestPOICard poi={closest_poi} currentPrice={currentPrice} />
        )}

        {/* Top POI Levels */}
        <div className="space-y-1.5">
          {top_pois.map((poi, idx) => (
            <POILevelCard key={idx} poi={poi} currentPrice={currentPrice} />
          ))}
        </div>

        {/* Legend Explanation */}
        <div className="text-xs text-slate-500 space-y-0.5 border-t border-slate-700/30 pt-2 mt-2">
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            </div>
            <span>Heat level (Weak → Strong)</span>
          </div>
          <div className="text-xs text-slate-600">
            💡 PREMIUM = 3+ touches | STANDARD = 2 touches | Volume/Structure confluence
          </div>
        </div>
      </div>
    );
  }
);

POILegend.displayName = 'POILegend';

/**
 * Closest POI Card
 * ────────────────
 * Highlights the nearest POI level to current price with proximity warning
 */
const ClosestPOICard = memo<{ poi: POILevel; currentPrice: number }>(
  ({ poi, currentPrice }) => {
    const distance = Math.abs(poi.distance_pct);
    const isClose = distance < 0.3; // within 0.3%
    const direction = currentPrice > poi.level ? '↓' : '↑';

    const heatColor = {
      1: 'bg-slate-700',
      2: 'bg-slate-600',
      3: 'bg-amber-700',
      4: 'bg-orange-600',
      5: 'bg-red-600',
    }[poi.heat_level];

    const bgColor = isClose
      ? 'bg-red-900/40 border-red-700/60'
      : 'bg-slate-800/40 border-slate-700/40';

    return (
      <div className={`px-3 py-2 border rounded ${bgColor}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isClose && <span className="text-red-400 text-lg animate-pulse">⚠️</span>}
            <div className={`w-3 h-3 rounded-full ${heatColor}`} />
            <div className="text-left">
              <div className="text-sm font-semibold text-slate-100">
                ₹{poi.level.toFixed(2)}
              </div>
              <div className="text-xs text-slate-400">
                {poi.type.replace(/_/g, ' ')} • {poi.quality}
              </div>
            </div>
          </div>
          <div className="text-right text-xs">
            <div className="text-slate-300 font-mono">
              {direction} {distance.toFixed(3)}%
            </div>
            <div className="text-slate-500">
              {poi.touches} touches
            </div>
          </div>
        </div>
      </div>
    );
  }
);

ClosestPOICard.displayName = 'ClosestPOICard';

/**
 * POI Level Card
 * ──────────────
 * Single POI level with type, strength, and confluence factors
 */
const POILevelCard = memo<{ poi: POILevel; currentPrice: number }>(
  ({ poi, currentPrice }) => {
    const heatColor = {
      1: 'bg-slate-700/60 border-slate-700/40',
      2: 'bg-slate-700/50 border-slate-700/40',
      3: 'bg-amber-900/30 border-amber-700/40',
      4: 'bg-orange-900/30 border-orange-700/40',
      5: 'bg-red-900/30 border-red-700/40',
    }[poi.heat_level];

    const heatDot = {
      1: 'bg-slate-600',
      2: 'bg-slate-500',
      3: 'bg-amber-600',
      4: 'bg-orange-500',
      5: 'bg-red-500',
    }[poi.heat_level];

    const typeIcon = {
      VOLUME_CLUSTER: '📊',
      MULTIPLE_TOUCH: '🔄',
      INDUCEMENT: '═',
      VOLUME_IMBALANCE: '⚡',
    }[poi.type];

    const typeLabel = poi.type.replace(/_/g, ' ');
    const direction = currentPrice > poi.level ? '↓' : '↑';

    return (
      <div className={`px-3 py-1.5 border rounded text-xs ${heatColor}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1">
            <div className={`w-2 h-2 rounded-full ${heatDot}`} />
            <div className="text-slate-100 font-mono font-semibold w-14">
              ₹{poi.level.toFixed(1)}
            </div>
            <div className="text-slate-400">
              {typeIcon} {typeLabel}
            </div>
            {poi.confluence_factors.length > 0 && (
              <div className="text-slate-500 text-xs">
                ({poi.confluence_factors.slice(0, 2).join(', ')})
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 text-right">
            <div className="text-slate-400 font-mono text-xs">
              {direction} {Math.abs(poi.distance_pct).toFixed(2)}%
            </div>
            <div className="w-12 h-1 bg-slate-700/50 rounded overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-red-500"
                style={{
                  width: `${Math.min(100, (poi.institutional_strength * 100))}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }
);

POILevelCard.displayName = 'POILevelCard';

export default POILegend;
