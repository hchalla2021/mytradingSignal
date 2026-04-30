import urllib.request, json
with urllib.request.urlopen('http://127.0.0.1:8000/ws/cache/NIFTY', timeout=5) as r:
    data = json.loads(r.read())
candles = data.get('candles5m', data.get('candles3m', []))
if candles:
    print('Last 5 candles (t, o, h, l, c, v):')
    for c in candles[-5:]:
        t = c['t'][:16]
        print(f"  {t}  o={c['o']}  c={c['c']}  v={c['v']}")
else:
    print('keys:', list(data.keys())[:15])
    print(json.dumps(data, indent=2)[:600])
