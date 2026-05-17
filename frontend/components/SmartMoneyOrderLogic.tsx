'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, TrendingUp, TrendingDown, Activity, BarChart3, Zap } from 'lucide-react';

interface SmartMoneySignal {
  signalType: string;
  confidence: number;
  magnitude: number;
  description: string;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  supportingPatterns: any[];
  riskScore: number;
  ai?: {
    provider: 'tensorflow' | 'numpy_fallback';
    featureVersion: string;
    sequencePrediction: {
      nextMove: 'UP' | 'DOWN' | 'SIDEWAYS';
      nextMovePts: number;
      trendContinuationProb: number;
      reversalProb: number;
      horizonSec: number;
    };
    microstructure: {
      liquidityDensity: number;
      structureDensity: number;
      fakeBreakoutRisk: number;
      stopHuntRisk: number;
    };
    commandDeck: {
      streamState: 'LIVE' | 'DELAYED' | 'CLOSED';
      modelProvider: 'tensorflow' | 'numpy_fallback';
      analysisLatencyMs: number;
      pipelineCadenceMs: number;
      eventRatePerSec: number;
      queueDepth: number;
      cacheState: 'HOT' | 'WARM' | 'COLD';
      alerts: string[];
    };
    institutionalConfluence: {
      executionProbability: number;
      smartMoneyAlignment: number;
      institutionalFlow: number;
      riskScore: number;
      rewardScore: number;
      riskRewardRatio: number;
    };
  };
}

interface InstitutionalActivity {
  activityLevel: string;
  confidence: number;
  recentSignatures: any[];
}

interface MarketStructure {
  trend: string;
  structureStrength: number;
  breakoutProbability: number;
  supportLevels: number[];
  resistanceLevels: number[];
}

interface OrderCluster {
  centerPrice: number;
  totalVolume: number;
  intensity: number;
  direction: string;
  impactScore: number;
}

/**
 * 🏛️ SMART MONEY ORDER LOGIC DASHBOARD
 * 
 * Institutional-grade component displaying:
 * - Real-time smart money signals
 * - Order flow analysis
 * - Institutional positioning
 * - Market structure analysis
 * - Alert notifications
 */
export function SmartMoneyOrderLogic({ symbol }: { symbol: string }) {
  const [signal, setSignal] = useState<SmartMoneySignal | null>(null);
  const [activity, setActivity] = useState<InstitutionalActivity | null>(null);
  const [structure, setStructure] = useState<MarketStructure | null>(null);
  const [clusters, setClusters] = useState<OrderCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'signal' | 'activity' | 'structure' | 'clusters'>('signal');

  // Fetch current signal
  const fetchSignal = useCallback(async () => {
    try {
      const response = await fetch(`/api/smart-money/current/${symbol}`);
      if (!response.ok) throw new Error('Failed to fetch signal');
      const data = await response.json();
      setSignal(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [symbol]);

  // Fetch institutional activity
  const fetchActivity = useCallback(async () => {
    try {
      const response = await fetch(`/api/smart-money/institutional-activity/${symbol}`);
      if (!response.ok) throw new Error('Failed to fetch activity');
      const data = await response.json();
      setActivity(data);
    } catch (err) {
      console.error('Error fetching activity:', err);
    }
  }, [symbol]);

  // Fetch market structure
  const fetchStructure = useCallback(async () => {
    try {
      const response = await fetch(`/api/smart-money/market-structure/${symbol}`);
      if (!response.ok) throw new Error('Failed to fetch structure');
      const data = await response.json();
      setStructure(data);
    } catch (err) {
      console.error('Error fetching structure:', err);
    }
  }, [symbol]);

  // Fetch order clusters
  const fetchClusters = useCallback(async () => {
    try {
      const response = await fetch(`/api/smart-money/clusters/${symbol}`);
      if (!response.ok) throw new Error('Failed to fetch clusters');
      const data = await response.json();
      setClusters(data.clusters || []);
    } catch (err) {
      console.error('Error fetching clusters:', err);
    }
  }, [symbol]);

  // Initial data load
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchSignal(),
      fetchActivity(),
      fetchStructure(),
      fetchClusters()
    ]).finally(() => setLoading(false));

    // Refresh every 3 seconds
    const interval = setInterval(() => {
      fetchSignal();
      fetchActivity();
      fetchStructure();
      fetchClusters();
    }, 3000);

    return () => clearInterval(interval);
  }, [symbol, fetchSignal, fetchActivity, fetchStructure, fetchClusters]);

  if (loading && !signal) {
    return (
      <div className="space-y-4">
        <div className="bg-dark-card rounded-lg p-6 animate-pulse">
          <div className="h-40 bg-dark-surface rounded"></div>
        </div>
      </div>
    );
  }

  const getSignalColor = (signalType: string) => {
    if (signalType.includes('BUY')) return 'text-emerald-500';
    if (signalType.includes('SELL')) return 'text-red-500';
    return 'text-amber-500';
  };

  const getSignalBgColor = (signalType: string) => {
    if (signalType.includes('BUY')) return 'bg-emerald-500/10 border-emerald-500/30';
    if (signalType.includes('SELL')) return 'bg-red-500/10 border-red-500/30';
    return 'bg-amber-500/10 border-amber-500/30';
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Smart Money Order Logic</h2>
        {error && (
          <div className="flex items-center gap-2 text-red-500 text-sm">
            <AlertCircle size={16} />
            {error}
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 bg-dark-surface rounded-lg p-1">
        {(['signal', 'activity', 'structure', 'clusters'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Signal Tab */}
      {activeTab === 'signal' && signal && (
        <div className={`bg-dark-card border rounded-lg p-6 ${getSignalBgColor(signal.signalType)}`}>
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              {signal.signalType.includes('BUY') ? (
                <TrendingUp className={`${getSignalColor(signal.signalType)}`} size={32} />
              ) : (
                <TrendingDown className={`${getSignalColor(signal.signalType)}`} size={32} />
              )}
              <div>
                <h3 className={`font-bold text-lg ${getSignalColor(signal.signalType)}`}>
                  {signal.signalType.replace(/_/g, ' ')}
                </h3>
                <p className="text-gray-400 text-sm">{signal.description}</p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-white">
                {(signal.confidence * 100).toFixed(0)}%
              </div>
              <div className="text-xs text-gray-400">Confidence</div>
            </div>
          </div>

          {/* Price Targets */}
          <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/10">
            {signal.entryPrice && (
              <div>
                <div className="text-xs text-gray-400 mb-1">Entry</div>
                <div className="text-lg font-bold text-white">
                  ₹{signal.entryPrice.toFixed(2)}
                </div>
              </div>
            )}
            {signal.takeProfit && (
              <div>
                <div className="text-xs text-gray-400 mb-1">Take Profit</div>
                <div className="text-lg font-bold text-emerald-500">
                  ₹{signal.takeProfit.toFixed(2)}
                </div>
              </div>
            )}
            {signal.stopLoss && (
              <div>
                <div className="text-xs text-gray-400 mb-1">Stop Loss</div>
                <div className="text-lg font-bold text-red-500">
                  ₹{signal.stopLoss.toFixed(2)}
                </div>
              </div>
            )}
          </div>

          {/* Risk Score */}
          <div className="mt-6 pt-6 border-t border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">Risk Level</span>
              <span className={`text-sm font-bold ${
                signal.riskScore < 0.4 ? 'text-emerald-500' : 
                signal.riskScore < 0.7 ? 'text-amber-500' : 
                'text-red-500'
              }`}>
                {(signal.riskScore * 100).toFixed(0)}%
              </span>
            </div>
            <div className="w-full bg-dark-surface rounded-full h-2 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  signal.riskScore < 0.4 ? 'bg-emerald-500' : 
                  signal.riskScore < 0.7 ? 'bg-amber-500' : 
                  'bg-red-500'
                }`}
                style={{ width: `${signal.riskScore * 100}%` }}
              ></div>
            </div>
          </div>

          {signal.ai && (
            <div className="mt-6 pt-6 border-t border-white/10">
              <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-950/15 via-slate-950/80 to-slate-900/80 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="h-5 w-1 rounded-full bg-gradient-to-b from-cyan-300 to-blue-400/70" />
                    <span className="text-[11px] font-black uppercase tracking-[0.12em] text-cyan-200">Smart Money AI Command Deck</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.1em]">
                    <span className="rounded border border-cyan-400/40 bg-cyan-500/10 px-2 py-1 text-cyan-200">{signal.ai.provider}</span>
                    <span className={`rounded border px-2 py-1 ${signal.ai.commandDeck.streamState === 'LIVE' ? 'border-emerald-400/45 bg-emerald-500/10 text-emerald-200' : signal.ai.commandDeck.streamState === 'DELAYED' ? 'border-amber-400/45 bg-amber-500/10 text-amber-200' : 'border-slate-600/45 bg-slate-700/20 text-slate-300'}`}>
                      {signal.ai.commandDeck.streamState}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8 text-[10px]">
                  <div className="rounded-lg border border-slate-700/45 bg-slate-900/60 px-2 py-1.5"><p className="text-slate-500">Latency</p><p className={signal.ai.commandDeck.analysisLatencyMs <= 60 ? 'font-black text-emerald-300' : signal.ai.commandDeck.analysisLatencyMs <= 180 ? 'font-black text-amber-300' : 'font-black text-rose-300'}>{signal.ai.commandDeck.analysisLatencyMs}ms</p></div>
                  <div className="rounded-lg border border-slate-700/45 bg-slate-900/60 px-2 py-1.5"><p className="text-slate-500">Events/s</p><p className="font-black text-cyan-300">{signal.ai.commandDeck.eventRatePerSec.toFixed(1)}</p></div>
                  <div className="rounded-lg border border-slate-700/45 bg-slate-900/60 px-2 py-1.5"><p className="text-slate-500">Queue</p><p className="font-black text-slate-200">{signal.ai.commandDeck.queueDepth}</p></div>
                  <div className="rounded-lg border border-slate-700/45 bg-slate-900/60 px-2 py-1.5"><p className="text-slate-500">Move</p><p className={`font-black ${signal.ai.sequencePrediction.nextMove === 'UP' ? 'text-emerald-300' : signal.ai.sequencePrediction.nextMove === 'DOWN' ? 'text-rose-300' : 'text-amber-300'}`}>{signal.ai.sequencePrediction.nextMove}</p></div>
                  <div className="rounded-lg border border-slate-700/45 bg-slate-900/60 px-2 py-1.5"><p className="text-slate-500">Exec</p><p className="font-black text-emerald-300">{signal.ai.institutionalConfluence.executionProbability}%</p></div>
                  <div className="rounded-lg border border-slate-700/45 bg-slate-900/60 px-2 py-1.5"><p className="text-slate-500">Smart</p><p className="font-black text-cyan-300">{signal.ai.institutionalConfluence.smartMoneyAlignment}%</p></div>
                  <div className="rounded-lg border border-slate-700/45 bg-slate-900/60 px-2 py-1.5"><p className="text-slate-500">R:R</p><p className="font-black text-violet-300">{signal.ai.institutionalConfluence.riskRewardRatio.toFixed(2)}x</p></div>
                  <div className="rounded-lg border border-slate-700/45 bg-slate-900/60 px-2 py-1.5"><p className="text-slate-500">Trap</p><p className={`${Math.max(signal.ai.microstructure.fakeBreakoutRisk, signal.ai.microstructure.stopHuntRisk) <= 35 ? 'font-black text-emerald-300' : Math.max(signal.ai.microstructure.fakeBreakoutRisk, signal.ai.microstructure.stopHuntRisk) <= 60 ? 'font-black text-amber-300' : 'font-black text-rose-300'}`}>{Math.max(signal.ai.microstructure.fakeBreakoutRisk, signal.ai.microstructure.stopHuntRisk).toFixed(0)}%</p></div>
                </div>

                {signal.ai.commandDeck.alerts.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {signal.ai.commandDeck.alerts.map((a) => (
                      <span key={a} className="rounded border border-amber-400/35 bg-amber-500/10 px-2 py-1 text-[9px] text-amber-200">{a}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Activity Tab */}
      {activeTab === 'activity' && activity && (
        <div className="bg-dark-card border border-white/10 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Activity className={`${
              activity.activityLevel === 'HIGH' ? 'text-red-500' :
              activity.activityLevel === 'MEDIUM' ? 'text-amber-500' :
              'text-emerald-500'
            }`} size={24} />
            <div>
              <h3 className="font-bold text-white">
                {activity.activityLevel} Activity Level
              </h3>
              <p className="text-sm text-gray-400">
                Confidence: {(activity.confidence * 100).toFixed(0)}%
              </p>
            </div>
          </div>

          {activity.recentSignatures && activity.recentSignatures.length > 0 && (
            <div className="mt-4 space-y-2">
              <h4 className="text-sm font-semibold text-gray-300">Recent Institutional Signatures</h4>
              {activity.recentSignatures.slice(0, 5).map((sig, idx) => (
                <div key={idx} className="bg-dark-surface/50 rounded p-3 text-xs">
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-400">Price: ₹{sig.price}</span>
                    <span className={`font-bold ${
                      sig.accumulationPhase ? 'text-emerald-500' : 'text-red-500'
                    }`}>
                      {sig.accumulationPhase ? 'Accumulating' : 'Distributing'}
                    </span>
                  </div>
                  <div className="text-gray-500">
                    Orders: {sig.largeOrderCount} | Clustering: {(sig.orderClustering * 100).toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Structure Tab */}
      {activeTab === 'structure' && structure && (
        <div className="bg-dark-card border border-white/10 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-3">
            <BarChart3 className="text-blue-400" size={24} />
            <div>
              <h3 className="font-bold text-white">{structure.trend}</h3>
              <p className="text-sm text-gray-400">
                Structure Strength: {(structure.structureStrength * 100).toFixed(0)}%
              </p>
            </div>
          </div>

          {/* Support & Resistance */}
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <h4 className="text-xs font-semibold text-gray-400 mb-2">SUPPORT LEVELS</h4>
              <div className="space-y-1">
                {structure.supportLevels.map((level, idx) => (
                  <div key={idx} className="text-sm text-emerald-400">
                    ₹{level.toFixed(2)}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-400 mb-2">RESISTANCE LEVELS</h4>
              <div className="space-y-1">
                {structure.resistanceLevels.map((level, idx) => (
                  <div key={idx} className="text-sm text-red-400">
                    ₹{level.toFixed(2)}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Breakout Probability */}
          <div className="mt-4 pt-4 border-t border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">Breakout Probability</span>
              <span className="text-sm font-bold text-blue-400">
                {(structure.breakoutProbability * 100).toFixed(0)}%
              </span>
            </div>
            <div className="w-full bg-dark-surface rounded-full h-2">
              <div
                className="h-full bg-blue-500 rounded-full"
                style={{ width: `${structure.breakoutProbability * 100}%` }}
              ></div>
            </div>
          </div>
        </div>
      )}

      {/* Clusters Tab */}
      {activeTab === 'clusters' && (
        <div className="bg-dark-card border border-white/10 rounded-lg p-6 space-y-3">
          <div className="flex items-center gap-3 mb-4">
            <Zap className="text-amber-500" size={24} />
            <h3 className="font-bold text-white">Order Clusters ({clusters.length})</h3>
          </div>

          {clusters.length === 0 ? (
            <p className="text-gray-500 text-sm">No clusters detected</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {clusters.map((cluster, idx) => (
                <div key={idx} className="bg-dark-surface/50 rounded p-3 text-xs">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-white">
                      ₹{cluster.centerPrice.toFixed(2)}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-bold ${
                      cluster.direction === 'BUY'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}>
                      {cluster.direction}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-gray-400">
                    <div>Vol: {cluster.totalVolume.toFixed(0)}</div>
                    <div>Impact: {(cluster.impactScore * 100).toFixed(0)}%</div>
                    <div>Intensity: {(cluster.intensity * 100).toFixed(0)}%</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
