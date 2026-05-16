'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { BarChart3, Target } from 'lucide-react';

interface VolumePulseProfileProps {
  symbol: string;
  refreshInterval?: number;
}

interface VolumeProfile {
  pointOfControl: number;
  valueAreaHigh: number;
  valueAreaLow: number;
  valueAreaVolume: number;
  profileShape: string;
  concentration: number;
  totalVolume: number;
  priceLevels: Record<string, number>;
}

/**
 * VolumePulseProfile - Volume distribution and support/resistance visualization
 * 
 * Displays volume profile across price levels with institutional zone identification,
 * point of control, and value area visualization.
 * 
 * Performance: <30ms render, efficient price level rendering
 * Desktop: Full heatmap visualization with interactive levels
 */
export default function VolumePulseProfile({
  symbol,
  refreshInterval = 3000,
}: VolumePulseProfileProps) {
  const [profile, setProfile] = useState<VolumeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'heatmap' | 'levels' | 'zones'>('heatmap');

  const fetchProfile = useCallback(async () => {
    try {
      const response = await fetch(`/api/volume-pulse/profile/${symbol}`);
      if (!response.ok) throw new Error('Failed to fetch profile');
      
      const data = await response.json();
      setProfile(data.profile);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchProfile();
    const interval = setInterval(fetchProfile, refreshInterval);
    return () => clearInterval(interval);
  }, [symbol, refreshInterval, fetchProfile]);

  if (loading) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-1/3"></div>
          <div className="h-64 bg-slate-800 rounded"></div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800 text-slate-400">
        {error || 'No profile data available'}
      </div>
    );
  }

  const maxVolume = Math.max(...Object.values(profile.priceLevels || {}), 1);
  const priceKeys = Object.keys(profile.priceLevels || {}).sort((a, b) => parseFloat(a) - parseFloat(b));

  const getShapeColor = (shape: string) => {
    switch (shape) {
      case 'BELL': return 'text-emerald-400';
      case 'SKEWED_HIGH': return 'text-teal-400';
      case 'SKEWED_LOW': return 'text-amber-400';
      case 'FLAT': return 'text-slate-400';
      default: return 'text-slate-400';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Volume Profile</h1>
          <p className="text-sm text-slate-400">{symbol}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveView('heatmap')}
            className={`px-4 py-2 rounded font-medium transition ${
              activeView === 'heatmap'
                ? 'bg-emerald-500 text-black'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            Heatmap
          </button>
          <button
            onClick={() => setActiveView('levels')}
            className={`px-4 py-2 rounded font-medium transition ${
              activeView === 'levels'
                ? 'bg-emerald-500 text-black'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            Levels
          </button>
          <button
            onClick={() => setActiveView('zones')}
            className={`px-4 py-2 rounded font-medium transition ${
              activeView === 'zones'
                ? 'bg-emerald-500 text-black'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            Zones
          </button>
        </div>
      </div>

      {/* Key Levels Card */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <h2 className="text-sm font-semibold text-slate-400 mb-4 flex items-center gap-2">
          <Target size={16} /> Key Price Levels
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Point of Control */}
          <div className="bg-gradient-to-br from-emerald-950 to-emerald-900 rounded-lg p-4 border border-emerald-700">
            <p className="text-xs text-emerald-300 font-semibold">POINT OF CONTROL</p>
            <p className="text-2xl font-bold text-emerald-400 mt-2">
              {profile.pointOfControl.toFixed(2)}
            </p>
            <p className="text-xs text-emerald-300 mt-2">Highest volume price level</p>
          </div>

          {/* Value Area High */}
          <div className="bg-gradient-to-br from-teal-950 to-teal-900 rounded-lg p-4 border border-teal-700">
            <p className="text-xs text-teal-300 font-semibold">VALUE AREA HIGH</p>
            <p className="text-2xl font-bold text-teal-400 mt-2">
              {profile.valueAreaHigh.toFixed(2)}
            </p>
            <p className="text-xs text-teal-300 mt-2">Top of 70% volume</p>
          </div>

          {/* Value Area Low */}
          <div className="bg-gradient-to-br from-purple-950 to-purple-900 rounded-lg p-4 border border-purple-700">
            <p className="text-xs text-purple-300 font-semibold">VALUE AREA LOW</p>
            <p className="text-2xl font-bold text-purple-400 mt-2">
              {profile.valueAreaLow.toFixed(2)}
            </p>
            <p className="text-xs text-purple-300 mt-2">Bottom of 70% volume</p>
          </div>
        </div>
      </div>

      {/* Profile Characteristics */}
      <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
        <h2 className="text-sm font-semibold text-slate-400 mb-4">Profile Characteristics</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-800 rounded p-4">
            <p className="text-xs text-slate-500">Shape</p>
            <p className={`text-lg font-semibold mt-2 ${getShapeColor(profile.profileShape)}`}>
              {profile.profileShape}
            </p>
          </div>
          <div className="bg-slate-800 rounded p-4">
            <p className="text-xs text-slate-500">Concentration</p>
            <div className="mt-2">
              <p className="text-lg font-semibold text-emerald-400">
                {(profile.concentration * 100).toFixed(0)}%
              </p>
              <div className="w-full bg-slate-700 rounded h-2 mt-2">
                <div
                  className="h-full bg-emerald-500 rounded"
                  style={{ width: `${profile.concentration * 100}%` }}
                ></div>
              </div>
            </div>
          </div>
          <div className="bg-slate-800 rounded p-4">
            <p className="text-xs text-slate-500">Total Volume</p>
            <p className="text-lg font-semibold text-emerald-400 mt-2">
              {(profile.totalVolume / 1000000).toFixed(2)}M
            </p>
          </div>
        </div>
      </div>

      {/* Main Content Areas */}
      {activeView === 'heatmap' && (
        <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
          <h2 className="text-sm font-semibold text-slate-400 mb-4 flex items-center gap-2">
            <BarChart3 size={16} /> Volume Distribution Heatmap
          </h2>
          
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {priceKeys.slice(-20).reverse().map((priceStr) => {
              const price = parseFloat(priceStr);
              const volume = profile.priceLevels[priceStr];
              const percentage = (volume / maxVolume) * 100;
              
              const isHighlight = 
                price === profile.pointOfControl ||
                (price <= profile.valueAreaHigh && price >= profile.valueAreaLow);
              
              return (
                <div key={price} className="flex items-center gap-3">
                  <div className="w-20 text-right">
                    <p className="text-sm font-semibold text-white">{price.toFixed(2)}</p>
                  </div>
                  <div className="flex-1 relative h-8 bg-slate-800 rounded overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 flex items-center justify-end pr-3 ${
                        isHighlight
                          ? percentage > 50
                            ? 'bg-gradient-to-r from-emerald-900 to-emerald-500'
                            : 'bg-gradient-to-r from-slate-800 to-emerald-700'
                          : percentage > 50
                            ? 'bg-gradient-to-r from-slate-800 to-blue-600'
                            : 'bg-gradient-to-r from-slate-800 to-slate-700'
                      }`}
                      style={{ width: `${percentage}%` }}
                    >
                      {percentage > 10 && (
                        <span className="text-xs font-semibold text-white">
                          {(volume / 1000).toFixed(0)}K
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="w-16 text-right">
                    <p className="text-xs text-slate-500">{percentage.toFixed(0)}%</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeView === 'levels' && (
        <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
          <h2 className="text-sm font-semibold text-slate-400 mb-4">Price Levels by Volume</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-3 px-4 text-slate-400">Price</th>
                  <th className="text-left py-3 px-4 text-slate-400">Volume</th>
                  <th className="text-left py-3 px-4 text-slate-400">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {priceKeys.slice(-10).reverse().map((priceStr) => {
                  const price = parseFloat(priceStr);
                  const volume = profile.priceLevels[priceStr];
                  const percentage = (volume / maxVolume) * 100;
                  
                  return (
                    <tr key={price} className="border-b border-slate-800 hover:bg-slate-800 transition">
                      <td className="py-3 px-4 font-semibold text-white">{price.toFixed(2)}</td>
                      <td className="py-3 px-4 text-emerald-400">{(volume / 1000).toFixed(0)}K</td>
                      <td className="py-3 px-4 text-slate-400">{percentage.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeView === 'zones' && (
        <div className="bg-slate-900 rounded-lg p-6 border border-slate-800">
          <h2 className="text-sm font-semibold text-slate-400 mb-4">Volume Zones</h2>
          <div className="space-y-4">
            <div className="bg-emerald-950 rounded-lg p-4 border border-emerald-700">
              <p className="text-xs font-semibold text-emerald-300">VALUE AREA</p>
              <p className="text-sm text-emerald-400 mt-2">
                {profile.valueAreaLow.toFixed(2)} - {profile.valueAreaHigh.toFixed(2)}
              </p>
              <p className="text-xs text-emerald-300 mt-2">
                Contains 70% of total volume ({(profile.valueAreaVolume / 1000000).toFixed(2)}M)
              </p>
            </div>

            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <p className="text-xs font-semibold text-slate-400">SUPPORT ZONE</p>
              <p className="text-sm text-slate-300 mt-2">Below {profile.valueAreaLow.toFixed(2)}</p>
              <p className="text-xs text-slate-500 mt-2">Lower price levels with accumulation potential</p>
            </div>

            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <p className="text-xs font-semibold text-slate-400">RESISTANCE ZONE</p>
              <p className="text-sm text-slate-300 mt-2">Above {profile.valueAreaHigh.toFixed(2)}</p>
              <p className="text-xs text-slate-500 mt-2">Higher price levels with distribution potential</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
