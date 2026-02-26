#!/usr/bin/env python3
"""
Integration Test: 14-Signals + Live Market Indices = Trading Decisions
Tests the complete trading decision system with market indices
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

def test_trading_decision(symbol):
    """Test trading decision endpoint for a symbol with indices integration"""
    print(f"🎯 Testing Trading Decision for {symbol}...")
    
    try:
        response = requests.get(
            f"{BASE_URL}/api/analysis/trading-decision/{symbol}",
            timeout=30
        )
        response.raise_for_status()
        
        data = response.json()
        
        print(f"✓ Status: {response.status_code}")
        print(f"✓ Timestamp: {data.get('timestamp')}")
        print(f"✓ Market Status: {data.get('market_status')}")
        
        # 14-Signal Analysis
        signal_analysis = data.get('14_signal_analysis', {})
        print(f"\n📊 14-SIGNAL ANALYSIS:")
        print(f"   Overall Signal: {signal_analysis.get('overall_signal')}")
        print(f"   Confidence: {signal_analysis.get('overall_confidence')}%")
        print(f"   Bullish Signals: {signal_analysis.get('bullish_signals')}/14")
        print(f"   Bearish Signals: {signal_analysis.get('bearish_signals')}/14")
        print(f"   Signal Agreement: {signal_analysis.get('signal_agreement_percent')}%")
        
        # Market Indices
        indices = data.get('market_indices', {})
        print(f"\n📈 MARKET INDICES:")
        
        pcr = indices.get('pcr', {})
        print(f"   PCR (Put-Call Ratio):")
        print(f"      Value: {pcr.get('pcr_value')}")
        print(f"      Sentiment: {pcr.get('sentiment')}")
        print(f"      Action: {pcr.get('action')}")
        
        breadth = indices.get('market_breadth', {})
        print(f"   Market Breadth:")
        print(f"      A/D Ratio: {breadth.get('ad_ratio')}")
        print(f"      Signal: {breadth.get('breadth_signal')}")
        print(f"      Advance: {breadth.get('advance_percent')}%")
        
        print(f"   Volatility: {indices.get('volatility')}")
        
        # Score Components
        scores = data.get('score_components', {})
        print(f"\n⚙️  SCORE CALCULATION:")
        print(f"   Base Score: {scores.get('base_score')}")
        print(f"   PCR Adjustment: {scores.get('pcr_adjustment'):+.1f}")
        print(f"   OI Adjustment: {scores.get('oi_adjustment'):+.1f}")
        print(f"   Volatility Adjustment: {scores.get('volatility_adjustment'):+.1f}")
        print(f"   Breadth Adjustment: {scores.get('breadth_adjustment'):+.1f}")
        print(f"   ─────────────────────")
        print(f"   FINAL SCORE: {scores.get('final_score')}")
        
        # Trading Decision
        decision = data.get('trading_decision', {})
        print(f"\n🎯 TRADING DECISION:")
        print(f"   Action: {decision.get('action')}")
        print(f"   Confidence: {decision.get('confidence')}%")
        print(f"   Description: {decision.get('description')}")
        print(f"   Risk Level: {decision.get('risk_level')}")
        
        # Trader Actions
        actions = data.get('trader_actions', {})
        print(f"\n💼 TRADER ACTIONS:")
        print(f"   Entry Setup: {actions.get('entry_setup')}")
        print(f"   Position Management: {actions.get('position_management')}")
        print(f"   Risk Management: {actions.get('risk_management')}")
        print(f"   Time Frame: {actions.get('time_frame_preference')}")
        
        # Monitor
        monitor = data.get('monitor', {})
        print(f"\n📍 MONITORING:")
        print(f"   Key Levels: {monitor.get('key_levels_to_watch')}")
        print(f"   Confirmation: {', '.join(monitor.get('confirmation_signals', []))}")
        print(f"   Exit Trigger: {monitor.get('exit_trigger')}")
        print(f"   Next Check: {monitor.get('next_check_minutes')} minutes")
        
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
    """Test trading decision for all symbols"""
    print_header("🔥 14-SIGNALS + LIVE INDICES = TRADING DECISIONS TEST")
    print(f"⏰ Test Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"🔌 Backend URL: {BASE_URL}")
    print(f"📊 Testing Symbols: {', '.join(SYMBOLS)}")
    
    results = {}
    
    for symbol in SYMBOLS:
        success, data = test_trading_decision(symbol)
        results[symbol] = {
            'success': success,
            'data': data
        }
        time.sleep(1)  # Small delay between requests
    
    # Summary
    print_header("🎯 TEST SUMMARY")
    
    success_count = sum(1 for r in results.values() if r['success'])
    print(f"✓ Successful tests: {success_count}/{len(SYMBOLS)}")
    
    if success_count == len(SYMBOLS):
        print("\n✅ ALL TESTS PASSED")
        print("\n🎯 Trading Decisions Comparison:")
        print(f"{'-'*80}")
        print(f"{'Symbol':<15} {'Decision':<20} {'Confidence':<15} {'Status'}")
        print(f"{'-'*80}")
        
        for symbol in SYMBOLS:
            data = results[symbol]['data']
            if data:
                decision_data = data.get('trading_decision', {})
                symbol_name = symbol
                action = decision_data.get('action', 'N/A')
                confidence = decision_data.get('confidence', 0)
                status = data.get('market_status', 'N/A')
                print(f"{symbol_name:<15} {action:<20} {confidence:<15}% {status}")
    else:
        print(f"\n⚠️  Some tests failed")
    
    # Save results to file
    with open('test_trading_decision_results.json', 'w') as f:
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
    
    print(f"\n💾 Results saved to test_trading_decision_results.json")
    print_header("END OF TEST")

if __name__ == "__main__":
    test_all_symbols()
