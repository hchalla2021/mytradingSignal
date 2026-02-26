#!/usr/bin/env python3
"""
Test RSI data to diagnose why all indices show identical RSI 62
SIMPLIFIED: Only HTTP endpoint testing (no imports needed)
"""
import requests
import json

# Test symbols
SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"]
BACKEND_URL = "http://localhost:8000"

def test_rsi_endpoint():
    """Test data from /api/analysis/rsi-momentum endpoint"""
    print("\n" + "="*80)
    print("🔍 TEST 1: /api/analysis/rsi-momentum endpoint")
    print("="*80)
    
    rsi_values = {}
    
    for symbol in SYMBOLS:
        try:
            url = f"{BACKEND_URL}/api/analysis/rsi-momentum/{symbol}"
            print(f"\n📡 Fetching {url}...")
            response = requests.get(url, timeout=5)
            data = response.json()
            
            rsi_5m = data.get('rsi_5m', 'N/A')
            rsi_15m = data.get('rsi_15m', 'N/A')
            rsi_values[symbol] = (rsi_5m, rsi_15m)
            
            print(f"\n📊 {symbol}:")
            print(f"  RSI 5M:  {rsi_5m}")
            print(f"  RSI 15M: {rsi_15m}")
            print(f"  5M Signal: {data.get('rsi_5m_signal', 'N/A')}")
            print(f"  15M Signal: {data.get('rsi_15m_signal', 'N/A')}")
            print(f"  Status: {data.get('rsi_momentum_status', 'N/A')}")
            print(f"  Confidence: {data.get('rsi_momentum_confidence', 'N/A')}")
            print(f"  Current Price: {data.get('current_price', 'N/A')}")
            print(f"  Raw response keys: {list(data.keys())}")
            
            # Check for identical values
            if rsi_5m == rsi_15m:
                print(f"  ⚠️  WARNING: RSI 5M ({rsi_5m}) == RSI 15M ({rsi_15m})")
            
        except requests.exceptions.ConnectionError:
            print(f"❌ Cannot connect to {BACKEND_URL}")
            print(f"   Backend may not be running. Start it with:")
            print(f"   cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000")
            break
        except Exception as e:
            print(f"❌ Error fetching {symbol}: {e}")
    
    # Summary
    print("\n" + "="*80)
    print("📊 SUMMARY - RSI Values Across Indices:")
    print("="*80)
    if rsi_values:
        for symbol, (rsi_5m, rsi_15m) in rsi_values.items():
            match = "✅ DIFFERENT" if rsi_5m != rsi_15m else "❌ IDENTICAL"
            print(f"{symbol:12} → 5m={rsi_5m:6} | 15m={rsi_15m:6} | {match}")
        
        # Check if all are the same
        all_values = [v for vals in rsi_values.values() for v in vals]
        if len(set(all_values)) == 1:
            print(f"\n🚨 CRITICAL: All RSI values are IDENTICAL ({all_values[0]})")
            print(f"   This indicates hardcoded data or shared cache issue")


def test_analyze_endpoint():
    """Test data from /api/analysis/analyze endpoint"""
    print("\n" + "="*80)
    print("🔍 TEST 2: /api/analysis/analyze endpoint (checks rsi_5m/rsi_15m)")
    print("="*80)
    
    for symbol in SYMBOLS:
        try:
            url = f"{BACKEND_URL}/api/analysis/analyze/{symbol}"
            print(f"\n📡 Fetching {url}...")
            response = requests.get(url, timeout=5)
            data = response.json()
            
            indicators = data.get('indicators', {})
            
            rsi_5m = indicators.get('rsi_5m', 'MISSING')
            rsi_15m = indicators.get('rsi_15m', 'MISSING')
            rsi_common = indicators.get('rsi', 'MISSING')
            
            print(f"\n📊 {symbol}:")
            print(f"  RSI 5M:       {rsi_5m}")
            print(f"  RSI 15M:      {rsi_15m}")
            print(f"  RSI (common): {rsi_common}")
            print(f"  5M Signal:    {indicators.get('rsi_5m_signal', 'N/A')}")
            print(f"  15M Signal:   {indicators.get('rsi_15m_signal', 'N/A')}")
            print(f"  Momentum:     {indicators.get('rsi_momentum_status', 'N/A')}")
            
            # Check for issues
            if rsi_5m == 'MISSING' or rsi_15m == 'MISSING':
                print(f"  ❌ CRITICAL: rsi_5m or rsi_15m NOT in indicators dict!")
                print(f"     Endpoint will fallback to using common 'rsi' field")
                print(f"     This explains why all indices might show same value")
            
            if rsi_5m == rsi_15m and rsi_5m != 'MISSING':
                print(f"  ⚠️  WARNING: RSI 5M ({rsi_5m}) == RSI 15M ({rsi_15m})")
            
        except requests.exceptions.ConnectionError:
            print(f"❌ Cannot connect")
            break
        except Exception as e:
            print(f"❌ Error: {e}")


if __name__ == "__main__":
    print("\n🎯 RSI DATA DIAGNOSTIC TEST")
    print("Finding why all indices show identical RSI 62...\n")
    
    # Test 1: Direct RSI endpoint
    test_rsi_endpoint()
    
    # Test 2: Full analyze endpoint
    test_analyze_endpoint()
    
    print("\n" + "="*80)
    print("✅ Diagnostic complete")
    print("="*80 + "\n")
