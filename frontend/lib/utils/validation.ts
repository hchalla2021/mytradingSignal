/**
 * Validation Utilities - Type-Safe Data Validators
 * Production-ready validators for API responses and user input
 */

import { MarketTick } from '@/hooks/useMarketSocket';
import { AnalysisSignal } from '@/types/analysis';

/**
 * Check if value is a valid number
 */
export function isValidNumber(value: any): value is number {
  return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

/**
 * Check if market data is valid
 */
export function isValidMarketData(data: any): data is MarketTick {
  if (!data || typeof data !== 'object') return false;
  
  return (
    typeof data.symbol === 'string' &&
    isValidNumber(data.price) &&
    isValidNumber(data.change) &&
    isValidNumber(data.changePercent) &&
    ['LIVE', 'OFFLINE'].includes(data.status)
  );
}

/**
 * Check if analysis data is valid
 */
export function isValidAnalysis(data: any): data is AnalysisSignal {
  if (!data || typeof data !== 'object') return false;
  
  return (
    typeof data.symbol === 'string' &&
    typeof data.signal === 'string' &&
    isValidNumber(data.confidence) &&
    data.indicators && typeof data.indicators === 'object'
  );
}

/**
 * Sanitize and validate numeric input
 */
export function sanitizeNumber(
  value: any,
  fallback: number = 0,
  min?: number,
  max?: number
): number {
  const num = Number(value);
  
  if (!isValidNumber(num)) {
    return fallback;
  }
  
  if (min !== undefined && num < min) return min;
  if (max !== undefined && num > max) return max;
  
  return num;
}

/**
 * Check if timestamp is fresh (within threshold)
 */
export function isFreshData(timestamp: string | Date, maxAgeMs: number = 60000): boolean {
  try {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const now = new Date();
    const ageMs = now.getTime() - date.getTime();
    
    return ageMs >= 0 && ageMs <= maxAgeMs;
  } catch {
    return false;
  }
}

/**
 * Validate WebSocket message
 */
export function isValidWSMessage(message: any): boolean {
  if (!message || typeof message !== 'object') return false;
  
  return (
    typeof message.type === 'string' &&
    ['tick', 'snapshot', 'heartbeat', 'pong', 'keepalive'].includes(message.type)
  );
}

/**
 * Check if market is open (IST timezone)
 */
export function isMarketOpen(date: Date = new Date()): boolean {
  const istHours = date.getHours();
  const istMinutes = date.getMinutes();
  const dayOfWeek = date.getDay();
  
  // Weekend check
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  
  // Market hours: 9:15 AM to 3:30 PM IST
  const openTime = 9 * 60 + 15; // 9:15 in minutes
  const closeTime = 15 * 60 + 30; // 15:30 in minutes
  const currentTime = istHours * 60 + istMinutes;
  
  return currentTime >= openTime && currentTime <= closeTime;
}

/**
 * Validate confidence score
 */
export function isValidConfidence(value: any): value is number {
  return isValidNumber(value) && value >= 0 && value <= 1;
}
