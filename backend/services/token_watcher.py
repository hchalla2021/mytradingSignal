"""
Automatic Token Refresh Service
Watches .env file and auto-reconnects when token changes
NO RESTART NEEDED - Hot reload token changes
"""
import asyncio
import os
from datetime import datetime
from pathlib import Path
from threading import Thread
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import pytz

from config import get_settings

IST = pytz.timezone('Asia/Kolkata')


class TokenWatcher(FileSystemEventHandler):
    """Watches .env file for token changes and triggers reconnection"""
    
    def __init__(self, market_feed_service, unified_auth_service):
        self.market_feed = market_feed_service
        self.unified_auth = unified_auth_service
        self.last_token = None
        self.env_file = Path(__file__).parent.parent / '.env'
        print(f"👀 Watching for token changes in: {self.env_file}")
    
    def on_modified(self, event):
        """Called when .env file is modified"""
        if event.src_path.endswith('.env'):
            # Run async task in a thread-safe way
            Thread(target=self._trigger_token_check).start()
    
    def _trigger_token_check(self):
        """Thread-safe wrapper to trigger async token check"""
        try:
            # Get or create event loop
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            
            # Run the async check
            if loop.is_running():
                # If loop is already running, schedule the task
                asyncio.run_coroutine_threadsafe(self._check_and_reload_token(), loop)
            else:
                # If no loop is running, run it directly
                loop.run_until_complete(self._check_and_reload_token())
        except Exception as e:
            print(f"⚠️ Error triggering token check: {e}")
    
    async def _check_and_reload_token(self):
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
                
                # Update stored token
                self.last_token = new_token
                
                # 🔥 UPDATE UNIFIED AUTH SERVICE (centralized)
                await self.unified_auth.update_token(new_token)
                
                # Legacy: Also update auth state manager for backward compatibility
                from services.auth_state_machine import auth_state_manager
                auth_state_manager.update_token(new_token)
                
                # Market feed will reconnect via unified_auth callback
                print("✅ Token update complete! Services reconnecting...")
            else:
                print("ℹ️ No token change detected")
                
        except Exception as e:
            print(f"❌ Error reloading token: {e}")
            import traceback
            traceback.print_exc()


def start_token_watcher(market_feed_service, unified_auth_service):
    """Start watching .env file for token changes
    
    Args:
        market_feed_service: Market feed service instance
        unified_auth_service: Unified auth service instance
    """
    event_handler = TokenWatcher(market_feed_service, unified_auth_service)
    observer = Observer()
    
    # Watch the parent directory (where .env is located)
    watch_path = Path(__file__).parent.parent
    observer.schedule(event_handler, str(watch_path), recursive=False)
    observer.start()
    
    return observer
