"""
Test Data Factory
Generates realistic market test data without hardcoding
Use this for testing, demos, and development
"""

import random
from datetime import datetime
from typing import Dict, Any, Optional
import json
import os

class TestDataFactory:
    """Factory for generating realistic test market data"""
    
    # Base prices for realistic data generation (not hardcoded in code)
    BASE_PRICES = {
        "NIFTY": 20150.0,
        "BANKNIFTY": 47850.0,
        "SENSEX": 78500.0,
    }
    
    # Volume ranges for realistic data
    VOLUME_RANGES = {
        "NIFTY": (500000, 2000000),
        "BANKNIFTY": (300000, 1500000),
        "SENSEX": (50000, 200000),
    }
    
    # OI ranges (Open Interest)
    OI_RANGES = {
        "NIFTY": (10000000, 50000000),
        "BANKNIFTY": (5000000, 25000000),
        "SENSEX": (500000, 2000000),
    }
    
    @classmethod
    def generate_tick(
        cls,
        symbol: str,
        price_variance: float = 0.02,
        volume: Optional[int] = None,
        oi: Optional[int] = None,
        status: str = "LIVE"
    ) -> Dict[str, Any]:
        """
        Generate a realistic market tick for testing
        
        Args:
            symbol: NIFTY, BANKNIFTY, or SENSEX
            price_variance: How much price can vary (0.02 = 2%)
            volume: Optional custom volume (uses random if not provided)
            oi: Optional custom OI (uses random if not provided)
            status: LIVE, CLOSED, PRE_OPEN
        
        Returns:
            Dict with complete tick data
        """
        base_price = cls.BASE_PRICES.get(symbol, 20000.0)
        
        # Generate realistic price movement
        variance = base_price * price_variance * random.uniform(-1, 1)
        current_price = round(base_price + variance, 2)
        
        # OHLC data
        open_price = round(base_price + random.uniform(-0.5, 0.5) * base_price * 0.01, 2)
        high_price = round(max(open_price, current_price) * (1 + random.uniform(0, 0.01)), 2)
        low_price = round(min(open_price, current_price) * (1 - random.uniform(0, 0.01)), 2)
        close_price = round(base_price * (1 + random.uniform(-0.01, 0.01)), 2)
        
        # Calculate change
        change = round(current_price - close_price, 2)
        change_percent = round((change / close_price * 100) if close_price else 0, 2)
        
        # Volume and OI
        if volume is None:
            vol_min, vol_max = cls.VOLUME_RANGES.get(symbol, (100000, 500000))
            volume = random.randint(vol_min, vol_max)
        
        if oi is None:
            oi_min, oi_max = cls.OI_RANGES.get(symbol, (1000000, 10000000))
            oi = random.randint(oi_min, oi_max)
        
        # PCR (Put-Call Ratio) - realistic range 0.5-2.0
        pcr = round(random.uniform(0.5, 2.0), 2)
        
        # Call and Put OI
        total_oi = oi
        call_oi = int(total_oi * random.uniform(0.4, 0.6))
        put_oi = total_oi - call_oi
        
        # Trend based on change
        if change > 0:
            trend = "bullish"
        elif change < 0:
            trend = "bearish"
        else:
            trend = "neutral"
        
        return {
            "symbol": symbol,
            "price": current_price,
            "open": open_price,
            "high": high_price,
            "low": low_price,
            "close": close_price,
            "change": change,
            "changePercent": change_percent,
            "volume": volume,
            "oi": oi,
            "pcr": pcr,
            "callOI": call_oi,
            "putOI": put_oi,
            "trend": trend,
            "timestamp": datetime.now().isoformat(),
            "status": status,
        }
    
    @classmethod
    def generate_all_symbols(cls, **kwargs) -> Dict[str, Dict[str, Any]]:
        """Generate ticks for all symbols"""
        return {
            symbol: cls.generate_tick(symbol, **kwargs)
            for symbol in cls.BASE_PRICES.keys()
        }
    
    @classmethod
    def generate_analysis(cls, tick: Dict[str, Any]) -> Dict[str, Any]:
        """Generate realistic analysis data for a tick"""
        price = tick.get("price", 0)
        symbol = tick.get("symbol", "UNKNOWN")
        
        # Generate signals based on momentum
        change_pct = tick.get("changePercent", 0)
        if change_pct > 1.0:
            signal = "STRONG_BUY"
            confidence = round(0.75 + random.uniform(0, 0.25), 2)
        elif change_pct > 0.3:
            signal = "BUY_SIGNAL"
            confidence = round(0.60 + random.uniform(0, 0.20), 2)
        elif change_pct < -1.0:
            signal = "STRONG_SELL"
            confidence = round(0.75 + random.uniform(0, 0.25), 2)
        elif change_pct < -0.3:
            signal = "SELL_SIGNAL"
            confidence = round(0.60 + random.uniform(0, 0.20), 2)
        else:
            signal = "NEUTRAL"
            confidence = round(0.50 + random.uniform(0, 0.30), 2)
        
        # Volume strength
        volume = tick.get("volume", 0)
        vol_min, vol_max = cls.VOLUME_RANGES.get(symbol, (100000, 500000))
        avg_vol = (vol_min + vol_max) / 2
        if volume > avg_vol * 1.5:
            volume_strength = "STRONG_VOLUME"
        elif volume > avg_vol:
            volume_strength = "MODERATE_VOLUME"
        else:
            volume_strength = "WEAK_VOLUME"
        
        return {
            "signal": signal,
            "confidence": confidence,
            "indicators": {
                "price": price,
                "high": tick.get("high", price),
                "low": tick.get("low", price),
                "open": tick.get("open", price),
                "vwap": round(price * random.uniform(0.99, 1.01), 2),
                "vwap_position": random.choice(["ABOVE_VWAP", "BELOW_VWAP", "AT_VWAP"]),
                "ema_20": round(price * random.uniform(0.98, 1.02), 2),
                "ema_50": round(price * random.uniform(0.97, 1.03), 2),
                "ema_100": round(price * random.uniform(0.96, 1.04), 2),
                "ema_200": round(price * random.uniform(0.95, 1.05), 2),
                "trend": tick.get("trend", "neutral").upper(),
                "support": tick.get("low", price),
                "resistance": tick.get("high", price),
                "volume": volume,
                "volume_strength": volume_strength,
                "rsi": round(random.uniform(30, 70), 1),
                "momentum": round(random.uniform(30, 70), 1),
                "pcr": tick.get("pcr", 0),
                "oi_change": round(random.uniform(-5, 5), 2),
            },
            "reasons": [
                f"Price movement: {change_pct:+.2f}%",
                f"Volume: {volume_strength}",
                f"Trend: {tick.get('trend', 'neutral').capitalize()}",
            ],
            "timestamp": datetime.now().isoformat(),
            "symbol": symbol,
        }
    
    @classmethod
    def generate_complete_tick_with_analysis(cls, symbol: str) -> Dict[str, Any]:
        """Generate a complete tick with analysis"""
        tick = cls.generate_tick(symbol)
        analysis = cls.generate_analysis(tick)
        tick["analysis"] = analysis
        return tick


# Configuration file for test data (loaded from environment)
class TestDataConfig:
    """Configuration for test data generation"""
    
    @staticmethod
    def load_from_env() -> Dict[str, Any]:
        """Load test data configuration from environment"""
        return {
            "enabled": os.getenv("TEST_DATA_ENABLED", "false").lower() == "true",
            "use_real_data": os.getenv("USE_REAL_MARKET_DATA", "true").lower() == "true",
            "price_variance": float(os.getenv("TEST_DATA_PRICE_VARIANCE", "0.02")),
            "refresh_interval": int(os.getenv("TEST_DATA_REFRESH_INTERVAL", "1000")),
        }


if __name__ == "__main__":
    # Example usage
    print("📊 Generating test market data...\n")
    
    # Generate data for all symbols
    all_ticks = TestDataFactory.generate_all_symbols(price_variance=0.05)
    
    for symbol, tick in all_ticks.items():
        print(f"✅ {symbol}:")
        print(f"   Price: ₹{tick['price']:,.2f}")
        print(f"   Change: {tick['changePercent']:+.2f}%")
        print(f"   Volume: {tick['volume']:,}")
        print(f"   Status: {tick['status']}\n")
    
    # Generate with analysis
    print("📊 Generating test data with analysis...\n")
    nifty_with_analysis = TestDataFactory.generate_complete_tick_with_analysis("NIFTY")
    print(f"NIFTY Analysis:")
    print(f"   Signal: {nifty_with_analysis['analysis']['signal']}")
    print(f"   Confidence: {nifty_with_analysis['analysis']['confidence']:.0%}\n")
    
    # Save to file
    output_file = "test_market_data.json"
    with open(output_file, 'w') as f:
        all_data = {
            symbol: TestDataFactory.generate_complete_tick_with_analysis(symbol)
            for symbol in TestDataFactory.BASE_PRICES.keys()
        }
        json.dump(all_data, f, indent=2)
    
    print(f"✅ Test data saved to: {output_file}")
