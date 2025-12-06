'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const requestToken = searchParams.get('request_token');
    const status = searchParams.get('status');

    console.log('[CALLBACK] Request Token:', requestToken); // Debug
    console.log('[CALLBACK] Status:', status); // Debug
    console.log('[CALLBACK] All params:', Object.fromEntries(searchParams.entries())); // Debug

    if (status === 'success' && requestToken) {
      // Send token to backend
      console.log('[CALLBACK] Sending token to backend...'); // Debug
      fetch(`${API_URL}/api/auth/set-token?request_token=${requestToken}`, {
        method: 'POST',
      })
        .then(response => {
          console.log('[CALLBACK] Response status:', response.status); // Debug
          return response.json();
        })
        .then(data => {
          console.log('[CALLBACK] Response data:', data); // Debug
          if (data.status === 'success') {
            // Success! Redirect to main page
            console.log('[CALLBACK] Authentication successful!');
            alert('✅ Authentication successful! Redirecting...');
            setTimeout(() => {
              router.push('/');
            }, 1500);
          } else {
            console.error('[CALLBACK] Auth failed:', data);
            alert(`❌ Authentication failed: ${data.detail || 'Unknown error'}`);
            router.push('/');
          }
        })
        .catch(err => {
          console.error('[CALLBACK] Error setting token:', err);
          alert('❌ Failed to authenticate. Please check backend is running.');
          router.push('/');
        });
    } else if (requestToken && !status) {
      // Zerodha doesn't send status=success, just request_token
      console.log('[CALLBACK] No status param, but request_token exists. Proceeding...'); // Debug
      fetch(`${API_URL}/api/auth/set-token?request_token=${requestToken}`, {
        method: 'POST',
      })
        .then(response => {
          console.log('[CALLBACK] Response status:', response.status); // Debug
          return response.json();
        })
        .then(data => {
          console.log('[CALLBACK] Response data:', data); // Debug
          if (data.status === 'success') {
            console.log('[CALLBACK] Authentication successful!');
            alert('✅ Authentication successful! Redirecting...');
            setTimeout(() => {
              router.push('/');
            }, 1500);
          } else {
            console.error('[CALLBACK] Auth failed:', data);
            alert(`❌ Authentication failed: ${data.detail || 'Unknown error'}`);
            router.push('/');
          }
        })
        .catch(err => {
          console.error('[CALLBACK] Error setting token:', err);
          alert('❌ Failed to authenticate. Please check backend is running.');
          router.push('/');
        });
    } else {
      console.error('[CALLBACK] No request token found');
      console.error('[CALLBACK] URL:', window.location.href); // Debug
      alert('❌ Authentication failed or was cancelled.');
      setTimeout(() => {
        router.push('/');
      }, 2000);
    }
  }, [searchParams, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <p className="text-lg">Completing authentication...</p>
        <p className="text-sm text-slate-400 mt-2">This window will close automatically.</p>
      </div>
    </div>
  );
}
