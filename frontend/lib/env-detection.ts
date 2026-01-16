/**
 * Environment Detection Utility
 * Auto-detects whether running in local development or production
 * Works on both client and server side
 */

export type Environment = 'local' | 'production';

/**
 * Detect current environment based on hostname
 * Can be called from both client and server
 */
export function detectEnvironment(): Environment {
  // Check explicit environment variable
  const explicitEnv = process.env.NEXT_PUBLIC_ENVIRONMENT?.toLowerCase();
  if (explicitEnv === 'local' || explicitEnv === 'production') {
    return explicitEnv;
  }

  // Server-side detection
  if (typeof window === 'undefined') {
    // Check Node environment
    const nodeEnv = process.env.NODE_ENV?.toLowerCase();
    if (nodeEnv === 'development') return 'local';
    if (nodeEnv === 'production') {
      // Check if actually running on localhost in production mode
      const host = process.env.HOST || 'localhost';
      if (host.includes('localhost') || host.includes('127.0.0.1')) {
        return 'local';
      }
      return 'production';
    }
    return 'local'; // Default for server
  }

  // Client-side detection based on hostname
  const hostname = window.location.hostname.toLowerCase();

  // Local indicators
  const localIndicators = [
    hostname === 'localhost',
    hostname === '127.0.0.1',
    hostname.startsWith('192.168.'), // Local network
    hostname.startsWith('10.'), // Local network
    hostname.endsWith('.local'),
  ];

  if (localIndicators.some(Boolean)) {
    return 'local';
  }

  // Production domain - check if it matches NEXT_PUBLIC_PRODUCTION_DOMAIN from .env
  const prodDomain = process.env.NEXT_PUBLIC_PRODUCTION_DOMAIN;
  if (prodDomain && (hostname === prodDomain || hostname.endsWith(`.${prodDomain}`))) {
    return 'production';
  }

  // Default to local for development safety
  return 'local';
}

/**
 * Get environment-specific configuration
 */
export function getEnvironmentConfig() {
  const env = detectEnvironment();

  const config = {
    environment: env,
    isProduction: env === 'production',
    isLocal: env === 'local',

    // API URLs - NO FALLBACKS, must be set in .env.local
    apiUrl:
      env === 'production'
        ? process.env.NEXT_PUBLIC_PRODUCTION_API_URL || process.env.NEXT_PUBLIC_API_URL || ''
        : process.env.NEXT_PUBLIC_LOCAL_API_URL || process.env.NEXT_PUBLIC_API_URL || '',

    // WebSocket URLs - NO FALLBACKS, must be set in .env.local
    wsUrl:
      env === 'production'
        ? process.env.NEXT_PUBLIC_PRODUCTION_WS_URL || process.env.NEXT_PUBLIC_WS_URL || ''
        : process.env.NEXT_PUBLIC_LOCAL_WS_URL || process.env.NEXT_PUBLIC_WS_URL || '',

    // Display info
    displayName: env === 'production' ? 'Production' : 'Local Development',
    badge: env === 'production' ? '🏭 PROD' : '🧪 DEV',
  };

  return config;
}

/**
 * Log environment detection (useful for debugging)
 * Only logs in development mode
 */
export function logEnvironment() {
  if (typeof window === 'undefined') return; // Skip on server
  if (process.env.NODE_ENV !== 'development') return; // Skip in production

  const config = getEnvironmentConfig();
  console.log('🌍 Environment Detection:');
  console.log(`   Environment: ${config.displayName} ${config.badge}`);
  console.log(`   Hostname: ${window.location.hostname}`);
  console.log(`   API URL: ${config.apiUrl}`);
  console.log(`   WebSocket URL: ${config.wsUrl}`);
}

// Auto-log on import in development
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  logEnvironment();
}
