"""
Contract Manager for Indian Index Futures
==========================================

SOLVES: Automatically manage monthly futures contracts
- Fetches correct tokens for NIFTY, BANKNIFTY, SENSEX
- Identifies current month (near), next month, far month contracts
- Switches to next month automatically when current expires
- Never use stale/expired tokens again

At any time, there are 3 active contracts:
1. Current Month (Near Month) - ACTIVELY TRADED
2. Next Month - Building liquidity
3. Far Month - Lower volume

This system always trades the NEAR MONTH for best liquidity.
"""

from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
import pytz
import logging
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

IST = pytz.timezone('Asia/Kolkata')


class ContractManager:
    """
    Dynamically manage futures contract tokens for NIFTY, BANKNIFTY, SENSEX
    
    Usage:
        manager = ContractManager(kite_client)
        
        # Get current month token for NIFTY
        token = manager.get_current_contract_token("NIFTY")
        
        # Get all 3 contracts for NIFTY
        contracts = manager.get_all_contracts("NIFTY")
    """
    
    SYMBOL_CONFIG = {
        "NIFTY": {
            "search_tradingsymbol": "NIFTY",
            "exchange": "NFO",
            "date_format": "YYMONFUT"  # e.g., 26FEBFUT
        },
        "BANKNIFTY": {
            "search_tradingsymbol": "BANKNIFTY",
            "exchange": "NFO",
            "date_format": "YYMONFUT"
        },
        "SENSEX": {
            "search_tradingsymbol": "SENSEX",
            "exchange": "BSE",  # ← SENSEX IS ON BSE!
            "date_format": "YYMONFUT"
        }
    }
    
    def __init__(self, kite_client):
        """Initialize with Zerodha KiteConnect client"""
        self.kite = kite_client
        self._contract_cache = {}
        self._cache_timestamp = None
        self._cache_expiry = 3600  # Cache for 1 hour
    
    def _is_cache_valid(self) -> bool:
        """Check if contract cache is still valid"""
        if self._cache_timestamp is None:
            return False
        age = (datetime.now(IST) - self._cache_timestamp).total_seconds()
        return age < self._cache_expiry
    
    def _refresh_instruments(self) -> bool:
        """
        Fetch instrument list from Zerodha and cache
        
        Returns:
            True if successful, False otherwise
        """
        try:
            if self._is_cache_valid():
                logger.debug("Using cached instrument list")
                return True
            
            logger.info("📥 Fetching instruments from Zerodha (NFO + BSE)...")
            
            # Fetch both NFO (for NIFTY/BANKNIFTY) and BSE (for SENSEX)
            nfo_instruments = self.kite.instruments("NFO")
            bse_instruments = self.kite.instruments("BSE")
            
            if not nfo_instruments:
                logger.error("❌ No NFO instruments received from Zerodha")
                return False
            
            # Combine both lists
            self._instrument_list = nfo_instruments + (bse_instruments if bse_instruments else [])
            self._cache_timestamp = datetime.now(IST)
            logger.info(f"✅ Fetched {len(nfo_instruments)} NFO + {len(bse_instruments) if bse_instruments else 0} BSE instruments")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to fetch instruments: {str(e)}")
            return False
    
    def _parse_expiry_from_name(self, tradingsymbol: str) -> Optional[datetime]:
        """
        Parse expiry month from trading symbol
        
        Format: NIFTY26FEBFUT, BANKNIFTY26MARFUT, SENSEX26APRFUT
        Extracts: YY (year), MON (month)
        Uses: Last Thursday of the month as expiry date
        
        Returns: datetime of expiry, or None if can't parse
        """
        try:
            # Remove 'FUT' suffix
            if tradingsymbol.endswith('FUT'):
                base = tradingsymbol[:-3]
            else:
                base = tradingsymbol
            
            # Extract year and month: "NIFTY26FEB" -> "26FEB"
            # Find where the year/month part starts
            year_month_part = None
            
            for i, char in enumerate(base):
                if char.isdigit() and i > 0:
                    year_month_part = base[i:]
                    break
            
            if not year_month_part or len(year_month_part) < 5:
                return None
            
            # Parse: "26FEB" -> year=26, month=FEB
            year_str = year_month_part[:2]
            month_str = year_month_part[2:5].upper()
            
            year = int(year_str)
            full_year = 2000 + year
            
            # Map months
            month_map = {
                'JAN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4, 'MAY': 5, 'JUN': 6,
                'JUL': 7, 'AUG': 8, 'SEP': 9, 'OCT': 10, 'NOV': 11, 'DEC': 12
            }
            
            month = month_map.get(month_str)
            if month is None:
                return None
            
            # Get last day of the month (expiry is usually last Thursday)
            from calendar import monthrange
            last_day = monthrange(full_year, month)[1]
            
            # Create expiry date at 3:30 PM IST (market close)
            expiry_date = datetime(full_year, month, last_day, 15, 30, tzinfo=IST)
            return expiry_date
            
        except Exception as e:
            logger.debug(f"⚠️  Failed to parse expiry from '{tradingsymbol}': {str(e)}")
            return None
    
    def get_all_contracts(
        self,
        symbol: str,
        debug: bool = False
    ) -> Dict[str, Dict]:
        """
        Get all 3 active contracts for a symbol
        
        Args:
            symbol: "NIFTY", "BANKNIFTY", or "SENSEX"
            debug: Print debug info
        
        Returns:
            {
                "near": {"token": 12345, "expiry": "2025-02-27", "name": "NIFTY26FEBFUT"},
                "next": {"token": 12346, "expiry": "2025-03-27", "name": "NIFTY26MARFUT"},
                "far":  {"token": 12347, "expiry": "2025-04-17", "name": "NIFTY26APRFUT"}
            }
        """
        try:
            if not self._refresh_instruments():
                logger.error(f"❌ Failed to get instruments for {symbol}")
                return {}
            
            config = self.SYMBOL_CONFIG.get(symbol)
            if not config:
                logger.error(f"❌ Unknown symbol: {symbol}")
                return {}
            
            # Find all futures for this symbol using tradingsymbol match
            futures = []
            search_str = config['search_tradingsymbol']
            
            for inst in self._instrument_list:
                tradingsymbol = inst.get('tradingsymbol', '').upper()
                
                # Check if this is a futures contract
                if inst.get('instrument_type') != 'FUT':
                    continue
                
                # Check if tradingsymbol starts with our search string
                if not tradingsymbol.startswith(search_str):
                    continue
                
                # Parse expiry date
                expiry = self._parse_expiry_from_name(tradingsymbol)
                if expiry:
                    futures.append({
                        'token': inst.get('instrument_token'),
                        'tradingsymbol': inst.get('tradingsymbol'),
                        'expiry': expiry,
                        'name': inst.get('name')
                    })
            
            if not futures:
                logger.error(f"❌ No futures found for {symbol}")
                if debug:
                    logger.error(f"   Searched for tradingsymbol starting with: {search_str}")
                    logger.info(f"   Sample instruments: {[i.get('tradingsymbol') for i in self._instrument_list[:20] if i.get('instrument_type') == 'FUT']}")
                return {}
            
            # Sort by expiry date (earliest first)
            futures.sort(key=lambda x: x['expiry'])
            
            if debug:
                logger.info(f"\n📊 Available {symbol} Contracts ({len(futures)} total):")
                for i, fut in enumerate(futures[:5]):  # Show top 5
                    logger.info(f"   [{i}] {fut['tradingsymbol']:25} (Token: {fut['token']:12}) - Expiry: {fut['expiry'].strftime('%Y-%m-%d')}")
            
            # Return top 3 (near, next, far)
            result = {}
            if len(futures) > 0:
                result['near'] = {
                    'token': futures[0]['token'],
                    'expiry': futures[0]['expiry'].strftime('%Y-%m-%d'),
                    'name': futures[0]['tradingsymbol']
                }
            if len(futures) > 1:
                result['next'] = {
                    'token': futures[1]['token'],
                    'expiry': futures[1]['expiry'].strftime('%Y-%m-%d'),
                    'name': futures[1]['tradingsymbol']
                }
            if len(futures) > 2:
                result['far'] = {
                    'token': futures[2]['token'],
                    'expiry': futures[2]['expiry'].strftime('%Y-%m-%d'),
                    'name': futures[2]['tradingsymbol']
                }
            
            return result
            
        except Exception as e:
            logger.error(f"❌ Error getting contracts for {symbol}: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return {}
    
    def get_current_contract_token(
        self,
        symbol: str,
        debug: bool = False
    ) -> Optional[int]:
        """
        Get the CURRENT MONTH (NEAR MONTH) contract token
        
        This is the contract with the earliest expiry - most liquid for trading
        
        Args:
            symbol: "NIFTY", "BANKNIFTY", or "SENSEX"
            debug: Print debug info
        
        Returns:
            Token (int) or None if not found
        """
        contracts = self.get_all_contracts(symbol, debug)
        
        if 'near' not in contracts:
            logger.error(f"❌ No current contract found for {symbol}")
            return None
        
        token = contracts['near']['token']
        if debug:
            logger.info(f"✅ {symbol} Current Contract: {contracts['near']['name']}")
            logger.info(f"   Token: {token}")
            logger.info(f"   Expiry: {contracts['near']['expiry']}")
        
        return token
    
    def get_contracts_for_all_symbols(
        self,
        debug: bool = False
    ) -> Dict[str, Dict]:
        """
        Get current contracts for all 3 symbols
        
        Args:
            debug: Print debug info
        
        Returns:
            {
                "NIFTY": {
                    "token": 15150594,
                    "name": "NIFTY-27FEB25",
                    "expiry": "2025-02-27"
                },
                "BANKNIFTY": {...},
                "SENSEX": {...}
            }
        """
        result = {}
        
        for symbol in ["NIFTY", "BANKNIFTY", "SENSEX"]:
            contracts = self.get_all_contracts(symbol, debug=False)
            if 'near' in contracts:
                result[symbol] = contracts['near']
                if debug:
                    logger.info(f"✅ {symbol}: Token={contracts['near']['token']}, Expires={contracts['near']['expiry']}")
        
        return result
    
    def is_contract_expiring_soon(
        self,
        symbol: str,
        days_threshold: int = 3,
        debug: bool = False
    ) -> Tuple[bool, Optional[str]]:
        """
        Check if current contract is expiring soon
        
        Args:
            symbol: Trading symbol
            days_threshold: Alert if expiry within N days
            debug: Print debug info
        
        Returns:
            (is_expiring, expiry_date_str)
        """
        contracts = self.get_all_contracts(symbol, debug=False)
        
        if 'near' not in contracts:
            return False, None
        
        near_contract = contracts['near']
        expiry_date = datetime.fromisoformat(near_contract['expiry']).replace(tzinfo=IST)
        
        time_to_expiry = (expiry_date - datetime.now(IST)).days
        
        is_expiring = time_to_expiry <= days_threshold
        
        if debug:
            status = "🚨 EXPIRING SOON" if is_expiring else "✅ Active"
            logger.info(f"{status}: {symbol} expires in {time_to_expiry} days ({near_contract['expiry']})")
        
        return is_expiring, near_contract['expiry']


async def get_live_contracts(kite_client) -> Dict[str, Dict]:
    """
    Quick helper to get current contracts for all symbols
    
    Usage:
        from services.contract_manager import get_live_contracts
        
        contracts = await get_live_contracts(kite)
        nifty_token = contracts['NIFTY']['token']  # Get NIFTY token
    """
    manager = ContractManager(kite_client)
    return manager.get_contracts_for_all_symbols(debug=True)
