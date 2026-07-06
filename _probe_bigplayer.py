"""Probe: watch live /ws/market ticks — does volume/oi ever change for indices?"""
import asyncio
import json
import time

import websockets

SYMS = ("NIFTY", "BANKNIFTY", "SENSEX")


async def main():
    seen = {}
    changes = {s: 0 for s in SYMS}
    ticks = {s: 0 for s in SYMS}
    try:
        async with websockets.connect("ws://localhost:8000/ws/market", open_timeout=8) as ws:
            t0 = time.time()
            while time.time() - t0 < 30:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=5)
                except asyncio.TimeoutError:
                    continue
                m = json.loads(raw)
                if m.get("type") == "snapshot":
                    for sym, d in (m.get("data") or {}).items():
                        if sym in SYMS:
                            print(f"SNAP {sym}: price={d.get('price')} vol={d.get('volume')} oi={d.get('oi')} status={d.get('status')}")
                elif m.get("type") == "tick":
                    d = m.get("data") or {}
                    sym = d.get("symbol")
                    if sym in SYMS:
                        ticks[sym] += 1
                        prev = seen.get(sym)
                        cur = (d.get("volume"), d.get("oi"))
                        if prev is not None and cur != prev:
                            changes[sym] += 1
                            print(f"CHANGE {sym}: vol {prev[0]} -> {cur[0]} | oi {prev[1]} -> {cur[1]}")
                        seen[sym] = cur
        print("\n--- 30s summary ---")
        for s in SYMS:
            last = seen.get(s)
            print(f"{s}: ticks={ticks[s]} vol/oi-changes={changes[s]} last vol={last[0] if last else None} oi={last[1] if last else None}")
    except Exception as e:  # noqa: BLE001
        print("WS ERROR:", type(e).__name__, e)


asyncio.run(main())
