'use client';

import { useEffect, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import { getEnvironmentConfig } from '@/lib/env-detection';

export default function DebugBanner() {
  const [config, setConfig] = useState<any>(null);
  const [wsStatus, setWsStatus] = useState('checking...');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const envConfig = getEnvironmentConfig();
    setConfig({
      environment: envConfig.environment,
      apiUrl: API_CONFIG.baseUrl,
      wsUrl: API_CONFIG.wsUrl,
      hostname: window.location.hostname,
      timestamp: new Date().toISOString(),
    });

    // Test websocket connection - wrapped in try-catch for mobile Safari
    try {
      const ws = new WebSocket(API_CONFIG.wsUrl);
      ws.onopen = () => setWsStatus('✅ Connected');
      ws.onerror = () => setWsStatus('❌ Failed');
      ws.onclose = () => setWsStatus('⚠️ Closed');
      
      setTimeout(() => {
        try { ws.close(); } catch (e) { /* ignore */ }
      }, 2000);
    } catch (e) {
      setWsStatus('❌ WS Init Failed');
      console.error('WebSocket init error:', e);
    }
  }, []);

  if (!config) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      background: 'linear-gradient(to right, #fffbeb, #fef3c7)',
      borderTop: '2px solid #fbbf24',
      color: '#78350f',
      padding: '12px 20px',
      fontSize: '13px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      zIndex: 9999,
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '12px',
      boxShadow: '0 -4px 12px rgba(251, 191, 36, 0.15)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ 
          fontSize: '16px',
          fontWeight: 'bold',
          background: config.environment === 'production' ? '#dc2626' : '#10b981',
          color: 'white',
          padding: '2px 10px',
          borderRadius: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        }}>
          {config.environment === 'production' ? '🏭 LIVE' : '🧪 DEV'}
        </span>
        <span style={{ fontSize: '12px', opacity: 0.8 }}>{config.hostname}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <strong style={{ color: '#92400e' }}>API:</strong>
        <span style={{ 
          fontSize: '11px', 
          fontFamily: 'monospace',
          background: 'rgba(251, 191, 36, 0.2)',
          padding: '2px 8px',
          borderRadius: '4px',
        }}>
          {config.apiUrl}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <strong style={{ color: '#92400e' }}>WebSocket:</strong>
        <span style={{ fontWeight: '600' }}>{wsStatus}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <strong style={{ color: '#92400e' }}>⏰</strong>
        <span>{new Date(config.timestamp).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
