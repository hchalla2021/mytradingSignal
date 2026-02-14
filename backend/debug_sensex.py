#!/usr/bin/env python3
"""
Debug: Find SENSEX contracts (they must be on BSE)
"""

import sys
sys.path.insert(0, '/d/Trainings/GitHub projects/GitClonedProject/mytradingSignal/backend')

from kiteconnect import KiteConnect
from config import get_settings

settings = get_settings()

kite = KiteConnect(api_key=settings.zerodha_api_key)
kite.set_access_token(settings.zerodha_access_token)

try:
    print("📥 Looking for SENSEX contracts on BSE...")
    bse_instruments = kite.instruments("BSE")
    
    print(f"\n✅ Total BSE instruments: {len(bse_instruments)}")
    
    # Search for anything with SENSEX, Sensex, or similar
    sensex_matches = []
    for i in bse_instruments:
        symbol = i.get('tradingsymbol', '').upper()
        name = i.get('name', '').upper()
        inst_type = i.get('instrument_type', '')
        
        if 'SENSEX' in symbol or 'SENSEX' in name or 'SENSEX50' in symbol:
            sensex_matches.append(i)
            print(f"\n   Found: {symbol}")
            print(f"   Name: {name}")
            print(f"   Type: {inst_type}")
            print(f"   Token: {i['instrument_token']}")
    
    if not sensex_matches:
        print("\n❌ No SENSEX instruments found on BSE")
        print("\nSearching for futures contracts on BSE...")
        
        # Show all futures on BSE
        bse_futures = [i for i in bse_instruments if i.get('instrument_type') == 'FUT']
        print(f"Total BSE Futures: {len(bse_futures)}")
        print("\nFirst 20 BSE Futures:")
        for i in bse_futures[:20]:
            print(f"   {i['tradingsymbol']:<25} | {i['name']:<40} (Token: {i['instrument_token']})")
    else:
        print(f"\n✅ Found {len(sensex_matches)} SENSEX-related contracts")
        
except Exception as e:
    import traceback
    print(f"❌ Error: {e}")
    traceback.print_exc()
