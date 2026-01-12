'use client';

import { useEffect, useState } from 'react';
import { getEnvironmentConfig, logEnvironment } from '@/lib/env-detection';

export default function TestEnvironment() {
  const [config, setConfig] = useState<any>(null);

  useEffect(() => {
    const envConfig = getEnvironmentConfig();
    setConfig(envConfig);
    logEnvironment();
  }, []);

  if (!config) return <div>Loading...</div>;

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>🌍 Environment Detection Test</h1>
      
      <div style={{ marginTop: '20px', padding: '15px', background: '#f5f5f5', borderRadius: '8px' }}>
        <h2>Current Configuration:</h2>
        <table style={{ width: '100%', marginTop: '10px' }}>
          <tbody>
            <tr>
              <td style={{ padding: '8px', fontWeight: 'bold' }}>Environment:</td>
              <td style={{ padding: '8px' }}>{config.displayName} {config.badge}</td>
            </tr>
            <tr>
              <td style={{ padding: '8px', fontWeight: 'bold' }}>Hostname:</td>
              <td style={{ padding: '8px' }}>{typeof window !== 'undefined' ? window.location.hostname : 'N/A'}</td>
            </tr>
            <tr>
              <td style={{ padding: '8px', fontWeight: 'bold' }}>Full URL:</td>
              <td style={{ padding: '8px' }}>{typeof window !== 'undefined' ? window.location.href : 'N/A'}</td>
            </tr>
            <tr style={{ background: '#e8f5e9' }}>
              <td style={{ padding: '8px', fontWeight: 'bold' }}>API URL:</td>
              <td style={{ padding: '8px', color: '#2e7d32' }}>{config.apiUrl}</td>
            </tr>
            <tr style={{ background: '#e3f2fd' }}>
              <td style={{ padding: '8px', fontWeight: 'bold' }}>WebSocket URL:</td>
              <td style={{ padding: '8px', color: '#1565c0' }}>{config.wsUrl}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '20px', padding: '15px', background: '#fff3e0', borderRadius: '8px' }}>
        <h3>🔍 Detection Logic:</h3>
        <ul>
          <li><strong>Local:</strong> localhost, 127.0.0.1, 192.168.x.x, 10.x.x.x</li>
          <li><strong>Production:</strong> mydailytradesignals.com</li>
        </ul>
      </div>

      <div style={{ marginTop: '20px', padding: '15px', background: '#ffebee', borderRadius: '8px' }}>
        <h3>✅ Test Login URL:</h3>
        <p>When you click Login, it should redirect to:</p>
        <code style={{ 
          display: 'block', 
          padding: '10px', 
          background: 'white', 
          borderRadius: '4px',
          marginTop: '10px',
          wordBreak: 'break-all'
        }}>
          {config.apiUrl}/api/auth/login
        </code>
        
        <button 
          onClick={() => {
            const loginUrl = `${config.apiUrl}/api/auth/login`;
            alert(`Would redirect to:\n${loginUrl}\n\nCheck if this is correct!`);
            console.log('Login URL:', loginUrl);
          }}
          style={{
            marginTop: '15px',
            padding: '10px 20px',
            background: '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          Test Login URL
        </button>
      </div>

      <div style={{ marginTop: '20px' }}>
        <a href="/" style={{ color: '#1976d2' }}>← Back to Home</a>
      </div>
    </div>
  );
}
