from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from kiteconnect import KiteConnect
import numpy as np
from datetime import datetime, timedelta
import asyncio
import json
from typing import Dict, List, Optional
import time
import os
import pytz

from config.settings import settings
from utils.math_helpers import norm
from services.whatsapp_service import get_alert_service
from services.ai_analysis_service import get_ai_service

# Configurations loaded from config/settings.py

app = FastAPI(
    title="Options Trading Signals API",
    description="Real-time options trading signals with Zerodha integration",
    version="2.0.0"
)

# Enhanced CORS middleware for production
# Supports localhost, Vercel, Render, and custom domains
allowed_origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:8000",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    # Local network for mobile device testing (iPhone, Android)
    "http://192.168.1.13:3000",
    "http://192.168.1.13:3001",
    "http://192.168.1.13:8000",
    # Production domain
    "https://www.mydailytradesignals.com",
    "https://mydailytradesignals.com",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins for development - restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Zerodha Kite Connect Configuration (from settings)
kite = KiteConnect(api_key=settings.ZERODHA_API_KEY)

# Global access token (can be updated via authentication endpoint)
ACCESS_TOKEN = settings.ZERODHA_ACCESS_TOKEN

if ACCESS_TOKEN:
    kite.set_access_token(ACCESS_TOKEN)

# Active WebSocket connections
active_connections: List[WebSocket] = []

# Cache for storing signals data - ultra-fast refresh
CACHE: Dict[str, Dict] = {}
CACHE_EXPIRY: Dict[str, float] = {}

# Cache for instruments (refreshed every 5 minutes)
INSTRUMENTS_CACHE: Dict[str, List] = {}
INSTRUMENTS_CACHE_EXPIRY: Dict[str, float] = {}

# Cache for spot prices (refreshed every 0.5 second for real-time feel)
SPOT_PRICE_CACHE: Dict[str, float] = {}
SPOT_PRICE_CACHE_EXPIRY: Dict[str, float] = {}

# Rate limiting for API calls
LAST_API_CALL: Dict[str, float] = {}
MIN_API_DELAY = 0.5  # Minimum 500ms between API calls

# Market hours configuration (IST timezone)
IST = pytz.timezone('Asia/Kolkata')
MARKET_OPEN_TIME = (9, 15)  # 9:15 AM
MARKET_CLOSE_TIME = (15, 30)  # 3:30 PM
MARKET_HOLIDAYS = [
    # 2025 NSE Holidays (add more as needed)
    datetime(2025, 1, 26).date(),  # Republic Day
    datetime(2025, 3, 14).date(),  # Holi
    datetime(2025, 3, 31).date(),  # Id-ul-Fitr
    datetime(2025, 4, 10).date(),  # Mahavir Jayanti
    datetime(2025, 4, 14).date(),  # Dr. Ambedkar Jayanti
    datetime(2025, 4, 18).date(),  # Good Friday
    datetime(2025, 5, 1).date(),   # Maharashtra Day
    datetime(2025, 8, 15).date(),  # Independence Day
    datetime(2025, 8, 27).date(),  # Ganesh Chaturthi
    datetime(2025, 10, 2).date(),  # Gandhi Jayanti
    datetime(2025, 10, 21).date(), # Dussehra
    datetime(2025, 11, 5).date(),  # Diwali Laxmi Pujan
    datetime(2025, 11, 6).date(),  # Diwali Balipratipada
    datetime(2025, 11, 24).date(), # Gurunanak Jayanti
    datetime(2025, 12, 25).date(), # Christmas
]

def is_market_open() -> bool:
    """Check if market is currently open (9:15 AM - 3:30 PM IST, excluding holidays)"""
    now = datetime.now(IST)
    current_time = now.time()
    current_date = now.date()
    
    # Check if today is a weekend
    if now.weekday() >= 5:  # Saturday = 5, Sunday = 6
        return False
    
    # Check if today is a holiday
    if current_date in MARKET_HOLIDAYS:
        return False
    
    # Check if within market hours
    market_open = current_time >= datetime.strptime(f"{MARKET_OPEN_TIME[0]}:{MARKET_OPEN_TIME[1]}", "%H:%M").time()
    market_close = current_time <= datetime.strptime(f"{MARKET_CLOSE_TIME[0]}:{MARKET_CLOSE_TIME[1]}", "%H:%M").time()
    
    return market_open and market_close

def get_mock_market_closed_data(symbol: str) -> Dict:
    """Return data when market is closed - with last traded spot price"""
    # Fetch last traded spot price from Zerodha even when market closed
    symbol_map = {
        "NIFTY": {"name": "NIFTY 50", "quote_symbol": "NIFTY 50", "exchange": "NSE"},
        "BANKNIFTY": {"name": "NIFTY BANK", "quote_symbol": "NIFTY BANK", "exchange": "NSE"},
        "SENSEX": {"name": "SENSEX", "quote_symbol": "SENSEX", "exchange": "BSE"}
    }
    
    spot_price = 0
    symbol_info = symbol_map.get(symbol.upper())
    
    if symbol_info:
        index_symbol = f"{symbol_info['exchange']}:{symbol_info['quote_symbol']}"
        try:
            # Try to get last traded price even when market is closed
            quote = kite.quote([index_symbol])
            quote_data = list(quote.values())[0]
            spot_price = (
                quote_data.get('last_price') or 
                quote_data.get('ohlc', {}).get('close') or 
                quote_data.get('last_traded_price') or 
                0
            )
            print(f"[MARKET CLOSED] Got last traded {symbol.upper()} spot: {spot_price}")
        except Exception as e:
            print(f"[MARKET CLOSED] Error fetching {symbol.upper()} spot: {e}")
            # Use fallback values if API fails
            spot_price = 26150 if symbol.upper() == "NIFTY" else (59700 if symbol.upper() == "BANKNIFTY" else 85600)
    
    # Use fallback if still 0
    if spot_price == 0:
        spot_price = 26150 if symbol.upper() == "NIFTY" else (59700 if symbol.upper() == "BANKNIFTY" else 85600)
    
    return {
        'symbol': symbol.upper(),
        'spot_price': spot_price,
        'signals': [],
        'pcr': 1.0,
        'market_direction': 'CLOSED',
        'direction_percentage': 0,
        'probability_bullish': 50,
        'probability_range': 0,
        'probability_bearish': 50,
        'bullish_percentage': 50,
        'bearish_percentage': 50,
        'component_scores': {
            'pcr_score': 50,
            'oi_score': 50,
            'delta_score': 50,
            'price_action_score': 50,
            'vix_score': 50
        },
        'total_ce_oi': 0,
        'total_pe_oi': 0,
        'timestamp': datetime.now().isoformat(),
        'market_status': 'CLOSED'
    }


class GreeksCalculator:
    """Calculate option Greeks using Black-Scholes model"""
    
    @staticmethod
    def calculate_greeks(spot_price: float, strike_price: float, time_to_expiry: float,
                        volatility: float, interest_rate: float, option_type: str) -> Dict:
        """
        Calculate Greeks for an option
        
        Args:
            spot_price: Current price of underlying
            strike_price: Strike price of option
            time_to_expiry: Time to expiry in years
            volatility: Implied volatility (as decimal, e.g., 0.20 for 20%)
            interest_rate: Risk-free interest rate (as decimal)
            option_type: 'CE' for Call or 'PE' for Put
        """
        if time_to_expiry <= 0:
            return {
                'delta': 0, 'gamma': 0, 'theta': 0, 'vega': 0,
                'price': max(0, spot_price - strike_price) if option_type == 'CE' else max(0, strike_price - spot_price)
            }
        
        # Black-Scholes calculations
        d1 = (np.log(spot_price / strike_price) + (interest_rate + 0.5 * volatility ** 2) * time_to_expiry) / (volatility * np.sqrt(time_to_expiry))
        d2 = d1 - volatility * np.sqrt(time_to_expiry)
        
        if option_type == 'CE':
            delta = norm.cdf(d1)
            price = spot_price * norm.cdf(d1) - strike_price * np.exp(-interest_rate * time_to_expiry) * norm.cdf(d2)
        else:
            delta = -norm.cdf(-d1)
            price = strike_price * np.exp(-interest_rate * time_to_expiry) * norm.cdf(-d2) - spot_price * norm.cdf(-d1)
        
        gamma = norm.pdf(d1) / (spot_price * volatility * np.sqrt(time_to_expiry))
        vega = spot_price * norm.pdf(d1) * np.sqrt(time_to_expiry) / 100
        theta = (-spot_price * norm.pdf(d1) * volatility / (2 * np.sqrt(time_to_expiry)) 
                - interest_rate * strike_price * np.exp(-interest_rate * time_to_expiry) * 
                (norm.cdf(d2) if option_type == 'CE' else norm.cdf(-d2))) / 365
        
        return {
            'delta': round(delta, 4),
            'gamma': round(gamma, 6),
            'theta': round(theta, 4),
            'vega': round(vega, 4),
            'price': round(price, 2)
        }


class SignalGenerator:
    """
    Professional Options Signal Generator using PCR, OI Analysis, Greeks, and Market Direction
    Optimized for O(1) time complexity per option with cached market-wide calculations
    """
    
    @staticmethod
    def calculate_pcr(all_options: List[Dict]) -> Dict:
        """Calculate Put-Call Ratio and market-wide OI metrics - O(n) once per symbol"""
        total_ce_oi = total_pe_oi = total_ce_oi_chg = total_pe_oi_chg = 0
        total_ce_volume = total_pe_volume = 0
        
        for opt in all_options:
            ce_oi = opt.get('CE', {}).get('oi', 0)
            pe_oi = opt.get('PE', {}).get('oi', 0)
            ce_oi_chg = opt.get('CE', {}).get('oi_change', 0)
            pe_oi_chg = opt.get('PE', {}).get('oi_change', 0)
            ce_vol = opt.get('CE', {}).get('volume', 0)
            pe_vol = opt.get('PE', {}).get('volume', 0)
            
            total_ce_oi += ce_oi
            total_pe_oi += pe_oi
            total_ce_oi_chg += ce_oi_chg
            total_pe_oi_chg += pe_oi_chg
            total_ce_volume += ce_vol
            total_pe_volume += pe_vol
        
        pcr = total_pe_oi / total_ce_oi if total_ce_oi > 0 else 1.0
        pcr_volume = total_pe_volume / total_ce_volume if total_ce_volume > 0 else 1.0
        
        # Market Direction based on PCR value (for label only)
        if pcr > 1.2:
            market_direction = "STRONG BULLISH"
        elif pcr > 1.1:
            market_direction = "BULLISH"
        elif pcr < 0.8:
            market_direction = "STRONG BEARISH"
        elif pcr < 0.9:
            market_direction = "BEARISH"
        else:
            market_direction = "NEUTRAL"
        
        # ===== PROBABILITY CALCULATION =====
        # Calculate probability of different market outcomes
        
        # Base probabilities from PCR
        if pcr > 1.3:
            bullish_prob = 65
            range_prob = 20
            bearish_prob = 15
        elif pcr > 1.15:
            bullish_prob = 55
            range_prob = 30
            bearish_prob = 15
        elif pcr > 1.05:
            bullish_prob = 45
            range_prob = 40
            bearish_prob = 15
        elif pcr < 0.75:
            bullish_prob = 15
            range_prob = 20
            bearish_prob = 65
        elif pcr < 0.85:
            bullish_prob = 15
            range_prob = 30
            bearish_prob = 55
        elif pcr < 0.95:
            bullish_prob = 15
            range_prob = 40
            bearish_prob = 45
        else:  # Neutral 0.95-1.05
            bullish_prob = 30
            range_prob = 50
            bearish_prob = 20
        
        # Adjust based on OI change (positive change = fresh positioning)
        if total_ce_oi_chg > 0 and total_pe_oi_chg > 0:
            oi_change_ratio = total_ce_oi_chg / total_pe_oi_chg if total_pe_oi_chg > 0 else 1.0
            
            # If PE OI building faster (ratio < 1), increase bullish
            if oi_change_ratio < 0.67:
                bullish_prob = min(bullish_prob + 10, 80)
                bearish_prob = max(bearish_prob - 8, 5)
                range_prob = max(100 - bullish_prob - bearish_prob, 10)
            # If CE OI building faster (ratio > 1.5), increase bearish
            elif oi_change_ratio > 1.5:
                bearish_prob = min(bearish_prob + 10, 80)
                bullish_prob = max(bullish_prob - 8, 5)
                range_prob = max(100 - bullish_prob - bearish_prob, 10)
        
        # Ensure probabilities sum to 100
        total_prob = bullish_prob + range_prob + bearish_prob
        if total_prob != 100:
            bullish_prob = round((bullish_prob / total_prob) * 100)
            bearish_prob = round((bearish_prob / total_prob) * 100)
            range_prob = 100 - bullish_prob - bearish_prob
        
        return {
            'pcr': round(pcr, 3),
            'pcr_volume': round(pcr_volume, 3),
            'market_direction': market_direction,
            'total_ce_oi': total_ce_oi,
            'total_pe_oi': total_pe_oi,
            'total_ce_oi_chg': total_ce_oi_chg,
            'total_pe_oi_chg': total_pe_oi_chg,
            'probability_bullish': bullish_prob,
            'probability_range': range_prob,
            'probability_bearish': bearish_prob
        }
    
    @staticmethod
    def analyze_signal(greeks: Dict, oi_data: Dict, option_type: str, strike_type: str, 
                      market_metrics: Dict, spot_price: float, strike_price: float) -> Dict:
        """
        BUYER FOCUSED Signal Analysis - 90%+ Threshold - Expert Stock Market Logic
        
        Enhanced Parameters (Buyer's Perspective Only):
        1. PCR + OI Change Analysis (35 points) - Strong money flow detection
        2. Delta Analysis (25 points) - Directional confidence
        3. OI Build Analysis (20 points) - Fresh institutional positioning
        4. Gamma + Vega (15 points) - Explosive potential
        5. Strike Position (5 points) - Entry timing
        
        Total: 100 points. Signal only if 90%+
        """
        delta = greeks['delta']
        gamma = greeks['gamma']
        vega = greeks['vega']
        theta = greeks['theta']
        
        score = 0
        reasons = []
        
        # Get market metrics
        market_dir = market_metrics.get('market_direction', 'NEUTRAL')
        pcr = market_metrics.get('pcr', 1.0)
        total_ce_oi_chg = market_metrics.get('total_ce_oi_chg', 0)
        total_pe_oi_chg = market_metrics.get('total_pe_oi_chg', 0)
        
        # === 1. PCR + OI CHANGE ANALYSIS (35 points) - Most Critical ===
        # BUYER FOCUS: Look for strong directional bias with fresh money
        if option_type == 'CE':
            # For CE buyers: Want BULLISH market (PCR > 1.0) + PE OI building (resistance breaking)
            if market_dir == "STRONG BULLISH" and pcr > 1.2:
                score += 35
                reasons.append(f"🔥 Strong Bullish + High PCR ({pcr:.2f})")
            elif market_dir == "BULLISH" and pcr > 1.05:
                score += 25
                reasons.append(f"📈 Bullish Market (PCR: {pcr:.2f})")
            elif pcr > 1.0:
                score += 15
                reasons.append(f"📊 Mildly Bullish (PCR: {pcr:.2f})")
            
            # Additional bonus: If PE OI building faster than CE (sellers trapped)
            if total_pe_oi_chg > total_ce_oi_chg and total_pe_oi_chg > 0:
                oi_ratio = total_pe_oi_chg / max(total_ce_oi_chg, 1)
                if oi_ratio > 1.5:
                    score += 5
                    reasons.append(f"💎 PE Sellers Trapped (Ratio: {oi_ratio:.1f}x)")
        else:  # PE
            # For PE buyers: Want BEARISH market (PCR < 0.9) + CE OI building (support breaking)
            if market_dir == "STRONG BEARISH" and pcr < 0.8:
                score += 35
                reasons.append(f"🔥 Strong Bearish + Low PCR ({pcr:.2f})")
            elif market_dir == "BEARISH" and pcr < 0.95:
                score += 25
                reasons.append(f"📉 Bearish Market (PCR: {pcr:.2f})")
            elif pcr < 1.0:
                score += 15
                reasons.append(f"📊 Mildly Bearish (PCR: {pcr:.2f})")
            
            # Additional bonus: If CE OI building faster than PE (buyers trapped)
            if total_ce_oi_chg > total_pe_oi_chg and total_ce_oi_chg > 0:
                oi_ratio = total_ce_oi_chg / max(total_pe_oi_chg, 1)
                if oi_ratio > 1.5:
                    score += 5
                    reasons.append(f"💎 CE Buyers Trapped (Ratio: {oi_ratio:.1f}x)")
        
        # === 2. DELTA ANALYSIS - Directional Conviction (25 points) ===
        if option_type == 'CE':
            if delta > 0.75:
                score += 25
                reasons.append(f"⚡ Excellent Delta ({delta:.3f})")
            elif delta > 0.6:
                score += 18
                reasons.append(f"✓ Strong Delta ({delta:.3f})")
            elif delta > 0.45:
                score += 10
                reasons.append(f"→ Moderate Delta ({delta:.3f})")
        else:  # PE
            if delta < -0.75:
                score += 25
                reasons.append(f"⚡ Excellent Delta ({delta:.3f})")
            elif delta < -0.6:
                score += 18
                reasons.append(f"✓ Strong Delta ({delta:.3f})")
            elif delta < -0.45:
                score += 10
                reasons.append(f"→ Moderate Delta ({delta:.3f})")
        
        # === 3. OI BUILD ANALYSIS - Institutional Money (20 points) ===
        oi_change = oi_data.get('oi_change_percent', 0)
        oi = oi_data.get('oi', 0)
        volume = oi_data.get('volume', 0)
        
        if oi_change > 30:
            score += 20
            reasons.append(f"💪 Massive OI Build ({oi_change:.1f}%)")
        elif oi_change > 20:
            score += 15
            reasons.append(f"📈 Strong OI Build ({oi_change:.1f}%)")
        elif oi_change > 10:
            score += 10
            reasons.append(f"📊 Good OI Build ({oi_change:.1f}%)")
        
        if oi > 500000 and volume > 10000:
            score += 3
            reasons.append(f"💧 Excellent Liquidity (OI: {oi:,}, Vol: {volume:,})")
        elif oi > 200000:
            score += 2
            reasons.append(f"💧 Good Liquidity (OI: {oi:,})")
        
        # === 4. GAMMA + VEGA ANALYSIS - Explosive Potential (15 points) ===
        if gamma > 0.025:
            score += 10
            reasons.append(f"🚀 Explosive Gamma ({gamma:.4f})")
        elif gamma > 0.015:
            score += 7
            reasons.append(f"↗ High Gamma ({gamma:.4f})")
        elif gamma > 0.008:
            score += 4
            reasons.append(f"→ Good Gamma ({gamma:.4f})")
        
        if vega > 15:
            score += 5
            reasons.append(f"🌊 High Vega ({vega:.2f})")
        elif vega > 10:
            score += 3
            reasons.append(f"~ Good Vega ({vega:.2f})")
        
        # === 5. STRIKE POSITION - Entry Timing (5 points) ===
        moneyness = abs(spot_price - strike_price) / spot_price * 100
        
        if strike_type == 'ATM' and moneyness < 0.5:
            score += 5
            reasons.append("🎯 Perfect ATM Entry")
        elif strike_type == 'ATM':
            score += 3
            reasons.append("🎯 ATM Strike")
        elif strike_type == 'ITM' and moneyness < 2:
            score += 4
            reasons.append("💎 Near ITM")
        
        # === PENALTY: THETA DECAY ===
        if abs(theta) > 50:
            score -= 5
            reasons.append(f"⚠️ High Time Decay ({theta:.2f}/day)")
        elif abs(theta) > 30:
            score -= 3
            reasons.append(f"⏰ Moderate Decay ({theta:.2f}/day)")
        
        # === SIGNAL CLASSIFICATION (STRICT 90%+) ===
        if score >= 90:
            signal = "STRONG BUY"
            signal_strength = "EXTREME"
        elif score >= 80:
            signal = "BUY"
            signal_strength = "STRONG"
        else:
            signal = "NO SIGNAL"
            signal_strength = "WEAK"
        
        return {
            'signal': signal,
            'signal_strength': signal_strength,
            'score': min(score, 100),  # Cap at 100
            'reasons': reasons,
            'greeks': greeks
        }
    
    @staticmethod
    def calculate_market_bias(all_options_with_greeks: List[Dict], market_metrics: Dict, spot_price: float) -> Dict:
        """
        Professional weighted market bias calculation using 5 core parameters:
        1. PCR Score (35%) - Put-Call Ratio
        2. OI Score (30%) - Put vs Call Open Interest
        3. Delta Score (20%) - ATM Delta Bias
        4. Price Action Score (10%) - PCR Trend
        5. VIX Score (5%) - Volatility Trend
        
        Returns: bullish_percentage, bearish_percentage, component_scores
        """
        
        # ===== PARAMETER 1: PCR SCORE =====
        # Better formula: PCR 0.8 = 0%, PCR 1.0 = 50%, PCR 1.2+ = 100%
        pcr = market_metrics.get('pcr', 1.0)
        if pcr >= 1.0:
            # Bullish side: PCR 1.0 → 50%, PCR 1.2 → 100%
            pcr_score = min(100, 50 + ((pcr - 1.0) / 0.2 * 50)) if pcr <= 1.2 else 100
        else:
            # Bearish side: PCR 0.8 → 0%, PCR 1.0 → 50%
            pcr_score = max(0, 50 - ((1.0 - pcr) / 0.2 * 50)) if pcr >= 0.8 else 0
        
        # ===== PARAMETER 2: OI SCORE =====
        total_pe_oi = market_metrics.get('total_pe_oi', 1)
        total_ce_oi = market_metrics.get('total_ce_oi', 1)
        total_oi = total_pe_oi + total_ce_oi
        
        # Avoid division by zero
        if total_oi > 0:
            oi_score = (total_pe_oi / total_oi) * 100
        else:
            oi_score = 50.0  # Neutral if no OI data available
        
        # ===== PARAMETER 3: DELTA SCORE =====
        # Find ATM options to get delta bias
        ce_delta_atm = 0.5  # Default neutral
        pe_delta_atm = -0.5  # Default neutral
        
        # Look for ATM strikes (closest to spot price)
        for opt in all_options_with_greeks:
            strike = opt.get('strike', spot_price)
            if abs(strike - spot_price) < 100:  # Within 100 points (approximate ATM)
                if opt.get('type') == 'CE':
                    ce_delta_atm = opt.get('delta', 0.5)
                elif opt.get('type') == 'PE':
                    pe_delta_atm = opt.get('delta', -0.5)
        
        # Delta score: higher CE delta = more bullish
        delta_score = abs(ce_delta_atm) / (abs(ce_delta_atm) + abs(pe_delta_atm)) * 100 if (abs(ce_delta_atm) + abs(pe_delta_atm)) > 0 else 50
        
        # ===== PARAMETER 4: PRICE ACTION SCORE =====
        # Use PCR as proxy for price trend
        price_action_score = 0  # Default neutral
        
        if pcr > 1.15:
            price_action_score = 20  # Strong bullish
        elif pcr > 1.05:
            price_action_score = 10  # Mild bullish
        elif pcr < 0.85:
            price_action_score = -20  # Strong bearish
        elif pcr < 0.95:
            price_action_score = -10  # Mild bearish
        
        # ===== PARAMETER 5: VIX SCORE =====
        # Assume VIX is falling (bullish) as default
        # In production, fetch India VIX from API
        # VIX score should be 0-100, so +10 means bias towards bullish (55 out of 100)
        vix_score_normalized = 55  # Default: VIX falling slightly bullish
        
        # ===== WEIGHTED FORMULA =====
        # Bullish% = 0.35(PCR) + 0.30(OI) + 0.20(Delta) + 0.10(Price) + 0.05(VIX)
        bullish_percentage = (
            0.35 * pcr_score +
            0.30 * oi_score +
            0.20 * delta_score +
            0.10 * (50 + price_action_score) +  # Normalize price action (0-100 range: 30-70)
            0.05 * vix_score_normalized  # VIX score 0-100
        )
        
        bearish_percentage = 100 - bullish_percentage
        
        return {
            'bullish_percentage': round(bullish_percentage, 1),
            'bearish_percentage': round(bearish_percentage, 1),
            'component_scores': {
                'pcr_score': round(pcr_score, 1),
                'oi_score': round(oi_score, 1),
                'delta_score': round(delta_score, 1),
                'price_action_score': round(50 + price_action_score, 1),
                'vix_score': round(vix_score_normalized, 1)
            }
        }


@app.get("/")
async def root():
    """Root endpoint - returns HTML redirect to frontend"""
    from fastapi.responses import HTMLResponse
    
    html_content = """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Options Trading Signals API</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                text-align: center;
            }
            .container {
                background: rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(10px);
                padding: 3rem;
                border-radius: 20px;
                box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
                border: 1px solid rgba(255, 255, 255, 0.18);
                max-width: 500px;
            }
            h1 { margin: 0 0 1rem 0; font-size: 2.5rem; }
            .status { 
                display: inline-block;
                background: #10b981;
                padding: 0.5rem 1rem;
                border-radius: 50px;
                font-weight: bold;
                margin: 1rem 0;
            }
            .link-button {
                display: inline-block;
                background: white;
                color: #667eea;
                text-decoration: none;
                padding: 1rem 2rem;
                border-radius: 10px;
                font-weight: bold;
                margin-top: 2rem;
                transition: transform 0.2s;
            }
            .link-button:hover {
                transform: scale(1.05);
            }
            .api-links {
                margin-top: 2rem;
                font-size: 0.9rem;
            }
            .api-links a {
                color: white;
                text-decoration: underline;
                margin: 0 0.5rem;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Options Trading Signals</h1>
            <div class="status">✓ API Running</div>
            <p>Backend API is operational and ready to serve trading signals.</p>
            <a href="https://options-trading-frontend.onrender.com" class="link-button">
                Open Trading Dashboard →
            </a>
            <div class="api-links">
                <strong>API Endpoints:</strong><br>
                <a href="/api/market/status" target="_blank">Market Status</a>
                <a href="/api/signals/NIFTY" target="_blank">NIFTY Signals</a>
                <a href="/api/signals/BANKNIFTY" target="_blank">BANKNIFTY</a>
            </div>
        </div>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)


@app.get("/api/market/status")
async def get_market_status():
    """Get current market status (OPEN/CLOSED) with timing info"""
    market_open = is_market_open()
    ist_now = datetime.now(IST)
    
    return {
        "status": "OPEN" if market_open else "CLOSED",
        "current_time": ist_now.strftime("%I:%M %p IST"),
        "market_hours": "9:15 AM - 3:30 PM IST (Mon-Fri)",
        "day": ist_now.strftime("%A"),
        "date": ist_now.strftime("%B %d, %Y"),
        "is_weekend": ist_now.weekday() >= 5,
        "is_holiday": ist_now.date() in MARKET_HOLIDAYS
    }


@app.get("/api/auth/login-url")
async def get_login_url():
    """Get Zerodha login URL for authentication - supports mobile app redirection"""
    try:
        # Validate API key is configured
        if not settings.ZERODHA_API_KEY:
            print("[ERROR] ZERODHA_API_KEY not configured in environment")
            raise HTTPException(
                status_code=500, 
                detail="Server configuration error: ZERODHA_API_KEY not set. Please configure environment variables."
            )
        
        # Log for debugging
        print(f"[AUTH] Generating login URL with API key: {settings.ZERODHA_API_KEY[:8]}...")
        print(f"[AUTH] Redirect URL: {settings.ZERODHA_REDIRECT_URL}")
        
        # Generate login URL with redirect
        # For mobile: kite://connect/login?api_key=xxx redirects to app if installed
        # For web: https://kite.zerodha.com/connect/login?api_key=xxx
        login_url = f"https://kite.zerodha.com/connect/login?api_key={settings.ZERODHA_API_KEY}&v=3"
        mobile_login_url = f"kite://kite.zerodha.com/connect/login?api_key={settings.ZERODHA_API_KEY}&v=3"
        
        response_data = {
            "login_url": login_url,
            "mobile_login_url": mobile_login_url,
            "api_key": settings.ZERODHA_API_KEY,
            "redirect_url": settings.ZERODHA_REDIRECT_URL
        }
        
        print(f"[AUTH] Login URL generated successfully")
        return response_data
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Login URL generation failed: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to generate login URL: {str(e)}"
        )


@app.post("/api/auth/set-token")
async def set_access_token(request_token: str):
    """Set access token after Zerodha authentication"""
    global ACCESS_TOKEN
    try:
        print(f"[AUTH] Received request_token: {request_token[:20]}...")
        print(f"[AUTH] API_KEY: {settings.ZERODHA_API_KEY}")
        print(f"[AUTH] API_SECRET exists: {bool(settings.ZERODHA_API_SECRET)}")
        
        data = kite.generate_session(request_token, api_secret=settings.ZERODHA_API_SECRET)
        print(f"[AUTH] Session generated successfully")
        print(f"[AUTH] Response data keys: {data.keys()}")
        
        ACCESS_TOKEN = data["access_token"]
        kite.set_access_token(ACCESS_TOKEN)
        
        # Save token to .env file for persistence (with UTF-8 encoding)
        env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', '.env')
        print(f"[AUTH] Saving token to: {env_path}")
        
        if os.path.exists(env_path):
            # Read with UTF-8 encoding to avoid charmap errors
            with open(env_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            # Write with UTF-8 encoding
            with open(env_path, 'w', encoding='utf-8') as f:
                token_found = False
                for line in lines:
                    if line.startswith('ZERODHA_ACCESS_TOKEN='):
                        f.write(f'ZERODHA_ACCESS_TOKEN={ACCESS_TOKEN}\n')
                        token_found = True
                    else:
                        f.write(line)
                
                if not token_found:
                    f.write(f'\nZERODHA_ACCESS_TOKEN={ACCESS_TOKEN}\n')
            
            print(f"[AUTH] Token saved to .env file with UTF-8 encoding")
        
        print(f"[AUTH] Access token set successfully: {ACCESS_TOKEN[:20]}...")
        return {"status": "success", "access_token": ACCESS_TOKEN}
    except Exception as e:
        print(f"[AUTH ERROR] Failed to generate session: {str(e)}")
        print(f"[AUTH ERROR] Error type: {type(e).__name__}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/auth/status")
async def check_auth_status():
    """Check if user is authenticated with Zerodha"""
    global ACCESS_TOKEN
    is_authenticated = bool(ACCESS_TOKEN)
    
    print(f"[AUTH STATUS] Checking authentication status")
    print(f"[AUTH STATUS] Has ACCESS_TOKEN: {is_authenticated}")
    
    if is_authenticated:
        print(f"[AUTH STATUS] Token exists: {ACCESS_TOKEN[:20]}...")
        # Try to make a simple API call to verify token is valid
        try:
            profile = kite.profile()
            print(f"[AUTH STATUS] Token is valid, user: {profile.get('user_name', 'Unknown')}")
            return {
                "status": "authenticated",
                "is_authenticated": True,
                "user_name": profile.get('user_name'),
                "user_id": profile.get('user_id'),
                "email": profile.get('email')
            }
        except Exception as e:
            print(f"[AUTH STATUS] Token exists but is invalid: {str(e)}")
            return {
                "status": "token_invalid",
                "is_authenticated": False,
                "message": "Token expired or invalid. Please login again."
            }
    else:
        print(f"[AUTH STATUS] No token found")
        return {
            "status": "not_authenticated",
            "is_authenticated": False,
            "message": "Please authenticate with Zerodha"
        }


@app.get("/api/alerts/status")
async def check_alert_status():
    """Check WhatsApp alert service configuration and status"""
    try:
        alert_service = get_alert_service()
        
        return {
            "status": "success",
            "enabled": alert_service.enabled,
            "configuration": {
                "threshold": alert_service.threshold if alert_service.enabled else None,
                "cooldown_minutes": alert_service.cooldown_minutes if alert_service.enabled else None,
                "from_phone": alert_service.from_phone if alert_service.enabled else None,
                "to_phone": alert_service.to_phone if alert_service.enabled else None,
                "has_account_sid": bool(alert_service.account_sid) if alert_service.enabled else False,
                "has_auth_token": bool(alert_service.auth_token) if alert_service.enabled else False
            },
            "message": "WhatsApp alerts are active" if alert_service.enabled else "WhatsApp alerts disabled - configure credentials in .env"
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }


@app.post("/api/alerts/test")
async def send_test_alert(phone_number: str):
    """Send a test WhatsApp alert to verify Twilio configuration"""
    try:
        print(f"[TEST ALERT] Attempting to send test WhatsApp to {phone_number}")
        alert_service = get_alert_service()
        
        # Check if service is enabled
        if not alert_service.enabled:
            error_msg = "WhatsApp alerts disabled. Missing Twilio credentials in .env file."
            print(f"[TEST ALERT ERROR] {error_msg}")
            return {
                "status": "error",
                "message": error_msg
            }
        
        # Validate Twilio configuration
        if not alert_service.account_sid or not alert_service.auth_token:
            error_msg = "Twilio Account SID or Auth Token is missing"
            print(f"[TEST ALERT ERROR] {error_msg}")
            return {
                "status": "error",
                "message": error_msg
            }
        
        if not alert_service.from_phone or alert_service.from_phone == "+12345678900":
            error_msg = "Please update TWILIO_PHONE_NUMBER in .env file with your real Twilio phone number"
            print(f"[TEST ALERT ERROR] {error_msg}")
            return {
                "status": "error",
                "message": error_msg
            }
        
        # Create a test signal
        test_signal = {
            "symbol": "NIFTY",
            "strike": 25900,
            "option_type": "CE",
            "score": 85.5,
            "ltp": 125.50,
            "tradingsymbol": "NIFTY25900CE",
            "signal": "STRONG BUY"
        }
        
        print(f"[TEST ALERT] Sending test message from {alert_service.from_phone} to {phone_number}")
        
        # Temporarily override the phone number for testing
        original_phone = alert_service.to_phone
        alert_service.to_phone = phone_number
        
        # Temporarily disable cooldown check for testing
        alert_key = f"{test_signal['symbol']}_{test_signal['option_type']}_{test_signal['strike']}"
        if alert_key in alert_service.last_alert_time:
            del alert_service.last_alert_time[alert_key]
        
        # Update test signal score to trigger 90% threshold
        test_signal["score"] = 92.5  # Must be 90%+ for alerts
        test_signal["reasons"] = [
            "🔥 Test Signal - Strong Market",
            "⚡ High Momentum Detected",
            "💪 Heavy OI Build"
        ]
        
        print(f"[TEST ALERT] Attempting to send WhatsApp message...")
        print(f"[TEST ALERT] Signal score: {test_signal['score']}% (threshold: {alert_service.threshold}%)")
        
        # Send the test alert
        message_sid = alert_service.send_alert(test_signal)
        
        # Restore original phone number
        alert_service.to_phone = original_phone
        
        if message_sid:
            success_msg = f"✅ WhatsApp SENT to {phone_number}! Message SID: {message_sid}"
            print(f"[TEST ALERT] {success_msg}")
            return {
                "status": "success",
                "message": success_msg,
                "message_sid": message_sid,
                "details": "Check your WhatsApp for the test signal message"
            }
        else:
            # Get more specific error from logs
            error_msg = """❌ WhatsApp message failed. Common issues:

1. **WhatsApp Sandbox Not Joined**:
   - Go to: https://www.twilio.com/console/sms/whatsapp/sandbox
   - Send "join <your-code>" to +14155238886 from WhatsApp
   
2. **Phone Number Not Verified**:
   - Verify +{phone} in Twilio Console
   
3. **Check Backend Logs** for detailed error message
   
4. **Try Regular SMS** (change TWILIO_PHONE_NUMBER to regular SMS number)"""
            
            print(f"[TEST ALERT ERROR] Failed to send. Check logs above for Twilio API response")
            return {
                "status": "error",
                "message": error_msg.format(phone=phone_number),
                "troubleshooting_url": "https://www.twilio.com/console/sms/whatsapp/sandbox"
            }
    except Exception as e:
        error_msg = f"❌ Error: {str(e)}"
        print(f"[TEST ALERT ERROR] {error_msg}")
        import traceback
        traceback.print_exc()
        return {
            "status": "error",
            "message": error_msg
        }
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/instruments/{symbol}")
async def get_option_chain(symbol: str):
    """
    Get option chain data for a symbol (NIFTY, BANKNIFTY, SENSEX)
    """
    if not ACCESS_TOKEN:
        raise HTTPException(status_code=401, detail="Not authenticated. Please login first.")
    
    try:
        kite.set_access_token(ACCESS_TOKEN)
        
        # Map symbols to their trading symbols and exchanges
        symbol_map = {
            "NIFTY": {"name": "NIFTY 50", "quote_symbol": "NIFTY 50", "exchange": "NSE", "instrument_type": "NIFTY"},
            "BANKNIFTY": {"name": "NIFTY BANK", "quote_symbol": "NIFTY BANK", "exchange": "NSE", "instrument_type": "BANKNIFTY"},
            "SENSEX": {"name": "SENSEX", "quote_symbol": "SENSEX", "exchange": "BSE", "instrument_type": "SENSEX"}
        }
        
        symbol_info = symbol_map.get(symbol.upper())
        if not symbol_info:
            raise HTTPException(status_code=404, detail="Symbol not found")
        
        # Get index quote for spot price with caching
        index_symbol = f"NSE:{symbol_info['quote_symbol']}" if symbol_info['exchange'] == 'NSE' else f"BSE:{symbol_info['quote_symbol']}"
        
        # Check spot price cache
        current_time = time.time()
        if symbol.upper() in SPOT_PRICE_CACHE and symbol.upper() in SPOT_PRICE_CACHE_EXPIRY:
            if current_time < SPOT_PRICE_CACHE_EXPIRY[symbol.upper()]:
                spot_price = SPOT_PRICE_CACHE[symbol.upper()]
                print(f"[SPOT] Using cached {symbol.upper()} spot: {spot_price}")
            else:
                # Fetch new spot price
                try:
                    quote = kite.quote([index_symbol])
                    quote_data = list(quote.values())[0]
                    spot_price = (
                        quote_data.get('last_price') or 
                        quote_data.get('ohlc', {}).get('close') or 
                        quote_data.get('last_traded_price') or 
                        0
                    )
                    if spot_price > 0:
                        SPOT_PRICE_CACHE[symbol.upper()] = spot_price
                        SPOT_PRICE_CACHE_EXPIRY[symbol.upper()] = current_time + settings.SPOT_PRICE_CACHE_DURATION
                        print(f"[SPOT] Fetched fresh {symbol.upper()} spot: {spot_price}")
                    else:
                        spot_price = 25959 if symbol.upper() == "NIFTY" else (54200 if symbol.upper() == "BANKNIFTY" else 85400)
                        print(f"[SPOT] Using fallback {symbol.upper()} spot: {spot_price}")
                except Exception as e:
                    print(f"Error fetching quote for {index_symbol}: {e}")
                    spot_price = 25959 if symbol.upper() == "NIFTY" else (54200 if symbol.upper() == "BANKNIFTY" else 85400)
                    print(f"[SPOT] Error fallback {symbol.upper()} spot: {spot_price}")
        else:
            # First time fetch
            try:
                quote = kite.quote([index_symbol])
                quote_data = list(quote.values())[0]
                spot_price = (
                    quote_data.get('last_price') or 
                    quote_data.get('ohlc', {}).get('close') or 
                    quote_data.get('last_traded_price') or 
                    0
                )
                if spot_price > 0:
                    SPOT_PRICE_CACHE[symbol.upper()] = spot_price
                    SPOT_PRICE_CACHE_EXPIRY[symbol.upper()] = current_time + settings.SPOT_PRICE_CACHE_DURATION
                else:
                    spot_price = 25959 if symbol.upper() == "NIFTY" else (54200 if symbol.upper() == "BANKNIFTY" else 85400)
            except Exception as e:
                print(f"Error fetching quote for {index_symbol}: {e}")
                spot_price = 25959 if symbol.upper() == "NIFTY" else (54200 if symbol.upper() == "BANKNIFTY" else 85400)
        
        # Get option instruments with caching
        exchange = "NFO" if symbol.upper() != "SENSEX" else "BFO"
        
        # Check if instruments are cached
        current_time = time.time()
        if exchange in INSTRUMENTS_CACHE and exchange in INSTRUMENTS_CACHE_EXPIRY:
            if current_time < INSTRUMENTS_CACHE_EXPIRY[exchange]:
                instruments = INSTRUMENTS_CACHE[exchange]
            else:
                instruments = kite.instruments(exchange)
                INSTRUMENTS_CACHE[exchange] = instruments
                INSTRUMENTS_CACHE_EXPIRY[exchange] = current_time + settings.INSTRUMENTS_CACHE_DURATION
        else:
            instruments = kite.instruments(exchange)
            INSTRUMENTS_CACHE[exchange] = instruments
            INSTRUMENTS_CACHE_EXPIRY[exchange] = current_time + settings.INSTRUMENTS_CACHE_DURATION
        
        # Filter for this week's expiry options
        today = datetime.now().date()
        option_instruments = [
            inst for inst in instruments 
            if inst['name'] == symbol_info['instrument_type']
            and inst['instrument_type'] in ['CE', 'PE']
            and (inst['expiry'].date() if hasattr(inst['expiry'], 'date') else inst['expiry']) >= today
        ]
        
        # Sort by expiry to get nearest (weekly expiry)
        option_instruments.sort(key=lambda x: x['expiry'])
        
        if not option_instruments:
            raise HTTPException(status_code=404, detail=f"No options found for {symbol}. Instruments may not be available yet.")
        
        # Get nearest expiry (current or next week's expiry)
        nearest_expiry = option_instruments[0]['expiry']
        
        # Filter options for nearest expiry
        nearest_options = [
            inst for inst in option_instruments 
            if inst['expiry'] == nearest_expiry
        ]
        
        # Calculate time to expiry (minimum 1 day to avoid division by zero)
        nearest_expiry_date = nearest_expiry.date() if hasattr(nearest_expiry, 'date') else nearest_expiry
        days_to_expiry = max((nearest_expiry_date - datetime.now().date()).days, 1)
        time_to_expiry = days_to_expiry / 365.0
        
        # Get option chain data
        option_chain = []
        calculator = GreeksCalculator()
        signal_gen = SignalGenerator()
        
        # Get ATM strike
        strike_diff = 50 if symbol.upper() == "NIFTY" else (100 if symbol.upper() == "BANKNIFTY" else 100)
        atm_strike = round(spot_price / strike_diff) * strike_diff
        
        # Get strikes around ATM (±5 strikes = 11 total strikes for full option chain)
        strikes = [atm_strike + (i * strike_diff) for i in range(-5, 6)]
        
        # Batch fetch quotes for all options at once
        option_symbols = []
        option_map = {}
        
        for strike in strikes:
            for option_type in ['CE', 'PE']:
                option = next((o for o in nearest_options if o['strike'] == strike and o['instrument_type'] == option_type), None)
                if option:
                    symbol_key = f"{option['exchange']}:{option['tradingsymbol']}"
                    option_symbols.append(symbol_key)
                    option_map[symbol_key] = {'strike': strike, 'type': option_type, 'instrument': option}
        
        # Fetch all quotes at once (more efficient)
        try:
            all_quotes = kite.quote(option_symbols) if option_symbols else {}
        except Exception as e:
            print(f"Error fetching quotes: {e}")
            all_quotes = {}
        
        # First pass: Collect all option data for PCR calculation
        all_options_data = []
        all_options_with_greeks = []  # New: collect full data including greeks
        
        for strike in strikes:
            for option_type in ['CE', 'PE']:
                option_key = None
                for key, val in option_map.items():
                    if val['strike'] == strike and val['type'] == option_type:
                        option_key = key
                        break
                
                if option_key and option_key in all_quotes:
                    opt_data = all_quotes[option_key]
                    all_options_data.append({
                        option_type: {
                            'oi': opt_data.get('oi', 0),
                            'oi_change': opt_data.get('oi_change', 0),
                            'volume': opt_data.get('volume', 0)
                        }
                    })
                    
                    # Also collect data with greeks for market bias calculation
                    greeks_data = opt_data.get('greeks', {})
                    if greeks_data and isinstance(greeks_data, dict):
                        delta = greeks_data.get('delta', 0)
                    else:
                        # Calculate delta if not available
                        ltp = opt_data.get('last_price', 0)
                        if ltp == 0:
                            ltp = opt_data.get('ohlc', {}).get('close', 0)
                        
                        if ltp > 0 and strike > 0:
                            moneyness = spot_price / strike if option_type == 'CE' else strike / spot_price
                            volatility = min(max(0.15 + (abs(1 - moneyness) * 0.5), 0.10), 0.60)
                        else:
                            volatility = 0.20
                        
                        temp_greeks = calculator.calculate_greeks(
                            spot_price, strike, time_to_expiry, volatility, 0.07, option_type
                        )
                        delta = temp_greeks.get('delta', 0)
                    
                    all_options_with_greeks.append({
                        'strike': strike,
                        'type': option_type,
                        'oi': opt_data.get('oi', 0),
                        'delta': delta
                    })
        
        # Calculate market-wide metrics (PCR, direction) - O(n) once
        market_metrics = signal_gen.calculate_pcr(all_options_data)
        
        # Calculate weighted market bias using all 5 parameters with greeks data
        try:
            print(f"[DEBUG] Calling calculate_market_bias with {len(all_options_with_greeks)} options")
            market_bias = signal_gen.calculate_market_bias(all_options_with_greeks, market_metrics, spot_price)
            print(f"[DEBUG] Market Bias Calculated Successfully!")
            print(f"[DEBUG] Market Bias Result: {market_bias}")
        except Exception as e:
            print(f"[ERROR] Failed to calculate market_bias: {e}")
            import traceback
            traceback.print_exc()
            # Fallback values
            market_bias = {
                'bullish_percentage': 50.0,
                'bearish_percentage': 50.0,
                'component_scores': {
                    'pcr_score': 50.0,
                    'oi_score': 50.0,
                    'delta_score': 50.0,
                    'price_action_score': 0,
                    'vix_score': 10
                }
            }
            print(f"[DEBUG] Using fallback market_bias")
            print(f"[DEBUG] market_bias: {market_bias}")
        
        for strike in strikes:
            strike_data = {'strike': strike}
            
            # Determine strike type for both CE and PE
            strike_diff_from_spot = abs(strike - spot_price)
            if strike_diff_from_spot < strike_diff / 2:
                strike_type_ce = 'ATM'
                strike_type_pe = 'ATM'
            elif strike < spot_price:
                strike_type_ce = 'ITM'
                strike_type_pe = 'OTM'
            else:
                strike_type_ce = 'OTM'
                strike_type_pe = 'ITM'
            
            # Process CE and PE
            for option_type in ['CE', 'PE']:
                strike_type = strike_type_ce if option_type == 'CE' else strike_type_pe
                
                # Find the option instrument
                option_key = None
                for key, val in option_map.items():
                    if val['strike'] == strike and val['type'] == option_type:
                        option_key = key
                        break
                
                if option_key and option_key in all_quotes:
                    try:
                        opt_data = all_quotes[option_key]
                        option = option_map[option_key]['instrument']
                        
                        # Get EXACT LTP from Zerodha - use last_price directly
                        ltp = opt_data.get('last_price', 0)
                        if ltp == 0:
                            # Fallback only if last_price is not available
                            ltp = opt_data.get('ohlc', {}).get('close', 0)
                        
                        # Get actual Greeks from Zerodha if available, otherwise calculate
                        greeks_data = opt_data.get('greeks', {})
                        if greeks_data and isinstance(greeks_data, dict):
                            # Use actual Greeks from Zerodha API
                            greeks = {
                                'delta': greeks_data.get('delta', 0),
                                'gamma': greeks_data.get('gamma', 0),
                                'theta': greeks_data.get('theta', 0),
                                'vega': greeks_data.get('vega', 0),
                                'price': ltp
                            }
                        else:
                            # Fallback: Calculate Greeks only if not provided
                            if ltp > 0 and strike > 0:
                                moneyness = spot_price / strike if option_type == 'CE' else strike / spot_price
                                volatility = min(max(0.15 + (abs(1 - moneyness) * 0.5), 0.10), 0.60)
                            else:
                                volatility = 0.20
                            
                            greeks = calculator.calculate_greeks(
                                spot_price, strike, time_to_expiry, volatility, 0.07, option_type
                            )
                        
                        # Get OI data directly from Zerodha
                        current_oi = opt_data.get('oi', 0)
                        oi_day_high = opt_data.get('oi_day_high', current_oi)
                        oi_day_low = opt_data.get('oi_day_low', current_oi)
                        
                        # Calculate OI change percentage
                        oi_change_percent = 0
                        if oi_day_low > 0:
                            oi_change_percent = ((current_oi - oi_day_low) / oi_day_low) * 100
                        
                        oi_data = {
                            'oi': current_oi,
                            'oi_day_high': oi_day_high,
                            'oi_day_low': oi_day_low,
                            'oi_change_percent': oi_change_percent,
                            'volume': opt_data.get('volume', 0)
                        }
                        
                        # Generate signal with market metrics
                        signal_analysis = signal_gen.analyze_signal(
                            greeks, oi_data, option_type, strike_type,
                            market_metrics, spot_price, strike
                        )
                        
                        strike_data[option_type] = {
                            'ltp': ltp,
                            'change': opt_data.get('change', 0),
                            'change_percent': opt_data.get('change_percent', 0),
                            'volume': opt_data.get('volume', 0),
                            'oi': current_oi,
                            'oi_change': opt_data.get('oi_day_high', 0) - opt_data.get('oi_day_low', 0),
                            'iv': 0,  # IV will be calculated if needed
                            'bid': opt_data.get('depth', {}).get('buy', [{}])[0].get('price', 0) if opt_data.get('depth') else 0,
                            'ask': opt_data.get('depth', {}).get('sell', [{}])[0].get('price', 0) if opt_data.get('depth') else 0,
                            'greeks': greeks,
                            'signal': signal_analysis['signal'],
                            'signal_strength': signal_analysis['signal_strength'],
                            'score': signal_analysis['score'],
                            'reasons': signal_analysis['reasons'],
                            'tradingsymbol': option['tradingsymbol']
                        }
                    except Exception as e:
                        print(f"Error processing option data: {e}")
            
            option_chain.append(strike_data)
        
        # Log the final data being returned - COMPREHENSIVE DEBUGGING
        print(f"\n[DEBUG] ===== FINAL DATA BEFORE RETURN =====")
        print(f"[DEBUG] market_bias object exists: {market_bias is not None}")
        print(f"[DEBUG] market_bias type: {type(market_bias)}")
        print(f"[DEBUG] market_bias keys: {list(market_bias.keys()) if isinstance(market_bias, dict) else 'NOT A DICT'}")
        print(f"[DEBUG] bullish_percentage: {market_bias.get('bullish_percentage') if isinstance(market_bias, dict) else 'N/A'}")
        print(f"[DEBUG] bearish_percentage: {market_bias.get('bearish_percentage') if isinstance(market_bias, dict) else 'N/A'}")
        print(f"[DEBUG] component_scores: {market_bias.get('component_scores') if isinstance(market_bias, dict) else 'N/A'}")
        print(f"[DEBUG] direction_percentage calc: {(market_bias.get('bullish_percentage', 0) - 50) if isinstance(market_bias, dict) else 'N/A'}")
        print(f"[DEBUG] market_metrics pcr: {market_metrics.get('pcr')}")
        print(f"[DEBUG] market_direction: {market_metrics.get('market_direction')}")
        print(f"[DEBUG] ===== END DEBUG =====\n")
        
        return_data = {
            'symbol': symbol,
            'spot_price': spot_price,
            'expiry': nearest_expiry.isoformat(),
            'time_to_expiry_days': round(time_to_expiry * 365, 2),
            'atm_strike': atm_strike,
            'option_chain': option_chain,
            'pcr': market_metrics['pcr'],
            'market_direction': market_metrics['market_direction'],
            'direction_percentage': market_bias['bullish_percentage'] - 50,  # Convert to -50 to +50 scale
            'probability_bullish': market_metrics['probability_bullish'],
            'probability_range': market_metrics['probability_range'],
            'probability_bearish': market_metrics['probability_bearish'],
            'bullish_percentage': market_bias['bullish_percentage'],
            'bearish_percentage': market_bias['bearish_percentage'],
            'component_scores': market_bias['component_scores'],
            'total_ce_oi': market_metrics['total_ce_oi'],
            'total_pe_oi': market_metrics['total_pe_oi'],
            'timestamp': datetime.now().isoformat()
        }
        
        print(f"[DEBUG] Return data contains bullish_percentage: {'bullish_percentage' in return_data}")
        print(f"[DEBUG] Return data bullish_percentage value: {return_data.get('bullish_percentage')}")
        print(f"[DEBUG] Full return_data keys: {list(return_data.keys())}")
        
        return return_data
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/optionchain/{symbol}")
async def get_full_option_chain(symbol: str):
    """Get full option chain with all strikes - live data"""
    try:
        option_data = await get_option_chain(symbol)
        return option_data
    except Exception as e:
        print(f"Error fetching option chain for {symbol}: {e}")
        # Return mock data instead of error
        print(f"Returning mock option chain data for {symbol}")
        spot_prices = {'NIFTY': 25959, 'BANKNIFTY': 51500, 'SENSEX': 81500}
        spot = spot_prices.get(symbol.upper(), 25959)
        atm_strike = round(spot / 100) * 100
        
        # Generate mock option chain
        mock_chain = []
        for strike in range(atm_strike - 500, atm_strike + 600, 100):
            mock_chain.append({
                'strike': strike,
                'CE': {
                    'ltp': max(strike - atm_strike, 10) * 0.5,
                    'change': round(np.random.uniform(-10, 10), 2),
                    'change_percent': round(np.random.uniform(-5, 5), 2),
                    'volume': int(np.random.uniform(10000, 100000)),
                    'oi': int(np.random.uniform(100000, 500000)),
                    'oi_change': int(np.random.uniform(-50000, 50000)),
                    'iv': round(15 + np.random.uniform(0, 10), 2),
                    'bid': max(strike - atm_strike, 10) * 0.45,
                    'ask': max(strike - atm_strike, 10) * 0.55,
                    'signal': 'BUY' if np.random.random() > 0.5 else 'SELL',
                    'signal_strength': 'MODERATE',
                    'score': int(np.random.uniform(50, 100)),
                    'reasons': ['IV low', 'OI high'],
                    'tradingsymbol': f'{symbol}{atm_strike}CE',
                    'greeks': {'delta': 0.5, 'gamma': 0.02, 'theta': -0.1, 'vega': 2.0}
                },
                'PE': {
                    'ltp': max(atm_strike - strike, 10) * 0.5,
                    'change': round(np.random.uniform(-10, 10), 2),
                    'change_percent': round(np.random.uniform(-5, 5), 2),
                    'volume': int(np.random.uniform(10000, 100000)),
                    'oi': int(np.random.uniform(100000, 500000)),
                    'oi_change': int(np.random.uniform(-50000, 50000)),
                    'iv': round(15 + np.random.uniform(0, 10), 2),
                    'bid': max(atm_strike - strike, 10) * 0.45,
                    'ask': max(atm_strike - strike, 10) * 0.55,
                    'signal': 'SELL' if np.random.random() > 0.5 else 'BUY',
                    'signal_strength': 'MODERATE',
                    'score': int(np.random.uniform(50, 100)),
                    'reasons': ['IV low', 'OI high'],
                    'tradingsymbol': f'{symbol}{atm_strike}PE',
                    'greeks': {'delta': -0.5, 'gamma': 0.02, 'theta': -0.1, 'vega': 2.0}
                }
            })
        
        return {
            'symbol': symbol.upper(),
            'spot_price': spot,
            'atm_strike': atm_strike,
            'pcr': 1.2,
            'market_direction': 'BULLISH',
            'total_ce_oi': 5000000,
            'total_pe_oi': 6000000,
            'option_chain': mock_chain,
            'timestamp': datetime.now().isoformat()
        }


@app.get("/api/signals/{symbol}")
async def get_strong_signals(symbol: str):
    """Get only strong buy signals for a symbol with caching and SMS alerts"""
    
    # Check if market is open
    market_open = is_market_open()
    ist_now = datetime.now(IST)
    
    # If market is closed, still fetch last traded data but don't send alerts
    if not market_open:
        print(f"[MARKET CLOSED] Fetching last traded data for {symbol.upper()}")
    
    # Check cache first
    current_time = time.time()
    cache_key = symbol.upper()
    
    if cache_key in CACHE and cache_key in CACHE_EXPIRY:
        if current_time < CACHE_EXPIRY[cache_key]:
            # Return cached data immediately
            cached = CACHE[cache_key]
            cached['market_status'] = 'OPEN'
            return cached
    
    # Rate limiting: Wait before making API call if needed
    if cache_key in LAST_API_CALL:
        time_since_last = current_time - LAST_API_CALL[cache_key]
        if time_since_last < MIN_API_DELAY:
            wait_time = MIN_API_DELAY - time_since_last
            time.sleep(wait_time)
    
    LAST_API_CALL[cache_key] = time.time()
    
    try:
        option_data = await get_option_chain(symbol)
    except Exception as e:
        print(f"Error fetching option chain for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch option chain: {str(e)}")
    
    try:
        strong_signals = []
        
        for strike_data in option_data['option_chain']:
            for option_type in ['CE', 'PE']:
                if option_type in strike_data:
                    opt = strike_data[option_type]
                    # Only include signals with 90%+ score (BUYER FOCUSED)
                    if opt['signal'] in ['STRONG BUY', 'BUY'] and opt['score'] >= 90:
                        signal = {
                            'symbol': symbol,
                            'strike': strike_data['strike'],
                            'option_type': option_type,
                            'signal': opt['signal'],
                            'signal_strength': opt['signal_strength'],
                            'score': opt['score'],
                            'reasons': opt['reasons'],
                            'ltp': opt['ltp'],
                            'greeks': opt['greeks'],
                            'oi': opt['oi'],
                            'volume': opt.get('volume', 0),
                            'tradingsymbol': opt['tradingsymbol'],
                            'pcr': option_data.get('pcr', 1.0)
                        }
                        strong_signals.append(signal)
                        
                        # AI-POWERED ANALYSIS: Detect sudden OI movements & big player entry
                        try:
                            ai_service = get_ai_service()
                            
                            if ai_service.enabled:
                                # Track OI changes for spike detection
                                ai_service.track_oi_change(
                                    symbol=symbol,
                                    strike=strike_data['strike'],
                                    option_type=option_type,
                                    current_oi=opt['oi']
                                )
                                
                                # Detect sudden OI spike
                                spike_info = ai_service.detect_sudden_spike(
                                    symbol=symbol,
                                    strike=strike_data['strike'],
                                    option_type=option_type,
                                    current_oi=opt['oi']
                                )
                                
                                # Only run AI analysis if spike detected or score >= 92%
                                ai_analysis = None
                                if spike_info['spike_detected'] or opt['score'] >= 92:
                                    print(f"[AI] Analyzing {symbol} {strike_data['strike']} {option_type}")
                                    
                                    # ENHANCED: Add ALL strikes data for comprehensive analysis
                                    enhanced_signal = signal.copy()
                                    enhanced_signal['spot_price'] = option_data.get('spot_price', 0)
                                    enhanced_signal['all_strikes_data'] = []
                                    
                                    # Collect all strikes with their OI, volume, OI changes
                                    for s_data in option_data['option_chain']:
                                        strike_info = {
                                            'strike': s_data['strike'],
                                            'ce_oi': s_data.get('CE', {}).get('oi', 0),
                                            'ce_volume': s_data.get('CE', {}).get('volume', 0),
                                            'ce_oi_change': s_data.get('CE', {}).get('oi_change_pct', 0),
                                            'pe_oi': s_data.get('PE', {}).get('oi', 0),
                                            'pe_volume': s_data.get('PE', {}).get('volume', 0),
                                            'pe_oi_change': s_data.get('PE', {}).get('oi_change_pct', 0),
                                        }
                                        enhanced_signal['all_strikes_data'].append(strike_info)
                                    
                                    ai_analysis = ai_service.analyze_sudden_movement(
                                        signal_data=enhanced_signal,
                                        spike_info=spike_info
                                    )
                                    
                                    if ai_analysis:
                                        print(f"[AI] Big Player: {ai_analysis['analysis'].get('big_player_detected', False)}")
                                        print(f"[AI] Confidence: {ai_analysis['analysis'].get('confidence', 0)}%")
                                
                                # Send WhatsApp alert with AI insights (ONLY if market is open)
                                if market_open:
                                    alert_service = get_alert_service()
                                    
                                    # Use AI-enhanced message if available
                                    if ai_analysis and ai_analysis['analysis'].get('big_player_detected'):
                                        enhanced_message = ai_service.enhance_whatsapp_alert(signal, ai_analysis)
                                        alert_service.send_alert(signal, custom_message=enhanced_message)
                                    else:
                                        alert_service.send_alert(signal)
                                else:
                                    print(f"[MARKET CLOSED] Skipping alert for {symbol} {strike_data['strike']} {option_type}")
                            else:
                                # Fallback: Send regular alert if AI disabled (ONLY if market is open)
                                if market_open:
                                    alert_service = get_alert_service()
                                    alert_service.send_alert(signal)
                                else:
                                    print(f"[MARKET CLOSED] Skipping alert")
                                
                        except Exception as alert_error:
                            print(f"[ALERT ERROR] Failed to send SMS: {alert_error}")
        
        # Sort by score
        strong_signals.sort(key=lambda x: x['score'], reverse=True)
        
        result = {
            'symbol': symbol,
            'spot_price': option_data['spot_price'],
            'signals': strong_signals if market_open else [],  # No signals when market closed
            'pcr': option_data.get('pcr'),
            'market_direction': option_data.get('market_direction'),
            'direction_percentage': option_data.get('direction_percentage'),
            'probability_bullish': option_data.get('probability_bullish'),
            'probability_range': option_data.get('probability_range'),
            'probability_bearish': option_data.get('probability_bearish'),
            'bullish_percentage': option_data.get('bullish_percentage'),
            'bearish_percentage': option_data.get('bearish_percentage'),
            'component_scores': option_data.get('component_scores'),
            'total_ce_oi': option_data.get('total_ce_oi'),
            'total_pe_oi': option_data.get('total_pe_oi'),
            'timestamp': datetime.now().isoformat(),
            'market_status': 'OPEN' if market_open else 'CLOSED'
        }
        
        # Add market closed message if needed
        if not market_open:
            result['message'] = f'Market is closed. Showing last traded values. Trading hours: 9:15 AM - 3:30 PM IST (Mon-Fri). Current time: {ist_now.strftime("%I:%M %p IST")}'
        
        # Cache the result for 3 seconds (reduced from 1 to reduce API calls)
        CACHE[cache_key] = result
        CACHE_EXPIRY[cache_key] = current_time + 3
        
        return result
        
    except Exception as e:
        print(f"Error processing signals: {e}")
        # Return mock data on any error
        result = get_mock_market_closed_data(symbol)
        result['message'] = f'Error fetching data: {str(e)}'
        CACHE[cache_key] = result
        CACHE_EXPIRY[cache_key] = current_time + 3
        return result


@app.websocket("/ws/signals/{symbol}")
async def websocket_signals(websocket: WebSocket, symbol: str):
    """WebSocket endpoint for real-time signal updates - updates every second"""
    await websocket.accept()
    active_connections.append(websocket)
    
    try:
        while True:
            # Send updates every 1 second for real-time streaming
            try:
                signals = await get_strong_signals(symbol.upper())
                await websocket.send_json(signals)
            except Exception as e:
                print(f"Error sending {symbol} signals: {e}")
                await websocket.send_json({"error": str(e)})
            
            await asyncio.sleep(1)  # Update every 1 second
            
    except WebSocketDisconnect:
        active_connections.remove(websocket)


@app.get("/health")
@app.get("/api/health")
async def health_check():
    """Health check endpoint for monitoring and debugging"""
    return {
        "status": "healthy",
        "service": "Options Trading Signals API",
        "version": "2.0.0",
        "timestamp": datetime.now().isoformat(),
        "config": {
            "zerodha_api_key_configured": bool(settings.ZERODHA_API_KEY),
            "zerodha_api_secret_configured": bool(settings.ZERODHA_API_SECRET),
            "redirect_url": settings.ZERODHA_REDIRECT_URL,
            "twilio_configured": bool(settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN),
        }
    }


@app.get("/")
async def root():
    """Root endpoint with API information"""
    return {
        "message": "Options Trading Signals API",
        "version": "2.0.0",
        "status": "running",
        "docs": "/docs",
        "health": "/health",
        "endpoints": {
            "market_status": "/api/market/status",
            "signals": "/api/signals/{symbol}",
            "auth_login": "/api/auth/login-url",
        }
    }


if __name__ == "__main__":
    import uvicorn
    print("[STARTUP] Starting backend server...")
    print(f"[STARTUP] Zerodha API Key: {settings.ZERODHA_API_KEY[:8] if settings.ZERODHA_API_KEY else 'NOT SET'}...")
    print(f"[STARTUP] Redirect URL: {settings.ZERODHA_REDIRECT_URL}")
    port = int(os.getenv("PORT", 8001))
    print(f"[STARTUP] Server running on http://0.0.0.0:{port}")
    print(f"[STARTUP] Health check: http://0.0.0.0:{port}/health")
    print(f"[STARTUP] API docs: http://0.0.0.0:{port}/docs")
    try:
        uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
    except Exception as e:
        print(f"[ERROR] Failed to start server: {e}")
        import traceback
        traceback.print_exc()
