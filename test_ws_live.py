#!/usr/bin/env python3
"""Test WebSocket connection"""
import asyncio
import websockets
import json

async def test():
    try:
        print("Connecting to ws://127.0.0.1:8000/ws/market...")
        async with websockets.connect('ws://127.0.0.1:8000/ws/market', ping_interval=None, close_timeout=5) as ws:
            print("✅ Connected to WebSocket!")
            for i in range(5):
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=3)
                    data = json.loads(msg)
                    msg_type = data.get('type', 'unknown')
                    print(f"  [{i+1}] Type: {msg_type}")
                except asyncio.TimeoutError:
                    print(f"  [{i+1}] Timeout waiting for message")
                    break
    except Exception as e:
        print(f"❌ Error: {type(e).__name__}: {e}")

asyncio.run(test())
