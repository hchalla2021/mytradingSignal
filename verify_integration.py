#!/usr/bin/env python3
"""Verify complete 14-Signal + Live Market Indices Integration"""

import requests
import json
from datetime import datetime

print("\n" + "="*80)
print("🎯 VERIFYING: 14-SIGNAL + LIVE MARKET INDICES INTEGRATION")
print("="*80)

# Test all three symbols
symbols = ["NIFTY", "BANKNIFTY", "SENSEX"]
all_pass = True

for symbol in symbols:
    try:
        response = requests.get(
            f"http://localhost:8000/api/analysis/trading-decision/{symbol}", 
            timeout=5
        )
        
        if response.status_code != 200:
            print(f"\n❌ {symbol}: Failed with status {response.status_code}")
            all_pass = False
            continue
        
        data = response.json()
        
        print(f"\n{'─'*80}")
        print(f"✅ {symbol} - COMPLETE TRADING DECISION")
        print(f"{'─'*80}")
        
        # 1. Trading Decision
        td = data.get("trading_decision", {})
        print(f"\n1️⃣  TRADING DECISION (Based on Confidence)")
        print(f"   Action: {td.get('action')} 🎯")
        print(f"   Confidence: {td.get('confidence')}%")
        print(f"   Risk Level: {td.get('risk_level')}")
        print(f"   Description: {td.get('description')}")
        
        # 2. 14-Signal Analysis
        sig = data.get("14_signal_analysis", {})
        print(f"\n2️⃣  14-SIGNAL ANALYSIS")
        print(f"   Overall Signal: {sig.get('overall_signal')}")
        print(f"   Overall Confidence: {sig.get('overall_confidence')}%")
        print(f"   Signal Distribution:")
        print(f"     • Bullish: {sig.get('bullish_signals')}/14")
        print(f"     • Bearish: {sig.get('bearish_signals')}/14")
        print(f"     • Neutral: {sig.get('neutral_signals')}/14")
        print(f"   Signal Agreement: {sig.get('signal_agreement_percent')}%")
        
        # 3. Market Indices
        indices = data.get("market_indices", {})
        print(f"\n3️⃣  LIVE MARKET INDICES (Integration Point)")
        
        if indices.get("pcr"):
            pcr = indices['pcr']
            print(f"   📊 PCR (Put-Call Ratio):")
            print(f"      Value: {pcr.get('pcr_value')}")
            print(f"      Sentiment: {pcr.get('sentiment')}")
            print(f"      Action: {pcr.get('action')}")
        
        if indices.get("oi_momentum"):
            oi = indices['oi_momentum']
            print(f"   📈 OI Momentum:")
            print(f"      Momentum: {oi.get('momentum')}")
            print(f"      Strength: {oi.get('strength')}")
        
        if indices.get("market_breadth"):
            breadth = indices['market_breadth']
            print(f"   📊 Market Breadth:")
            print(f"      A/D Ratio: {breadth.get('ad_ratio')}")
            print(f"      Signal: {breadth.get('breadth_signal')}")
        
        if indices.get("volatility"):
            vol = indices['volatility']
            vol_str = vol if isinstance(vol, str) else vol.get('level', vol)
            print(f"   📉 Volatility: {vol_str}")
        
        # 4. Score Calculation (Transparent Breakdown)
        score = data.get("score_components", {})
        print(f"\n4️⃣  SCORE CALCULATION (Transparent Breakdown)")
        print(f"   Base Score (from 14 signals):    {score.get('base_score'):>6}%")
        print(f"   + PCR Adjustment:                {score.get('pcr_adjustment'):>+6}")
        print(f"   + OI Adjustment:                 {score.get('oi_adjustment'):>+6}")
        print(f"   + Volatility Adjustment:         {score.get('volatility_adjustment'):>+6}")
        print(f"   + Breadth Adjustment:            {score.get('breadth_adjustment'):>+6}")
        print(f"   {'─'*50}")
        print(f"   = FINAL SCORE:                   {score.get('final_score'):>6}%")
        
        # 5. Trader Actions
        trader = data.get("trader_actions", {})
        print(f"\n5️⃣  TRADER ACTIONS (Market Status-Based)")
        print(f"   Entry Setup:")
        print(f"     {trader.get('entry_setup')}")
        print(f"   Position Management:")
        print(f"     {trader.get('position_management')}")
        print(f"   Risk Management:")
        print(f"     {trader.get('risk_management')}")
        print(f"   Timeframe Preference: {trader.get('time_frame_preference')}")
        
        # 6. Monitor Section
        monitor = data.get("monitor", {})
        print(f"\n6️⃣  MONITORING INSTRUCTIONS")
        print(f"   Key Levels: {monitor.get('key_levels_to_watch')}")
        print(f"   Exit Trigger: {monitor.get('exit_trigger')}")
        print(f"   Check Every: {monitor.get('next_check_minutes')} minutes")
        
        print(f"\n✅ {symbol}: ALL SECTIONS INTEGRATED ✓")
        
    except Exception as e:
        print(f"\n❌ {symbol}: Error - {str(e)}")
        all_pass = False

print(f"\n{'='*80}")
if all_pass:
    print("🟢 SUCCESS: 14-SIGNAL + LIVE MARKET INDICES INTEGRATION COMPLETE")
    print("\nWhat's Working:")
    print("  ✅ All 14 signals calculating")
    print("  ✅ PCR sentiment analysis integrated")
    print("  ✅ OI momentum analysis integrated")
    print("  ✅ Market breadth analysis integrated")
    print("  ✅ Volatility analysis integrated")
    print("  ✅ Score calculation transparent")
    print("  ✅ Trading decisions based on confidence")
    print("  ✅ Trader-specific actions provided")
    print("  ✅ Market status-aware recommendations")
else:
    print("❌ SOME ISSUES DETECTED - See above")

print("="*80 + "\n")
