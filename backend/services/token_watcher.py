"""
Automatic Token Refresh Service
Watches .env file and auto-reconnects when token changes
NO RESTART NEEDED - Hot reload token changes
"""
import asyncio
import os
from datetime import datetime
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import pytz

from config import get_settings

IST = pytz.timezone('Asia/Kolkata')


class TokenWatcher(FileSystemEventHandler):
    """Watches .env file for token changes and triggers reconnection"""
    
    def __init__(self, market_feed_service):
        self.market_feed = market_feed_service
        self.last_token = None
        self.env_file = Path(__file__).parent.parent / '.env'
        print(f"👀 Watching for token changes in: {self.env_file}")
    
    def on_modified(self, event):
        """Called when .env file is modified"""
        if event.src_path.endswith('.env'):
            asyncio.create_task(self._check_and_reload_token())
    
    async def _check_and_reload_token(self):
        """Check if token changed and reload if needed"""
        try:
            # Small delay to ensure file is fully written
            await asyncio.sleep(1)
            
            # Reload settings
            settings = get_settings()
            new_token = settings.zerodha_access_token
            
            if new_token and new_token != self.last_token:
                now = datetime.now(IST)
                print("\n" + "=" * 80)
                print(f"🔄 TOKEN CHANGE DETECTED at {now.strftime('%Y-%m-%d %H:%M:%S')}")
                print("=" * 80)
                print(f"   Old Token: {self.last_token[:20] if self.last_token else 'None'}...")
                print(f"   New Token: {new_token[:20]}...")
                print("   🔌 Auto-reconnecting to Zerodha (NO RESTART NEEDED)...")
                
                # Update stored token
                self.last_token = new_token
                
                # Trigger reconnection with new token
                if self.market_feed:
                    await self.market_feed.reconnect_with_new_token(new_token)
                    print("   ✅ Reconnection initiated - Live data will resume shortly")
                    print("=" * 80 + "\n")
                
        except Exception as e:
            print(f"⚠️ Error reloading token: {e}")


def start_token_watcher(market_feed_service):
    """Start watching .env file for token changes"""
    event_handler = TokenWatcher(market_feed_service)
    observer = Observer()
    
    # Watch the parent directory (where .env is located)
    watch_path = Path(__file__).parent.parent
    observer.schedule(event_handler, str(watch_path), recursive=False)
    observer.start()
    
    print("✅ Token Auto-Reload Service started")
    print("   → Watches .env file for token changes")
    print("   → Auto-reconnects to Zerodha (no restart needed)")
    print("   → Updates every time you refresh token via login\n")
    
    return observer
