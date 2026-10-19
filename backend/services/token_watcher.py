"""
Automatic Token Refresh Service
Watches .env file and auto-reconnects when token changes
NO RESTART NEEDED - Hot reload token changes
"""
import asyncio
import inspect
import logging
from pathlib import Path
from watchdog.observers.polling import PollingObserver
from watchdog.events import FileSystemEventHandler

from config import get_settings

logger = logging.getLogger(__name__)


class TokenWatcher(FileSystemEventHandler):
    """Watches .env file for token changes and triggers reconnection"""
    
    def __init__(self, market_feed_service, unified_auth_service):
        self.market_feed = market_feed_service
        self.unified_auth = unified_auth_service
        self.last_token = get_settings().zerodha_access_token
        self.env_file = Path(__file__).parent.parent / '.env'
        self._loop = asyncio.get_running_loop()
        self._reload_lock = asyncio.Lock()
        print(f"👀 Watching for token changes in: {self.env_file}")
    
    def on_modified(self, event):
        """Called when .env file is modified"""
        if not event.is_directory and Path(event.src_path).resolve() == self.env_file.resolve():
            self._trigger_token_check()

    def on_created(self, event):
        """Also handle editors replacing the file instead of modifying it."""
        self.on_modified(event)
    
    def _trigger_token_check(self):
        """Thread-safe wrapper to trigger async token check"""
        if self._loop.is_closed():
            return
        asyncio.run_coroutine_threadsafe(self._check_and_reload_token(), self._loop)
    
    async def _check_and_reload_token(self):
        async with self._reload_lock:
            await self._reload_token()

    async def _reload_token(self):
        """Check if token changed and reload if needed - ULTRA FAST"""
        try:
            # Minimal delay - just enough for file system sync
            await asyncio.sleep(0.3)
            
            print("\n⚡ Token file change detected! Fast-checking...")
            
            # Clear settings cache to force reload from .env
            get_settings.cache_clear()
            
            # Reload settings
            settings = get_settings()
            new_token = settings.zerodha_access_token
            
            if new_token and new_token != self.last_token:
                print("🚀 NEW TOKEN DETECTED! Instant reconnection starting...")
                
                # Update unified auth regardless of sync/async implementation.
                maybe_awaitable = self.unified_auth.update_token(new_token)
                if inspect.isawaitable(maybe_awaitable):
                    await maybe_awaitable
                
                # Legacy: Also update auth state manager for backward compatibility
                from services.auth_state_machine import auth_state_manager
                auth_state_manager.update_token(new_token)
                self.last_token = new_token
                
                # The active feed loop and scheduler observe the updated token.
                print("✅ Token update complete! Services reconnecting...")
            else:
                print("ℹ️ No token change detected")
                
        except Exception:
            logger.exception("Failed to reload Zerodha access token")


def start_token_watcher(market_feed_service, unified_auth_service):
    """Start watching .env file for token changes
    
    Args:
        market_feed_service: Market feed service instance
        unified_auth_service: Unified auth service instance
    """
    event_handler = TokenWatcher(market_feed_service, unified_auth_service)
    # Native filesystem notifications can miss changes to Docker bind mounts.
    observer = PollingObserver(timeout=1)
    
    # Watch the parent directory (where .env is located)
    watch_path = Path(__file__).parent.parent
    observer.schedule(event_handler, str(watch_path), recursive=False)
    observer.start()
    
    return observer
