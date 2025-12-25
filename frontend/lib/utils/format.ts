/**
 * Formatting Utilities - Type-Safe Data Formatters
 * Production-ready helpers for numbers, currency, percentages
 */

import { DISPLAY_FORMATS } from '../constants';

/**
 * Format number as Indian currency
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '₹—';
  }
  
  return `₹${value.toLocaleString(DISPLAY_FORMATS.LARGE_NUMBER_FORMAT, {
    minimumFractionDigits: DISPLAY_FORMATS.PRICE_DECIMALS,
    maximumFractionDigits: DISPLAY_FORMATS.PRICE_DECIMALS,
  })}`;
}

/**
 * Format percentage with sign
 */
export function formatPercentage(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '—%';
  }
  
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(DISPLAY_FORMATS.PERCENT_DECIMALS)}%`;
}

/**
 * Format large numbers with K/L/Cr suffixes
 */
export function formatLargeNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '—';
  }

  const absValue = Math.abs(value);
  
  if (absValue >= 10000000) {
    // Crores (1,00,00,000)
    return `${(value / 10000000).toFixed(2)} Cr`;
  } else if (absValue >= 100000) {
    // Lakhs (1,00,000)
    return `${(value / 100000).toFixed(2)} L`;
  } else if (absValue >= 1000) {
    // Thousands (1,000)
    return `${(value / 1000).toFixed(2)} K`;
  }
  
  return value.toLocaleString(DISPLAY_FORMATS.LARGE_NUMBER_FORMAT);
}

/**
 * Format Open Interest
 */
export function formatOI(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '—';
  }
  
  return formatLargeNumber(value);
}

/**
 * Format change value with sign and color class
 */
export function formatChange(value: number | null | undefined): {
  formatted: string;
  colorClass: string;
} {
  if (value === null || value === undefined || isNaN(value)) {
    return { formatted: '—', colorClass: 'text-gray-500' };
  }
  
  const sign = value > 0 ? '+' : '';
  const formatted = `${sign}${value.toFixed(DISPLAY_FORMATS.PRICE_DECIMALS)}`;
  const colorClass = value > 0 ? 'text-bullish' : value < 0 ? 'text-bearish' : 'text-gray-500';
  
  return { formatted, colorClass };
}

/**
 * Format time to IST string
 */
export function formatTime(date: Date | string | null | undefined): string {
  if (!date) return '--:--:--';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  return dateObj.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Format date to Indian format
 */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  
  return dateObj.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Format timestamp to relative time (e.g., "2 minutes ago")
 */
export function formatRelativeTime(timestamp: string | Date | null | undefined): string {
  if (!timestamp) return '—';
  
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  
  return formatDate(date);
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength)}...`;
}

/**
 * Format confidence as percentage
 */
export function formatConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '—%';
  }
  
  return `${Math.round(value * 100)}%`;
}
