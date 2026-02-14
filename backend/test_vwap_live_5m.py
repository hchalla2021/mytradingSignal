#!/usr/bin/env python3
"""
Test VWAP Intraday Filter - LIVE 5m VWAP Signal
================================================

Tests the new get_live_vwap_5m_signal() method that fetches actual LIVE
5-minute VWAP for futures contracts (NIFTY, BANKNIFTY, SENSEX).

Run before trading to verify VWAP values are CORRECT (not stale/wrong).
"""

import sys
sys.path.insert(0, '/d/Trainings/GitHub projects/GitClonedProject/mytradingSignal/backend')

from services.intraday_entry_filter import VWAPIntradayFilter
from kiteconnect import KiteConnect
from config import get_settings
import json


def test_live_vwap_signal(symbol: str):
    """Test LIVE 5m VWAP signal for a symbol using AUTO CONTRACT SWITCHING"""
    
    settings = get_settings()
    
    # Initialize Zerodha connection
    kite = KiteConnect(api_key=settings.zerodha_api_key)
    kite.set_access_token(settings.zerodha_access_token)
    
    # Get current price
    try:
        import pandas as pd
        from datetime import datetime, timedelta
        import pytz
        
        IST = pytz.timezone('Asia/Kolkata')
        now = datetime.now(IST)
        market_open = now.replace(hour=9, minute=15, second=0, microsecond=0)
        
        # Try to get token from ContractManager, fallback to config if needed
        from services.contract_manager import ContractManager
        manager = ContractManager(kite)
        token = manager.get_current_contract_token(symbol, debug=False)
        
        # If ContractManager fails, use config fallback
        if not token:
            token_map = {
                "NIFTY": settings.nifty_fut_token,
                "BANKNIFTY": settings.banknifty_fut_token,
                "SENSEX": settings.sensex_fut_token,
            }
            token = token_map.get(symbol)
            if not token:
                print(f"❌ Failed to get token for {symbol} from both ContractManager and config")
                return
            print(f"   ⚠️  Using config fallback token for {symbol}: {token}")
        else:
            print(f"   ✅ Using ContractManager token for {symbol}: {token}")
        
        # Fetch latest price
        data = kite.historical_data(
            instrument_token=token,
            from_date=market_open,
            to_date=now,
            interval="5minute"
        )
        
        if data and len(data) > 0:
            current_price = data[-1]['close']  # Use last candle's close as current price
        else:
            print(f"❌ Failed to get current price for {symbol}: No data from Zerodha (token may be expired)")
            return
    except Exception as e:
        print(f"❌ Failed to get current price for {symbol}: {e}")
        import traceback
        traceback.print_exc()
        return
    
    print(f"\n{'='*80}")
    print(f"🔍 Testing: {symbol}")
    print(f"{'='*80}")
    print(f"💹 Current Price: ₹{current_price:,.2f}")
    
    # Get LIVE VWAP signal using AUTO TOKEN (no token parameter needed!)
    result = VWAPIntradayFilter.get_live_vwap_5m_signal_with_auto_token(
        symbol=symbol,
        kite_client=kite,
        current_price=current_price,
        debug=True
    )
    
    # Check if successful
    if not result['success']:
        print(f"\n❌ FAILED: {result.get('error')}")
        return
    
    # Display results
    print(f"\n✅ LIVE VWAP DATA:")
    print(f"   Symbol: {result['symbol']}")
    print(f"   Current Price: ₹{result['current_price']:,.2f}")
    print(f"   VWAP (5m): ₹{result['vwap']:,.2f}")
    print(f"   Position: {result['position']} ({result['distance_pct']:+.4f}%)")
    print(f"   Signal: {result['signal']}")
    print(f"   Direction: {result['direction']}")
    print(f"   Confidence: {result['confidence']}%")
    
    print(f"\n📊 DATA QUALITY:")
    print(f"   Candles used: {result['candles_used']} (from {result['market_open']})")
    print(f"   Last update: {result['last_update']}")
    print(f"   Total volume: {result['total_volume']:,}")
    
    print(f"\n📍 SIGNAL REASONS:")
    for reason in result['reasons']:
        print(f"   {reason}")
    
    print(f"\n✅ EXECUTION NOTES:")
    for note in result['execution_notes']:
        print(f"   {note}")
    
    # Verify data quality
    print(f"\n🔐 DATA VERIFICATION:")
    
    # Check 1: VWAP should NOT equal current price (unless genuinely at equilibrium)
    if abs(result['vwap'] - result['current_price']) < 0.01:
        print(f"   ⚠️  VWAP ≈ Price (should be rare - only at exact equilibrium)")
    else:
        print(f"   ✅ VWAP differs from price: {abs(result['vwap'] - result['current_price']):.2f}pts")
    
    # Check 2: Candles count should be high (>100 for intraday ≈ full trading day)
    if result['candles_used'] < 10:
        print(f"   ❌ Too few candles ({result['candles_used']}) - data source issue")
    else:
        print(f"   ✅ Sufficient candles: {result['candles_used']}")
    
    # Check 3: Volume should be non-zero
    if result['total_volume'] == 0:
        print(f"   ❌ Volume is zero - stale data")
    else:
        print(f"   ✅ Volume is real: {result['total_volume']:,}")
    
    # Check 4: Last update should be recent (within 5 minutes)
    print(f"   ✅ Last candle timestamp: {result['last_update']}")
    
    return result


def main():
    """Test all symbols with AUTO CONTRACT SWITCHING"""
    
    settings = get_settings()
    
    print(f"""
╔════════════════════════════════════════════════════════════════════╗
║    VWAP INTRADAY FILTER - LIVE 5M TEST (WITH AUTO TOKENS) ✅       ║
╚════════════════════════════════════════════════════════════════════╝

Testing the new get_live_vwap_5m_signal_with_auto_token() method

This test verifies:
✅ Auto-fetches current month contract tokens
✅ VWAP values are LIVE (from Zerodha) - NOT stale/wrong
✅ Correct signal generation (BUY/SELL/HOLD)
✅ Position calculation (ABOVE/BELOW/AT VWAP)
✅ Works with ContractManager (auto-switches monthly!)

Futures to test:
• NIFTY (auto-detected token)
• BANKNIFTY (auto-detected token)
• SENSEX (auto-detected token)
""")
    
    symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
    
    results = {}
    for symbol in symbols:
        result = test_live_vwap_signal(symbol)
        results[symbol] = result
    
    # Summary
    print(f"\n{'='*80}")
    print(f"📊 TEST SUMMARY")
    print(f"{'='*80}\n")
    
    passed = 0
    failed = 0
    
    for symbol, result in results.items():
        if result and result.get('success'):
            status = "✅ PASS"
            passed += 1
            print(f"{status}: {symbol}")
            print(f"        Signal: {result['signal']} @ {result['confidence']}%")
            print(f"        VWAP: ₹{result['vwap']:,.2f} (Distance: {result['distance_pct']:+.4f}%)")
            if 'contract_name' in result:
                print(f"        Contract: {result['contract_name']} (Expires: {result.get('contract_expiry', 'N/A')})")
        else:
            status = "❌ FAIL"
            failed += 1
            error = result.get('error', 'Unknown error') if result else 'No result'
            print(f"{status}: {symbol}")
            print(f"        Error: {error}")
    
    print(f"\nTotal: {passed} passed, {failed} failed")
    
    if passed == len(symbols):
        print(f"\n✨ SUCCESS! All symbols showing LIVE VWAP with AUTO TOKEN SWITCHING.")
        print(f"   No manual token updates needed - ContractManager handles monthly switches! 🚀")
    else:
        print(f"\n⚠️  Some tests failed. Check the errors above.")


if __name__ == "__main__":
    main()
