'use client'

import { useEffect } from 'react'

// Global error handler for unhandled errors and promise rejections
// This is particularly important for mobile browsers which have varying tolerance levels
export function GlobalErrorHandler() {
  useEffect(() => {
    // Detect mobile environment
    const isMobile = typeof navigator !== 'undefined' && 
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(navigator.userAgent);
    
    const getBrowserInfo = () => {
      if (typeof navigator === 'undefined') return 'Server';
      const ua = navigator.userAgent;
      if (/Chrome/i.test(ua) && !/Edg|OPR|Samsung/i.test(ua)) return 'Chrome Mobile';
      if (/Safari/i.test(ua) && !/Chrome|Edg|OPR/i.test(ua)) return 'Safari Mobile';
      if (/Firefox/i.test(ua)) return 'Firefox Mobile';
      if (/Samsung/i.test(ua)) return 'Samsung Internet';
      if (/OPR|Opera/i.test(ua)) return 'Opera Mobile';
      if (/Edg/i.test(ua)) return 'Edge Mobile';
      return `Mobile Browser (${ua.split(' ')[0]})`;
    };

    const getDeviceInfo = () => {
      if (typeof navigator === 'undefined') return {};
      const ua = navigator.userAgent;
      return {
        isAndroid: /Android/i.test(ua),
        isIOS: /iPhone|iPad|iPod/i.test(ua),
        isTablet: /Tablet|iPad/i.test(ua),
        connection: (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection,
        memory: (navigator as any).deviceMemory,
        cores: navigator.hardwareConcurrency
      };
    };

    // Handle uncaught JavaScript errors
    const handleError = (event: ErrorEvent) => {
      const browserInfo = getBrowserInfo();
      const deviceInfo = getDeviceInfo();
      
      console.error('Global Error:', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error,
        browser: browserInfo,
        isMobile,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
        viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'Unknown',
        deviceInfo
      })
      
      // Mobile-specific error logging
      if (isMobile) {
        console.warn(`Mobile Error on ${browserInfo}:`, event.message);
      }
      
      // Don't show error dialog in production to prevent disrupting user experience
      if (process.env.NODE_ENV === 'development') {
        const errorMessage = event.message || 'An unexpected error occurred'
        console.warn('Development Error:', errorMessage)
      }
      
      // Prevent default error handling which might show browser error dialog
      event.preventDefault()
      return true
    }

    // Handle unhandled promise rejections (common with WebSocket/Fetch calls)
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const browserInfo = getBrowserInfo();
      const deviceInfo = getDeviceInfo();
      
      console.error('Unhandled Promise Rejection:', {
        reason: event.reason,
        promise: event.promise,
        browser: browserInfo,
        isMobile,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
        deviceInfo
      })
      
      // Mobile browsers often have stricter network policies
      if (isMobile) {
        console.warn(`Mobile Promise Rejection on ${browserInfo}:`, event.reason);
        
        // Common mobile issues
        if (event.reason?.name === 'TypeError' && event.reason?.message?.includes('Failed to fetch')) {
          console.warn('Mobile network request failed - likely poor connection or battery optimization');
        } else if (event.reason?.message?.includes('WebSocket')) {
          console.warn('Mobile WebSocket issue - mobile networks can be unreliable');
        }
      }
      
      // Prevent the default "Uncaught promise rejection" console error
      event.preventDefault()
      
      // Log specific common issues for debugging
      if (event.reason?.name === 'TypeError' && event.reason?.message?.includes('Failed to fetch')) {
        console.warn('Network request failed - this is usually a temporary connectivity issue')
      } else if (event.reason?.message?.includes('WebSocket')) {
        console.warn('WebSocket connection issue - will attempt to reconnect')
      }
      
      return true
    }

    // Add event listeners
    if (typeof window !== 'undefined') {
      window.addEventListener('error', handleError)
      window.addEventListener('unhandledrejection', handleUnhandledRejection)
      
      // Cleanup on unmount
      return () => {
        window.removeEventListener('error', handleError)
        window.removeEventListener('unhandledrejection', handleUnhandledRejection)
      }
    }
  }, [])

  // This component doesn't render anything
  return null
}