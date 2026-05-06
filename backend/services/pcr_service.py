"""PCR (Put-Call Ratio) calculation service using Zerodha API."""
import asyncio
from datetime import datetime, timedelta, date
from typing import Dict, Any, Optional, List
import pytz

from config import get_settings

settings = get_settings()
IST = pytz.timezone('Asia/Kolkata')

# Cache for PCR data
_PCR_CACHE: Dict[str, Dict[str, Any]] = {}
_LAST_UPDATE: Dict[str, datetime] = {}

# ── Strike-level OI cache (per symbol → per strike → {ce_oi, pe_oi, ce_vol, pe_vol}) ──
# Updated every 10s alongside PCR. Used by zone participant intelligence.
_STRIKE_OI_MAP: Dict[str, Dict[int, Dict[str, int]]] = {}   # current snapshot
_STRIKE_OI_PREV: Dict[str, Dict[int, Dict[str, int]]] = {}  # previous snapshot (for change calc)
_STRIKE_STEP: Dict[str, int] = {"NIFTY": 50, "BANKNIFTY": 100, "SENSEX": 100}


def get_nearest_strike(price: float, symbol: str) -> int:
    """Return the nearest valid option strike for a given price."""
    step = _STRIKE_STEP.get(symbol, 50)
    return int(round(price / step) * step)


def get_strike_oi(symbol: str, price: float) -> Dict[str, Any]:
    """
    Return live CE/PE OI at the nearest strike to `price`.
    Also computes OI change vs previous snapshot and detects CE↔PE rotation.

    Returns:
        {
          strike          : int,
          ce_oi           : int,   # Call OI at this strike
          pe_oi           : int,   # Put OI at this strike
          ce_oi_chg       : int,   # CE OI change since last fetch (+build / -unwind)
          pe_oi_chg       : int,   # PE OI change since last fetch
          ce_vol          : int,   # CE traded volume at this strike
          pe_vol          : int,   # PE traded volume at this strike
          rotation        : str,   # 'CE_TO_PE' | 'PE_TO_CE' | 'BUILDING' | 'UNWINDING' | 'STABLE'
          defender        : str,   # 'CALLS' | 'PUTS' | 'BALANCED'
          oi_interpretation: str,  # human-readable e.g. "Writers defending resistance"
        }
    """
    empty = {
        "strike": 0, "ce_oi": 0, "pe_oi": 0,
        "ce_oi_chg": 0, "pe_oi_chg": 0,
        "ce_vol": 0, "pe_vol": 0,
        "rotation": "STABLE", "defender": "BALANCED",
        "oi_interpretation": "No option data",
    }
    strike_map = _STRIKE_OI_MAP.get(symbol)
    if not strike_map:
        return empty

    strike = get_nearest_strike(price, symbol)
    data   = strike_map.get(strike)
    if not data:
        # Try ±1 step
        step = _STRIKE_STEP.get(symbol, 50)
        data = strike_map.get(strike + step) or strike_map.get(strike - step)
        if not data:
            return empty

    ce_oi  = data.get("ce_oi", 0)
    pe_oi  = data.get("pe_oi", 0)
    ce_vol = data.get("ce_vol", 0)
    pe_vol = data.get("pe_vol", 0)

    # Change vs previous
    prev_map = _STRIKE_OI_PREV.get(symbol, {})
    prev     = prev_map.get(strike, {})
    ce_chg   = ce_oi - prev.get("ce_oi", ce_oi)
    pe_chg   = pe_oi - prev.get("pe_oi", pe_oi)

    # Rotation detection
    # CE_TO_PE: CE OI dropping + PE OI building → smart money moving to puts (bearish shift)
    # PE_TO_CE: PE OI dropping + CE OI building → smart money moving to calls (bullish shift)
    chg_threshold = max(500, min(ce_oi, pe_oi) * 0.02)  # 2% of smaller side or 500 contracts
    if ce_chg < -chg_threshold and pe_chg > chg_threshold:
        rotation = "CE_TO_PE"      # Bearish rotation
    elif pe_chg < -chg_threshold and ce_chg > chg_threshold:
        rotation = "PE_TO_CE"      # Bullish rotation
    elif ce_chg > chg_threshold and pe_chg > chg_threshold:
        rotation = "BUILDING"      # Both sides building — range / indecision
    elif ce_chg < -chg_threshold and pe_chg < -chg_threshold:
        rotation = "UNWINDING"     # Both sides closing — move exhausting
    else:
        rotation = "STABLE"

    # Who is the dominant writer at this strike?
    if ce_oi > pe_oi * 1.3:
        defender = "CALLS"         # Call writers dominate = resistance (bearish)
        interp = "Call writers defending resistance — expect rejection"
    elif pe_oi > ce_oi * 1.3:
        defender = "PUTS"          # Put writers dominate = support (bullish)
        interp = "Put writers defending support — expect bounce"
    else:
        defender = "BALANCED"
        interp   = "Balanced option writers — no clear OI bias"

    # Rotation override
    if rotation == "PE_TO_CE":
        interp = "PE→CE rotation: smart money building calls, bullish shift"
    elif rotation == "CE_TO_PE":
        interp = "CE→PE rotation: smart money building puts, bearish shift"
    elif rotation == "UNWINDING":
        interp = "OI unwinding at zone — move may exhaust here"
    elif rotation == "BUILDING":
        interp = "OI building both sides — expecting a volatile range test"

    return {
        "strike"          : strike,
        "ce_oi"           : ce_oi,
        "pe_oi"           : pe_oi,
        "ce_oi_chg"       : ce_chg,
        "pe_oi_chg"       : pe_chg,
        "ce_vol"          : ce_vol,
        "pe_vol"          : pe_vol,
        "rotation"        : rotation,
        "defender"        : defender,
        "oi_interpretation": interp,
    }

# SMART CACHING: Cache instruments for entire day (they don't change)
_INSTRUMENTS_CACHE: Dict[str, List] = {}  # {"NFO": [...], "BFO": [...]}
_INSTRUMENTS_CACHE_DATE: Dict[str, date] = {}  # Track when cached

# Rate limit handling
_RATE_LIMITED_UNTIL: Dict[str, datetime] = {}  # Track when rate limited
_FETCH_DELAYS: Dict[str, int] = {"NIFTY": 0, "BANKNIFTY": 10, "SENSEX": 20}  # Stagger fetches


class PCRService:
    """Service to calculate PCR ratio from Zerodha options data."""
    
    def __init__(self):
        self.kite: Optional['KiteConnect'] = None
        self._initialized = False
        self._last_token: Optional[str] = None  # Track last used token
    
    def _init_kite(self):
        """Initialize KiteConnect if not already done."""
        if not self._initialized and settings.zerodha_api_key and settings.zerodha_access_token:
            try:
                from kiteconnect import KiteConnect
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
            if elapsed < 10:  # 10 seconds — fast enough for intraday OI shifts
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
            
            # Sum OI + build per-strike map
            total_call_oi = 0
            total_put_oi = 0

            # Build strike→{ce_oi, pe_oi, ce_vol, pe_vol}
            strike_map: Dict[int, Dict[str, int]] = {}

            for inst in calls:
                token = inst["instrument_token"]
                q = quotes.get(str(token), {})
                oi_val  = int(q.get("oi", 0))
                vol_val = int(q.get("volume", 0))
                total_call_oi += oi_val
                strike = int(inst.get("strike", 0))
                if strike:
                    if strike not in strike_map:
                        strike_map[strike] = {"ce_oi": 0, "pe_oi": 0, "ce_vol": 0, "pe_vol": 0}
                    strike_map[strike]["ce_oi"]  += oi_val
                    strike_map[strike]["ce_vol"] += vol_val

            for inst in puts:
                token = inst["instrument_token"]
                q = quotes.get(str(token), {})
                oi_val  = int(q.get("oi", 0))
                vol_val = int(q.get("volume", 0))
                total_put_oi += oi_val
                strike = int(inst.get("strike", 0))
                if strike:
                    if strike not in strike_map:
                        strike_map[strike] = {"ce_oi": 0, "pe_oi": 0, "ce_vol": 0, "pe_vol": 0}
                    strike_map[strike]["pe_oi"]  += oi_val
                    strike_map[strike]["pe_vol"] += vol_val

            # Save previous snapshot before overwriting (for change detection)
            if symbol in _STRIKE_OI_MAP:
                _STRIKE_OI_PREV[symbol] = _STRIKE_OI_MAP[symbol]
            _STRIKE_OI_MAP[symbol] = strike_map
            
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
