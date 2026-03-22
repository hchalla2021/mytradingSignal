#!/usr/bin/env python3
"""
🔥 Order Flow WebSocket Quick Test
Tests if order flow data is flowing through the WebSocket correctly
"""

import asyncio
import json
import sys
from typing import Optional

try:
    import websockets
except ImportError:
    print("❌ websockets not installed. Installing...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websockets"])
    import websockets


class OrderFlowTester:
    """Test order flow WebSocket connection and data"""
    
    def __init__(self, host: str = "localhost", port: int = 8000):
        self.uri = f"ws://{host}:{port}/ws/market"
        self.tick_count = 0
        self.order_flow_received = False
        
    async def run_test(self, timeout: int = 30):
        """Run the WebSocket test"""
        print(f"🔌 Testing WebSocket connection to: {self.uri}")
        print(f"⏱️  Timeout: {timeout} seconds\n")
        
        try:
            async with websockets.connect(self.uri, ping_interval=None) as websocket:
                print("✅ Connected to WebSocket!\n")
                print("Waiting for order flow data...\n")
                print("-" * 60)
                
                # Set up timeout for receiving data
                start_time = asyncio.get_event_loop().time()
                
                while True:
                    try:
                        # Wait with timeout
                        elapsed = asyncio.get_event_loop().time() - start_time
                        remaining_timeout = timeout - elapsed
                        
                        if remaining_timeout <= 0:
                            print("\n❌ Timeout: No data received within {} seconds".format(timeout))
                            break
                            
                        message = await asyncio.wait_for(
                            websocket.recv(),
                            timeout=remaining_timeout
                        )
                        
                        self._process_message(message)
                        
                        # Stop after receiving 3 complete sets of data
                        if self.tick_count >= 15:
                            break
                            
                    except asyncio.TimeoutError:
                        print("\n⏱️  Timeout reached")
                        break
                    except Exception as e:
                        print(f"\n❌ Error receiving message: {e}")
                        break
                        
        except ConnectionRefusedError:
            print(f"❌ Connection refused. Backend not running at {self.uri}")
            print("   💡 Start backend with:")
            print("      cd backend")
            print("      python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000")
            return False
            
        except Exception as e:
            print(f"❌ Connection error: {e}")
            return False
        
        print("\n" + "-" * 60)
        return self.order_flow_received
    
    def _process_message(self, message: str):
        """Process WebSocket message"""
        try:
            data = json.loads(message)
            
            if data.get('type') != 'tick':
                return
            
            tick = data.get('data', {})
            order_flow = tick.get('orderFlow')
            
            if not order_flow:
                # print("⚠️  Tick received but NO order flow data")
                return
            
            self.tick_count += 1
            self.order_flow_received = True
            
            symbol = order_flow.get('symbol', 'UNKNOWN')
            signal = order_flow.get('signal', 'UNKNOWN')
            confidence = order_flow.get('signalConfidence', 0) * 100
            delta = order_flow.get('delta', 0)
            bid = order_flow.get('bid', 0)
            ask = order_flow.get('ask', 0)
            spread = order_flow.get('spread', 0)
            
            # Color codes
            if signal == 'STRONG_BUY':
                color = "🟢"
            elif signal == 'BUY':
                color = "🟢"
            elif signal == 'STRONG_SELL':
                color = "🔴"
            elif signal == 'SELL':
                color = "🔴"
            else:
                color = "🟡"
            
            print(f"\n✅ Tick #{self.tick_count}")
            print(f"   Symbol:     {symbol}")
            print(f"   Signal:     {color} {signal} ({confidence:.1f}% confidence)")
            print(f"   Price:      ${bid:.2f} / ${ask:.2f} (Spread: ₹{spread:.3f})")
            print(f"   Delta:      {delta:+.0f} {'🔥' if abs(delta) > 1000 else ''}")
            
            # Order flow details
            bid_qty = order_flow.get('totalBidQty', 0)
            ask_qty = order_flow.get('totalAskQty', 0)
            
            if bid_qty > 0 or ask_qty > 0:
                total = bid_qty + ask_qty
                bid_pct = (bid_qty / total * 100) if total > 0 else 0
                ask_pct = (ask_qty / total * 100) if total > 0 else 0
                
                print(f"   Order Flow: Buyers {bid_pct:.1f}% | Sellers {ask_pct:.1f}%")
            
            # Prediction
            prediction = order_flow.get('fiveMinPrediction', {})
            if prediction:
                pred_direction = prediction.get('direction', 'UNKNOWN')
                pred_confidence = prediction.get('confidence', 0) * 100
                print(f"   5-Min Pred: {pred_direction} ({pred_confidence:.1f}%)")
                
        except json.JSONDecodeError:
            print(f"⚠️  Invalid JSON: {message[:100]}")
        except Exception as e:
            print(f"⚠️  Error processing message: {e}")


async def main():
    """Main test function"""
    print("=" * 60)
    print("🔥 ORDER FLOW WEBSOCKET QUICK TEST")
    print("=" * 60)
    print()
    
    tester = OrderFlowTester()
    success = await tester.run_test(timeout=30)
    
    print()
    if success:
        print("✅ ORDER FLOW SYSTEM IS WORKING!")
        print()
        print("Summary:")
        print(f"   ✅ WebSocket connected")
        print(f"   ✅ Backend is running")
        print(f"   ✅ Order flow data received: {tester.tick_count} ticks")
        print(f"   ✅ Frontend should show live data now")
        print()
        print("Next step: Open http://localhost:3000 in browser")
        return 0
    else:
        print("❌ ORDER FLOW SYSTEM NOT WORKING")
        print()
        print("Troubleshooting:")
        if tester.tick_count == 0:
            print("   1. Is backend running?")
            print("      cd backend")
            print("      python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000")
            print()
            print("   2. Is Zerodha connected?")
            print("      python test_market_status_direct.py")
            print()
            print("   3. Check for errors in backend terminal")
        else:
            print(f"   Received {tester.tick_count} ticks but NO order flow data")
            print("   - Order flow analyzer may have an error")
            print("   - Check backend logs for: 'Error in order flow processing'")
        return 1


if __name__ == '__main__':
    try:
        exit_code = asyncio.run(main())
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print("\n\n⚠️  Test interrupted by user")
        sys.exit(1)
