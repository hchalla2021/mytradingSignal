"""Probe: simulate per-tick futures prints into the radar and verify events fire."""
import random
import sys

sys.path.insert(0, "backend")

from services.fii_dii_realtime_ai import FIIDIIRealtimeAIEngine  # noqa: E402

eng = FIIDIIRealtimeAIEngine()
random.seed(7)

price = 24500.0
cum_vol = 5_000_000.0

# 1) Normal retail-scale flow: ~2000-8000 qty per tick (~0.5-2 Cr notional)
for i in range(60):
    price += random.uniform(-3, 3)
    cum_vol += random.uniform(2000, 8000)
    eng.ingest_futures_tick("NIFTY", price, cum_vol, 16_850_000 + i * 50)

bp = eng._big_players_payload()
print(f"after retail flow: events={bp['eventsToday']} (expect 0)")

# 2) A big player sweeps: 80,000 qty in one tick (~196 Cr notional), price up, OI up
price += 6
cum_vol += 80_000
eng.ingest_futures_tick("NIFTY", price, cum_vol, 16_990_000)

bp = eng._big_players_payload()
print(f"after BLOCK print:  events={bp['eventsToday']} (expect 1)")
if bp["events"]:
    ev = bp["events"][0]
    print(f"  -> {ev['side']} {ev['notionalCr']} Cr z={ev['zScore']} kind={ev['kind']} read={ev['read']}")

# 3) Aggressive sell block: price down, OI up (fresh shorts)
for i in range(10):
    price += random.uniform(-2, 2)
    cum_vol += random.uniform(2000, 8000)
    eng.ingest_futures_tick("NIFTY", price, cum_vol, 16_990_000)
price -= 8
cum_vol += 55_000
eng.ingest_futures_tick("NIFTY", price, cum_vol, 17_080_000)

bp = eng._big_players_payload()
print(f"after SELL block:   events={bp['eventsToday']} (expect 2)")
for ev in bp["events"][:2]:
    print(f"  -> {ev['ts']} {ev['symbol']} {ev['side']} {ev['notionalCr']} Cr z={ev['zScore']} {ev['kind']} | {ev['read']}")
print(f"session: buy={bp['sessionBuyCr']} sell={bp['sessionSellCr']} net={bp['sessionNetCr']}")

# 4) Double-feed guard: update_tick must NOT consume the same counter now
snap_before = eng._big_players_payload()["eventsToday"]
eng.update_tick("NIFTY", {"price": price, "volume": cum_vol + 500_000, "oi": 17_080_000})
snap_after = eng._big_players_payload()["eventsToday"]
print(f"double-feed guard:  events {snap_before} -> {snap_after} (must be equal)")

# 5) get_snapshot always ships bigPlayers
snap = eng.get_snapshot()
assert "bigPlayers" in snap, "bigPlayers missing from snapshot!"
print("get_snapshot ships bigPlayers: OK")
