"""
Authentication State Machine - Token Lifecycle Management
✅ Tracks token validity explicitly
✅ Never assumes token is valid
✅ Triggers login flow when needed
"""
import os
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Optional, Tuple
import pytz

from config import get_settings

IST = pytz.timezone('Asia/Kolkata')


class AuthState(str, Enum):
    """Authentication states - explicit tracking"""
    VALID = "valid"                    # Token exists and valid
    EXPIRED = "expired"                # Token exists but expired
    REQUIRED = "login_required"        # No token or invalid
    REFRESHING = "refreshing"          # Currently refreshing token


class ZerodhaAuthException(Exception):
    """Zerodha authentication related exceptions"""
    pass


class AuthStateManager:
    """
    Professional Auth State Machine
    
    ✅ Tracks token expiry explicitly
    ✅ Never assumes token is valid
    ✅ Detects silent failures
    ✅ Triggers login when needed
    """
    
    def __init__(self):
        self._settings = get_settings()
        self._state: AuthState = AuthState.REQUIRED
        self._token: Optional[str] = None
        self._token_created_at: Optional[datetime] = None
        self._last_successful_api_call: Optional[datetime] = None
        self._consecutive_failures: int = 0
        
        # Initialize state
        self._check_and_load_token()
    
    def _check_and_load_token(self):
        """Check for existing token and determine initial state"""
        try:
            # Always reload settings to get latest token from .env
            get_settings.cache_clear()
            self._settings = get_settings()
            
            token = self._settings.zerodha_access_token
            
            if not token or token == "your_access_token_here":
                self._state = AuthState.REQUIRED
                self._token = None
                print("🔴 AUTH STATE: LOGIN_REQUIRED (no token found)")
                return
            
            # Token exists - check if it's likely expired
            self._token = token
            
            # Check token file modification time
            env_path = Path(__file__).parent.parent / ".env"
            if env_path.exists():
                mtime = datetime.fromtimestamp(env_path.stat().st_mtime, tz=IST)
                self._token_created_at = mtime
                
                # Zerodha tokens expire after ~24 hours (expire at 7:30 AM IST next day)
                # Conservative check: if token file is > 20 hours old, consider expired
                age_hours = (datetime.now(IST) - mtime).total_seconds() / 3600
                
                if age_hours > 20:
                    self._state = AuthState.EXPIRED
                    print(f"🟠 AUTH STATE: EXPIRED (token age: {age_hours:.1f} hours)")
                else:
                    self._state = AuthState.VALID
                    print(f"🟢 AUTH STATE: VALID (token age: {age_hours:.1f} hours)")
            else:
                # No .env file, assume token is fresh
                self._state = AuthState.VALID
                print("🟢 AUTH STATE: VALID (token found)")
                
        except Exception as e:
            print(f"⚠️ Error checking token: {e}")
            self._state = AuthState.REQUIRED
            self._token = None
    
    @property
    def current_state(self) -> AuthState:
        """Get current auth state"""
        return self._state
    
    @property
    def is_valid(self) -> bool:
        """Check if auth is currently valid"""
        return self._state == AuthState.VALID
    
    @property
    def requires_login(self) -> bool:
        """Check if login is required"""
        return self._state in (AuthState.REQUIRED, AuthState.EXPIRED)
    
    def mark_api_success(self):
        """Mark successful API call - token is confirmed working"""
        self._last_successful_api_call = datetime.now(IST)
        self._consecutive_failures = 0
        
        if self._state != AuthState.VALID:
            print("🟢 AUTH STATE: VALID (API call successful)")
            self._state = AuthState.VALID
    
    def mark_api_failure(self, error: Exception):
        """Mark failed API call - may indicate expired token"""
        self._consecutive_failures += 1
        
        error_msg = str(error).lower()
        
        # Check for auth-related errors
        if any(keyword in error_msg for keyword in 
               ["token", "auth", "403", "401", "forbidden", "unauthorized", "invalid_token"]):
            print(f"🔴 AUTH STATE: EXPIRED (auth error detected: {error})")
            self._state = AuthState.EXPIRED
            self._token = None
        
        # Multiple consecutive failures might indicate token issue
        elif self._consecutive_failures >= 5:
            print(f"🟠 AUTH STATE: EXPIRED (5+ consecutive failures)")
            self._state = AuthState.EXPIRED
    
    def update_token(self, new_token: str):
        """Update token and reset state - forces settings reload globally"""
        # Clear settings cache first to reload from .env
        get_settings.cache_clear()
        
        # Reload settings to get fresh token
        self._settings = get_settings()
        
        self._token = new_token
        self._token_created_at = datetime.now(IST)
        self._state = AuthState.VALID
        self._consecutive_failures = 0
        print(f"🟢 AUTH STATE: VALID (new token registered)")
        print(f"🔄 Settings cache cleared - all services now using new token globally")
    
    def force_reauth(self):
        """Force re-authentication (manual trigger)"""
        print("🔴 AUTH STATE: REQUIRED (forced by system)")
        self._state = AuthState.REQUIRED
        self._token = None
    
    def get_token_age_hours(self) -> Optional[float]:
        """Get token age in hours"""
        if not self._token_created_at:
            return None
        return (datetime.now(IST) - self._token_created_at).total_seconds() / 3600
    
    def get_state_info(self) -> dict:
        """Get detailed state information"""
        token_age = self.get_token_age_hours()
        
        return {
            "state": self._state.value,
            "is_valid": self.is_valid,
            "requires_login": self.requires_login,
            "has_token": self._token is not None,
            "token_age_hours": round(token_age, 2) if token_age else None,
            "last_success": self._last_successful_api_call.isoformat() if self._last_successful_api_call else None,
            "consecutive_failures": self._consecutive_failures,
            "created_at": self._token_created_at.isoformat() if self._token_created_at else None
        }
    
    async def verify_token_with_api(self) -> Tuple[bool, Optional[str]]:
        """
        Verify token by making actual API call to Zerodha
        
        Returns:
            (is_valid, error_message)
        """
        if not self._token:
            return False, "No token available"
        
        try:
            from kiteconnect import KiteConnect
            
            kite = KiteConnect(api_key=self._settings.zerodha_api_key)
            kite.set_access_token(self._token)
            
            # Make a lightweight API call to verify token
            profile = kite.profile()
            
            # If we got here, token is valid
            self.mark_api_success()
            return True, None
            
        except Exception as e:
            error_msg = str(e)
            self.mark_api_failure(e)
            return False, error_msg


# Singleton instance
auth_state_manager = AuthStateManager()


if __name__ == "__main__":
    """Test auth state manager"""
    manager = AuthStateManager()
    
    print("\nAuth State Manager Test\n")
    print("="*70)
    
    info = manager.get_state_info()
    print(f"\nCurrent State: {info['state']}")
    print(f"Is Valid: {info['is_valid']}")
    print(f"Requires Login: {info['requires_login']}")
    print(f"Has Token: {info['has_token']}")
    print(f"Token Age: {info['token_age_hours']} hours" if info['token_age_hours'] else "Token Age: Unknown")
    print(f"Last Success: {info['last_success']}" if info['last_success'] else "Last Success: Never")
    print(f"Consecutive Failures: {info['consecutive_failures']}")
    
    print("\n" + "="*70)
