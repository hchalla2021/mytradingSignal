"""Quick WS diagnostics: /ws/market and /ws/smc frame check."""
import asyncio
import json
import sys

sys.path.insert(0, "backend")


async def probe(path: str, wait: float = 6.0) -> None:
    import websockets
    url = f"ws://localhost:8000{path}"
    try:
        async with websockets.connect(url, open_timeout=5) as ws:
            got = 0
            try:
                while got < 3:
                    raw = await asyncio.wait_for(ws.recv(), timeout=wait)
                    msg = json.loads(raw)
                    mtype = msg.get("type")
                    data = msg.get("data") or {}
                    syms = list(data.keys()) if isinstance(data, dict) else "n/a"
                    print(f"[{path}] frame {got + 1}: type={mtype} keys={syms}")
                    if mtype in ("smc_update", "smc_snapshot") and isinstance(data, dict):
                        for s, row in data.items():
                            print(f"    {s}: {row.get('verdict')} conf={row.get('confidence')} "
                                  f"price={(row.get('metrics') or {}).get('price')} src={row.get('dataSource')}")
                    got += 1
            except asyncio.TimeoutError:
                print(f"[{path}] TIMEOUT after {got} frames (no data in {wait}s)")
    except Exception as e:
        print(f"[{path}] CONNECT FAILED: {type(e).__name__}: {e}")


async def main():
    await probe("/ws/smc")
    await probe("/ws/market")

asyncio.run(main())
