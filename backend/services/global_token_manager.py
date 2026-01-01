"""
GLOBAL TOKEN MANAGER - Single Source of Truth
All services use token from .env automatically
Auto-detects expiry and provides global status
"""
from datetime import datetime, timedelta
from typing import Optional, Dict
import asyncio
from kiteconnect import KiteConnect
import pytz

from config import get_settings

IST = pytz.timezone('Asia/Kolkata')


class GlobalTokenManager:
    """Manages Zerodha token globally for entire application"""
    
    def __init__(self):
        self.settings = get_settings()
        self._last_check: Optional[datetime] = None
        self._is_valid: bool = False
        self._check_interval = 300  # Check every 5 minutes
        self._user_info: Dict = {}
    
    async def is_token_valid(self) -> bool:
        """
        Check if current token in .env is valid
        Caches result for 5 minutes to avoid excessive API calls
        """
        now = datetime.now(IST)
        
        # Use cached result if checked recently
        if self._last_check and (now - self._last_check).seconds < self._check_interval:
            return self._is_valid
        
        # Check token validity
        try:
            if not self.settings.zerodha_access_token:
                self._is_valid = False
                return False
            
            # Quick validation - try to get profile
            kite = KiteConnect(api_key=self.settings.zerodha_api_key)
            kite.set_access_token(self.settings.zerodha_access_token)
            
            # Lightweight API call
            profile = kite.profile()
            
            self._is_valid = True
            self._user_info = profile
            self._last_check = now
            
            print(f"✅ Global Token Valid: {profile.get('user_name', 'User')}")
            return True
            
        except Exception as e:
            self._is_valid = False
            self._last_check = now
            print(f"❌ Global Token Invalid: {str(e)[:50]}")
            return False
    
    def get_token_status(self) -> Dict:
        """Get current token status for UI display"""
        return {
            "valid": self._is_valid,
            "last_check": self._last_check.isoformat() if self._last_check else None,
            "user_info": self._user_info,
            "token_configured": bool(self.settings.zerodha_access_token),
            "api_key_configured": bool(self.settings.zerodha_api_key)
        }
    
    def force_recheck(self):
        """Force recheck on next is_token_valid() call"""
        self._last_check = None


# Global singleton instance
_token_manager: Optional[GlobalTokenManager] = None


def get_token_manager() -> GlobalTokenManager:
    """Get global token manager instance"""
    global _token_manager
    if _token_manager is None:
        _token_manager = GlobalTokenManager()
    return _token_manager


async def check_global_token_status() -> Dict:
    """Check global token status - used by all endpoints"""
    manager = get_token_manager()
    is_valid = await manager.is_token_valid()
    status = manager.get_token_status()
    status["valid"] = is_valid
    return status
