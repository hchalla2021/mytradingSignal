'use client';

import React, { useState, useEffect } from 'react';
import { AlertTriangle, Bell, Clock } from 'lucide-react';

interface Alert {
  alertId: string;
  symbol: string;
  alertType: string;
  severity: string;
  severityScore: number;
  timestamp: string;
  title: string;
  description: string;
  currentPrice: number;
  targetPrice?: number;
  confidence: number;
  isActive: boolean;
}

/**
 * 🚨 SMART MONEY ALERT PANEL
 * 
 * Real-time professional alert system displaying:
 * - Institutional activity alerts
 * - Order imbalance warnings
 * - Smart money pattern detection
 * - Breakout probability alerts
 */
export function SmartMoneyAlertPanel({ symbol }: { symbol: string }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/smart-money/alerts/${symbol}`);
        if (response.ok) {
          const data = await response.json();
          setAlerts(data.alerts || []);
        }
      } catch (error) {
        console.error('Error fetching alerts:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAlerts();
    const interval = setInterval(fetchAlerts, 5000);
    return () => clearInterval(interval);
  }, [symbol]);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return 'border-red-500/50 bg-red-500/5 text-red-400';
      case 'HIGH':
        return 'border-orange-500/50 bg-orange-500/5 text-orange-400';
      case 'MEDIUM':
        return 'border-amber-500/50 bg-amber-500/5 text-amber-400';
      case 'LOW':
        return 'border-blue-500/50 bg-blue-500/5 text-blue-400';
      default:
        return 'border-gray-500/50 bg-gray-500/5 text-gray-400';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
      case 'HIGH':
        return <AlertTriangle size={16} />;
      case 'MEDIUM':
        return <Clock size={16} />;
      default:
        return <Bell size={16} />;
    }
  };

  const activeAlerts = alerts.filter(a => a.isActive);
  const expiredAlerts = alerts.filter(a => !a.isActive);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell size={18} className="text-blue-400" />
          <h3 className="font-bold text-white">Trading Alerts</h3>
          {activeAlerts.length > 0 && (
            <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-xs font-bold">
              {activeAlerts.length} Active
            </span>
          )}
        </div>
      </div>

      {loading && alerts.length === 0 ? (
        <div className="bg-dark-card rounded-lg p-4 animate-pulse">
          <div className="h-20 bg-dark-surface rounded"></div>
        </div>
      ) : activeAlerts.length === 0 ? (
        <div className="bg-dark-card border border-white/10 rounded-lg p-4 text-center text-gray-500 text-sm">
          No active alerts at this time
        </div>
      ) : (
        <div className="space-y-3">
          {activeAlerts.map((alert) => (
            <div
              key={alert.alertId}
              className={`border rounded-lg p-4 transition-all cursor-pointer ${getSeverityColor(alert.severity)}`}
              onClick={() => setExpandedId(expandedId === alert.alertId ? null : alert.alertId)}
            >
              {/* Alert Header */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  {getSeverityIcon(alert.severity)}
                  <div>
                    <h4 className="font-bold text-white text-sm">{alert.title}</h4>
                    <p className="text-xs opacity-75">{alert.alertType.replace(/_/g, ' ')}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold">
                    {(alert.confidence * 100).toFixed(0)}%
                  </div>
                  <div className="text-xs opacity-75">Confidence</div>
                </div>
              </div>

              {/* Alert Body */}
              <p className="text-xs mb-3 opacity-90">{alert.description}</p>

              {/* Price Info */}
              <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                <div>
                  <span className="opacity-75">Current: </span>
                  <span className="font-bold">₹{alert.currentPrice.toFixed(2)}</span>
                </div>
                {alert.targetPrice && (
                  <div>
                    <span className="opacity-75">Target: </span>
                    <span className="font-bold">₹{alert.targetPrice.toFixed(2)}</span>
                  </div>
                )}
              </div>

              {/* Timestamp */}
              <div className="text-xs opacity-60">
                {new Date(alert.timestamp).toLocaleTimeString()}
              </div>

              {/* Expanded Details */}
              {expandedId === alert.alertId && (
                <div className="mt-4 pt-4 border-t border-current/20 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="opacity-75">Alert ID:</span>
                    <span className="font-mono text-xs">{alert.alertId.slice(-8)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="opacity-75">Severity:</span>
                    <span className="font-bold">{alert.severity}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Expired Alerts Section */}
      {expiredAlerts.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-semibold text-gray-500 hover:text-gray-300 transition-colors">
            Expired Alerts ({expiredAlerts.length})
          </summary>
          <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
            {expiredAlerts.map((alert) => (
              <div key={alert.alertId} className="bg-dark-surface/30 rounded p-2 text-xs text-gray-500">
                <div className="flex justify-between">
                  <span>{alert.title}</span>
                  <span>{new Date(alert.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
