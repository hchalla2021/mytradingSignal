"""
Quick test to check market feed status
"""
import requests
import json
from datetime import datetime

def test_market_feed():
    """Test if market feed is broadcasting"""
    
    print("🔍 Testing Market Feed Status...")
    print(f"Time: {datetime.now().isoformat()}\n")
    
    # Test 1: Backend health
    print("1️⃣  Testing Backend Health...")
    try:
        r = requests.get("http://localhost:8000/health", timeout=5)
        print(f"✅ Backend responding: {r.status_code}")
    except Exception as e:
        print(f"❌ Backend not responding: {e}")
        return
    
    # Test 2: Market status endpoint
    print("\n2️⃣  Testing Market Status...")
    try:
        r = requests.get("http://localhost:8000/api/market-status", timeout=5)
        if r.status_code == 200:
            data = r.json()
            print(f"✅ Market Status: {json.dumps(data, indent=2)}")
        else:
            print(f"⚠️  No status endpoint ({r.status_code})")
    except Exception as e:
        print(f"⚠️  Status check failed: {e}")
    
    # Test 3: Smart Money API (real data)
    print("\n3️⃣  Testing Smart Money REST API...")
    for symbol in ["NIFTY", "BANKNIFTY", "SENSEX"]:
        try:
            r = requests.get(f"http://localhost:8000/api/advanced/smart-money-flow/{symbol}", timeout=10)
            if r.status_code == 200:
                data = r.json()
                signal = data.get("smart_money_signal", "N/A")
                confidence = data.get("smart_money_confidence", 0)
                print(f"✅ {symbol}: {signal} ({confidence}% confidence)")
            else:
                print(f"❌ {symbol}: Failed ({r.status_code})")
        except Exception as e:
            print(f"❌ {symbol}: {e}")
    
    # Test 4: WebSocket directly
    print("\n4️⃣  Testing WebSocket Connection...")
    try:
        import websockets
        import asyncio
        
        async def test_ws():
            uri = "ws://localhost:8000/ws/market"
            try:
                async with websockets.connect(uri, ping_interval=None, timeout=5) as ws:
                    print(f"✅ WebSocket connected to {uri}")
                    
                    # Try to receive one message
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=3)
                        data = json.loads(msg)
                        print(f"✅ Received message: {data.get('type', 'unknown')}")
                        if data.get('type') == 'tick':
                            print(f"   Symbol: {data['data'].get('symbol')}")
                            if 'orderFlow' in data['data']:
                                print(f"   ✅ Order Flow Data Present!")
                    except asyncio.TimeoutError:
                        print(f"⏱️  No message received within 3 seconds")
                        
            except Exception as e:
                print(f"❌ WebSocket error: {e}")
        
        asyncio.run(test_ws())
        
    except ImportError:
        print("⚠️  websockets library not installed")
    except Exception as e:
        print(f"❌ WebSocket test error: {e}")
    
    print("\n" + "="*60)
    print("Analysis Complete")

if __name__ == "__main__":
    test_market_feed()
