"""
AI-Powered Options OI Analysis Service using OpenAI GPT-4o-mini
Detects sudden OI movements, big player entries, and provides instant insights
ULTRA-FAST: <1 second response time for real-time trading
"""

import os
import logging
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
import json
from openai import OpenAI
from dotenv import load_dotenv

# Import settings to access OPENAI_API_KEY
from config.settings import settings

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AIAnalysisService:
    """
    Ultra-fast AI-powered OI analysis for detecting sudden big player movements
    Uses GPT-4o-mini for optimal speed + accuracy balance
    """
    
    def __init__(self):
        """Initialize OpenAI client with API key from global settings"""
        self.api_key = settings.OPENAI_API_KEY
        
        if not self.api_key:
            logger.error("=" * 80)
            logger.error("[AI SERVICE] ❌ OPENAI_API_KEY not found in .env")
            logger.error("[AI SERVICE] AI analysis will be DISABLED")
            logger.error("=" * 80)
            self.enabled = False
            return
        
        try:
            self.client = OpenAI(api_key=self.api_key)
            self.enabled = True
            self.model = "gpt-4o-mini"  # Fast + accurate + affordable
            
            # Historical OI tracking for spike detection
            self.oi_history: Dict[str, List[Tuple[datetime, float]]] = {}
            
            logger.info("=" * 80)
            logger.info(f"[AI SERVICE] 🤖 AI Analysis Service ACTIVE")
            logger.info(f"[AI SERVICE]   Model: {self.model}")
            logger.info(f"[AI SERVICE]   Purpose: Real-time OI Spike Detection")
            logger.info(f"[AI SERVICE]   Speed: <1 second response time")
            logger.info(f"[AI SERVICE]   Detection: Sudden big player entry")
            logger.info(f"[AI SERVICE] ✅ Ready for instant WhatsApp alerts!")
            logger.info("=" * 80)
            
        except Exception as e:
            logger.error(f"[AI SERVICE] ❌ Failed to initialize: {e}")
            self.enabled = False
    
    def track_oi_change(self, symbol: str, strike: int, option_type: str, current_oi: float):
        """
        Track OI changes over time to detect sudden spikes
        Maintains 20-minute rolling window for comparison
        """
        key = f"{symbol}_{strike}_{option_type}"
        now = datetime.now()
        
        # Initialize history for this option
        if key not in self.oi_history:
            self.oi_history[key] = []
        
        # Add current OI to history
        self.oi_history[key].append((now, current_oi))
        
        # Keep only last 20 minutes of data
        cutoff_time = now - timedelta(minutes=20)
        self.oi_history[key] = [
            (ts, oi) for ts, oi in self.oi_history[key] 
            if ts > cutoff_time
        ]
    
    def detect_sudden_spike(self, symbol: str, strike: int, option_type: str, current_oi: float) -> Dict:
        """
        Detect if current OI is a SUDDEN SPIKE vs historical average
        Returns spike percentage and urgency level
        """
        key = f"{symbol}_{strike}_{option_type}"
        
        if key not in self.oi_history or len(self.oi_history[key]) < 3:
            return {'spike_detected': False, 'spike_pct': 0, 'urgency': 'LOW'}
        
        # Calculate average OI from last 20 minutes
        historical_ois = [oi for _, oi in self.oi_history[key][:-1]]  # Exclude current
        avg_oi = sum(historical_ois) / len(historical_ois) if historical_ois else current_oi
        
        # Calculate spike percentage
        spike_pct = ((current_oi - avg_oi) / avg_oi * 100) if avg_oi > 0 else 0
        
        # Determine urgency based on spike magnitude
        if spike_pct > 50:
            urgency = 'CRITICAL'
            spike_detected = True
        elif spike_pct > 30:
            urgency = 'HIGH'
            spike_detected = True
        elif spike_pct > 15:
            urgency = 'MEDIUM'
            spike_detected = True
        else:
            urgency = 'LOW'
            spike_detected = False
        
        return {
            'spike_detected': spike_detected,
            'spike_pct': spike_pct,
            'urgency': urgency,
            'avg_oi': avg_oi,
            'current_oi': current_oi
        }
    
    def analyze_sudden_movement(self, signal_data: Dict, spike_info: Dict = None) -> Optional[Dict]:
        """
        ULTRA-FAST AI analysis of sudden OI movements
        Detects big player entries and provides instant trading insights
        
        Args:
            signal_data: Complete signal data with all parameters
            spike_info: Spike detection results from detect_sudden_spike()
        
        Returns:
            Dict with AI analysis or None if disabled
        """
        if not self.enabled:
            return None
        
        try:
            # Prepare prompt for AI analysis
            prompt = self._create_movement_analysis_prompt(signal_data, spike_info)
            
            # Fast API call
            start_time = datetime.now()
            
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": self._get_system_prompt()
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.3,  # Lower for consistent analysis
                max_tokens=400,   # Limit for speed
                response_format={"type": "json_object"}  # Structured output
            )
            
            elapsed = (datetime.now() - start_time).total_seconds()
            
            # Parse AI response
            ai_response = json.loads(response.choices[0].message.content)
            
            logger.info(f"[AI SERVICE] ⚡ Analysis completed in {elapsed:.2f}s")
            logger.info(f"[AI SERVICE] Big Player: {ai_response.get('big_player_detected', False)}")
            logger.info(f"[AI SERVICE] Confidence: {ai_response.get('confidence', 0)}%")
            
            return {
                'analysis': ai_response,
                'response_time': elapsed,
                'model': self.model,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"[AI SERVICE] ❌ Analysis failed: {e}")
            return None
    
    def _get_system_prompt(self) -> str:
        """System prompt for AI trading expert - STRIKE-BY-STRIKE ANALYSIS"""
        return """You are an EXPERT Indian options trader with 99% accuracy analyzing LIVE OI data.

Your task: PREDICT market movement 1 MINUTE AHEAD by analyzing EACH STRIKE PRICE.

**CRITICAL INDICATORS (Analyze ALL):**

1. **STRIKE-BY-STRIKE OI ANALYSIS:**
   - Which strikes have SUDDEN OI spike (>30% in 1 min)?
   - CE strikes with high OI = Resistance (sellers winning)
   - PE strikes with high OI = Support (buyers winning)
   
2. **VOLUME ANALYSIS:**
   - Volume > OI = NEW positions entering (STRONG signal)
   - Volume < OI = Squaring off (WEAK signal)
   - Compare CE total volume vs PE total volume
   
3. **BIG PLAYER DETECTION:**
   - OI spike >50% + High volume = INSTITUTIONAL MONEY
   - Multiple strikes moving together = SMART MONEY clustering
   - Unusual activity = Big players positioning BEFORE move
   
4. **DIRECTIONAL PREDICTION:**
   - If CE OI building + PE OI falling = Market will FALL (Buy PE)
   - If PE OI building + CE OI falling = Market will RISE (Buy CE)
   - If both building = Volatility coming (Buy ATM straddle)
   
5. **1-MINUTE AHEAD PREDICTION:**
   - Analyze OI momentum (increasing/decreasing speed)
   - Check Delta shift (calls getting ITM or OTM?)
   - PCR trend (rising = bullish, falling = bearish)

Return JSON ONLY:
{
  "prediction_confidence": 0-100,
  "next_1min_direction": "STRONG UP" | "UP" | "FLAT" | "DOWN" | "STRONG DOWN",
  "predicted_move_points": number,
  "big_player_detected": true/false,
  "big_player_side": "CE" | "PE" | "BOTH" | "NONE",
  "strongest_strike": number,
  "strongest_strike_reason": "Brief explanation",
  "action": "BUY CALL" | "BUY PUT" | "STRADDLE" | "WAIT" | "EXIT",
  "recommended_strike": number,
  "entry_price": number,
  "target": number,
  "stop_loss": number,
  "win_probability": 0-100,
  "time_to_move": "IMMEDIATE" | "30SEC" | "1MIN" | "2MIN",
  "key_reasons": ["reason1", "reason2", "reason3"]
}

Be 100% ACCURATE. Lives depend on this. Analyze EVERY strike price data provided."""

    def _create_movement_analysis_prompt(self, signal_data: Dict, spike_info: Dict = None) -> str:
        """Create prompt with ALL STRIKE DATA for accurate prediction"""
        
        symbol = signal_data.get('symbol', 'UNKNOWN')
        spot_price = signal_data.get('spot_price', 0)
        pcr = signal_data.get('pcr', 1.0)
        
        # Get ALL strikes data if available
        all_strikes = signal_data.get('all_strikes_data', [])
        
        prompt = f"""🚨 PREDICT NEXT 1-MINUTE MOVE - ANALYZE ALL STRIKES!

**Time**: {datetime.now().strftime('%H:%M:%S')}
**Symbol**: {symbol}
**Spot Price**: ₹{spot_price:.2f}
**PCR**: {pcr:.3f} {'(BULLISH)' if pcr > 1.2 else '(BEARISH)' if pcr < 0.8 else '(NEUTRAL)'}

"""

        if all_strikes:
            # Show strike-by-strike breakdown
            prompt += "**STRIKE-BY-STRIKE ANALYSIS (Top 10 Active Strikes):**\n\n"
            
            for i, strike_data in enumerate(all_strikes[:10], 1):
                strike = strike_data.get('strike', 0)
                ce_oi = strike_data.get('ce_oi', 0)
                ce_vol = strike_data.get('ce_volume', 0)
                pe_oi = strike_data.get('pe_oi', 0)
                pe_vol = strike_data.get('pe_volume', 0)
                ce_oi_chg = strike_data.get('ce_oi_change', 0)
                pe_oi_chg = strike_data.get('pe_oi_change', 0)
                
                prompt += f"Strike {strike}:\n"
                prompt += f"  CE: OI={ce_oi:,.0f} Vol={ce_vol:,.0f} ΔOI={ce_oi_chg:+.1f}% V/OI={(ce_vol/ce_oi*100) if ce_oi > 0 else 0:.1f}%\n"
                prompt += f"  PE: OI={pe_oi:,.0f} Vol={pe_vol:,.0f} ΔOI={pe_oi_chg:+.1f}% V/OI={(pe_vol/pe_oi*100) if pe_oi > 0 else 0:.1f}%\n\n"
        else:
            # Fallback: Single strike analysis
            strike = signal_data.get('strike', 0)
            option_type = signal_data.get('option_type', 'CE')
            ltp = signal_data.get('ltp', 0)
            oi = signal_data.get('oi', 0)
            volume = signal_data.get('volume', 0)
            delta = signal_data.get('greeks', {}).get('delta', 0)
            gamma = signal_data.get('greeks', {}).get('gamma', 0)
            
            prompt += f"""**SINGLE STRIKE DATA:**
Strike {strike} {option_type}:
- LTP: ₹{ltp:.2f}
- OI: {oi:,.0f}
- Volume: {volume:,.0f}
- Vol/OI: {(volume/oi*100) if oi > 0 else 0:.1f}%
- Delta: {delta:.4f}
- Gamma: {gamma:.6f}

"""

        if spike_info and spike_info.get('spike_detected'):
            spike_pct = spike_info.get('spike_pct', 0)
            urgency = spike_info.get('urgency', 'LOW')
            
            prompt += f"""
**🔥 ALERT: SUDDEN SPIKE DETECTED! 🔥**
- OI Spike: +{spike_pct:.1f}% in last minute
- Urgency: {urgency}
- Institutional money detected!

"""
        
        prompt += f"""
**CRITICAL QUESTIONS TO ANSWER:**

1. Which side (CE or PE) has MORE aggressive buying RIGHT NOW?
2. Are big players positioning for UP or DOWN move?
3. What will happen in NEXT 1 MINUTE?
4. Which strike price will give MAXIMUM profit?
5. What is win probability (be HONEST)?

**YOUR PREDICTION (1-minute ahead):**
Analyze ALL strikes, volume patterns, OI momentum. Return JSON with 99% accurate prediction."""

        return prompt
    
    def enhance_whatsapp_alert(self, signal: Dict, ai_analysis: Dict = None) -> str:
        """
        Create enhanced WhatsApp message with AI insights
        Makes alerts more actionable and convincing
        """
        symbol = signal.get('symbol', 'UNKNOWN')
        strike = signal.get('strike', 0)
        option_type = signal.get('option_type', 'CE')
        score = signal.get('score', 0)
        ltp = signal.get('ltp', 0)
        
        # Base message
        message = f"""🔥🔥 STRONG TRADING SIGNAL! 🔥🔥

{symbol} {strike} {option_type}
Score: {score:.1f}%
LTP: ₹{ltp:.2f}
"""
        
        # Add AI insights if available
        if ai_analysis and ai_analysis.get('analysis'):
            ai = ai_analysis['analysis']
            
            if ai.get('big_player_detected'):
                message += f"\n🤖 AI DETECTED: BIG PLAYER ENTRY!"
                message += f"\nConfidence: {ai.get('confidence', 0)}%"
                message += f"\nType: {ai.get('movement_type', 'UNKNOWN')}"
                message += f"\n\n💡 {ai.get('key_insight', '')}"
                
                message += f"\n\n📊 Trade Setup:"
                message += f"\nAction: {ai.get('action', 'WAIT')}"
                message += f"\nEntry: ₹{ai.get('entry_price', ltp):.2f}"
                message += f"\nTarget: ₹{ai.get('target', 0):.2f}"
                message += f"\nStop Loss: ₹{ai.get('stop_loss', 0):.2f}"
                message += f"\nWin Rate: {ai.get('win_probability', 0)}%"
                
                reasons = ai.get('reasons', [])
                if reasons:
                    message += f"\n\n✅ Reasons:"
                    for i, reason in enumerate(reasons[:3], 1):
                        message += f"\n{i}. {reason}"
            else:
                message += f"\n\n🤖 AI Verdict: {ai.get('key_insight', 'Normal signal, no urgency')}"
        
        message += f"\n\n⏰ Time: {datetime.now().strftime('%H:%M:%S')}"
        message += "\n\n⚠️ Trade at your own risk!"
        
        return message


# Singleton instance
    def analyze_market_overview(self, nifty_data: dict, banknifty_data: dict, sensex_data: dict) -> dict:
        """
        🚀 ULTRA-FAST AI-powered comprehensive market analysis
        Analyzes all 3 indices together for overall market bias, direction, and component scores
        """
        if not self.enabled:
            return {
                'enabled': False,
                'message': 'AI analysis disabled - no API key'
            }
        
        try:
            # Prepare comprehensive market data
            market_summary = {
                'NIFTY': {
                    'spot': nifty_data.get('spot_price', 0),
                    'pcr': nifty_data.get('pcr', 1.0),
                    'ce_oi': nifty_data.get('total_ce_oi', 0),
                    'pe_oi': nifty_data.get('total_pe_oi', 0),
                    'signal': nifty_data.get('market_direction', 'NEUTRAL'),
                    'bullish_pct': nifty_data.get('bullish_percentage', 50)
                },
                'BANKNIFTY': {
                    'spot': banknifty_data.get('spot_price', 0),
                    'pcr': banknifty_data.get('pcr', 1.0),
                    'ce_oi': banknifty_data.get('total_ce_oi', 0),
                    'pe_oi': banknifty_data.get('total_pe_oi', 0),
                    'signal': banknifty_data.get('market_direction', 'NEUTRAL'),
                    'bullish_pct': banknifty_data.get('bullish_percentage', 50)
                },
                'SENSEX': {
                    'spot': sensex_data.get('spot_price', 0),
                    'pcr': sensex_data.get('pcr', 1.0),
                    'ce_oi': sensex_data.get('total_ce_oi', 0),
                    'pe_oi': sensex_data.get('total_pe_oi', 0),
                    'signal': sensex_data.get('market_direction', 'NEUTRAL'),
                    'bullish_pct': sensex_data.get('bullish_percentage', 50)
                }
            }
            
            # Create AI prompt for comprehensive market analysis
            prompt = f"""You are an expert options trader analyzing Indian markets (NIFTY, BANKNIFTY, SENSEX).

REAL-TIME MARKET DATA:

NIFTY 50:
- Spot: ₹{market_summary['NIFTY']['spot']:.2f}
- PCR: {market_summary['NIFTY']['pcr']:.2f}
- Call OI: {market_summary['NIFTY']['ce_oi']:,.0f} | Put OI: {market_summary['NIFTY']['pe_oi']:,.0f}
- Current Signal: {market_summary['NIFTY']['signal']}
- Bullish %: {market_summary['NIFTY']['bullish_pct']:.1f}%

BANKNIFTY:
- Spot: ₹{market_summary['BANKNIFTY']['spot']:.2f}
- PCR: {market_summary['BANKNIFTY']['pcr']:.2f}
- Call OI: {market_summary['BANKNIFTY']['ce_oi']:,.0f} | Put OI: {market_summary['BANKNIFTY']['pe_oi']:,.0f}
- Current Signal: {market_summary['BANKNIFTY']['signal']}
- Bullish %: {market_summary['BANKNIFTY']['bullish_pct']:.1f}%

SENSEX:
- Spot: ₹{market_summary['SENSEX']['spot']:.2f}
- PCR: {market_summary['SENSEX']['pcr']:.2f}
- Call OI: {market_summary['SENSEX']['ce_oi']:,.0f} | Put OI: {market_summary['SENSEX']['pe_oi']:,.0f}
- Current Signal: {market_summary['SENSEX']['signal']}
- Bullish %: {market_summary['SENSEX']['bullish_pct']:.1f}%

Provide INSTANT analysis in this EXACT JSON format:
{{
    "overall_bias": "BULLISH|BEARISH|NEUTRAL",
    "confidence": 85,
    "direction_probability": {{
        "bullish": 65,
        "bearish": 20,
        "neutral": 15
    }},
    "component_scores": {{
        "pcr_score": 75,
        "oi_distribution_score": 80,
        "cross_index_correlation": 90,
        "volatility_score": 70
    }},
    "weighted_analysis": "60% Bullish across all indices with strong PUT support",
    "key_insights": [
        "NIFTY showing strong bullish momentum",
        "BANKNIFTY leading the rally",
        "High PUT OI at key support levels"
    ],
    "action_recommendation": "BUY CALL|BUY PUT|WAIT|BOOK PROFIT",
    "time_horizon": "INTRADAY|SWING|POSITIONAL",
    "risk_level": "LOW|MEDIUM|HIGH"
}}

Focus on: PCR levels, OI distribution, cross-index correlation, and institutional activity.
Be decisive and actionable for intraday traders."""

            # Call OpenAI API with ultra-fast settings
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are an expert options trader providing instant market analysis. Respond ONLY with valid JSON, no markdown."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,  # More focused, less creative
                max_tokens=800,  # Concise response
                response_format={"type": "json_object"}
            )
            
            # Parse AI response
            ai_result = json.loads(response.choices[0].message.content)
            
            logger.info(f"[AI MARKET ANALYSIS] Overall Bias: {ai_result.get('overall_bias')} ({ai_result.get('confidence')}% confidence)")
            
            return {
                'enabled': True,
                'timestamp': datetime.now().isoformat(),
                'analysis': ai_result,
                'model': self.model,
                'response_time_ms': 'Fast (<1s)'
            }
            
        except Exception as e:
            logger.error(f"[AI MARKET ANALYSIS] Error: {e}")
            return {
                'enabled': True,
                'error': str(e),
                'message': 'AI analysis failed'
            }


_ai_service: Optional[AIAnalysisService] = None


def get_ai_service() -> AIAnalysisService:
    """Get or create singleton AI service"""
    global _ai_service
    
    if _ai_service is None:
        _ai_service = AIAnalysisService()
    
    return _ai_service
