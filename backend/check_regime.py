"""Quick check of regime API data."""
import requests, json

for port in [8002, 8000, 8001]:
    try:
        r = requests.get(f"http://localhost:{port}/api/market-regime", timeout=3)
        if r.ok:
            data = r.json()
            print(f"=== Port {port} LIVE ===")
            for sym, info in data.get("data", {}).items():
                ctx = info.get("context", {})
                print(f"  {sym}:")
                print(f"    regime={info.get('regime')}")
                print(f"    score={info.get('regimeScore')}")
                print(f"    direction={info.get('direction')}")
                print(f"    trendStrength={info.get('trendStrength')}")
                print(f"    tradeApproach={info.get('tradeApproach')}")
                print(f"    price={ctx.get('price')}, open={ctx.get('open')}")
                print(f"    changePct={ctx.get('changePct')}%")
                print(f"    vix={ctx.get('vix')}, pcr={ctx.get('pcr')}")
                print(f"    dataSource={info.get('dataSource')}")
                print(f"    timestamp={info.get('timestamp')}")
                print(f"    actionSummary={info.get('actionSummary')}")
                # Factor summary
                factors = info.get("factors", {})
                for fname, fdata in factors.items():
                    print(f"    [{fname}] score={fdata.get('score')}, signal={fdata.get('signal')}")
            break
    except Exception as e:
        print(f"Port {port}: {e}")
