'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const requestToken = searchParams.get('request_token');
    const status = searchParams.get('status');

    if (status === 'success' && requestToken) {
      // Send token to backend
      fetch(`http://localhost:8000/api/auth/set-token?request_token=${requestToken}`, {
        method: 'POST',
      })
        .then(response => response.json())
        .then(data => {
          if (data.status === 'success') {
            // If opened in popup, close it, otherwise redirect
            if (window.opener) {
              window.opener.postMessage({ type: 'AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              // Not a popup, redirect to main page
              setTimeout(() => {
                router.push('/');
              }, 1000);
            }
          } else {
            alert('Authentication failed. Please try again.');
            router.push('/');
          }
        })
        .catch(err => {
          console.error('Error setting token:', err);
          alert('Failed to authenticate. Please try again.');
          router.push('/');
        });
    } else {
      alert('Authentication failed or was cancelled.');
      window.close();
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
