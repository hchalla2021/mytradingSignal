// Quick test: Check if WebSocket is sending analysis data
const WebSocket = require('ws');

const WS_URL = 'ws://localhost:8000/ws/market';
console.log(`🔌 Connecting to ${WS_URL}...`);

const ws = new WebSocket(WS_URL);

let tickCount = 0;
let analysisCount = 0;

ws.on('open', () => {
  console.log('✅ Connected to WebSocket');
});

ws.on('message', (event) => {
  try {
    const message = JSON.parse(event);
    
    if (message.type === 'tick' || message.type === 'snapshot') {
      const data = message.data;
      
      if (data && data.symbol) {
        tickCount++;
        
        // Check for NIFTY ticks only
        if (data.symbol === 'NIFTY') {
          if (data.analysis) {
            analysisCount++;
            console.log(`✅ [NIFTY-${tickCount}] Analysis found:`);
            console.log(`   - Signal: ${data.analysis.signal}`);
            console.log(`   - Confidence: ${data.analysis.confidence}`);
            console.log(`   - Has indicators: ${!!data.analysis.indicators}`);
            if (data.analysis.indicators) {
              console.log(`   - Indicator count: ${Object.keys(data.analysis.indicators).length}`);
              console.log(`   - Sample: support=${data.analysis.indicators.support}, resistance=${data.analysis.indicators.resistance}`);
            }
          } else {
            console.log(`❌ [NIFTY-${tickCount}] NO analysis in tick!`);
          }
          
          // Stop after 5 NIFTY ticks
          if (tickCount >= 5) {
            console.log(`\n📊 Summary: ${analysisCount}/${tickCount} ticks had analysis`);
            if (analysisCount === 0) {
              console.log('⚠️ WebSocket is NOT sending analysis data!');
            } else {
              console.log('✅ WebSocket IS sending analysis data!');
            }
            process.exit(0);
          }
        }
      }
    }
  } catch (e) {
    console.error('❌ Error parsing message:', e);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error);
});

ws.on('close', () => {
  console.log('❌ WebSocket closed');
});

// Timeout after 30 seconds
setTimeout(() => {
  console.log('❌ Timeout - no NIFTY ticks received');
  process.exit(1);
}, 30000);
