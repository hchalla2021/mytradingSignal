"""
Fix SENSEX Futures Token
This script finds the correct SENSEX futures token on BFO exchange
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kiteconnect import KiteConnect
from config import Settings
from datetime import datetime

settings = Settings()

print("🔍 Finding SENSEX futures contract on BFO...\n")

kite = KiteConnect(api_key=settings.zerodha_api_key)
kite.set_access_token(settings.zerodha_access_token)

# Fetch all BFO instruments (BSE Futures & Options)
print("📥 Fetching BFO instruments...")
instruments = kite.instruments("BFO")

# Get current month futures
current_date = datetime.now().date()

# Find SENSEX futures
sensex_futures = [
    inst for inst in instruments
    if inst['name'] == 'SENSEX'
    and inst['instrument_type'] == 'FUT'
    and inst['expiry'] >= current_date
]

if not sensex_futures:
    print("❌ No SENSEX futures found on BFO exchange")
    print("\n💡 This is expected - BSE may not have SENSEX index futures")
    print("   SENSEX volume will show N/A until proper instrument is configured")
else:
    # Get nearest expiry
    nearest = min(sensex_futures, key=lambda x: x['expiry'])
    
    print(f"\n✅ SENSEX Future Found:")
    print(f"   Token: {nearest['instrument_token']}")
    print(f"   Trading Symbol: {nearest['tradingsymbol']}")
    print(f"   Expiry: {nearest['expiry']}")
    print(f"   Exchange: {nearest['exchange']}")
    
    print("\n" + "="*60)
    print("🎯 UPDATE YOUR .env FILE:")
    print("="*60)
    print(f"SENSEX_FUT_TOKEN={nearest['instrument_token']}")
    print("="*60)
    print("\n⚠️ RESTART BACKEND after updating .env for changes to take effect!")
