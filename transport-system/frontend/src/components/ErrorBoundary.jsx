import { Component, createContext, useContext, useState, useCallback } from 'react';

const ErrorContext = createContext(null);

export function useErrorBoundary() {
  return useContext(ErrorContext);
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryKey: 0,
    };
    this.retryCount = 0;
    this.maxRetries = 1;
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });

    // Log in development only. Never log secrets/tokens/API keys.
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary] Caught rendering error:', error.message);
      console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    }

    // In production, send to a logging service if available.
    if (!import.meta.env.DEV && typeof window !== 'undefined') {
      try {
        const report = {
          message: error.message,
          name: error.name,
          stack: error.stack,
          componentStack: errorInfo.componentStack,
          url: window.location.href,
          timestamp: new Date().toISOString(),
        };
        // Replace with your production logging endpoint.
        // navigator.sendBeacon('/api/errors', JSON.stringify(report));
      } catch {
        // Ignore logging failures.
      }
    }
  }

  handleRetry = () => {
    if (this.retryCount < this.maxRetries) {
      this.retryCount += 1;
      this.setState((prev) => ({ hasError: false, error: null, errorInfo: null, retryKey: prev.retryKey + 1 }));
    }
  };

  handleRefresh = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      const canRetry = this.retryCount < this.maxRetries;
      const { fallback, onError } = this.props;

      if (fallback) {
        return fallback({
          error: this.state.error,
          retry: this.handleRetry,
          refresh: this.handleRefresh,
          canRetry,
        });
      }

      return (
        <ErrorContext.Provider value={{ error: this.state.error, retry: this.handleRetry, refresh: this.handleRefresh }}>
          <div className="min-h-screen flex items-center justify-center bg-surface p-4">
            <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
              <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h1 className="text-xl font-bold text-gray-900 mb-2">Something went wrong.</h1>
              <p className="text-gray-600 mb-6">
                We couldn't load this page. This is usually temporary.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                {canRetry && (
                  <button
                    onClick={this.handleRetry}
                    className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                  >
                    Try Again
                  </button>
                )}
                <button
                  onClick={this.handleRefresh}
                  className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Refresh Page
                </button>
                <a
                  href="/admin"
                  className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors inline-block"
                >
                  Go to Dashboard
                </a>
              </div>
            </div>
          </div>
        </ErrorContext.Provider>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
