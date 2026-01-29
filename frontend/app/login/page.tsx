"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const searchParams = useSearchParams();
  const router = useRouter();

  // Handle callback from Zerodha
  useEffect(() => {
    const status = searchParams.get("status");
    const userId = searchParams.get("user_id");
    const errorMessage = searchParams.get("message");

    if (status === "success" && userId) {
      setLoading(false);
      setMessage(`✅ Success! Authenticated as ${userId}`);
      
      // Redirect to dashboard after 2 seconds
      setTimeout(() => {
        router.push("/");
      }, 2000);
    } else if (status === "error") {
      setLoading(false);
      setError(errorMessage || "Zerodha authentication failed. Please try again.");
    }
  }, [searchParams, router]);

  const handleLoginClick = () => {
    if (typeof window === 'undefined') return;
    
    setLoading(true);
    setMessage("Opening Zerodha login...");
    
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) {
      setMessage("❌ API URL not configured in .env.local");
      setLoading(false);
      return;
    }
    
    // Detect mobile device - guarded for SSR
    const isMobile = typeof navigator !== 'undefined' && 
      (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768);
    
    if (isMobile) {
      // Mobile: Direct navigation
      window.location.href = `${apiUrl}/api/auth/login`;
    } else {
      // Desktop: Open in popup with larger size for 2FA
      const popup = window.open(
        `${apiUrl}/api/auth/login`,
        'ZerodhaLogin',
        'width=800,height=800,scrollbars=yes,resizable=yes,top=100,left=200'
      );
      
      if (!popup) {
        // Popup blocked, fallback to direct navigation
        setMessage("Popup blocked! Redirecting in same window...");
        setTimeout(() => {
          window.location.href = `${apiUrl}/api/auth/login`;
        }, 1500);
        return;
      }

      // Monitor popup for completion
      const checkPopup = setInterval(() => {
        try {
          if (popup.closed) {
            clearInterval(checkPopup);
            setLoading(false);
            setMessage("Login window closed. Checking authentication...");
            
            // Revalidate after popup closes
            setTimeout(() => {
              router.push('/');
            }, 2000);
          }
        } catch (e) {
          // Continue monitoring
        }
      }, 500);

      // Cleanup after 10 minutes
      setTimeout(() => {
        clearInterval(checkPopup);
        if (!popup.closed) {
          setLoading(false);
          setMessage("Please complete login in the popup window");
        }
      }, 600000); // 10 minutes
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-2xl shadow-2xl p-8 max-w-md w-full border border-gray-700">
        
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-4">📈</div>
          <h1 className="text-3xl font-bold text-white mb-2">
            MyDailyTradingSignals
          </h1>
          <p className="text-gray-400 text-sm">
            Connect with Zerodha for live market data
          </p>
        </div>

        {/* Status Messages */}
        {message && (
          <div className="mb-6 p-4 bg-blue-900/50 border border-blue-700 rounded-lg">
            <p className="text-blue-200 text-sm text-center">{message}</p>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-900/50 border border-red-700 rounded-lg">
            <p className="text-red-200 text-sm text-center">{error}</p>
          </div>
        )}

        {/* Login Button */}
        <button
          onClick={handleLoginClick}
          disabled={loading}
          className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 
                     text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 
                     disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl
                     flex items-center justify-center gap-3"
        >
          {loading ? (
            <>
              <svg
                className="animate-spin h-5 w-5"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <span>Connecting...</span>
            </>
          ) : (
            <>
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
                />
              </svg>
              <span>Login with Zerodha</span>
            </>
          )}
        </button>

        {/* Info */}
        <div className="mt-8 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">
            🔒 Secure Authentication
          </h3>
          <ul className="text-xs text-gray-400 space-y-1">
            <li>• Token valid for 24 hours</li>
            <li>• Auto-saves credentials</li>
            <li>• No manual token entry needed</li>
            <li>• Secure OAuth 2.0 flow</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
