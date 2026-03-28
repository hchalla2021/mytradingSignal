import asyncio, json, websockets

async def test():
    async with websockets.connect("ws://localhost:8000/ws/market") as ws:
        for i in range(4):
            msg = await asyncio.wait_for(ws.recv(), timeout=10)
            data = json.loads(msg)
            if data.get("type") == "snapshot":
                for sym, d in data.get("data", {}).items():
                    if d:
                        print(f"\n=== {sym} ===")
                        print(f"  price={d.get('price')}, open={d.get('open')}, high={d.get('high')}, low={d.get('low')}, close={d.get('close')}")
                        print(f"  prev_day_high={d.get('prev_day_high')}, prev_day_low={d.get('prev_day_low')}, prev_day_close={d.get('prev_day_close')}")
                        print(f"  change={d.get('change')}, changePercent={d.get('changePercent')}, status={d.get('status')}")
                        
                        # Run CRT calculation inline
                        ltp = d.get("price", 0)
                        o = d.get("open", ltp)
                        h = d.get("high", ltp)
                        l = d.get("low", ltp)
                        pdh = d.get("prev_day_high", h)
                        pdl = d.get("prev_day_low", l)
                        pdc = d.get("prev_day_close") or d.get("close", ltp)
                        chg_pct = d.get("changePercent", 0)
                        
                        # Use LTP as close during live
                        c = ltp if d.get("status") == "LIVE" else d.get("close", ltp)
                        
                        pdr = pdh - pdl
                        cdr = h - l
                        rng = h - l
                        body = abs(c - o)
                        
                        print(f"\n  CRT Inputs: PDH={pdh}, PDL={pdl}, PDC={pdc}")
                        print(f"  PDR={pdr:.2f}, CDR={cdr:.2f}")
                        print(f"  Body={body:.2f}, Range={rng:.2f}")
                        
                        if pdh and pdl and pdc and pdh != h:
                            print(f"  >> prev_day data IS available - CRT should work")
                        else:
                            print(f"  >> WARNING: prev_day data may be MISSING or same as today")
                            print(f"     pdh==high? {pdh==h}, pdl==low? {pdl==l}")

asyncio.run(test())
