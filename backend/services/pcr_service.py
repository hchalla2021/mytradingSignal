"""PCR (Put-Call Ratio) calculation service using Zerodha API."""
import asyncio
from datetime import datetime
from typing import Dict, Any, Optional
from kiteconnect import KiteConnect
import pytz

from config import get_settings

settings = get_settings()
IST = pytz.timezone('Asia/Kolkata')

# Cache for PCR data
_PCR_CACHE: Dict[str, Dict[str, Any]] = {}
_LAST_UPDATE: Dict[str, datetime] = {}


class PCRService:
    """Service to calculate PCR ratio from Zerodha options data."""
    
    def __init__(self):
        self.kite: Optional[KiteConnect] = None
        self._initialized = False
    
    def _init_kite(self):
        """Initialize KiteConnect if not already done."""
        if not self._initialized and settings.zerodha_api_key and settings.zerodha_access_token:
            try:
                self.kite = KiteConnect(api_key=settings.zerodha_api_key)
                self.kite.set_access_token(settings.zerodha_access_token)
                self._initialized = True
            except Exception as e:
                print(f"❌ Failed to initialize KiteConnect for PCR: {e}")
    
    async def get_pcr_data(self, symbol: str) -> Dict[str, Any]:
        """
        Get PCR data for an index.
        Returns: {pcr, callOI, putOI, sentiment}
        """
        self._init_kite()
        
        # Check cache (update every 60 seconds)
        now = datetime.now(IST)
        if symbol in _PCR_CACHE and symbol in _LAST_UPDATE:
            elapsed = (now - _LAST_UPDATE[symbol]).total_seconds()
            if elapsed < 60:
                return _PCR_CACHE[symbol]
        
        # Default values
        default_data = {
            "pcr": 0.0,
            "callOI": 0,
            "putOI": 0,
            "oi": 0,
            "sentiment": "neutral"
        }
        
        if not self.kite:
            return default_data
        
        try:
            # Get options chain data
            pcr_data = await asyncio.to_thread(self._fetch_pcr_from_zerodha, symbol)
            _PCR_CACHE[symbol] = pcr_data
            _LAST_UPDATE[symbol] = now
            return pcr_data
        except Exception as e:
            print(f"❌ Error fetching PCR for {symbol}: {e}")
            return _PCR_CACHE.get(symbol, default_data)
    
    def _fetch_pcr_from_zerodha(self, symbol: str) -> Dict[str, Any]:
        """Fetch PCR from Zerodha (blocking call, run in thread)."""
        try:
            # Map symbol to Zerodha index name
            index_map = {
                "NIFTY": "NIFTY",
                "BANKNIFTY": "BANKNIFTY",
                "SENSEX": "SENSEX"
            }
            
            index_name = index_map.get(symbol, symbol)
            
            # Get current expiry options instruments
            instruments = self.kite.instruments("NFO")
            
            # Filter for current week/month expiry options
            today = datetime.now(IST).date()
            
            # Find options for this index
            calls = []
            puts = []
            
            for inst in instruments:
                if inst.get("name") == index_name and inst.get("instrument_type") in ["CE", "PE"]:
                    expiry = inst.get("expiry")
                    if expiry and expiry >= today:
                        # Get nearest expiry
                        if inst["instrument_type"] == "CE":
                            calls.append(inst)
                        else:
                            puts.append(inst)
            
            # Get nearest expiry
            if calls:
                nearest_expiry = min(set(c.get("expiry") for c in calls if c.get("expiry")))
                calls = [c for c in calls if c.get("expiry") == nearest_expiry]
                puts = [p for p in puts if p.get("expiry") == nearest_expiry]
            
            if not calls or not puts:
                return {"pcr": 0.0, "callOI": 0, "putOI": 0, "oi": 0, "sentiment": "neutral"}
            
            # Get OI data for options (batch of 500 max)
            call_tokens = [c["instrument_token"] for c in calls[:100]]
            put_tokens = [p["instrument_token"] for p in puts[:100]]
            
            # Fetch quotes
            all_tokens = call_tokens + put_tokens
            if not all_tokens:
                return {"pcr": 0.0, "callOI": 0, "putOI": 0, "oi": 0, "sentiment": "neutral"}
            
            # Zerodha quote needs instrument tokens as strings
            quotes = self.kite.quote([str(t) for t in all_tokens[:200]])
            
            # Sum OI
            total_call_oi = 0
            total_put_oi = 0
            
            for token in call_tokens:
                q = quotes.get(str(token), {})
                total_call_oi += q.get("oi", 0)
            
            for token in put_tokens:
                q = quotes.get(str(token), {})
                total_put_oi += q.get("oi", 0)
            
            # Calculate PCR
            pcr = round(total_put_oi / total_call_oi, 2) if total_call_oi > 0 else 0.0
            
            # Determine sentiment
            if pcr > 1.2:
                sentiment = "bullish"  # High PCR = more puts = bullish (contrarian)
            elif pcr < 0.8:
                sentiment = "bearish"  # Low PCR = more calls = bearish (contrarian)
            else:
                sentiment = "neutral"
            
            return {
                "pcr": pcr,
                "callOI": total_call_oi,
                "putOI": total_put_oi,
                "oi": total_call_oi + total_put_oi,
                "sentiment": sentiment
            }
            
        except Exception as e:
            print(f"❌ PCR fetch error: {e}")
            return {"pcr": 0.0, "callOI": 0, "putOI": 0, "oi": 0, "sentiment": "neutral"}


# Singleton instance
_pcr_service: Optional[PCRService] = None


def get_pcr_service() -> PCRService:
    """Get singleton PCR service instance."""
    global _pcr_service
    if _pcr_service is None:
        _pcr_service = PCRService()
    return _pcr_service


async def get_pcr_data(symbol: str) -> Dict[str, Any]:
    """Helper function to get PCR data for a symbol."""
    service = get_pcr_service()
    return await service.get_pcr_data(symbol)
