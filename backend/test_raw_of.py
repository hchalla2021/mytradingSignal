"""Dump raw orderFlow fiveMinPrediction from running server."""
import asyncio, json, websockets

async def test():
    async with websockets.connect("ws://localhost:8000/ws/market", ping_interval=None) as ws:
        for i in range(5):
            msg = await asyncio.wait_for(ws.recv(), timeout=15)
            data = json.loads(msg)
            if data.get("type") == "tick":
                of = data["data"].get("orderFlow", {})
                pred = of.get("fiveMinPrediction", "MISSING")
                print(f"fiveMinPrediction: {json.dumps(pred, indent=2)}")
                # Also check other keys
                print(f"signal: {of.get('signal')}")
                print(f"signalConfidence: {of.get('signalConfidence')}")
                break

asyncio.run(test())
