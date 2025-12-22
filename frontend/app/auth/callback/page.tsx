'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState('Processing...');
  const [error, setError] = useState('');

  useEffect(() => {
    const requestToken = searchParams.get('request_token');
    const authStatus = searchParams.get('status');

    console.log('[CALLBACK] Request Token:', requestToken);
    console.log('[CALLBACK] Status:', authStatus);

    if (!requestToken && !authStatus) {
      setError('No request token found. Login was cancelled or failed.');
      setTimeout(() => window.location.href = '/', 2000);
      return;
    }

    if ((authStatus === 'success' && requestToken) || requestToken) {
      setStatus('Connecting to backend...');
      
      // Retry logic for backend connection
      const sendTokenWithRetry = async (retries = 3) => {
        for (let i = 0; i < retries; i++) {
          try {
            setStatus(`Authenticating... (Attempt ${i + 1}/${retries})`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
            
            const response = await fetch(`${API_URL}/api/auth/set-token?request_token=${requestToken}`, {
              method: 'POST',
              signal: controller.signal,
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
              throw new Error(`Backend returned ${response.status}`);
            }
            
            const data = await response.json();
            console.log('[CALLBACK] Response:', data);
            
            if (data.status === 'success') {
              setStatus('✅ Success! Redirecting...');
              setTimeout(() => window.location.href = '/', 1000);
              return;
            } else {
              throw new Error(data.detail || 'Authentication failed');
            }
          } catch (err: any) {
            console.error(`[CALLBACK] Attempt ${i + 1} failed:`, err);
            
            if (i === retries - 1) {
              // Last retry failed
              if (err.name === 'AbortError') {
                setError('⏱️ Backend timeout. Please ensure backend is running on port 8001.');
              } else if (err.message.includes('fetch')) {
                setError('❌ Cannot connect to backend. Is it running on http://localhost:8001?');
              } else {
                setError(`❌ ${err.message}`);
              }
              setTimeout(() => window.location.href = '/', 3000);
            } else {
              // Wait before retry
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }
        }
      };
      
      sendTokenWithRetry();
    } else {
      setError('Authentication cancelled or failed');
      setTimeout(() => window.location.href = '/', 2000);
    }
  }, [searchParams, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white px-4">
      <div className="text-center max-w-md">
        {!error ? (
          <>
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-500 mx-auto mb-6"></div>
            <p className="text-xl font-semibold mb-2">{status}</p>
            <p className="text-sm text-slate-400">Please wait...</p>
          </>
        ) : (
          <>
            <div className="text-6xl mb-4">⚠️</div>
            <p className="text-xl font-semibold mb-4 text-red-400">{error}</p>
            <p className="text-sm text-slate-400">Redirecting to home...</p>
            <div className="mt-6 p-4 bg-slate-800 rounded-lg text-left text-xs">
              <p className="font-semibold mb-2">Troubleshooting:</p>
              <ul className="list-disc list-inside space-y-1 text-slate-300">
                <li>Ensure backend is running: http://localhost:8001</li>
                <li>Check backend terminal for errors</li>
                <li>Try running: <code className="bg-slate-700 px-1">.\START-SERVERS.ps1</code></li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AuthCallback() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-500"></div>
      </div>
    }>
      <AuthCallbackContent />
    </Suspense>
  );
}
