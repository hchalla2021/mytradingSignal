"""
AI Scheduler - 3-Minute Event Loop
Professional market analysis engine with full error isolation
"""
import asyncio
from typing import Dict, Any, Optional
from datetime import datetime
from .feature_builder import FeatureBuilder
from .risk_engine import RiskEngine
from .llm_client import LLMClient
from .decision_engine import DecisionEngine
from .alert_service import TwilioAlertService
import time
import traceback


class AIScheduler:
    """Run AI analysis every 3 minutes with complete error isolation."""
    
    def __init__(self, market_feed, cache_service, websocket_manager):
        """Initialize AI engine components with error handling."""
        self.market_feed = market_feed
        self.cache = cache_service
        self.websocket_manager = websocket_manager
        
        # AI Components - wrapped in try-catch
        try:
            self.feature_builder = FeatureBuilder()
            self.risk_engine = RiskEngine()
            self.llm_client = LLMClient()
            self.decision_engine = DecisionEngine()
            self.alert_service = TwilioAlertService()
            print("✅ AI Engine components initialized")
        except Exception as e:
            print(f"⚠️ AI Engine init warning: {e}")
            print("   AI Engine will run with fallback mode")
            self.feature_builder = None
            self.risk_engine = None
            self.llm_client = None
            self.decision_engine = None
            self.alert_service = None
        
        # State
        self.running = False
        self.last_analysis = {}
        self.analysis_interval = 180  # 3 minutes
        self.retry_interval = 60  # 1 minute on error
        
        # Circuit Breaker - disable AI temporarily after repeated failures
        self.failure_count = 0
        self.max_failures = 5
        self.circuit_breaker_active = False
        self.circuit_breaker_reset_time = None
        
        print("🤖 AI Engine initialized with error isolation")
    
    async def start(self):
        """Start the 3-minute analysis loop with full error isolation."""
        self.running = True
        print("🚀 Starting AI analysis loop (every 3 minutes)...")
        print("   - Full error isolation enabled")
        print("   - OpenAI errors won't crash backend")
        print("   - Circuit breaker: 5 failures = 10min cooldown")
        
        while self.running:
            try:
                # Check circuit breaker
                if self.circuit_breaker_active:
                    if datetime.now() > self.circuit_breaker_reset_time:
                        print("🔄 Circuit breaker reset - retrying AI Engine")
                        self.circuit_breaker_active = False
                        self.failure_count = 0
                    else:
                        # Skip this cycle
                        await asyncio.sleep(60)
                        continue
                
                # Get latest market data
                symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
                
                # Analyze each symbol independently (errors in one won't affect others)
                for symbol in symbols:
                    try:
                        await self._analyze_symbol(symbol)
                        # Reset failure count on success
                        if self.failure_count > 0:
                            self.failure_count = max(0, self.failure_count - 1)
                    except Exception as e:
                        # Symbol-level error - log but continue with other symbols
                        print(f"⚠️ AI analysis failed for {symbol}: {str(e)[:100]}")
                        self.failure_count += 1
                        
                        # Activate circuit breaker if too many failures
                        if self.failure_count >= self.max_failures:
                            print(f"🚨 Circuit breaker ACTIVATED - too many AI failures")
                            print(f"   AI Engine paused for 10 minutes")
                            print(f"   InstantSignal continues working normally")
                            self.circuit_breaker_active = True
                            from datetime import timedelta
                            self.circuit_breaker_reset_time = datetime.now() + timedelta(minutes=10)
                
                # Wait 3 minutes before next cycle
                await asyncio.sleep(self.analysis_interval)
                
            except Exception as e:
                # Top-level error - should never happen but handle gracefully
                print(f"❌ AI loop critical error (isolated): {str(e)[:100]}")
                print(f"   Backend continues running normally")
                traceback.print_exc()
                await asyncio.sleep(self.retry_interval)
    
    async def get_latest_analysis(self, symbol: str) -> Dict[str, Any]:
        """Get the latest analysis for a symbol."""
        return self.last_analysis.get(symbol)
    
    async def _analyze_symbol(self, symbol: str):
        """Analyze single symbol with full AI pipeline and error isolation."""
        start_time = time.time()
        
        try:
            # Step 1: Get market data
            market_data = await self.cache.get_market_data(symbol)
            if not market_data:
                print(f"⚠️ No market data for {symbol}")
                return
            
            # Check if components are available (may be None if init failed)
            if not all([self.feature_builder, self.risk_engine, self.decision_engine]):
                print(f"⚠️ AI components not available for {symbol}")
                return
            
            # Step 2: Build features (<20ms)
            features = self.feature_builder.build_features(market_data)
            
            # Step 3: Detect extremes (<10ms)
            alerts = self.risk_engine.detect_extremes(features)
            risk_score = self.risk_engine.get_risk_score(features)
            
            # Step 4: LLM analysis (<300ms) - WRAPPED IN TRY-CATCH
            ai_analysis = None
            try:
                if self.llm_client and self.llm_client.enabled:
                    ai_analysis = await self.llm_client.analyze_market_async(features)
                else:
                    ai_analysis = self.llm_client._get_fallback_analysis(features) if self.llm_client else {}
            except Exception as llm_error:
                # OpenAI error - use fallback, don't crash
                error_msg = str(llm_error)
                if "quota" in error_msg.lower() or "429" in error_msg:
                    print(f"⚠️ {symbol}: OpenAI quota exceeded - using fallback analysis")
                elif "rate_limit" in error_msg.lower():
                    print(f"⚠️ {symbol}: Rate limited - using fallback analysis")
                else:
                    print(f"⚠️ {symbol}: LLM error - using fallback analysis")
                
                # Generate fallback analysis
                ai_analysis = self._generate_fallback_analysis(features)
            
            # Step 5: Build decision (<10ms)
            result = self.decision_engine.build_ui_response(
                features, ai_analysis, alerts, risk_score
            )
            
            # Calculate latency
            latency_ms = (time.time() - start_time) * 1000
            result['meta']['latency_ms'] = round(latency_ms, 2)
            result['meta']['ai_mode'] = 'openai' if ai_analysis and 'insight' in ai_analysis else 'fallback'
            
            # Log performance
            mode = result['meta']['ai_mode']
            print(f"✅ {symbol} analyzed in {latency_ms:.0f}ms (mode: {mode})")
            
            # Step 6: Send alerts if conditions met (wrapped to prevent crashes)
            try:
                await self._handle_alerts(symbol, features, result, alerts)
            except Exception as alert_error:
                print(f"⚠️ Alert sending failed for {symbol}: {str(alert_error)[:50]}")
            
            # Step 7: Cache result
            await self.cache.set(f"ai_analysis:{symbol}", result, expire=300)
            self.last_analysis[symbol] = result
            
            # Step 8: Broadcast to WebSocket clients (wrapped to prevent crashes)
            try:
                await self.websocket_manager.broadcast_ai_update(symbol, result)
            except Exception as ws_error:
                print(f"⚠️ WebSocket broadcast failed for {symbol}: {str(ws_error)[:50]}")
            
        except Exception as e:
            # Symbol-level error - log and re-raise so circuit breaker can handle it
            print(f"❌ Error analyzing {symbol}: {str(e)[:100]}")
            traceback.print_exc()
            raise  # Re-raise to trigger circuit breaker
    
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
    
    def _generate_fallback_analysis(self, features: Dict[str, Any]) -> Dict[str, Any]:
        """Generate basic analysis when OpenAI is unavailable."""
        try:
            price_change = features.get('price_change_percent', 0)
            
            if price_change > 1:
                bias = "bullish"
                insight = "Strong upward momentum detected"
            elif price_change < -1:
                bias = "bearish"
                insight = "Strong downward pressure observed"
            else:
                bias = "neutral"
                insight = "Market consolidating in range"
            
            return {
                "bias": bias,
                "confidence": 0.6,
                "insight": insight,
                "action": "Monitor for breakout",
                "fallback": True
            }
        except Exception as e:
            print(f"⚠️ Fallback generation error: {e}")
            return {
                "bias": "neutral",
                "confidence": 0.5,
                "insight": "Analysis unavailable",
                "action": "Wait for data",
                "fallback": True
            }
    
    def stop(self):
        """Stop the analysis loop gracefully."""
        self.running = False
        print("⏹️ AI analysis loop stopped")
        print("   InstantSignal continues working")
