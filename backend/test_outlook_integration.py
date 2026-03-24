import urllib.request, json

r = urllib.request.urlopen('http://localhost:8000/api/analysis/market-outlook-all')
data = json.loads(r.read().decode())

for sym in ['NIFTY', 'BANKNIFTY', 'SENSEX']:
    d = data.get(sym, {})
    signal = d.get('signal', 'N/A')
    conf = d.get('confidence', 0)
    p5m_dir = d.get('prediction_5m_direction', 'N/A')
    p5m_sig = d.get('prediction_5m_signal', 'N/A')
    p5m_conf = d.get('prediction_5m_confidence', 0)
    of_buy = d.get('order_flow_buy_pct', 'N/A')
    of_sell = d.get('order_flow_sell_pct', 'N/A')
    buy_sigs = d.get('buy_signals', 0)
    sell_sigs = d.get('sell_signals', 0)
    
    print(f"{sym}:")
    print(f"  Signal: {signal}  Confidence: {conf}%")
    print(f"  5m Direction: {p5m_dir}  Signal: {p5m_sig}  Conf: {p5m_conf}%")
    print(f"  Order Flow Buy: {of_buy}%  Sell: {of_sell}%")
    print(f"  Buy Signals: {buy_sigs}%  Sell Signals: {sell_sigs}%")
    print()

# Also test smart-money endpoint
print("=== SMART MONEY ENDPOINT ===")
for sym in ['NIFTY', 'BANKNIFTY', 'SENSEX']:
    r2 = urllib.request.urlopen(f'http://localhost:8000/api/analysis/smart-money/{sym}')
    sm = json.loads(r2.read().decode())
    print(f"{sym}: signal={sm.get('smart_money_signal')} conf={sm.get('smart_money_confidence')}% "
          f"of_strength={sm.get('order_flow_strength')}% imbalance={sm.get('volume_imbalance')}")
