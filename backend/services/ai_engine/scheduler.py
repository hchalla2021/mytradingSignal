"""
AI Scheduler - 3-Minute Event Loop
Professional market analysis engine
"""
import asyncio
from typing import Dict, Any
from datetime import datetime
from .feature_builder import FeatureBuilder
from .risk_engine import RiskEngine
from .llm_client import LLMClient
from .decision_engine import DecisionEngine
from .alert_service import TwilioAlertService
import time


class AIScheduler:
    """Run AI analysis every 3 minutes."""
    
    def __init__(self, market_feed, cache_service, websocket_manager):
        """Initialize AI engine components."""
        self.market_feed = market_feed
        self.cache = cache_service
        self.websocket_manager = websocket_manager
        
        # AI Components
        self.feature_builder = FeatureBuilder()
        self.risk_engine = RiskEngine()
        self.llm_client = LLMClient()
        self.decision_engine = DecisionEngine()
        self.alert_service = TwilioAlertService()
        
        # State
        self.running = False
        self.last_analysis = {}
        self.analysis_interval = 180  # 3 minutes
        
        print("🤖 AI Engine initialized")
    
    async def start(self):
        """Start the 3-minute analysis loop."""
        self.running = True
        print("🚀 Starting AI analysis loop (every 3 minutes)...")
        
        while self.running:
            try:
                # Get latest market data
                symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
                
                for symbol in symbols:
                    await self._analyze_symbol(symbol)
                
                # Wait 3 minutes before next cycle
                await asyncio.sleep(self.analysis_interval)
                
            except Exception as e:
                print(f"❌ AI loop error: {e}")
                await asyncio.sleep(60)  # Retry after 1 minute on error
    
    async def get_latest_analysis(self, symbol: str) -> Dict[str, Any]:
        """Get the latest analysis for a symbol."""
        return self.last_analysis.get(symbol)
    
    async def _analyze_symbol(self, symbol: str):
        """Analyze single symbol with full AI pipeline."""
        start_time = time.time()
        
        try:
            # Step 1: Get market data
            market_data = await self.cache.get_market_data(symbol)
            if not market_data:
                print(f"⚠️ No market data for {symbol}")
                return
            
            # Step 2: Build features (<20ms)
            features = self.feature_builder.build_features(market_data)
            
            # Step 3: Detect extremes (<10ms)
            alerts = self.risk_engine.detect_extremes(features)
            risk_score = self.risk_engine.get_risk_score(features)
            
            # Step 4: LLM analysis (<300ms)
            if self.llm_client.enabled:
                ai_analysis = await self.llm_client.analyze_market_async(features)
            else:
                ai_analysis = self.llm_client._get_fallback_analysis(features)
            
            # Step 5: Build decision (<10ms)
            result = self.decision_engine.build_ui_response(
                features, ai_analysis, alerts, risk_score
            )
            
            # Calculate latency
            latency_ms = (time.time() - start_time) * 1000
            result['meta']['latency_ms'] = round(latency_ms, 2)
            
            # Log performance
            print(f"✅ {symbol} analyzed in {latency_ms:.0f}ms")
            
            # Step 6: Send alerts if conditions met
            await self._handle_alerts(symbol, features, result, alerts)
            
            # Step 7: Cache result
            await self.cache.set(f"ai_analysis:{symbol}", result, expire=300)
            self.last_analysis[symbol] = result
            
            # Step 8: Broadcast to WebSocket clients
            await self.websocket_manager.broadcast_ai_update(symbol, result)
            
        except Exception as e:
            print(f"❌ Error analyzing {symbol}: {e}")
    
    async def _handle_alerts(
        self,
        symbol: str,
        features: Dict[str, Any],
        result: Dict[str, Any],
        alerts: list
    ):
        """Send WhatsApp alerts for critical conditions."""
        
        # Check for crash risk
        crash_alerts = [a for a in alerts if a['type'] == 'CRASH_RISK']
        if crash_alerts:
            self.alert_service.send_crash_alert(symbol, features)
        
        # Check for strong buy signal (>80%)
        signal_strength = result['signal']['strength']
        if signal_strength >= 80 and result['signal']['bias'] == 'Long':
            self.alert_service.send_strong_buy_alert(symbol, result)
        
        # Check for buy the dip
        self.alert_service.send_buy_dip_alert(symbol, features)
        
        # Check for institutional activity
        institutional_alerts = [a for a in alerts if a['type'] == 'INSTITUTIONAL_ACTIVITY']
        if institutional_alerts:
            self.alert_service.send_institutional_activity(symbol, features)
    
    async def get_latest_analysis(self, symbol: str) -> Dict[str, Any]:
        """Get latest cached analysis."""
        cached = await self.cache.get(f"ai_analysis:{symbol}")
        if cached:
            return cached
        
        return self.last_analysis.get(symbol, {})
    
    def stop(self):
        """Stop the analysis loop."""
        self.running = False
        print("⏹️ AI analysis loop stopped")
