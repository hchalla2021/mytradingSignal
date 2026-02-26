#!/usr/bin/env python3
"""Test WebSocket snapshot delivery"""

import asyncio
import websockets
import json

async def test_websocket():
    uri = "ws://localhost:8000/ws/market"
    print(f"\n🔌 Connecting to {uri}...")
    
    try:
        async with websockets.connect(uri, ping_interval=20) as websocket:
            print("✅ Connected!")
            
            # Wait for messages up to 5 seconds
            timeout = 5
            start_time = asyncio.get_event_loop().time()
            
            while asyncio.get_event_loop().time() - start_time < timeout:
                try:
                    message = await asyncio.wait_for(
                        websocket.recv(),
                        timeout=1
                    )
                    data = json.loads(message)
                    msg_type = data.get("type", "unknown")
                    
                    if msg_type == "snapshot":
                        print(f"\n📸 SNAPSHOT Received!")
                        symbols = list(data.get("data", {}).keys())
                        print(f"   Symbols: {symbols}")
                        for sym, info in data.get("data", {}).items():
                            price = info.get("price", 0)
                            change = info.get("changePercent", 0)
                            print(f"   - {sym}: ₹{price:.2f} ({change:+.2f}%)")
                        return True
                    
                    elif msg_type == "connection_status":
                        mode = data.get("mode")
                        quality = data.get("quality")
                        message_text = data.get("message")
                        print(f"📡 Connection Status: {mode} ({quality})")
                        print(f"   {message_text}")
                    
                    else:
                        print(f"📨 {msg_type}: {list(data.keys())}")
                        
                except asyncio.TimeoutError:
                    pass
            
            print(f"❌ No snapshot received after {timeout}s")
            return False
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    success = asyncio.run(test_websocket())
    exit(0 if success else 1)
