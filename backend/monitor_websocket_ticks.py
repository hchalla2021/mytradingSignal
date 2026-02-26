#!/usr/bin/env python3
"""
🔌 WebSocket Tick Monitoring
Simulates what the frontend app receives via WebSocket
Shows if ticks are being broadcast to clients
"""

import asyncio
import json
import websockets
import sys
from datetime import datetime
import pytz

IST = pytz.timezone('Asia/Kolkata')

async def monitor_websocket():
    """Monitor WebSocket for ticks"""
    
    print("\n" + "="*80)
    print("🔌 WEBSOCKET TICK MONITOR (Simulates Frontend App)")
    print("="*80)
    print(f"Connecting to ws://localhost:8000/ws/market\n")
    
    tick_count = 0
    start_time = None
    
    try:
        async with websockets.connect("ws://localhost:8000/ws/market") as websocket:
            print(f"✅ Connected to WebSocket\n")
            
            # Receive initial snapshot
            print("📥 Waiting for initial snapshot...")
            message = await asyncio.wait_for(websocket.recv(), timeout=10)
            data = json.loads(message)
            
            if data.get("type") == "snapshot":
                print(f"✅ Received snapshot:")
                snapshot_data = data.get("data", {})
                for symbol, market_data in snapshot_data.items():
                    if market_data:
                        price = market_data.get("price", 0)
                        change_pct = market_data.get("changePercent", 0)
                        timestamp = market_data.get("timestamp", "")
                        print(f"   {symbol}: ₹{price:,.2f} ({change_pct:+.2f}%) - {timestamp[:19]}")
                print()
            
            # Monitor for ticks
            start_time = datetime.now(IST)
            print(f"🔄 Monitoring for tick updates (will timeout after 30 seconds)...\n")
            
            last_prices = {}
            while True:
                try:
                    # Wait for message with 1 second timeout
                    message = await asyncio.wait_for(websocket.recv(), timeout=1)
                    data = json.loads(message)
                    
                    msg_type = data.get("type")
                    
                    if msg_type == "tick":
                        tick_count += 1
                        tick_data = data.get("data", {})
                        symbol = tick_data.get("symbol")
                        price = tick_data.get("price")
                        change = tick_data.get("change")
                        oi = tick_data.get("oi")
                        
                        # Check if price changed
                        prev_price = last_prices.get(symbol, price)
                        price_changed = prev_price != price
                        
                        print(f"✅ TICK #{tick_count}: {symbol} ₹{price:,.2f} (change: {change:+.2f}, OI: {oi:,}) {'[PRICE CHANGED]' if price_changed else ''}")
                        last_prices[symbol] = price
                    
                    elif msg_type == "heartbeat":
                        # Print heartbeat less frequently
                        connections = data.get("connections", 0)
                        market_status = data.get("marketStatus", "?")
                        last_tick_age = data.get("connectionHealth", {}).get("last_tick_seconds_ago")
                        print(f"💓 HEARTBEAT: status={market_status}, connections={connections}, last_tick={last_tick_age}s ago")
                    
                    elif msg_type == "snapshot":
                        print(f"📷 Snapshot received")
                    
                    elif msg_type == "connection_status":
                        print(f"ℹ️  {data.get('message')}")
                    
                    else:
                        print(f"📨 Message: {msg_type}")
                    
                    # Check elapsed time
                    elapsed = (datetime.now(IST) - start_time).total_seconds()
                    if elapsed > 30:
                        print(f"\n⏱️  Monitoring period completed (30 seconds)")
                        break
                
                except asyncio.TimeoutError:
                    # Check if we've been waiting long enough
                    elapsed = (datetime.now(IST) - start_time).total_seconds()
                    if elapsed > 30:
                        print(f"\n⏱️  Monitoring period completed (30 seconds)")
                        break
                    # Otherwise just keep waiting
                
                except json.JSONDecodeError:
                    print(f"⚠️  Could not parse message: {message[:100]}")
        
        # Summary
        print("\n" + "="*80)
        print(f"📊 SUMMARY")
        print("="*80)
        elapsed = (datetime.now(IST) - start_time).total_seconds()
        print(f"✅ Ticks received: {tick_count}")
        print(f"⏱️  Elapsed time: {elapsed:.1f} seconds")
        
        if tick_count == 0:
            print(f"\n❌ NO TICKS RECEIVED!")
            print(f"   This explains why the app shows ₹0.00")
            print(f"   Problem: WebSocket connected but market feed not sending ticks\n")
            print(f"   🔧 FIX: Run: python reconnect_market_feed.py\n")
        else:
            ticks_per_sec = tick_count / elapsed
            print(f"📈 Tick rate: {ticks_per_sec:.1f} ticks/second")
            print(f"\n✅ Ticks ARE flowing to the app!")
            print(f"   If app still shows ₹0.00, check:")
            print(f"   1. Browser not showing WebSocket messages")
            print(f"   2. Frontend needs refresh")
            print(f"   3. JavaScript WebSocket handler has an error\n")
        
        print("="*80 + "\n")
        
    except asyncio.TimeoutError:
        print(f"❌ Failed to connect to WebSocket (timeout)")
        print(f"   Backend may not be running or WebSocket not available\n")
    
    except Exception as e:
        print(f"❌ WebSocket error: {e}\n")
        import traceback
        traceback.print_exc()


async def main():
    await monitor_websocket()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n🛑 Stopped by user")
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
