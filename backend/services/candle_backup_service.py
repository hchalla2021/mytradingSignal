"""
Candle Backup & Restore Service
Saves historical candles at market close and restores them at market open
Ensures OI Momentum signals work immediately when market starts
"""

import json
import asyncio
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional
import pytz
import logging

logger = logging.getLogger(__name__)

# Indian timezone
IST = pytz.timezone('Asia/Kolkata')

# Backup directory
BACKUP_DIR = Path(__file__).parent.parent / "data" / "candle_backups"
BACKUP_DIR.mkdir(parents=True, exist_ok=True)


class CandleBackupService:
    """
    Manages backup and restoration of candle data
    Ensures historical continuity between market sessions
    """

    @staticmethod
    def get_backup_file_path(symbol: str, date: Optional[datetime] = None) -> Path:
        """Get the file path for candle backup"""
        if date is None:
            date = datetime.now(IST)
        
        date_str = date.strftime("%Y-%m-%d")
        filename = f"{symbol}_candles_{date_str}.json"
        return BACKUP_DIR / filename

    @staticmethod
    async def backup_candles(cache, symbol: str) -> bool:
        """
        Backup candles from Redis to disk file
        Called at market close (3:30 PM)
        
        Args:
            cache: CacheService instance
            symbol: Trading symbol (NIFTY, BANKNIFTY, SENSEX)
        
        Returns:
            True if successful, False otherwise
        """
        try:
            print(f"\n📦 BACKING UP CANDLES FOR {symbol}...")
            
            # Get all cached candles from Redis
            candle_key = f"analysis_candles:{symbol}"
            candles_json = await cache.lrange(candle_key, 0, 199)
            
            if not candles_json:
                print(f"   ⚠️  No candles to backup for {symbol}")
                return False
            
            # Parse candles (they're stored as JSON strings)
            candles = []
            for candle_json in reversed(candles_json):  # Reverse to get chronological order
                try:
                    candles.append(json.loads(candle_json))
                except json.JSONDecodeError:
                    continue
            
            if not candles:
                print(f"   ⚠️  Could not parse candles for {symbol}")
                return False
            
            # Prepare backup data
            backup_data = {
                "symbol": symbol,
                "backup_date": datetime.now(IST).isoformat(),
                "candle_count": len(candles),
                "first_candle": candles[0] if candles else None,
                "last_candle": candles[-1] if candles else None,
                "candles": candles
            }
            
            # Write to disk
            backup_file = CandleBackupService.get_backup_file_path(symbol)
            with open(backup_file, 'w') as f:
                json.dump(backup_data, f, indent=2)
            
            print(f"   ✅ Backed up {len(candles)} candles to {backup_file.name}")
            print(f"      First candle: {backup_data['first_candle'].get('timestamp', 'N/A')}")
            print(f"      Last candle:  {backup_data['last_candle'].get('timestamp', 'N/A')}")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Error backing up candles for {symbol}: {e}")
            print(f"   ❌ Error: {e}")
            return False

    @staticmethod
    async def restore_candles(cache, symbol: str) -> bool:
        """
        Restore candles from disk to Redis
        Called at market open (9:15 AM)
        
        Args:
            cache: CacheService instance
            symbol: Trading symbol (NIFTY, BANKNIFTY, SENSEX)
        
        Returns:
            True if successful and candles were restored, False otherwise
        """
        try:
            print(f"\n🔄 RESTORING CANDLES FOR {symbol}...")
            
            # Try to find the most recent backup file for this symbol
            backup_file = CandleBackupService.get_backup_file_path(symbol)
            
            if not backup_file.exists():
                print(f"   ⚠️  No backup file found: {backup_file.name}")
                return False
            
            # Load backup data
            with open(backup_file, 'r') as f:
                backup_data = json.load(f)
            
            candles = backup_data.get("candles", [])
            if not candles:
                print(f"   ⚠️  Backup file has no candles")
                return False
            
            # Clear existing candles in Redis
            candle_key = f"analysis_candles:{symbol}"
            await cache.delete(candle_key)
            
            # Restore candles to Redis (in reverse order - newest first)
            for candle in reversed(candles):
                candle_json = json.dumps(candle)
                await cache.lpush(candle_key, candle_json)
            
            # Trim to keep only 100 most recent
            await cache.ltrim(candle_key, 0, 99)
            
            # Verify restoration
            restored = await cache.llen(candle_key)
            
            print(f"   ✅ Restored {restored} candles from backup")
            print(f"      Backup date: {backup_data.get('backup_date', 'N/A')}")
            
            if backup_data.get('last_candle'):
                print(f"      Latest candle: {backup_data['last_candle'].get('timestamp', 'N/A')}")
            
            return restored > 0
            
        except Exception as e:
            logger.error(f"❌ Error restoring candles for {symbol}: {e}")
            print(f"   ❌ Error: {e}")
            return False

    @staticmethod
    async def backup_all_symbols(cache, symbols: List[str] = None) -> Dict[str, bool]:
        """
        Backup candles for all symbols
        
        Args:
            cache: CacheService instance
            symbols: List of symbols to backup (default: NIFTY, BANKNIFTY, SENSEX)
        
        Returns:
            Dictionary of symbol: backup_success pairs
        """
        if symbols is None:
            symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        
        print(f"\n{'='*80}")
        print(f"📦 BACKING UP CANDLES FOR ALL SYMBOLS")
        print(f"{'='*80}")
        
        results = {}
        for symbol in symbols:
            results[symbol] = await CandleBackupService.backup_candles(cache, symbol)
        
        print(f"\n{'='*80}")
        success_count = sum(1 for v in results.values() if v)
        print(f"✅ BACKUP COMPLETE - {success_count}/{len(symbols)} symbols backed up")
        print(f"{'='*80}\n")
        
        return results

    @staticmethod
    async def restore_all_symbols(cache, symbols: List[str] = None) -> Dict[str, bool]:
        """
        Restore candles for all symbols
        
        Args:
            cache: CacheService instance
            symbols: List of symbols to restore (default: NIFTY, BANKNIFTY, SENSEX)
        
        Returns:
            Dictionary of symbol: restore_success pairs
        """
        if symbols is None:
            symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
        
        print(f"\n{'='*80}")
        print(f"🔄 RESTORING CANDLES FOR ALL SYMBOLS")
        print(f"{'='*80}")
        
        results = {}
        for symbol in symbols:
            results[symbol] = await CandleBackupService.restore_candles(cache, symbol)
        
        print(f"\n{'='*80}")
        success_count = sum(1 for v in results.values() if v)
        print(f"✅ RESTORE COMPLETE - {success_count}/{len(symbols)} symbols restored")
        print(f"{'='*80}\n")
        
        return results

    @staticmethod
    def list_backup_files() -> List[Dict[str, str]]:
        """List all available backup files"""
        backups = []
        for backup_file in sorted(BACKUP_DIR.glob("*_candles_*.json"), reverse=True):
            try:
                with open(backup_file, 'r') as f:
                    data = json.load(f)
                backups.append({
                    "file": backup_file.name,
                    "symbol": data.get("symbol", "UNKNOWN"),
                    "backup_date": data.get("backup_date", "UNKNOWN"),
                    "candle_count": data.get("candle_count", 0)
                })
            except:
                pass
        return backups

    @staticmethod
    def cleanup_old_backups(days: int = 7):
        """Remove backup files older than specified days"""
        from datetime import timedelta
        
        cutoff_time = datetime.now(IST) - timedelta(days=days)
        
        for backup_file in BACKUP_DIR.glob("*_candles_*.json"):
            try:
                file_time = datetime.fromtimestamp(backup_file.stat().st_mtime, IST)
                if file_time < cutoff_time:
                    backup_file.unlink()
                    print(f"🗑️  Deleted old backup: {backup_file.name}")
            except:
                pass
