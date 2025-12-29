"""
Find current month futures tokens for NIFTY, BANKNIFTY, SENSEX
This finds the nearest expiry future contract automatically
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kiteconnect import KiteConnect
from config import Settings
from datetime import datetime

settings = Settings()

print("🔍 Finding current futures contracts...\n")

kite = KiteConnect(api_key=settings.zerodha_api_key)
kite.set_access_token(settings.zerodha_access_token)

# Fetch all NFO instruments
print("📥 Fetching NFO instruments...")
instruments = kite.instruments("NFO")

# Get current month futures
current_date = datetime.now().date()

def find_current_month_future(symbol_name):
    """Find nearest expiry future for given symbol"""
    futures = [
        inst for inst in instruments
        if inst['name'] == symbol_name
        and inst['instrument_type'] == 'FUT'
        and inst['expiry'] >= current_date
    ]
    
    if not futures:
        print(f"❌ No futures found for {symbol_name}")
        return None
    
    # Get nearest expiry
    nearest = min(futures, key=lambda x: x['expiry'])
    
    print(f"\n✅ {symbol_name} Future:")
    print(f"   Token: {nearest['instrument_token']}")
    print(f"   Trading Symbol: {nearest['tradingsymbol']}")
    print(f"   Expiry: {nearest['expiry']}")
    
    return nearest['instrument_token']

# Find tokens
nifty_fut = find_current_month_future('NIFTY')
banknifty_fut = find_current_month_future('BANKNIFTY')

print("\n" + "="*60)
print("🎯 COPY THESE TO YOUR .env FILE:")
print("="*60)
if nifty_fut:
    print(f"NIFTY_FUT_TOKEN={nifty_fut}")
if banknifty_fut:
    print(f"BANKNIFTY_FUT_TOKEN={banknifty_fut}")
print("="*60)

# Update .env file automatically
env_path = "../.env"
if os.path.exists(env_path):
    print("\n✏️ Updating .env file...")
    with open(env_path, 'r') as f:
        lines = f.readlines()
    
    # Remove old future tokens
    lines = [l for l in lines if not l.startswith('NIFTY_FUT_TOKEN=') and not l.startswith('BANKNIFTY_FUT_TOKEN=')]
    
    # Add new tokens
    if nifty_fut:
        lines.append(f"NIFTY_FUT_TOKEN={nifty_fut}\n")
    if banknifty_fut:
        lines.append(f"BANKNIFTY_FUT_TOKEN={banknifty_fut}\n")
    
    with open(env_path, 'w') as f:
        f.writelines(lines)
    
    print("✅ .env file updated!")
    print("⚠️ RESTART YOUR BACKEND for changes to take effect!")
else:
    print(f"\n⚠️ .env file not found at {env_path}")
    print("Please add the tokens manually to your .env file")
