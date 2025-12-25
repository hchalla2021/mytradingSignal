/**
 * Global Constants - Single Source of Truth
 * Production-ready configuration management
 */

export const MARKET_SYMBOLS = {
  NIFTY: 'NIFTY',
  BANKNIFTY: 'BANKNIFTY',
  SENSEX: 'SENSEX',
} as const;

export const MARKET_NAMES = {
  NIFTY: 'NIFTY 50',
  BANKNIFTY: 'BANK NIFTY',
  SENSEX: 'SENSEX',
} as const;

export const UPDATE_INTERVALS = {
  WEBSOCKET: 3000, // 3 seconds
  CLOCK: 1000, // 1 second
  RECONNECT: 3000, // 3 seconds
  PING: 25000, // 25 seconds
} as const;

export const CACHE_CONFIG = {
  STORAGE_KEY: 'lastMarketData',
  EXPIRE_TIME: 300, // 5 minutes
} as const;

export const API_ENDPOINTS = {
  WS_MARKET: '/ws/market',
  WS_ANALYSIS: '/ws/analysis',
  HEALTH: '/health',
  LOGIN_URL: '/api/auth/login-url',
  LOGIN: '/api/auth/login',
  CALLBACK: '/api/auth/callback',
} as const;

export const ANALYSIS_CONFIG = {
  MIN_CONFIDENCE: 0.6,
  REFRESH_INTERVAL: 5000, // 5 seconds
  LOOKBACK_PERIOD: 50,
} as const;

export const TIME_FILTER = {
  MARKET_OPEN_HOUR: 9,
  MARKET_OPEN_MINUTE: 15,
  MARKET_CLOSE_HOUR: 15,
  MARKET_CLOSE_MINUTE: 30,
  AVOID_FIRST_MINUTES: 15,
  AVOID_LAST_MINUTES: 15,
} as const;

export const DISPLAY_FORMATS = {
  PRICE_DECIMALS: 2,
  PERCENT_DECIMALS: 2,
  OI_DECIMALS: 2,
  LARGE_NUMBER_FORMAT: 'en-IN',
} as const;

export type MarketSymbol = keyof typeof MARKET_SYMBOLS;
export type MarketStatus = 'LIVE' | 'OFFLINE';
