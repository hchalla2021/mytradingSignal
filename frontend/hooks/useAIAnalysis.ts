"use client";

import { useEffect, useState } from 'react';
import type { AIAnalysis, AIAlertTooltipData } from '@/types/ai';
import { API_CONFIG } from '@/lib/api-config';

interface UseAIAnalysisReturn {
  analyses: Record<string, AIAnalysis>;
  alertData: Record<string, AIAlertTooltipData>;
  loading: boolean;
  error: string | null;
}

const API_URL = API_CONFIG.baseUrl;

/**
 * Hook to fetch and manage AI analysis for all indices
 * Updates every 3 minutes synchronized with backend
 */
export function useAIAnalysis(): UseAIAnalysisReturn {
  const [analyses, setAnalyses] = useState<Record<string, AIAnalysis>>({});
  const [alertData, setAlertData] = useState<Record<string, AIAlertTooltipData>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch AI analysis from backend
  const fetchAnalysis = async () => {
    try {
      const response = await fetch(`${API_URL}/api/analysis/analyze/all`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch AI analysis');
      }
      
      const data: Record<string, AIAnalysis> = await response.json();
      setAnalyses(data);
      
      // Update alert data for each symbol
      const newAlertData: Record<string, AIAlertTooltipData> = {};
      
      Object.entries(data).forEach(([symbol, analysis]) => {
        newAlertData[symbol] = buildAlertData(analysis);
      });
      
      setAlertData(newAlertData);
      setError(null);
    } catch (err) {
      console.error('AI analysis fetch error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // Build alert data from analysis
  const buildAlertData = (analysis: AIAnalysis): AIAlertTooltipData => {
    // Check for critical alerts
    const criticalAlerts = analysis.alerts.filter(
      alert => alert.level === 'CRITICAL' && alert.show_popup
    );
    
    // Check for high signal strength
    const strongSignal = analysis.signal.strength >= 80;
    
    if (criticalAlerts.length > 0) {
      return {
        showAlert: true,
        level: 'CRITICAL',
        message: criticalAlerts[0].message,
        signalStrength: analysis.signal.strength,
      };
    }
    
    if (strongSignal) {
      const direction = analysis.signal.direction;
      return {
        showAlert: true,
        level: 'HIGH',
        message: `Strong ${direction} signal detected! ${analysis.next_move}`,
        signalStrength: analysis.signal.strength,
      };
    }
    
    return {
      showAlert: false,
      level: 'INFO',
      message: '',
    };
  };

  // Initial fetch and polling every 3 minutes (180 seconds)
  useEffect(() => {
    fetchAnalysis();
    
    const interval = setInterval(() => {
      fetchAnalysis();
    }, 180000); // 3 minutes
    
    return () => clearInterval(interval);
  }, []);

  return {
    analyses,
    alertData,
    loading,
    error,
  };
}
