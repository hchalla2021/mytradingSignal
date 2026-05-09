/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🎯 ADVANCED CHART INTELLIGENCE COMPONENTS
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Enterprise-grade React components for displaying real-time chart intelligence.
 * 
 * Components:
 * • ChartIntelligencePanel: Main display panel with all levels/zones
 * • SupportResistanceDisplay: Visual S/R zones with confluence
 * • OrderBlockViewer: OB zones with status
 * • FairValueGapViewer: FVG zones with fill status
 * • LiquidityDisplay: BSL/SSL with distance metrics
 * • StructuralIndicators: BOS and structural signals
 * 
 * DESIGN:
 * • Responsive layout
 * • Real-time updates
 * • Visual heat mapping
 * • Smooth animations
 * • Accessible UI
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use client';

import React, { memo, useMemo } from 'react';
import {
  useAdvancedChartIntelligence,
  ChartIntelligenceData,
  SupportResistanceZone,
  OrderBlock,
  FairValueGap,
  LiquidityLevel,
  HeatLevel,
  Quality,
  ZoneType,
} from '@/hooks/useAdvancedChartIntelligence';
import { motion } from 'framer-motion';

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PANEL COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

interface ChartIntelligencePanelProps {
  symbol: 'NIFTY' | 'BANKNIFTY' | 'SENSEX';
  compact?: boolean;
  showDetails?: boolean;
}

export const ChartIntelligencePanel = memo(function ChartIntelligencePanel({
  symbol,
  compact = false,
  showDetails = true,
}: ChartIntelligencePanelProps) {
  const intel = useAdvancedChartIntelligence(symbol, true);

  if (intel.loading && !intel.data) {
    return (
      <div className="p-6 bg-slate-900 rounded-lg border border-slate-700/30 flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="animate-spin mb-4">
            <div className="w-8 h-8 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full" />
          </div>
          <p className="text-slate-400">Loading Chart Intelligence...</p>
        </div>
      </div>
    );
  }

  if (intel.error) {
    return (
      <div className="p-6 bg-slate-900 rounded-lg border border-red-700/30">
        <div className="text-red-400">
          <p className="font-semibold">Error Loading Chart Intelligence</p>
          <p className="text-sm mt-2">{intel.error}</p>
        </div>
      </div>
    );
  }

  if (!intel.data) {
    return (
      <div className="p-6 bg-slate-900 rounded-lg border border-slate-700/30">
        <p className="text-slate-400">No data available</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={`rounded-lg border border-slate-700/30 bg-slate-900 overflow-hidden ${
        compact ? 'p-4' : 'p-6'
      }`}
    >
      {/* Header */}
      <HeaderSection data={intel.data} symbol={symbol} />

      {/* Main Grid */}
      <div className={`grid gap-6 mt-6 ${
        compact ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-3'
      }`}>
        {/* Price Levels */}
        <PriceLevelsSection data={intel.data} />

        {/* Support/Resistance */}
        {showDetails && <SupportResistanceSection data={intel.data} />}

        {/* Order Blocks */}
        {showDetails && intel.data.order_blocks.length > 0 && (
          <OrderBlocksSection data={intel.data} />
        )}

        {/* Fair Value Gaps */}
        {showDetails && intel.data.fair_value_gaps.length > 0 && (
          <FairValueGapsSection data={intel.data} />
        )}

        {/* Liquidity */}
        {showDetails && (intel.data.buy_side_liquidity.length > 0 || intel.data.sell_side_liquidity.length > 0) && (
          <LiquiditySection data={intel.data} />
        )}

        {/* Break of Structure */}
        {showDetails && intel.data.breaks_of_structure.length > 0 && (
          <StructureSection data={intel.data} />
        )}
      </div>

      {/* Footer */}
      <FooterSection data={intel.data} isStale={intel.isStale} />
    </motion.div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

const HeaderSection = memo(function HeaderSection({
  data,
  symbol,
}: {
  data: ChartIntelligenceData;
  symbol: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-700/30 pb-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-100">{symbol}</h2>
        <p className="text-sm text-slate-400 mt-1">
          {new Date(data.timestamp).toLocaleTimeString('en-IN')}
        </p>
      </div>

      <div className="text-right">
        <div className="text-4xl font-mono font-bold text-emerald-400">
          ₹{data.current_price.toFixed(2)}
        </div>
        <div className={`text-sm mt-1 ${
          data.market_status === 'LIVE' ? 'text-emerald-400' : 'text-slate-400'
        }`}>
          {data.market_status}
        </div>
      </div>
    </div>
  );
});

const PriceLevelsSection = memo(function PriceLevelsSection({
  data,
}: {
  data: ChartIntelligenceData;
}) {
  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-slate-200 text-sm uppercase tracking-wider">
        Price Levels
      </h3>

      <div className="space-y-2">
        <LevelRow
          label="Day High"
          value={data.day_high}
          diff={data.current_price - data.day_high}
          color="text-blue-400"
        />
        <LevelRow
          label="Day Low"
          value={data.day_low}
          diff={data.current_price - data.day_low}
          color="text-orange-400"
        />
        <div className="border-t border-slate-700/30 pt-2 mt-2">
          <LevelRow
            label="Prev High"
            value={data.prev_day_high}
            diff={data.current_price - data.prev_day_high}
            color="text-cyan-400"
            small
          />
          <LevelRow
            label="Prev Low"
            value={data.prev_day_low}
            diff={data.current_price - data.prev_day_low}
            color="text-purple-400"
            small
          />
        </div>
      </div>
    </div>
  );
});

const LevelRow = memo(function LevelRow({
  label,
  value,
  diff,
  color,
  small = false,
}: {
  label: string;
  value: number;
  diff: number;
  color: string;
  small?: boolean;
}) {
  const isSafe = diff > 0;
  return (
    <div className={`flex items-center justify-between ${small ? 'text-xs' : 'text-sm'}`}>
      <span className="text-slate-400">{label}</span>
      <div className="text-right">
        <div className={`font-mono font-semibold ${color}`}>
          ₹{value.toFixed(2)}
        </div>
        <div className={`text-xs ${isSafe ? 'text-emerald-500' : 'text-red-500'}`}>
          {isSafe ? '+' : ''}{diff.toFixed(2)}
        </div>
      </div>
    </div>
  );
});

const SupportResistanceSection = memo(function SupportResistanceSection({
  data,
}: {
  data: ChartIntelligenceData;
}) {
  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-slate-200 text-sm uppercase tracking-wider">
        S&R Zones
      </h3>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {/* Support */}
        {data.support_zones.slice(0, 2).map((zone, idx) => (
          <ZoneCard key={`support-${idx}`} zone={zone} currentPrice={data.current_price} />
        ))}

        {/* Resistance */}
        {data.resistance_zones.slice(0, 2).map((zone, idx) => (
          <ZoneCard key={`resist-${idx}`} zone={zone} currentPrice={data.current_price} />
        ))}
      </div>

      {data.support_zones.length + data.resistance_zones.length > 4 && (
        <p className="text-xs text-slate-400 text-center">
          +{data.support_zones.length + data.resistance_zones.length - 4} more zones
        </p>
      )}
    </div>
  );
});

const ZoneCard = memo(function ZoneCard({
  zone,
  currentPrice,
}: {
  zone: SupportResistanceZone;
  currentPrice: number;
}) {
  const distance = Math.abs(currentPrice - zone.price);
  const distancePct = (distance / currentPrice) * 100;
  const heatColor = getHeatColor(zone.heat_level);

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="p-3 rounded bg-slate-800/50 border border-slate-700/30 hover:border-slate-600/50 transition-colors"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${heatColor}`}
            style={{
              boxShadow: `0 0 8px ${heatColor}`,
            }}
          />
          <span className="text-xs font-semibold text-slate-300 uppercase">
            {zone.type === ZoneType.SUPPORT ? 'Support' : 'Resistance'}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded ${
            zone.quality === Quality.PREMIUM ? 'bg-emerald-500/20 text-emerald-400' :
            zone.quality === Quality.STANDARD ? 'bg-amber-500/20 text-amber-400' :
            'bg-slate-600/30 text-slate-400'
          }`}>
            {zone.quality}
          </span>
        </div>
      </div>

      <div className="text-sm font-mono text-slate-200 mb-1">₹{zone.price.toFixed(2)}</div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">{zone.touch_count} touches</span>
        <span className={distancePct < 1 ? 'text-red-400 font-semibold' : 'text-slate-400'}>
          {distancePct.toFixed(3)}% away
        </span>
      </div>
    </motion.div>
  );
});

const OrderBlocksSection = memo(function OrderBlocksSection({
  data,
}: {
  data: ChartIntelligenceData;
}) {
  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-slate-200 text-sm uppercase tracking-wider">
        Order Blocks
      </h3>

      <div className="space-y-2">
        {data.order_blocks.slice(0, 3).map((ob, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="p-3 rounded bg-slate-800/50 border border-slate-700/30"
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs font-bold px-2 py-1 rounded ${
                ob.type === 'BULLISH'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-red-500/20 text-red-400'
              }`}>
                {ob.type}
              </span>
              <span className={`text-xs ${ob.mitigated ? 'text-slate-400 line-through' : 'text-yellow-400 font-semibold'}`}>
                {ob.mitigated ? 'Mitigated' : 'Active'}
              </span>
            </div>
            <div className="text-xs text-slate-300 font-mono">
              ₹{ob.price_low.toFixed(2)} - ₹{ob.price_high.toFixed(2)}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
});

const FairValueGapsSection = memo(function FairValueGapsSection({
  data,
}: {
  data: ChartIntelligenceData;
}) {
  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-slate-200 text-sm uppercase tracking-wider">
        Fair Value Gaps
      </h3>

      <div className="space-y-2">
        {data.fair_value_gaps.slice(0, 3).map((fvg, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="p-3 rounded bg-slate-800/50 border border-slate-700/30"
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs font-bold px-2 py-1 rounded ${
                fvg.type === 'BULLISH'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-pink-500/20 text-pink-400'
              }`}>
                {fvg.type}
              </span>
              <div className="w-16 h-1 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full ${
                    fvg.type === 'BULLISH' ? 'bg-blue-500' : 'bg-pink-500'
                  }`}
                  style={{ width: `${Math.min(fvg.fill_ratio * 100, 100)}%` }}
                />
              </div>
            </div>
            <div className="text-xs text-slate-300 font-mono">
              ₹{fvg.price_low.toFixed(2)} - ₹{fvg.price_high.toFixed(2)}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {(fvg.size_pct * 100).toFixed(3)}% gap • {(fvg.fill_ratio * 100).toFixed(1)}% filled
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
});

const LiquiditySection = memo(function LiquiditySection({
  data,
}: {
  data: ChartIntelligenceData;
}) {
  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-slate-200 text-sm uppercase tracking-wider">
        Liquidity Pools
      </h3>

      <div className="space-y-2">
        {data.buy_side_liquidity.slice(0, 2).map((liq, idx) => (
          <LiquidityCard key={`buy-${idx}`} liq={liq} />
        ))}
        {data.sell_side_liquidity.slice(0, 2).map((liq, idx) => (
          <LiquidityCard key={`sell-${idx}`} liq={liq} />
        ))}
      </div>
    </div>
  );
});

const LiquidityCard = memo(function LiquidityCard({ liq }: { liq: LiquidityLevel }) {
  return (
    <div className="p-2 rounded bg-slate-800/50 border border-slate-700/30 text-xs">
      <div className="flex items-center justify-between">
        <span className={`font-semibold ${
          liq.type === 'BUY_SIDE' ? 'text-emerald-400' : 'text-red-400'
        }`}>
          {liq.type === 'BUY_SIDE' ? 'BSL' : 'SSL'}
        </span>
        <span className="text-slate-300 font-mono">₹{liq.price.toFixed(2)}</span>
        <span className={liq.swept ? 'text-slate-400 line-through' : 'text-yellow-400'}>
          {liq.swept ? 'Swept' : 'Active'}
        </span>
      </div>
    </div>
  );
});

const StructureSection = memo(function StructureSection({
  data,
}: {
  data: ChartIntelligenceData;
}) {
  const bos = data.breaks_of_structure[0];
  if (!bos) return null;

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-slate-200 text-sm uppercase tracking-wider">
        Break of Structure
      </h3>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`p-4 rounded border ${
          bos.direction === 'UP'
            ? 'bg-emerald-500/10 border-emerald-500/30'
            : 'bg-red-500/10 border-red-500/30'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <span className={`text-sm font-bold ${
            bos.direction === 'UP' ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {bos.direction === 'UP' ? '📈 Bullish' : '📉 Bearish'}
          </span>
          <span className="text-xs text-slate-400">
            {new Date(bos.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <div className="text-sm font-mono text-slate-300">
          Level: ₹{bos.price_level.toFixed(2)}
        </div>
        <div className="text-xs text-slate-400 mt-1">
          Strength: {(bos.strength * 100).toFixed(0)}% • Volume: {bos.volume_confirmation.toFixed(2)}x
        </div>
      </motion.div>
    </div>
  );
});

const FooterSection = memo(function FooterSection({
  data,
  isStale,
}: {
  data: ChartIntelligenceData;
  isStale: boolean;
}) {
  return (
    <div className="border-t border-slate-700/30 mt-6 pt-4 flex items-center justify-between text-xs text-slate-400">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${
          isStale ? 'bg-yellow-500' : 'bg-emerald-500'
        }`} />
        <span>{isStale ? 'Stale data' : 'Real-time'}</span>
      </div>
      <div>
        Confidence: <span className="text-slate-200 font-semibold">{data.analysis_confidence.toFixed(0)}%</span>
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function getHeatColor(heatLevel: HeatLevel): string {
  const colors = {
    1: 'bg-slate-600',
    2: 'bg-amber-500',
    3: 'bg-orange-500',
    4: 'bg-orange-600',
    5: 'bg-red-600',
  };
  return colors[heatLevel as keyof typeof colors] || 'bg-slate-600';
}
