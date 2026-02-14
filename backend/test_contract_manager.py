#!/usr/bin/env python3
"""
Test Contract Manager - Get ACTUAL Current Futures Tokens
=========================================================

This test shows which contract tokens are CURRENTLY ACTIVE for:
- NIFTY
- BANKNIFTY
- SENSEX

Run this to verify tokens are NOT EXPIRED and trading is active.
"""

import sys
sys.path.insert(0, '/d/Trainings/GitHub projects/GitClonedProject/mytradingSignal/backend')

from services.contract_manager import ContractManager
from kiteconnect import KiteConnect
from config import get_settings
import json
from datetime import datetime
import pytz

IST = pytz.timezone('Asia/Kolkata')


def main():
    settings = get_settings()
    
    # Initialize Zerodha connection
    kite = KiteConnect(api_key=settings.zerodha_api_key)
    kite.set_access_token(settings.zerodha_access_token)
    
    print(f"""
╔════════════════════════════════════════════════════════════════════╗
║         CONTRACT MANAGER - GET CURRENT TOKENS                      ║
╚════════════════════════════════════════════════════════════════════╝

Checking which contract tokens are CURRENTLY ACTIVE for Indian 
index futures. These tokens are used for VWAP, entry/exit signals.

⚠️  Note: Contract tokens CHANGE every month when contracts expire!
""")
    
    manager = ContractManager(kite)
    
    print(f"\n{'='*80}")
    print(f"📊 FETCHING CURRENT CONTRACTS FROM ZERODHA")
    print(f"{'='*80}\n")
    
    # Get all 3 months of contracts for each symbol
    symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
    all_contracts = {}
    
    for symbol in symbols:
        print(f"\n🔍 {symbol}:")
        print(f"{'-'*60}")
        
        contracts = manager.get_all_contracts(symbol, debug=False)
        all_contracts[symbol] = contracts
        
        if not contracts:
            print(f"  ❌ Failed to get contracts for {symbol}")
            continue
        
        # Show all 3 contracts (near, next, far)
        for position, contract_type in [("NEAR MONTH (Current)", 'near'), 
                                         ("NEXT MONTH", 'next'), 
                                         ("FAR MONTH", 'far')]:
            if contract_type in contracts:
                contract = contracts[contract_type]
                token = contract['token']
                name = contract['name']
                expiry = contract['expiry']
                
                # Calculate days to expiry
                expiry_date = datetime.fromisoformat(expiry).replace(tzinfo=IST)
                days_left = (expiry_date - datetime.now(IST)).days
                
                marker = "🟢 ACTIVE" if contract_type == 'near' else "⚪ Secondary"
                
                print(f"\n  {marker}: {position}")
                print(f"     Contract: {name}")
                print(f"     Token:    {token}")
                print(f"     Expiry:   {expiry} ({days_left} days)")
    
    # Summary table
    print(f"\n\n{'='*80}")
    print(f"📋 CURRENT CONTRACT TOKENS (USE THESE FOR TRADING)")
    print(f"{'='*80}\n")
    
    print(f"{'Symbol':<15} {'Token':<20} {'Expiry':<15} {'Days Left':<10}")
    print(f"{'-'*60}")
    
    for symbol in symbols:
        if symbol in all_contracts and 'near' in all_contracts[symbol]:
            contract = all_contracts[symbol]['near']
            token = contract['token']
            expiry = contract['expiry']
            
            expiry_date = datetime.fromisoformat(expiry).replace(tzinfo=IST)
            days_left = (expiry_date - datetime.now(IST)).days
            
            print(f"{symbol:<15} {str(token):<20} {expiry:<15} {days_left:<10}")
    
    # Recommendations
    print(f"\n\n{'='*80}")
    print(f"✅ RECOMMENDATIONS")
    print(f"{'='*80}\n")
    
    print(f"""
1. UPDATE YOUR CONFIGURATION:
   Instead of hardcoded tokens, use ContractManager to dynamically fetch:
   
   from services.contract_manager import ContractManager
   
   manager = ContractManager(kite)
   nifty_token = manager.get_current_contract_token("NIFTY")
   banknifty_token = manager.get_current_contract_token("BANKNIFTY")
   sensex_token = manager.get_current_contract_token("SENSEX")

2. CHECK BEFORE TRADING:
   - Use NEAR MONTH contracts (highest liquidity)
   - When expiry < 3 days, switch to NEXT MONTH
   - Never use expired contracts

3. IN YOUR VWAP CODE:
   Replace hardcoded tokens with:
   
   token = manager.get_current_contract_token(symbol)
   
   This ensures you're always using the CORRECT, NON-EXPIRED contract!

4. RESTART DAILY CHECK:
   Add this check to your startup sequence to ensure contracts are current.
""")
    
    # Export as JSON for reference
    print(f"\n\n{'='*80}")
    print(f"📥 CURRENT TOKENS (JSON FORMAT)")
    print(f"{'='*80}\n")
    
    export = {}
    for symbol in symbols:
        if symbol in all_contracts and 'near' in all_contracts[symbol]:
            contract = all_contracts[symbol]['near']
            export[symbol] = contract['token']
    
    print(json.dumps(export, indent=2))
    
    print(f"\n\n✨ To use these tokens, update your .env or config with the values above")
    print(f"   Or better yet: Use ContractManager to fetch dynamically!\n")


if __name__ == "__main__":
    main()
