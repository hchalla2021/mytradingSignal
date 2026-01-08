"""PCR (Put-Call Ratio) calculation service using Zerodha API."""
import asyncio
from datetime import datetime, timedelta, date
from typing import Dict, Any, Optional, List
from kiteconnect import KiteConnect
import pytz

from config import get_settings

settings = get_settings()
IST = pytz.timezone('Asia/Kolkata')

# Cache for PCR data
_PCR_CACHE: Dict[str, Dict[str, Any]] = {}
_LAST_UPDATE: Dict[str, datetime] = {}

# SMART CACHING: Cache instruments for entire day (they don't change)
_INSTRUMENTS_CACHE: Dict[str, List] = {}  # {"NFO": [...], "BFO": [...]}
_INSTRUMENTS_CACHE_DATE: Dict[str, date] = {}  # Track when cached

# Rate limit handling
_RATE_LIMITED_UNTIL: Dict[str, datetime] = {}  # Track when rate limited
_FETCH_DELAYS: Dict[str, int] = {"NIFTY": 0, "BANKNIFTY": 10, "SENSEX": 20}  # Stagger fetches


class PCRService:
    """Service to calculate PCR ratio from Zerodha options data."""
    
    def __init__(self):
        self.kite: Optional[KiteConnect] = None
        self._initialized = False
        self._last_token: Optional[str] = None  # Track last used token
    
    def _init_kite(self):
        """Initialize KiteConnect if not already done."""
        if not self._initialized and settings.zerodha_api_key and settings.zerodha_access_token:
            try:
                self.kite = KiteConnect(api_key=settings.zerodha_api_key)
                self.kite.set_access_token(settings.zerodha_access_token)
                
                # 🔥 CRITICAL FIX: Validate token immediately by making a simple API call
                try:
                    profile = self.kite.profile()
                    print(f"✅ PCR Service initialized - User: {profile.get('user_name', 'Unknown')}")
                    self._initialized = True
                except Exception as e:
                    error_msg = str(e).lower()
                    if "token" in error_msg or "api_key" in error_msg or "403" in error_msg:
                        print("\n" + "="*80)
                        print("🔴 PCR SERVICE ERROR: ZERODHA TOKEN EXPIRED OR INVALID")
                        print("="*80)
                        print(f"Error: {e}")
                        print("\n💡 SOLUTION:")
                        print("   1. Run: python backend/get_token.py")
                        print("   2. Or run: python quick_token_fix.py")
                        print("   3. Or click LOGIN in the UI")
                        print("\n⚠️ PCR will show 0.00 until token is refreshed")
                        print("="*80 + "\n")
                    else:
                        print(f"❌ Failed to validate Zerodha token for PCR: {e}")
                    self.kite = None
                    self._initialized = False
                    
            except Exception as e:
                print(f"❌ Failed to initialize KiteConnect for PCR: {e}")
                self.kite = None
                self._initialized = False
        elif not settings.zerodha_api_key or not settings.zerodha_access_token:
            print("\n" + "="*80)
            print("⚠️ PCR SERVICE: ZERODHA CREDENTIALS NOT CONFIGURED")
            print("="*80)
            print("Missing: ZERODHA_API_KEY or ZERODHA_ACCESS_TOKEN")
            print("\nSetup Instructions:")
            print("   1. Get API credentials from: https://developers.kite.trade")
            print("   2. Add to backend/.env file:")
            print("      ZERODHA_API_KEY=your_api_key")
            print("      ZERODHA_API_SECRET=your_api_secret")
            print("   3. Generate token: python backend/get_token.py")
            print("="*80 + "\n")
            self.kite = None
            self._initialized = False
    
    async def get_pcr_data(self, symbol: str) -> Dict[str, Any]:
        """
        Get PCR data for an index.
        Returns: {pcr, callOI, putOI, sentiment}
        """
        # 🔥 CRITICAL FIX: Check if token changed and re-initialize
        current_token = settings.zerodha_access_token
        if current_token and current_token != self._last_token:
            print(f"[TOKEN-REFRESH] New Zerodha token detected! Re-initializing PCR service...")
            self._initialized = False
            self._last_token = current_token
        
        self._init_kite()
        
        # Check cache (update every 10 seconds for real-time PCR)
        now = datetime.now(IST)
        if symbol in _PCR_CACHE and symbol in _LAST_UPDATE:
            elapsed = (now - _LAST_UPDATE[symbol]).total_seconds()
            if elapsed < 30:  # Increased to 30 seconds to avoid rate limits
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
            # Try to re-initialize in case token was updated
            self._init_kite()
            
            if not self.kite:
                print(f"[ERROR] PCR Service not initialized - Token expired or credentials missing")
                print(f"        Run: python backend/get_token.py to generate a new token")
                return default_data
        
        # SMART: Check if we're rate limited
        if symbol in _RATE_LIMITED_UNTIL:
            until = _RATE_LIMITED_UNTIL[symbol]
            if now < until:
                wait_seconds = (until - now).total_seconds()
                # Rate limited, return cached data if available
                if symbol in _PCR_CACHE:
                    return _PCR_CACHE[symbol]
                return default_data
        
        try:
            # Get options chain data
            pcr_data = await asyncio.to_thread(self._fetch_pcr_from_zerodha, symbol)
            _PCR_CACHE[symbol] = pcr_data
            
            # Clear rate limit flag on success
            if symbol in _RATE_LIMITED_UNTIL:
                del _RATE_LIMITED_UNTIL[symbol]
            _LAST_UPDATE[symbol] = now
            
            return pcr_data
        except Exception as e:
            error_msg = str(e).lower()
            
            # SMART: Detect rate limiting
            if "too many requests" in error_msg or "429" in error_msg:
                # Exponential backoff: 60s, 120s, 180s...
                backoff_seconds = 60 * (1 + len([k for k in _RATE_LIMITED_UNTIL.keys()]))
                retry_time = now + timedelta(seconds=backoff_seconds)
                _RATE_LIMITED_UNTIL[symbol] = retry_time
                print(f"[RATE-LIMIT] {symbol} detected! Backing off for {backoff_seconds}s")
            else:
                print(f"[ERROR] PCR fetch error for {symbol}: {type(e).__name__}: {e}")
            
            # Return cached data if available
            if symbol in _PCR_CACHE:
                age = (now - _LAST_UPDATE.get(symbol, now)).total_seconds()
                return _PCR_CACHE[symbol]
            
            print(f"[ERROR] No cached PCR for {symbol}, returning zeros")
            return default_data
    
    def _get_cached_instruments(self, exchange: str) -> List:
        """Get instruments with smart daily caching."""
        today = datetime.now(IST).date()
        
        # Check if we have fresh cache (same day)
        if exchange in _INSTRUMENTS_CACHE and exchange in _INSTRUMENTS_CACHE_DATE:
            if _INSTRUMENTS_CACHE_DATE[exchange] == today:
                print(f"[CACHE-HIT] Using cached instruments for {exchange} (today's cache)")
                return _INSTRUMENTS_CACHE[exchange]
        
        # Fetch fresh instruments
        print(f"[FETCH-INST] Fetching instruments for {exchange}...")
        instruments = self.kite.instruments(exchange)
        
        # Cache for entire day
        _INSTRUMENTS_CACHE[exchange] = instruments
        _INSTRUMENTS_CACHE_DATE[exchange] = today
        print(f"[CACHE-SAVE] Cached {len(instruments)} instruments for {exchange}")
        
        return instruments
    
    def _fetch_pcr_from_zerodha(self, symbol: str) -> Dict[str, Any]:
        """Fetch PCR from Zerodha (blocking call, run in thread)."""
        try:
            # Map symbol to Zerodha index name AND exchange
            index_config = {
                "NIFTY": {"name": "NIFTY", "exchange": "NFO"},
                "BANKNIFTY": {"name": "BANKNIFTY", "exchange": "NFO"},
                "SENSEX": {"name": "SENSEX", "exchange": "BFO"}  # SENSEX is on BSE!
            }
            
            config = index_config.get(symbol)
            if not config:
                print(f"[WARN] Unknown index: {symbol}")
                return {"pcr": 0.0, "callOI": 0, "putOI": 0, "oi": 0, "sentiment": "neutral"}
            
            index_name = config["name"]
            exchange = config["exchange"]
            
            print(f"[PCR] Fetching PCR for {symbol} from {exchange} exchange...")
            
            # SMART: Get instruments from cache (daily cache)
            try:
                instruments = self._get_cached_instruments(exchange)
                print(f"[INST] Using {len(instruments)} instruments from {exchange}")
            except Exception as e:
                error_msg = str(e).lower()
                if "too many requests" in error_msg:
                    print(f"[RATE-LIMIT] Instruments fetch rate limited for {exchange}")
                else:
                    print(f"[ERROR] Failed to fetch instruments from {exchange}: {e}")
                raise
            
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
                print(f"[OPTIONS] {symbol}: Found {len(calls)} calls and {len(puts)} puts for expiry {nearest_expiry}")
            
            if not calls or not puts:
                print(f"[WARN] No options found for {symbol} on {exchange}")
                return {"pcr": 0.0, "callOI": 0, "putOI": 0, "oi": 0, "sentiment": "neutral"}
            
            # Get OI data for options (batch of 500 max)
            call_tokens = [c["instrument_token"] for c in calls[:100]]
            put_tokens = [p["instrument_token"] for p in puts[:100]]
            
            # Fetch quotes
            all_tokens = call_tokens + put_tokens
            if not all_tokens:
                return {"pcr": 0.0, "callOI": 0, "putOI": 0, "oi": 0, "sentiment": "neutral"}
            
            # Zerodha quote needs instrument tokens as strings
            try:
                quotes = self.kite.quote([str(t) for t in all_tokens[:200]])
                print(f"[QUOTES] Fetched quotes for {len(quotes)} instruments")
            except Exception as e:
                print(f"[ERROR] Failed to fetch quotes: {e}")
                print(f"        This usually means Zerodha session expired")
                raise
            
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
            
            print(f"[PCR] {symbol} PCR Calculated: {pcr:.2f} (CallOI:{total_call_oi:,}, PutOI:{total_put_oi:,})")
            
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
            print(f"❌ PCR fetch error for {symbol}: {e}")
            import traceback
            traceback.print_exc()
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
