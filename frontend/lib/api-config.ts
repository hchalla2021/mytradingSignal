/**
 * Centralized API Configuration
 * Single source of truth for all API URLs
 */

import { getEnvironmentConfig } from './env-detection';

/**
 * Get API base URL based on environment
 * Uses environment detection to automatically switch between local and production
 */
export function getApiUrl(): string {
  // Priority 1: Explicit environment variable
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }

  // Priority 2: Environment-based detection
  const config = getEnvironmentConfig();
  return config.apiUrl;
}

/**
 * Get WebSocket URL based on environment
 */
export function getWebSocketUrl(): string {
  // Priority 1: Explicit environment variable
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }

  // Priority 2: Environment-based detection
  const config = getEnvironmentConfig();
  return config.wsUrl;
}

/**
 * API Configuration object
 * Use this throughout the app for consistency
 */
export const API_CONFIG = {
  /**
   * Get base API URL
   */
  get baseUrl(): string {
    return getApiUrl();
  },

  /**
   * Get WebSocket URL
   */
  get wsUrl(): string {
    return getWebSocketUrl();
  },

  /**
   * Build full API endpoint URL
   */
  endpoint(path: string): string {
    const base = this.baseUrl;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${normalizedPath}`;
  },
} as const;
