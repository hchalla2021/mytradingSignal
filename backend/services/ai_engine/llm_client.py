"""
LLM Client - OpenAI GPT-4 Integration
Zero Hallucination, Data-Driven Analysis
"""
# Make OpenAI optional - backend can run without it
try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False
    OpenAI = None
    print("⚠️ OpenAI not installed - AI analysis will use fallback logic")
    print("   Install: pip install openai")

from typing import Dict, Any, Optional
import json
import os
from datetime import datetime


class LLMClient:
    """Professional market analysis using OpenAI GPT-4."""
    
    SYSTEM_PROMPT = """You are a professional derivatives trader with 25 years of experience in Indian markets.

CRITICAL RULES:
1. You ONLY analyze numeric data provided
2. You NEVER assume or make up missing data
3. You NEVER give financial advice or recommendations
4. Output MUST be valid JSON
5. Be data-driven, not speculative
6. Focus on PROBABILITY, not certainty
7. Keep reasoning concise (max 50 words)

Your analysis must be:
- Objective and factual
- Based ONLY on provided metrics
- Explainable and transparent
- Risk-aware"""

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None, 
                 temperature: Optional[float] = None, max_tokens: Optional[int] = None,
                 timeout: Optional[int] = None):
        """Initialize OpenAI client with configurable parameters."""
        from config import get_settings
        settings = get_settings()
        
        # Check if OpenAI is available
        if not OPENAI_AVAILABLE:
            print("⚠️ OpenAI module not installed - AI analysis using fallback logic")
            print("   To enable: pip install openai")
            self.enabled = False
            self.client = None
            return
        
        self.api_key = api_key or settings.openai_api_key
        self.enabled = bool(self.api_key)
        
        if not self.enabled:
            print("⚠️ OPENAI_API_KEY not configured - AI analysis disabled")
            print("   Add OPENAI_API_KEY to .env to enable GPT-4 intelligence")
            self.client = None
            return
        
        try:
            self.client = OpenAI(api_key=self.api_key, timeout=timeout or settings.openai_timeout)
            self.model = model or settings.openai_model
            self.temperature = temperature if temperature is not None else settings.openai_temperature
            self.max_tokens = max_tokens or settings.openai_max_tokens
            print(f"✅ OpenAI {self.model} enabled")
        except Exception as e:
            print(f"⚠️ OpenAI initialization failed: {e}")
            self.enabled = False
            self.client = None
    
    def analyze_market(self, features: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analyze market features and generate trading insights.
        Target latency: < 300ms
        """
        # Return fallback if not enabled
        if not self.enabled or not self.client:
            return self._get_fallback_analysis(features)
        
        try:
            prompt = self._build_prompt(features)
            
            response = self.client.chat.completions.create(
                model=self.model,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {"role": "user", "content": prompt}
                ]
            )
            
            result_text = response.choices[0].message.content
            result = json.loads(result_text)
            
            # Add metadata
            result["timestamp"] = datetime.now().isoformat()
            result["model"] = self.model
            result["tokens_used"] = response.usage.total_tokens
            
            return result
            
        except json.JSONDecodeError as e:
            print(f"❌ JSON parsing error: {e}")
            return self._get_fallback_analysis(features)
        except Exception as e:
            print(f"❌ LLM analysis error: {e}")
            return self._get_fallback_analysis(features)
    
    def _build_prompt(self, features: Dict[str, Any]) -> str:
        """Build optimized prompt for market analysis."""
        
        prompt = f"""Analyze this LIVE market snapshot:

**PRICE & STRUCTURE**
• Symbol: {features.get('symbol')}
• Current Price: ₹{features.get('price', 0):,.2f}
• Gap from Open: {features.get('gap_pct', 0):.2f}%
• Distance from VWAP: {features.get('vwap_distance_pct', 0):.2f}%
• Price Position in Day Range: {features.get('price_position_in_range', 50):.0f}%
• Near High: {features.get('near_high', False)}
• Near Low: {features.get('near_low', False)}

**VOLUME & LIQUIDITY**
• Volume Spike: {features.get('volume_spike_pct', 0):.0f}% of average
• Volume Status: {features.get('volume_status', 'UNKNOWN')}

**OPEN INTEREST (Real Money)**
• OI Change: {features.get('oi_change_pct', 0):.2f}%
• OI Intensity: {features.get('oi_intensity', 'UNKNOWN')}

**OPTIONS INTELLIGENCE**
• PCR (Put-Call Ratio): {features.get('pcr', 0):.2f}
• PCR Status: {features.get('pcr_status', 'UNKNOWN')}
• PCR Shift: {features.get('pcr_shift', 'UNKNOWN')}

**RISK METRICS**
• India VIX: {features.get('india_vix', 15):.1f}
• VIX Category: {features.get('vix_category', 'UNKNOWN')}
• VIX Spike Alert: {features.get('vix_spike', False)}

**CURRENT TREND**
• Direction: {features.get('trend', 'UNKNOWN')}
• Change: {features.get('change_pct', 0):.2f}%

---

**YOUR TASK:**
Provide analysis in VALID JSON format with these exact fields:

{{
  "market_state": "<Bullish|Mild_Bullish|Neutral|Mild_Bearish|Bearish>",
  "bullish_probability": <0-100>,
  "bearish_probability": <0-100>,
  "next_move_1_3min": "<Expected direction and magnitude>",
  "confidence": <0-100>,
  "key_drivers": ["<driver1>", "<driver2>", "<driver3>"],
  "reasoning": "<Concise explanation max 50 words>",
  "risk_level": "<Low|Medium|High|Critical>",
  "trade_bias": "<Long|Short|Neutral|No_Trade>",
  "expected_range": {{"low": <price>, "high": <price>}}
}}

Remember: Use ONLY the data provided. Be precise, concise, and probabilistic."""
        
        return prompt
    
    def _get_fallback_analysis(self, features: Dict[str, Any]) -> Dict[str, Any]:
        """Return rule-based analysis when LLM fails."""
        
        change_pct = features.get('change_pct', 0)
        vix = features.get('india_vix', 15)
        pcr = features.get('pcr', 1.0)
        
        # Simple rule-based logic
        if change_pct > 0.5:
            market_state = "Bullish"
            trade_bias = "Long"
        elif change_pct < -0.5:
            market_state = "Bearish"
            trade_bias = "Short"
        else:
            market_state = "Neutral"
            trade_bias = "Neutral"
        
        # Risk level from VIX
        if vix > 18:
            risk_level = "High"
        elif vix > 15:
            risk_level = "Medium"
        else:
            risk_level = "Low"
        
        return {
            "market_state": market_state,
            "bullish_probability": 50 + (change_pct * 10),
            "bearish_probability": 50 - (change_pct * 10),
            "next_move_1_3min": f"Expected {market_state.lower()} continuation",
            "confidence": 60,
            "key_drivers": ["Price momentum", "Volume", "Market sentiment"],
            "reasoning": "Fallback analysis - LLM unavailable",
            "risk_level": risk_level,
            "trade_bias": trade_bias,
            "expected_range": {
                "low": features.get('low', 0),
                "high": features.get('high', 0)
            },
            "timestamp": datetime.now().isoformat(),
            "model": "fallback",
            "tokens_used": 0
        }
    
    async def analyze_market_async(self, features: Dict[str, Any]) -> Dict[str, Any]:
        """Async version for non-blocking analysis."""
        import asyncio
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.analyze_market, features)
