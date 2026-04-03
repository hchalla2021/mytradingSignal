/**
 * Error Boundary - Production Error Handling
 * Graceful error recovery with user-friendly messaging
 */

'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught error:', error, errorInfo);
    
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  componentWillUnmount(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Auto-recover only up to MAX_RETRIES to prevent infinite loop
      if (this.state.retryCount < MAX_RETRIES) {
        this.retryTimer = setTimeout(() => {
          this.setState((prev) => ({
            hasError: false,
            error: null,
            retryCount: prev.retryCount + 1,
          }));
        }, RETRY_DELAY_MS);

        return (
          <div className="flex items-center justify-center p-4">
            <div className="text-emerald-400 text-sm animate-pulse">Loading...</div>
          </div>
        );
      }

      // Max retries exhausted — show permanent error UI
      return (
        <div className="flex flex-col items-center justify-center p-6 text-center gap-3">
          <p className="text-red-400 text-sm font-medium">Something went wrong</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null, retryCount: 0 })}
            className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
