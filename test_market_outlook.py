#!/usr/bin/env python3
"""
Integration Test: Market Outlook signal extraction
Tests the comprehensive market outlook API with all signals
"""

import requests
import json
from datetime import datetime
import time

BASE_URL = "http://localhost:8000"
SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"]

def print_header(text):
    """Print formatted header"""
    print(f"\n{'='*80}")
    print(f"{text:^80}")
    print(f"{'='*80}\n")

def test_market_outlook(symbol):
    """Test market outlook endpoint for a symbol"""
    print(f"📊 Testing Market Outlook for {symbol}...")
    
    try:
        response = requests.get(
            f"{BASE_URL}/api/analysis/market-outlook/{symbol}",
            timeout=30
        )
        response.raise_for_status()
        
        data = response.json()
        
        print(f"✓ Status: {response.status_code}")
        print(f"✓ Timestamp: {data.get('timestamp')}")
        print(f"✓ Overall Signal: {data.get('overall_signal')}")
        print(f"✓ Overall Confidence: {data.get('overall_confidence')}%")
        print(f"\n📈 Signal Distribution:")
        print(f"   🟢 Bullish Signals: {data.get('bullish_signals')}/11")
        print(f"   🟡 Neutral Signals: {data.get('neutral_signals')}/11")
        print(f"   🔴 Bearish Signals: {data.get('bearish_signals')}/11")
        print(f"   📊 Trend Percentage: {data.get('trend_percentage')}%")
        
        print(f"\n🎯 Signal Status:")
        print(f"{'-'*80}")
        print(f"{'Signal Name':<35} {'Signal':<10} {'Confidence':<10} {'Status'}")
        print(f"{'-'*80}")
        
        signals = data.get('signals', {})
        signal_order = [
            'volume_pulse',
            'pivot_points',
            'supertrend',
            'rsi_60_40',
            'camarilla',
            'vwma_20',
            'high_volume_scanner',
            'smart_money_flow',
            'trade_zones',
            'oi_momentum',
            'order_flow_5m',
        ]
        
        for key in signal_order:
            if key in signals:
                signal = signals[key]
                name = signal.get('name', key)
                signal_type = signal.get('signal', 'N/A')
                confidence = signal.get('confidence', 0)
                status = signal.get('status', 'N/A')
                
                # Truncate status if too long
                if len(status) > 25:
                    status = status[:22] + "..."
                
                print(f"{name:<35} {signal_type:<10} {confidence:<10.1f} {status}")
        
        print(f"{'-'*80}")
        
        return True, data
        
    except requests.exceptions.Timeout:
        print(f"✗ Timeout: Request took longer than 30 seconds")
        return False, None
    except requests.exceptions.ConnectionError:
        print(f"✗ Connection Error: Could not connect to {BASE_URL}")
        return False, None
    except requests.exceptions.HTTPError as e:
        print(f"✗ HTTP Error: {e}")
        return False, None
    except Exception as e:
        print(f"✗ Error: {str(e)}")
        return False, None

def test_all_symbols():
    """Test market outlook for all symbols"""
    print_header("14-SIGNAL INTEGRATED MARKET OUTLOOK TEST")
    print(f"⏰ Test Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"🔌 Backend URL: {BASE_URL}")
    print(f"📊 Testing Symbols: {', '.join(SYMBOLS)}")
    
    results = {}
    
    for symbol in SYMBOLS:
        success, data = test_market_outlook(symbol)
        results[symbol] = {
            'success': success,
            'data': data
        }
        time.sleep(1)  # Small delay between requests
    
    # Summary
    print_header("TEST SUMMARY")
    
    success_count = sum(1 for r in results.values() if r['success'])
    print(f"✓ Successful tests: {success_count}/{len(SYMBOLS)}")
    
    if success_count == len(SYMBOLS):
        print("\n✅ ALL TESTS PASSED")
        print("\n🎯 Signal Confidence Comparison:")
        print(f"{'-'*80}")
        print(f"{'Symbol':<15} {'Overall Signal':<20} {'Confidence':<15} {'Trend %'}")
        print(f"{'-'*80}")
        
        for symbol in SYMBOLS:
            data = results[symbol]['data']
            if data:
                symbol_name = symbol
                overall_signal = data.get('overall_signal', 'N/A')
                confidence = data.get('overall_confidence', 0)
                trend = data.get('trend_percentage', 0)
                print(f"{symbol_name:<15} {overall_signal:<20} {confidence:<15.1f}% {trend:+.1f}%")
    else:
        print(f"\n⚠️  Some tests failed")
    
    # Save results to file
    with open('test_market_outlook_results.json', 'w') as f:
        json.dump(
            {
                'timestamp': datetime.now().isoformat(),
                'results': {
                    k: {
                        'success': v['success'],
                        'data': v['data']
                    }
                    for k, v in results.items()
                }
            },
            f,
            indent=2
        )
    
    print(f"\n💾 Results saved to test_market_outlook_results.json")

def test_specific_signal_extraction():
    """Test that specific signals are correctly extracted"""
    print_header("DETAILED SIGNAL EXTRACTION TEST")
    
    try:
        response = requests.get(
            f"{BASE_URL}/api/analysis/market-outlook/NIFTY",
            timeout=30
        )
        response.raise_for_status()
        
        data = response.json()
        signals = data.get('signals', {})
        
        expected_signals = {
            'volume_pulse': 'Volume Pulse - Candle Volume',
            'pivot_points': 'Pivot Points Support/Resistance',
            'supertrend': 'SuperTrend (10,2)',
            'rsi_60_40': 'RSI 60/40 Momentum',
            'camarilla': 'Camarilla R3/S3 CPR Zones',
            'vwma_20': 'VWMA 20 Entry Filter',
            'high_volume_scanner': 'High Volume Scanner',
            'smart_money_flow': 'Smart Money Flow',
            'trade_zones': 'Trade Zones',
            'oi_momentum': 'OI Momentum Signals',
            'order_flow_5m': 'Order Flow 5-Min',
        }
        
        print("Checking all 11 signals are present and valid...\n")
        
        found_signals = 0
        for key, description in expected_signals.items():
            if key in signals:
                signal = signals[key]
                is_valid = (
                    'name' in signal and
                    'confidence' in signal and
                    'signal' in signal and
                    'status' in signal and
                    isinstance(signal.get('confidence'), (int, float)) and
                    0 <= signal.get('confidence', 0) <= 100 and
                    signal.get('signal') in ['BUY', 'SELL', 'NEUTRAL']
                )
                
                status_icon = "✓" if is_valid else "✗"
                confidence = signal.get('confidence', 'N/A')
                signal_type = signal.get('signal', 'N/A')
                
                print(f"{status_icon} {key:<25} - Confidence: {confidence:>6.1f}%, Signal: {signal_type}")
                
                if is_valid:
                    found_signals += 1
            else:
                print(f"✗ {key:<25} - MISSING")
        
        print(f"\n✓ Found valid signals: {found_signals}/11")
        
        if found_signals == 11:
            print("✅ All 11 signals correctly extracted and validated")
            return True
        else:
            print("⚠️  Not all signals extracted correctly")
            return False
            
    except Exception as e:
        print(f"✗ Error: {str(e)}")
        return False

def main():
    """Main test runner"""
    try:
        # Test 1: All symbols
        test_all_symbols()
        
        print("\n")
        
        # Test 2: Detailed signal extraction
        extraction_success = test_specific_signal_extraction()
        
        print_header("TEST COMPLETE")
        print(f"⏰ Test Finished: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        if extraction_success:
            print("✅ Integration test PASSED - All 11 signals working")
        else:
            print("⚠️  Integration test needs attention")
            
    except KeyboardInterrupt:
        print("\n\n⛔ Test interrupted by user")
    except Exception as e:
        print(f"\n\n✗ Fatal error: {str(e)}")

if __name__ == "__main__":
    main()
