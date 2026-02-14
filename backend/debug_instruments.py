#!/usr/bin/env python3
"""
Debug: See all NFO instruments returned by Zerodha
"""

import sys
sys.path.insert(0, '/d/Trainings/GitHub projects/GitClonedProject/mytradingSignal/backend')

from kiteconnect import KiteConnect
from config import get_settings

settings = get_settings()

kite = KiteConnect(api_key=settings.zerodha_api_key)
kite.set_access_token(settings.zerodha_access_token)

try:
    print("📥 Fetching NFO instruments from Zerodha...")
    instruments = kite.instruments("NFO")
    
    print(f"\n✅ Total instruments: {len(instruments)}")
    
    # Search for NIFTY-related
    nifty_instruments = [i for i in instruments if 'NIFTY' in i.get('name', '').upper() and i.get('instrument_type') == 'FUT']
    print(f"\n📊 NIFTY Futures ({len(nifty_instruments)} found):")
    for i in nifty_instruments[:10]:
        print(f"   {i['tradingsymbol']:<20} | {i['name']:<40} | Token: {i['instrument_token']}")
    
    # Search for BANKNIFTY-related
    banknifty_instruments = [i for i in instruments if 'BANKNIFTY' in i.get('name', '').upper() and i.get('instrument_type') == 'FUT']
    print(f"\n📊 BANKNIFTY Futures ({len(banknifty_instruments)} found):")
    for i in banknifty_instruments[:10]:
        print(f"   {i['tradingsymbol']:<20} | {i['name']:<40} | Token: {i['instrument_token']}")
    
    # Search for SENSEX-related
    sensex_instruments = [i for i in instruments if 'SENSEX' in i.get('name', '').upper() and i.get('instrument_type') == 'FUT']
    print(f"\n📊 SENSEX Futures ({len(sensex_instruments)} found):")
    for i in sensex_instruments[:10]:
        print(f"   {i['tradingsymbol']:<20} | {i['name']:<40} | Token: {i['instrument_token']}")
    
    # Show sample of all instruments
    print(f"\n📋 Sample of first 20 NFO instruments:")
    for i in instruments[:20]:
        if i.get('instrument_type') == 'FUT':
            print(f"   {i['tradingsymbol']:<20} | {i['name']:<40} (FUT)")
        
except Exception as e:
    import traceback
    print(f"❌ Error: {e}")
    traceback.print_exc()
