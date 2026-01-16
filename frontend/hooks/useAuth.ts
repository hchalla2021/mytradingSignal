'use client';

import { useState, useEffect, useCallback } from 'react';
import { API_CONFIG } from '@/lib/api-config';

// Production-safe logging
const isDev = process.env.NODE_ENV === 'development';
const log = {
  debug: (...args: unknown[]) => isDev && console.log(...args),
  warn: (...args: unknown[]) => isDev && console.warn(...args),
  error: console.error,
};

interface AuthState {
  isAuthenticated: boolean;
  isValidating: boolean;
  user: {
    userId?: string;
    userName?: string;
    email?: string;
  } | null;
  error: string | null;
}

const API_URL = API_CONFIG.baseUrl;
const AUTH_STORAGE_KEY = 'zerodha_auth_state';
const VALIDATION_INTERVAL = 5 * 60 * 1000; // Revalidate every 5 minutes

export function useAuth() {
  // Always start with consistent default state for SSR hydration
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    isValidating: true,
    user: null,
    error: null,
  });
  
  // Track revalidation in progress to prevent duplicate calls
  const [isRevalidating, setIsRevalidating] = useState(false);

  // Load cached state after mount (client-side only)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem(AUTH_STORAGE_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          const age = Date.now() - (parsed.timestamp || 0);
          
          // Use cached data if less than 5 minutes old (optimistic auth)
          // Reduced from 1 hour to 5 minutes for faster token expiry detection
          if (age < 5 * 60 * 1000) {
            setAuthState({
              isAuthenticated: parsed.isAuthenticated || false,
              isValidating: false, // Don't show loading on cached data
              user: parsed.user || null,
              error: parsed.error || null,
            });
            log.debug('Loaded cached auth state (age: ' + Math.round(age / 1000) + 's)');
          } else {
            log.debug('Cached auth state expired, will revalidate');
            localStorage.removeItem(AUTH_STORAGE_KEY);
          }
        } catch (e) {
          log.warn('Failed to parse cached auth state');
          localStorage.removeItem(AUTH_STORAGE_KEY);
        }
      }

      // Listen for auth success messages from popup
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'zerodha-auth-success') {
          log.debug('Received auth success message from popup - forcing revalidation');
          // Clear cache to force fresh validation
          localStorage.removeItem(AUTH_STORAGE_KEY);
          // Revalidate immediately
          validateToken();
        }
      };

      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, []);

  const validateToken = useCallback(async () => {
    // Prevent duplicate validation calls
    if (isRevalidating) {
      log.debug('Validation already in progress, skipping...');
      return;
    }
    
    setIsRevalidating(true);
    
    try {
      // Use AbortController for faster cancellation
      const controller = new AbortController();
      const timeout = parseInt(process.env.NEXT_PUBLIC_API_TIMEOUT || '8000', 10); // Increased to 8s for Zerodha API
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      log.debug('Validating token with backend...');
      
      const response = await fetch(`${API_URL}/api/auth/validate`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        cache: 'no-store', // Prevent caching to get fresh token status
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error('Validation request failed');
      }

      const data = await response.json();
      log.debug('Token validation response:', data);

      if (data.valid) {
        // Token is valid
        const newState: AuthState = {
          isAuthenticated: true,
          isValidating: false,
          user: {
            userId: data.user_id,
            userName: data.user_name,
            email: data.email,
          },
          error: null,
        };
        setAuthState(newState);
        
        // Save to localStorage with timestamp
        if (typeof window !== 'undefined') {
          localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
            timestamp: Date.now(),
            ...newState,
          }));
        }
        
        log.debug('✅ Token valid - User authenticated:', data.user_name);
      } else {
        // Token is invalid or doesn't exist
        log.warn('❌ Token invalid:', data.message);
        
        setAuthState({
          isAuthenticated: false,
          isValidating: false,
          user: null,
          error: data.message || 'Authentication required',
        });
        
        // Clear localStorage
        if (typeof window !== 'undefined') {
          localStorage.removeItem(AUTH_STORAGE_KEY);
        }
      }
    } catch (error: any) {
      // Handle errors gracefully
      if (error.name === 'AbortError') {
        log.warn('Auth validation timed out - keeping current state');
      } else {
        log.error('Token validation error:', error);
      }
      
      // On error, don't update state - keep cached/current state
      // But mark as not validating
      setAuthState(prev => ({
        ...prev,
        isValidating: false,
      }));
    } finally {
      setIsRevalidating(false);
    }
  }, [isRevalidating]);

  // Initial validation on mount (background, non-blocking)
  useEffect(() => {
    // Validate in background without blocking
    validateToken();
  }, [validateToken]);

  // Periodic revalidation - every 2 minutes for faster token expiry detection
  useEffect(() => {
    const interval = setInterval(validateToken, 2 * 60 * 1000); // 2 minutes
    return () => clearInterval(interval);
  }, [validateToken]);

  const login = useCallback(() => {
    // Detect mobile device
    const isMobile = typeof window !== 'undefined' && (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768);
    
    if (isMobile) {
      // Mobile: Direct navigation
      window.location.href = `${API_URL}/api/auth/login`;
    } else {
      // Desktop: Open popup with better configuration
      const popup = window.open(
        `${API_URL}/api/auth/login`,
        'ZerodhaLogin',
        'width=800,height=800,scrollbars=yes,resizable=yes,top=100,left=200'
      );
      
      // If popup blocked or failed, fallback to direct navigation
      if (!popup) {
        log.debug('Popup blocked, using direct navigation');
        window.location.href = `${API_URL}/api/auth/login`;
        return;
      }

      // Monitor popup for successful authentication
      const pollTimer = setInterval(() => {
        try {
          // Check if popup is closed
          if (popup.closed) {
            clearInterval(pollTimer);
            log.debug('Popup closed, revalidating token...');
            // Wait for backend to save token, then revalidate and reload
            setTimeout(async () => {
              await validateToken();
              log.debug('Reloading page to show updated auth state...');
              window.location.reload();
            }, 3000);
            return;
          }

          // Try to check if popup navigated to success page (same origin)
          try {
            if (popup.location.href.includes('/login?status=success') || 
                popup.location.href.includes('auth=success')) {
              clearInterval(pollTimer);
              popup.close();
              validateToken();
            }
          } catch (e) {
            // Cross-origin error - popup is on Zerodha domain, which is expected
            // Continue monitoring
          }
        } catch (e) {
          // Error accessing popup, might be closed
          clearInterval(pollTimer);
        }
      }, 500); // Check every 500ms

      // Cleanup after 10 minutes (enough time for 2FA)
      setTimeout(() => {
        clearInterval(pollTimer);
      }, 600000); // 10 minutes timeout
    }
  }, [validateToken]);

  const logout = useCallback(() => {
    // Clear local state
    setAuthState({
      isAuthenticated: false,
      isValidating: false,
      user: null,
      error: null,
    });

    // Clear localStorage
    if (typeof window !== 'undefined') {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }

    // Optional: Call backend logout endpoint
    fetch(`${API_URL}/api/auth/logout`, {
      method: 'POST',
    }).catch(log.error);
  }, []);

  return {
    ...authState,
    login,
    logout,
    revalidate: validateToken,
  };
}
