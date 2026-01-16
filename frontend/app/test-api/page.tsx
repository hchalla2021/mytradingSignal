'use client';

import { useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';

export default function TestAPI() {
  const [results, setResults] = useState<any>({});
  const [loading, setLoading] = useState(false);

  const testAPIs = async () => {
    setLoading(true);
    const apiUrl = API_CONFIG.baseUrl;
    
    try {
      // Test 1: All Analysis
      console.log('Testing /api/advanced/all-analysis/NIFTY...');
      const r1 = await fetch(`${apiUrl}/api/advanced/all-analysis/NIFTY`, { cache: 'no-store' });
      const d1 = await r1.json();
      console.log('All Analysis Response:', d1);
      
      // Test 2: Technical Analysis
      console.log('Testing /api/analysis/analyze/NIFTY...');
      const r2 = await fetch(`${apiUrl}/api/analysis/analyze/NIFTY`, { cache: 'no-store' });
      const d2 = await r2.json();
      console.log('Technical Analysis Response:', d2);
      
      // Test 3: Market Cache
      console.log('Testing /ws/cache/NIFTY...');
      const r3 = await fetch(`${apiUrl}/ws/cache/NIFTY`, { cache: 'no-store' });
      const d3 = await r3.json();
      console.log('Market Cache Response:', d3);
      
      setResults({
        allAnalysis: d1,
        technical: d2,
        marketCache: d3
      });
    } catch (error) {
      console.error('API Test Error:', error);
      setResults({ error: String(error) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>API Test Page</h1>
      <button 
        onClick={testAPIs}
        disabled={loading}
        style={{ 
          padding: '10px 20px', 
          fontSize: '16px', 
          cursor: loading ? 'not-allowed' : 'pointer' 
        }}
      >
        {loading ? 'Testing...' : 'Test All APIs'}
      </button>
      
      <div style={{ marginTop: '20px' }}>
        <h2>Results:</h2>
        <pre style={{ 
          background: '#1e1e1e', 
          color: '#00ff00', 
          padding: '20px', 
          borderRadius: '8px',
          overflow: 'auto',
          maxHeight: '600px'
        }}>
          {JSON.stringify(results, null, 2)}
        </pre>
      </div>
      
      <div style={{ marginTop: '20px', background: '#fff3cd', padding: '15px', borderRadius: '8px' }}>
        <h3>Instructions:</h3>
        <ol>
          <li>Click "Test All APIs" button</li>
          <li>Open DevTools Console (F12)</li>
          <li>Check for errors or data</li>
          <li>Results will appear above</li>
        </ol>
      </div>
    </div>
  );
}
