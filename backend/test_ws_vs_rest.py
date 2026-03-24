import asyncio
import json
import httpx
import websockets

async def test_ws_vs_rest():
    ws_ticks = {"BANKNIFTY": [], "SENSEX": []}
    rest_data = {}
    fields = ["symbol", "totalBidQty", "totalAskQty", "signal", "delta", "buyerAggressionRatio"]

    # --- Task 1: WebSocket ---
    async def ws_task():
        uri = "ws://localhost:8000/ws/market"
        print(f"[WS] Connecting to {uri}...")
        try:
            async with websockets.connect(uri, ping_interval=None) as ws:
                print("[WS] Connected!")
                count = 0
                while count < 15:
                    msg = await asyncio.wait_for(ws.recv(), timeout=30)
                    data = json.loads(msg)
                    msg_type = data.get("type")
                    if msg_type == "tick":
                        td = data.get("data", {})
                        sym = td.get("symbol", "")
                        count += 1
                        row = {f: td.get(f) for f in fields}
                        print(f"[WS] Msg#{count:02d} type=tick symbol={sym} "
                              f"totalBidQty={td.get('totalBidQty')} totalAskQty={td.get('totalAskQty')} "
                              f"signal={td.get('signal')} delta={td.get('delta')} "
                              f"buyerAggressionRatio={td.get('buyerAggressionRatio')}")
                        if sym in ws_ticks:
                            ws_ticks[sym].append(row)
                    elif msg_type == "snapshot":
                        snap = data.get("data", {})
                        print(f"[WS] Msg snapshot: symbols={list(snap.keys())}")
                        for sym in ["BANKNIFTY", "SENSEX"]:
                            if sym in snap:
                                sd = snap[sym]
                                row = {f: sd.get(f) for f in fields}
                                ws_ticks[sym].append(row)
                                print(f"  [WS-snap] {sym}: totalBidQty={sd.get('totalBidQty')} "
                                      f"totalAskQty={sd.get('totalAskQty')} signal={sd.get('signal')} "
                                      f"delta={sd.get('delta')} buyerAggressionRatio={sd.get('buyerAggressionRatio')}")
                        count += 1
        except Exception as e:
            print(f"[WS] Error: {type(e).__name__}: {e}")

    # --- Task 2: REST ---
    async def rest_task():
        url = "http://localhost:8000/api/advanced/smart-money-flow/BANKNIFTY"
        print(f"[REST] Calling {url} ...")
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url)
                rest_data["BANKNIFTY"] = resp.json()
                print(f"[REST] Status: {resp.status_code}")
                print(f"[REST] Response: {json.dumps(rest_data['BANKNIFTY'], indent=2)}")
        except Exception as e:
            print(f"[REST] Error: {type(e).__name__}: {e}")

    await asyncio.gather(ws_task(), rest_task())

    # --- COMPARISON ---
    print("\n" + "=" * 80)
    print("COMPARISON: WebSocket ticks vs REST API")
    print("=" * 80)

    for sym in ["BANKNIFTY", "SENSEX"]:
        ticks = ws_ticks.get(sym, [])
        print(f"\n--- {sym} WebSocket ticks ({len(ticks)} captured) ---")
        for i, t in enumerate(ticks):
            print(f"  Tick#{i+1}: totalBidQty={t.get('totalBidQty'):<12} totalAskQty={t.get('totalAskQty'):<12} "
                  f"signal={str(t.get('signal')):<10} delta={str(t.get('delta')):<12} "
                  f"buyerAggressionRatio={t.get('buyerAggressionRatio')}")

        # Check if values are CHANGING
        if len(ticks) >= 2:
            vals = [str(t.get('totalBidQty')) for t in ticks]
            unique = set(vals)
            if len(unique) > 1:
                print(f"  => totalBidQty CHANGED across ticks: {unique}")
            else:
                print(f"  => totalBidQty was STATIC: {unique}")
            vals_d = [str(t.get('delta')) for t in ticks]
            unique_d = set(vals_d)
            if len(unique_d) > 1:
                print(f"  => delta CHANGED across ticks: {unique_d}")
            else:
                print(f"  => delta was STATIC: {unique_d}")

    print(f"\n--- REST /api/advanced/smart-money-flow/BANKNIFTY ---")
    rd = rest_data.get("BANKNIFTY", {})
    if rd:
        for k, v in rd.items():
            print(f"  {k}: {v}")
    else:
        print("  (no data)")

    print("\n" + "=" * 80)
    print("VERDICT:")
    bn_ticks = ws_ticks.get("BANKNIFTY", [])
    if bn_ticks:
        ws_bid = bn_ticks[-1].get("totalBidQty")
        ws_ask = bn_ticks[-1].get("totalAskQty")
        rest_bid = rd.get("totalBidQty") or rd.get("total_bid_qty")
        rest_ask = rd.get("totalAskQty") or rd.get("total_ask_qty")
        print(f"  WS  last BANKNIFTY: totalBidQty={ws_bid}, totalAskQty={ws_ask}")
        print(f"  REST     BANKNIFTY: totalBidQty={rest_bid}, totalAskQty={rest_ask}")
        if ws_bid != rest_bid or ws_ask != rest_ask:
            print("  => Values DIFFER between WS and REST!")
        else:
            print("  => Values are the SAME between WS and REST.")
    print("=" * 80)

asyncio.run(test_ws_vs_rest())
