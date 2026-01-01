"""
AUTO FUTURES TOKEN UPDATER
Automatically fetches and updates futures tokens when they expire
NO MANUAL WORK - Updates .env file automatically every month
"""
from datetime import datetime, timedelta
from typing import Dict, Optional
import re
import asyncio
from pathlib import Path

from kiteconnect import KiteConnect
from config import get_settings


class AutoFuturesUpdater:
    """Automatically updates futures tokens when contracts expire"""
    
    def __init__(self):
        self.settings = get_settings()
        self.env_file = Path(__file__).parent.parent / '.env'
        
    async def check_and_update_futures(self) -> bool:
        """
        Check if futures tokens need updating and auto-update if needed
        Returns True if updated, False if still valid
        """
        try:
            print("\n" + "="*80)
            print("🔄 AUTO FUTURES TOKEN UPDATER")
            print("="*80)
            
            # Check if we need to update
            if not self._should_update():
                print("✅ Futures tokens are CURRENT (within expiry window)")
                return False
            
            print("⚠️ Futures tokens need update (expired or expiring soon)")
            
            # Fetch new futures tokens
            new_tokens = await self._fetch_new_futures_tokens()
            
            if not new_tokens:
                print("❌ Could not fetch new futures tokens")
                return False
            
            # Update .env file
            success = self._update_env_file(new_tokens)
            
            if success:
                print("✅ FUTURES TOKENS AUTO-UPDATED in .env!")
                print(f"   → NIFTY: {new_tokens['NIFTY']}")
                print(f"   → BANKNIFTY: {new_tokens['BANKNIFTY']}")
                print(f"   → SENSEX: {new_tokens['SENSEX']}")
                print("🔄 Restart backend to apply new tokens")
                print("="*80 + "\n")
                return True
            
            return False
            
        except Exception as e:
            print(f"❌ Auto-update failed: {e}")
            return False
    
    def _should_update(self) -> bool:
        """Check if we're within 7 days of expiry or already expired"""
        today = datetime.now()
        
        # Futures expire on last Thursday of month
        # Check if we're in last week of month
        last_day = self._get_last_day_of_month(today)
        last_thursday = self._get_last_thursday(today.year, today.month)
        
        # Update if within 7 days of expiry or after expiry
        days_to_expiry = (last_thursday - today).days
        
        print(f"📅 Today: {today.date()}")
        print(f"📅 Next Expiry: {last_thursday.date()}")
        print(f"📅 Days to Expiry: {days_to_expiry}")
        
        return days_to_expiry <= 7  # Update in last week
    
    def _get_last_thursday(self, year: int, month: int) -> datetime:
        """Get last Thursday of given month"""
        # Start from last day of month
        if month == 12:
            next_month = datetime(year + 1, 1, 1)
        else:
            next_month = datetime(year, month + 1, 1)
        
        last_day = next_month - timedelta(days=1)
        
        # Find last Thursday (weekday() == 3)
        while last_day.weekday() != 3:
            last_day -= timedelta(days=1)
        
        return last_day
    
    def _get_last_day_of_month(self, date: datetime) -> datetime:
        """Get last day of month"""
        if date.month == 12:
            return datetime(date.year, 12, 31)
        else:
            return datetime(date.year, date.month + 1, 1) - timedelta(days=1)
    
    async def _fetch_new_futures_tokens(self) -> Optional[Dict[str, int]]:
        """Fetch next month's futures tokens from Zerodha"""
        try:
            if not self.settings.zerodha_api_key or not self.settings.zerodha_access_token:
                print("❌ Zerodha credentials not configured")
                return None
            
            kite = KiteConnect(api_key=self.settings.zerodha_api_key)
            kite.set_access_token(self.settings.zerodha_access_token)
            
            print("🔍 Searching for next month futures contracts...")
            
            # Get current + next month for safety
            today = datetime.now()
            if today.month == 12:
                next_month = 1
                next_year = today.year + 1
            else:
                next_month = today.month + 1
                next_year = today.year
            
            # Month codes for futures
            month_codes = {
                1: "JAN", 2: "FEB", 3: "MAR", 4: "APR",
                5: "MAY", 6: "JUN", 7: "JUL", 8: "AUG",
                9: "SEP", 10: "OCT", 11: "NOV", 12: "DEC"
            }
            
            current_code = month_codes[today.month]
            next_code = month_codes[next_month]
            
            # Search for futures symbols
            instruments = kite.instruments("NFO")  # NSE Futures & Options
            bfo_instruments = kite.instruments("BFO")  # BSE Futures & Options
            
            tokens = {}
            
            # Find NIFTY futures (prefer next month)
            print(f"   → Searching NIFTY{next_year % 100}{next_code}FUT...")
            for inst in instruments:
                if inst['tradingsymbol'] == f"NIFTY{next_year % 100}{next_code}FUT":
                    tokens['NIFTY'] = inst['instrument_token']
                    print(f"   ✅ Found NIFTY: {inst['instrument_token']}")
                    break
            
            # Find BANKNIFTY futures
            print(f"   → Searching BANKNIFTY{next_year % 100}{next_code}FUT...")
            for inst in instruments:
                if inst['tradingsymbol'] == f"BANKNIFTY{next_year % 100}{next_code}FUT":
                    tokens['BANKNIFTY'] = inst['instrument_token']
                    print(f"   ✅ Found BANKNIFTY: {inst['instrument_token']}")
                    break
            
            # Find SENSEX futures (on BFO exchange)
            print(f"   → Searching SENSEX{next_year % 100}{next_code}FUT...")
            for inst in bfo_instruments:
                if inst['tradingsymbol'] == f"SENSEX{next_year % 100}{next_code}FUT":
                    tokens['SENSEX'] = inst['instrument_token']
                    print(f"   ✅ Found SENSEX: {inst['instrument_token']}")
                    break
            
            if len(tokens) == 3:
                print(f"✅ All 3 futures tokens found for {next_code} {next_year}")
                return tokens
            else:
                print(f"⚠️ Only found {len(tokens)}/3 tokens")
                return None
            
        except Exception as e:
            print(f"❌ Error fetching futures tokens: {e}")
            return None
    
    def _update_env_file(self, new_tokens: Dict[str, int]) -> bool:
        """Update .env file with new futures tokens"""
        try:
            if not self.env_file.exists():
                print(f"❌ .env file not found: {self.env_file}")
                return False
            
            # Read current .env
            with open(self.env_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Calculate expiry date
            today = datetime.now()
            if today.month == 12:
                next_month = 1
                next_year = today.year + 1
            else:
                next_month = today.month + 1
                next_year = today.year
            
            last_thursday = self._get_last_thursday(next_year, next_month)
            
            month_codes = {
                1: "JAN", 2: "FEB", 3: "MAR", 4: "APR",
                5: "MAY", 6: "JUN", 7: "JUL", 8: "AUG",
                9: "SEP", 10: "OCT", 11: "NOV", 12: "DEC"
            }
            expiry_month = month_codes[next_month]
            
            # Update futures tokens section
            futures_section = f"""# FUTURES TOKENS FOR VOLUME DATA (Update monthly before expiry!)
# Current: {expiry_month} {next_year} (Expiry: {last_thursday.strftime('%d-%b-%Y')}) ✅ AUTO-UPDATED!
# Next update: ~{(last_thursday - timedelta(days=7)).strftime('%d-%b-%Y')}
NIFTY_FUT_TOKEN={new_tokens['NIFTY']}
BANKNIFTY_FUT_TOKEN={new_tokens['BANKNIFTY']}
SENSEX_FUT_TOKEN={new_tokens['SENSEX']}"""
            
            # Replace the futures section
            pattern = r'# FUTURES TOKENS FOR VOLUME DATA.*?\nSENSEX_FUT_TOKEN=\d+'
            new_content = re.sub(pattern, futures_section, content, flags=re.DOTALL)
            
            # Write back to file
            with open(self.env_file, 'w', encoding='utf-8') as f:
                f.write(new_content)
            
            print(f"✅ Updated .env file: {self.env_file}")
            return True
            
        except Exception as e:
            print(f"❌ Error updating .env file: {e}")
            return False


# Global instance
_updater: Optional[AutoFuturesUpdater] = None


def get_futures_updater() -> AutoFuturesUpdater:
    """Get global futures updater instance"""
    global _updater
    if _updater is None:
        _updater = AutoFuturesUpdater()
    return _updater


async def check_and_update_futures_on_startup():
    """Run futures check on backend startup"""
    updater = get_futures_updater()
    await updater.check_and_update_futures()
