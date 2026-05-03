/**
 * Centralized API Configuration
 * Single source of truth for all API URLs
 */

import { getEnvironmentConfig } from './env-detection';

function isLocalHostname(hostname: string): boolean {
  const name = hostname.toLowerCase();
  return (
    name === 'localhost' ||
    name === '127.0.0.1' ||
    name.startsWith('192.168.') ||
    name.startsWith('10.') ||
    name.endsWith('.local')
  );
}

function isLocalUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return isLocalHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function getBrowserOriginFallback(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.location.origin;
}

function getBrowserWsFallback(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/market`;
}

function normalizeResolvedUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function shouldRejectLocalUrlOnPublicHost(value: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return isLocalUrl(value) && !isLocalHostname(window.location.hostname);
}

/**
 * Get API base URL based on environment
 * Uses environment detection to automatically switch between local and production
 */
export function getApiUrl(): string {
  // Priority 1: Explicit environment variable
  if (process.env.NEXT_PUBLIC_API_URL) {
    const explicit = normalizeResolvedUrl(process.env.NEXT_PUBLIC_API_URL);
    if (!shouldRejectLocalUrlOnPublicHost(explicit)) {
      return explicit;
    }
  }

  // Priority 2: Environment-based detection
  const config = getEnvironmentConfig();
  const detected = normalizeResolvedUrl(config.apiUrl || '');
  if (detected && !shouldRejectLocalUrlOnPublicHost(detected)) {
    return detected;
  }

  // Final fallback for production safety: same-origin API.
  return getBrowserOriginFallback();
}

/**
 * Get WebSocket URL based on environment
 */
export function getWebSocketUrl(): string {
  // Priority 1: Explicit environment variable
  if (process.env.NEXT_PUBLIC_WS_URL) {
    const explicit = normalizeResolvedUrl(process.env.NEXT_PUBLIC_WS_URL);
    if (!shouldRejectLocalUrlOnPublicHost(explicit)) {
      return explicit;
    }
  }

  // Priority 2: Environment-based detection
  const config = getEnvironmentConfig();
  const detected = normalizeResolvedUrl(config.wsUrl || '');
  if (detected && !shouldRejectLocalUrlOnPublicHost(detected)) {
    return detected;
  }

  return getBrowserWsFallback();
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
