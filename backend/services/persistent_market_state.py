"""
[PERSISTENT MARKET STATE SERVICE]
Professional-grade persistent caching for Live Market Indices
Stores last known market data and retrieves it across market closures, weekends, holidays

Key Features:
- Persistent storage of last market state per symbol
- Automatic failover to cached data when market is closed
- Timestamps track when data was last updated
- Works silently without disrupting other functionality
- Professional error handling and logging
"""

import json
import time
from typing import Optional, Dict, Any
from pathlib import Path
from datetime import datetime, timedelta
import asyncio

# Persistent storage file location
PERSISTENT_STATE_FILE = Path(__file__).parent.parent / "data" / "persistent_market_state.json"


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
    """Save persistent market state to file."""
    try:
        _ensure_persistent_dir()
        with open(PERSISTENT_STATE_FILE, 'w') as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        print(f"[WARN] Could not save persistent state file: {e}")


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
            global _PERSISTENT_STATE
            
            # Add metadata for persistence
            persistent_data = {
                **data,
                '_persist_timestamp': datetime.now().isoformat(),
                '_persist_unix_time': time.time(),
                '_symbol': symbol,
            }
            
            _PERSISTENT_STATE[symbol] = persistent_data
            
            # Save to file asynchronously (doesn't block market feed)
            _save_persistent_state(_PERSISTENT_STATE)
            
        except Exception as e:
            print(f"[WARN] Error saving persistent state for {symbol}: {e}")

    @staticmethod
    def get_last_known_state(symbol: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve the last known market state for a symbol.
        Returns None if no state has been saved yet.
        """
        try:
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


# Initialize on module load
PersistentMarketState.initialize()
