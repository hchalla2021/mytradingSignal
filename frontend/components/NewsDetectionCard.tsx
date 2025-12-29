"use client";

import React, { useEffect, useState } from 'react';
import { Badge } from './ui/Badge';

/**
 * News/Event Detection Card
 * ═══════════════════════════════════════════════════════════
 * Real-time news impact analysis with sentiment detection
 * Performance: 5-second auto-refresh with aggressive caching
 * 
 * Features:
 * - Sentiment analysis (POSITIVE, NEGATIVE, NEUTRAL)
 * - Market impact scoring (CRITICAL, HIGH, MEDIUM, LOW)
 * - Shock event detection
 * - Top 5 headline display
 * 
 * Styling: Matches PCR/OI section (orange theme for news alerts)
 */

interface NewsItem {
  title: string;
  description: string;
  source: string;
  published_at: string;
  url: string;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  impact_score: number;
  keywords: string[];
}

interface NewsDetectionData {
  symbol: string;
  news_count: number;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  impact_level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  shock_detected: boolean;
  top_headlines: NewsItem[];
  last_update: string;
  status: string;
}

interface NewsDetectionCardProps {
  symbol: string;
  name: string;
}

const NewsDetectionCard: React.FC<NewsDetectionCardProps> = React.memo(({ symbol, name }) => {
  const [data, setData] = useState<NewsDetectionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNews = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
      const response = await fetch(`${apiUrl}/api/advanced/news-detection/${symbol}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      console.error(`[NEWS] Error fetching ${symbol}:`, err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
    
    // Auto-refresh interval from env
    const refreshInterval = parseInt(process.env.NEXT_PUBLIC_REFRESH_INTERVAL || '5000', 10);
    const interval = setInterval(fetchNews, refreshInterval);
    
    return () => clearInterval(interval);
  }, [symbol]);

  // Helper functions
  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'POSITIVE':
        return 'text-green-400';
      case 'NEGATIVE':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  const getSentimentBg = (sentiment: string) => {
    switch (sentiment) {
      case 'POSITIVE':
        return 'bg-green-500/20 border-green-500/40';
      case 'NEGATIVE':
        return 'bg-red-500/20 border-red-500/40';
      default:
        return 'bg-gray-500/20 border-gray-500/40';
    }
  };

  const getImpactColor = (level: string) => {
    switch (level) {
      case 'CRITICAL':
        return 'text-red-500 font-bold animate-pulse';
      case 'HIGH':
        return 'text-orange-400 font-semibold';
      case 'MEDIUM':
        return 'text-yellow-400';
      default:
        return 'text-gray-400';
    }
  };

  const getSentimentEmoji = (sentiment: string) => {
    switch (sentiment) {
      case 'POSITIVE':
        return '📈';
      case 'NEGATIVE':
        return '📉';
      default:
        return '📰';
    }
  };

  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return 'N/A';
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-900/60 backdrop-blur-sm rounded-lg p-4 border border-orange-500/30 animate-pulse">
        <div className="h-6 bg-gray-700/50 rounded w-3/4 mb-3"></div>
        <div className="h-4 bg-gray-700/50 rounded w-1/2"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-900/60 backdrop-blur-sm rounded-lg p-4 border border-red-500/30">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xl">⚠️</span>
          <h3 className="text-base font-semibold text-red-400">{name}</h3>
        </div>
        <p className="text-sm text-red-400/70">Error: {error}</p>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="bg-gray-900/60 backdrop-blur-sm rounded-lg p-4 border border-orange-500/30 hover:border-orange-500/50 transition-all duration-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{getSentimentEmoji(data.sentiment)}</span>
          <h3 className="text-base font-semibold text-white">{name}</h3>
        </div>
        
        {/* Shock Alert */}
        {data.shock_detected && (
          <div className="flex items-center gap-1 px-2 py-1 bg-red-500/20 border border-red-500/40 rounded-full animate-pulse">
            <span className="text-xs text-red-400 font-bold">🚨 SHOCK</span>
          </div>
        )}
      </div>

      {/* Sentiment & Impact */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* Sentiment */}
        <div className={`p-2.5 rounded-lg border ${getSentimentBg(data.sentiment)}`}>
          <div className="text-xs text-gray-400 font-bold mb-1">Sentiment</div>
          <div className={`text-sm font-semibold ${getSentimentColor(data.sentiment)}`}>
            {data.sentiment}
          </div>
        </div>

        {/* Impact Level */}
        <div className="p-2.5 rounded-lg bg-orange-500/10 border border-orange-500/30">
          <div className="text-xs text-gray-400 font-bold mb-1">Impact</div>
          <div className={`text-sm font-semibold ${getImpactColor(data.impact_level)}`}>
            {data.impact_level}
          </div>
        </div>
      </div>

      {/* News Count */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-700/50">
        <span className="text-xs text-gray-400 font-bold">Recent News</span>
        <span className="text-sm font-mono text-orange-400 font-semibold">
          {data.news_count} articles
        </span>
      </div>

      {/* Top Headlines */}
      {data.top_headlines && data.top_headlines.length > 0 ? (
        <div className="space-y-2 mb-3">
          <div className="text-xs text-gray-400 font-bold mb-2">📰 Top Headlines</div>
          {data.top_headlines.slice(0, 3).map((headline, idx) => (
            <a
              key={idx}
              href={headline.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block p-2 rounded-lg bg-gray-800/40 hover:bg-gray-800/60 border border-gray-700/30 hover:border-orange-500/30 transition-all duration-200"
            >
              <div className="flex items-start gap-2">
                <span className={`text-xs font-bold ${getSentimentColor(headline.sentiment)}`}>
                  {headline.sentiment === 'POSITIVE' ? '▲' : headline.sentiment === 'NEGATIVE' ? '▼' : '●'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white/90 line-clamp-2 leading-relaxed">
                    {headline.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-500">{headline.source}</span>
                    <span className="text-xs text-gray-600">•</span>
                    <span className="text-xs text-orange-400/70">
                      Impact: {headline.impact_score}%
                    </span>
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className="text-center py-3 text-xs text-gray-500">
          No recent news found
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse"></div>
          <span className="text-xs text-gray-500">
            {data.status.includes('WAITING') || data.status.includes('ERROR') 
              ? data.status 
              : 'LIVE'
            }
          </span>
        </div>
        <span className="text-xs text-gray-500 font-mono">
          {formatTime(data.last_update)}
        </span>
      </div>
    </div>
  );
});

NewsDetectionCard.displayName = 'NewsDetectionCard';

export default NewsDetectionCard;
