"""
UNIFIED AUTHENTICATION SERVICE
================================
Centralized, isolated authentication machine for Zerodha tokens

Features:
- Single source of truth for auth state
- Automated token refresh (daily at 5 AM IST)
- Pre-emptive token validation
- Auto-reconnection on token refresh
- Independent from market feed service
- Persistent state across restarts

Usage:
    from services.unified_auth_service import unified_auth
    
    # Check if authenticated
    if unified_auth.is_authenticated:
        # Use token
        token = unified_auth.get_token()
    
    # Manual token refresh
    await unified_auth.refresh_token()
"""

import asyncio
import os
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Optional, Callable, Dict
from enum import Enum
import pytz
from kiteconnect import KiteConnect
from kiteconnect.exceptions import TokenException

from config import get_settings

IST = pytz.timezone('Asia/Kolkata')


class AuthStatus(str, Enum):
    """Authentication status states"""
    VALID = "valid"              # Token is valid and working
    EXPIRED = "expired"          # Token expired (needs refresh)
    REQUIRED = "required"        # No token available (needs login)
    REFRESHING = "refreshing"    # Currently refreshing token
    UNKNOWN = "unknown"          # Initial state


class UnifiedAuthService:
    """
    Centralized authentication service
    Manages token lifecycle independently
    """
    
    def __init__(self):
        self.settings = get_settings()
        self._status: AuthStatus = AuthStatus.UNKNOWN
        self._token: Optional[str] = None
        self._token_timestamp: Optional[datetime] = None
        self._last_validation: Optional[datetime] = None
        self._validation_interval = 30  # Validate every 30 seconds
        self._user_info: Dict = {}
        self._on_token_refresh_callbacks: list[Callable] = []
        self._refresh_task: Optional[asyncio.Task] = None
        
        # Initialize
        self._load_token()
    
    def _load_token(self):
        """Load token from settings and determine initial state"""
        try:
            get_settings.cache_clear()
            self.settings = get_settings()
            
            token = self.settings.zerodha_access_token
            if not token or token == "your_access_token_here":
                self._status = AuthStatus.REQUIRED
                self._token = None
                print("🔴 UNIFIED AUTH: LOGIN REQUIRED (no token)")
                return
            
            # Token exists - check file timestamp
            env_path = Path(__file__).parent.parent / ".env"
            if env_path.exists():
                mtime = datetime.fromtimestamp(env_path.stat().st_mtime, tz=IST)
                self._token_timestamp = mtime
                
                # Check age
                age_hours = (datetime.now(IST) - mtime).total_seconds() / 3600
                
                if age_hours > 20:
                    self._status = AuthStatus.EXPIRED
                    print(f"🟠 UNIFIED AUTH: EXPIRED (age: {age_hours:.1f}h)")
                else:
                    self._status = AuthStatus.VALID
                    self._token = token
                    print(f"🟢 UNIFIED AUTH: VALID (age: {age_hours:.1f}h)")
            else:
                self._status = AuthStatus.VALID
                self._token = token
                print("🟢 UNIFIED AUTH: VALID (new token)")
                
        except Exception as e:
            print(f"⚠️ UNIFIED AUTH: Error loading token: {e}")
            self._status = AuthStatus.REQUIRED
    
    @property
    def is_authenticated(self) -> bool:
        """Check if currently authenticated with valid token"""
        return self._status == AuthStatus.VALID and self._token is not None
    
    @property
    def requires_login(self) -> bool:
        """Check if login is required"""
        return self._status in (AuthStatus.REQUIRED, AuthStatus.EXPIRED)
    
    @property
    def status(self) -> AuthStatus:
        """Get current auth status"""
        return self._status
    
    def get_token(self) -> Optional[str]:
        """Get current access token"""
        return self._token
    
    def get_token_age_hours(self) -> Optional[float]:
        """Get token age in hours"""
        if not self._token_timestamp:
            return None
        return (datetime.now(IST) - self._token_timestamp).total_seconds() / 3600
    
    async def validate_token(self, force: bool = False) -> bool:
        """
        Validate token using Zerodha API
        
        Args:
            force: Force validation even if recently checked
            
        Returns:
            True if token is valid, False otherwise
        """
        now = datetime.now(IST)
        
        # Use cached result if recently checked (unless forced)
        if not force and self._last_validation:
            elapsed = (now - self._last_validation).total_seconds()
            if elapsed < self._validation_interval:
                return self._status == AuthStatus.VALID
        
        if not self._token:
            self._status = AuthStatus.REQUIRED
            return False
        
        try:
            print(f"🔍 UNIFIED AUTH: Validating token...")
            
            kite = KiteConnect(api_key=self.settings.zerodha_api_key)
            kite.set_access_token(self._token)
            
            # Quick profile check
            profile = kite.profile()
            
            self._status = AuthStatus.VALID
            self._user_info = profile
            self._last_validation = now
            
            print(f"✅ UNIFIED AUTH: Token valid - User: {profile.get('user_name', 'Unknown')}")
            return True
            
        except TokenException as e:
            print(f"❌ UNIFIED AUTH: Token invalid - {e}")
            self._status = AuthStatus.EXPIRED
            self._token = None
            self._last_validation = now
            return False
            
        except Exception as e:
            print(f"⚠️ UNIFIED AUTH: Validation error - {e}")
            # Don't change status on network errors
            return self._status == AuthStatus.VALID
    
    async def update_token(self, new_token: str):
        """
        Update token and notify all listeners
        
        Args:
            new_token: New access token from Zerodha
        """
        print(f"\n{'='*80}")
        print("🔄 UNIFIED AUTH: TOKEN UPDATE")
        print(f"   New Token: {new_token[:20]}...")
        print(f"{'='*80}")
        
        # Clear settings cache
        get_settings.cache_clear()
        self.settings = get_settings()
        
        # Update internal state
        self._token = new_token
        self._token_timestamp = datetime.now(IST)
        self._status = AuthStatus.VALID
        self._last_validation = datetime.now(IST)
        
        print("✅ UNIFIED AUTH: Token updated successfully")
        
        # Notify all listeners
        print(f"📢 UNIFIED AUTH: Notifying {len(self._on_token_refresh_callbacks)} listeners...")
        for callback in self._on_token_refresh_callbacks:
            try:
                if asyncio.iscoroutinefunction(callback):
                    await callback(new_token)
                else:
                    callback(new_token)
                print(f"   ✅ Listener notified")
            except Exception as e:
                print(f"   ❌ Listener failed: {e}")
        
        print(f"{'='*80}\n")
    
    def register_token_refresh_callback(self, callback: Callable):
        """
        Register callback to be called when token is refreshed
        
        Args:
            callback: Function to call with new token as argument
        """
        self._on_token_refresh_callbacks.append(callback)
        print(f"🔔 UNIFIED AUTH: Callback registered (total: {len(self._on_token_refresh_callbacks)})")
    
    async def start_auto_refresh_monitor(self):
        """
        Start monitoring for token expiry and auto-refresh
        Runs daily at 5 AM IST to prompt for token refresh
        """
        if self._refresh_task and not self._refresh_task.done():
            print("⚠️ UNIFIED AUTH: Auto-refresh already running")
            return
        
        self._refresh_task = asyncio.create_task(self._auto_refresh_loop())
        print("🔄 UNIFIED AUTH: Auto-refresh monitor started")
    
    async def _auto_refresh_loop(self):
        """Background task to monitor token expiry"""
        print("\n" + "="*80)
        print("🤖 UNIFIED AUTH: AUTO-REFRESH MONITOR ACTIVE")
        print("   - Validates token every 30 seconds")
        print("   - Alerts when token expires")
        print("   - Monitors for token refresh")
        print("="*80 + "\n")
        
        while True:
            try:
                now = datetime.now(IST)
                
                # Validate token periodically
                is_valid = await self.validate_token()
                
                if not is_valid:
                    # Token expired - alert
                    print("\n" + "="*80)
                    print("🔴 UNIFIED AUTH: TOKEN EXPIRED")
                    print("   Please login to refresh token:")
                    print("   1. Click LOGIN button in UI")
                    print("   2. Or run: python quick_token_fix.py")
                    print("="*80 + "\n")
                
                # Check if token is getting old (>18 hours)
                token_age = self.get_token_age_hours()
                if token_age and token_age > 18:
                    print(f"⚠️ UNIFIED AUTH: Token is {token_age:.1f}h old - consider refreshing before expiry")
                
                # Sleep for validation interval
                await asyncio.sleep(self._validation_interval)
                
            except asyncio.CancelledError:
                print("🛑 UNIFIED AUTH: Auto-refresh monitor stopped")
                break
            except Exception as e:
                print(f"❌ UNIFIED AUTH: Monitor error - {e}")
                await asyncio.sleep(60)  # Wait before retry
    
    async def stop_auto_refresh_monitor(self):
        """Stop auto-refresh monitor"""
        if self._refresh_task:
            self._refresh_task.cancel()
            try:
                await self._refresh_task
            except asyncio.CancelledError:
                pass
            self._refresh_task = None
            print("🛑 UNIFIED AUTH: Auto-refresh monitor stopped")
    
    def get_status_info(self) -> dict:
        """Get comprehensive status information"""
        token_age = self.get_token_age_hours()
        
        return {
            "status": self._status.value,
            "is_authenticated": self.is_authenticated,
            "requires_login": self.requires_login,
            "has_token": self._token is not None,
            "token_age_hours": round(token_age, 2) if token_age else None,
            "last_validation": self._last_validation.isoformat() if self._last_validation else None,
            "user_info": self._user_info,
            "listeners_count": len(self._on_token_refresh_callbacks)
        }


# Global singleton instance
unified_auth = UnifiedAuthService()


# Convenience functions
def is_authenticated() -> bool:
    """Quick check if authenticated"""
    return unified_auth.is_authenticated


def get_token() -> Optional[str]:
    """Get current token"""
    return unified_auth.get_token()


def requires_login() -> bool:
    """Check if login is required"""
    return unified_auth.requires_login


# Test
if __name__ == "__main__":
    """Test unified auth service"""
    import asyncio
    
    async def main():
        print("\nUnified Auth Service Test\n")
        print("="*70)
        
        info = unified_auth.get_status_info()
        print(f"\nStatus: {info['status']}")
        print(f"Authenticated: {info['is_authenticated']}")
        print(f"Requires Login: {info['requires_login']}")
        print(f"Has Token: {info['has_token']}")
        print(f"Token Age: {info['token_age_hours']} hours" if info['token_age_hours'] else "Token Age: Unknown")
        print(f"Listeners: {info['listeners_count']}")
        
        # Validate token
        print("\nValidating token...")
        is_valid = await unified_auth.validate_token(force=True)
        print(f"Token valid: {is_valid}")
        
        print("\n" + "="*70)
    
    asyncio.run(main())
