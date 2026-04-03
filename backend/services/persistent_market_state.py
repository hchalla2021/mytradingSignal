"""
[PERSISTENT MARKET STATE SERVICE]
Professional-grade persistent caching for Live Market Indices
Stores last known market data and retrieves it across market closures, weekends, holidays

Key Features:
- Persistent storage of last market state per symbol
- Automatic failover to cached data when market is closed
- Timestamps track when data was last updated
- Debounced disk writes (10s) to avoid I/O bottleneck on every tick
- Works silently without disrupting other functionality
- Professional error handling and logging
"""

import json
import time
import threading
from typing import Optional, Dict, Any
from pathlib import Path
from datetime import datetime, timedelta
import asyncio

# Persistent storage file location
PERSISTENT_STATE_FILE = Path(__file__).parent.parent / "data" / "persistent_market_state.json"

# Debounce interval for disk writes (seconds)
_SAVE_DEBOUNCE_SECONDS = 10.0
_last_save_time: float = 0.0
_save_timer: threading.Timer | None = None
_save_lock = threading.Lock()


def _ensure_persistent_dir():
    """Ensure the data directory exists for persistent state."""
    PERSISTENT_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)


def _load_persistent_state() -> Dict[str, Any]:
    """Load persistent market state from file on startup."""
    try:
        if PERSISTENT_STATE_FILE.exists():
            with open(PERSISTENT_STATE_FILE, 'r') as f:
                data = json.load(f)
                print(f"[OK] Persistent market state loaded: {list(data.keys())}")
                return data
    except Exception as e:
        print(f"[WARN] Could not load persistent state file: {e}")
    return {}


def _save_persistent_state(state: Dict[str, Any]):
    """Save persistent market state to file (synchronous, called from debounce timer)."""
    try:
        _ensure_persistent_dir()
        with open(PERSISTENT_STATE_FILE, 'w') as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        print(f"[WARN] Could not save persistent state file: {e}")


def _debounced_save():
    """Schedule a disk write, debounced to avoid writing on every tick.
    
    Writes at most once every _SAVE_DEBOUNCE_SECONDS.
    If a write is already scheduled, it reuses the existing timer.
    """
    global _last_save_time, _save_timer
    with _save_lock:
        now = time.time()
        if now - _last_save_time >= _SAVE_DEBOUNCE_SECONDS:
            # Enough time has passed — write immediately
            _last_save_time = now
            _save_persistent_state(_PERSISTENT_STATE)
        elif _save_timer is None or not _save_timer.is_alive():
            # Schedule a delayed write
            delay = _SAVE_DEBOUNCE_SECONDS - (now - _last_save_time)
            def _do_save():
                global _last_save_time
                with _save_lock:
                    _last_save_time = time.time()
                    _save_persistent_state(_PERSISTENT_STATE)
            _save_timer = threading.Timer(delay, _do_save)
            _save_timer.daemon = True
            _save_timer.start()


# In-memory persistent state (loaded on startup, updated on market data)
_PERSISTENT_STATE: Dict[str, Any] = {}


class PersistentMarketState:
    """
    Manages persistent storage of last known market state
    Provides failover mechanism for market closure scenarios
    """

    @staticmethod
    def initialize():
        """Initialize persistent state from file on startup."""
        global _PERSISTENT_STATE
        _PERSISTENT_STATE = _load_persistent_state()
        if not _PERSISTENT_STATE:
            print("[OK] Persistent market state initialized (empty)")
        return _PERSISTENT_STATE

    @staticmethod
    def save_market_state(symbol: str, data: Dict[str, Any]):
        """
        Save current market data as persistent last-known state.
        Called every time fresh market data is received.
        """
        try:
            _ensure_initialized()
            global _PERSISTENT_STATE
            
            # Add metadata for persistence
            persistent_data = {
                **data,
                '_persist_timestamp': datetime.now().isoformat(),
                '_persist_unix_time': time.time(),
                '_symbol': symbol,
            }
            
            _PERSISTENT_STATE[symbol] = persistent_data
            
            # Debounced save — writes to disk at most once every 10 seconds
            _debounced_save()
            
        except Exception as e:
            print(f"[WARN] Error saving persistent state for {symbol}: {e}")

    @staticmethod
    def get_last_known_state(symbol: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve the last known market state for a symbol.
        Returns None if no state has been saved yet.
        """
        try:
            _ensure_initialized()
            global _PERSISTENT_STATE
            
            if symbol in _PERSISTENT_STATE:
                state = _PERSISTENT_STATE[symbol].copy()
                
                # Mark this data as coming from cache (not live)
                if '_cached' not in state:
                    state['_cached'] = True
                    state['_cache_type'] = 'persistent_market_state'
                
                return state
            
            return None
        except Exception as e:
            print(f"[WARN] Error retrieving persistent state for {symbol}: {e}")
            return None

    @staticmethod
    def get_last_update_time(symbol: str) -> Optional[float]:
        """Get Unix timestamp of last update for a symbol."""
        try:
            _ensure_initialized()
            global _PERSISTENT_STATE
            
            if symbol in _PERSISTENT_STATE:
                return _PERSISTENT_STATE[symbol].get('_persist_unix_time')
            
            return None
        except Exception:
            return None

    @staticmethod
    def get_time_since_last_update(symbol: str) -> Optional[float]:
        """Get seconds since last market data update for a symbol."""
        try:
            last_time = PersistentMarketState.get_last_update_time(symbol)
            if last_time:
                return time.time() - last_time
            return None
        except Exception:
            return None

    @staticmethod
    def get_all_last_known_states() -> Dict[str, Dict[str, Any]]:
        """Get all last-known states for all symbols."""
        try:
            _ensure_initialized()
            global _PERSISTENT_STATE
            
            return {
                symbol: state.copy()
                for symbol, state in _PERSISTENT_STATE.items()
            }
        except Exception as e:
            print(f"[WARN] Error retrieving all persistent states: {e}")
            return {}

    @staticmethod
    def clear_all_states():
        """Clear all persistent states (mainly for testing)."""
        try:
            global _PERSISTENT_STATE
            _PERSISTENT_STATE = {}
            _save_persistent_state(_PERSISTENT_STATE)
        except Exception as e:
            print(f"[WARN] Error clearing persistent states: {e}")


# Lazy initialization - called on first access, not on import
_INITIALIZED = False

def _ensure_initialized():
    global _INITIALIZED
    if not _INITIALIZED:
        PersistentMarketState.initialize()
        _INITIALIZED = True
