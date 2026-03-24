import asyncio, json, websockets

async def test():
    uri = "ws://localhost:8000/ws/market"
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri, ping_interval=None) as ws:
            print("Connected!")
            preds = []
            for i in range(15):
                msg = await asyncio.wait_for(ws.recv(), timeout=10)
                data = json.loads(msg)
                if data.get("type") == "tick":
                    td = data.get("data", {})
                    sym = td.get("symbol", "?")
                    of = td.get("orderFlow", {})
                    pred = of.get("fiveMinPrediction", {}) if of else {}
                    if pred and sym == "NIFTY":
                        dir_ = pred.get("direction", "N/A")
                        conf = pred.get("confidence", 0)
                        buy = pred.get("buyDominancePct", 0)
                        sell = pred.get("sellDominancePct", 0)
                        reason = pred.get("reasoning", "")
                        ticks = pred.get("tickCount", 0)
                        avg_d = pred.get("avgDelta", 0)
                        preds.append((dir_, conf, buy, sell))
                        print(f"Tick {i+1}: NIFTY 5min={dir_} conf={conf:.0%} buy={buy:.1f}% sell={sell:.1f}% delta={avg_d:.0f} ticks={ticks}")
                        print(f"  Reason: {reason}")
                elif data.get("type") == "snapshot":
                    snap = data.get("data", {})
                    for sym in ["NIFTY", "BANKNIFTY", "SENSEX"]:
                        of = snap.get(sym, {}).get("orderFlow", {})
                        pred = of.get("fiveMinPrediction", {}) if of else {}
                        if pred:
                            d = pred.get("direction")
                            c = pred.get("confidence", 0)
                            b = pred.get("buyDominancePct", 0)
                            s = pred.get("sellDominancePct", 0)
                            r = pred.get("reasoning", "")
                            print(f"Snapshot {sym}: dir={d} conf={c:.0%} buy={b:.1f}% sell={s:.1f}%")
                            print(f"  Reason: {r}")
            
            # Check if values changed
            if len(preds) >= 2:
                buys = set(round(p[2], 1) for p in preds)
                sells = set(round(p[3], 1) for p in preds)
                dirs = set(p[0] for p in preds)
                confs = set(p[1] for p in preds)
                print(f"\nDirections seen: {sorted(dirs)}")
                print(f"Confidence seen: {sorted(confs)}")
                print(f"Buy% values seen: {sorted(buys)}")
                print(f"Sell% values seen: {sorted(sells)}")
                if len(buys) > 1 or len(sells) > 1:
                    print("✅ Values ARE changing!")
                else:
                    print("⚠️ Values are STATIC across these ticks")
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")

asyncio.run(test())
