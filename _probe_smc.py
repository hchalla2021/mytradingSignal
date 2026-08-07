"""Smoke test for services.smc_engine — synthetic data, determinism, no-repaint."""
import json
import math
import random
import sys
from datetime import datetime, timedelta

sys.path.insert(0, "backend")
import pytz  # noqa: E402

from services.smc_engine import analyze_symbol  # noqa: E402

IST = pytz.timezone("Asia/Kolkata")


def make_candles(n=120, seed=7, base=24000.0):
    rng = random.Random(seed)
    out = []
    price = base
    t0 = IST.localize(datetime(2026, 8, 7, 9, 15))
    for i in range(n):
        drift = 6.0 * math.sin(i / 9.0) + (2.5 if i > n * 0.6 else -1.0)
        o = price
        c = o + drift + rng.uniform(-14, 14)
        h = max(o, c) + rng.uniform(1, 12)
        l = min(o, c) - rng.uniform(1, 12)
        # inject a stop-hunt: bar 100 wicks below recent lows then closes back up
        if i == 100:
            l -= 55
            c = o + 20
            h = c + 5
        out.append({
            "timestamp": (t0 + timedelta(minutes=5 * i)).isoformat(),
            "open": round(o, 2), "high": round(h, 2), "low": round(l, 2),
            "close": round(c, 2),
            "volume": rng.randint(50_000, 220_000) * (3 if i == 100 else 1),
            "oi": 1_000_000 + i * 1200, "oi_prev": 1_000_000 + (i - 1) * 1200,
        })
        price = c
    return out


def spot_from(candles):
    last = candles[-1]
    return {
        "price": last["close"], "changePercent": 0.45, "pcr": 1.24,
        "callOI": 4_000_000, "putOI": 4_960_000,
        "prev_day_high": last["close"] + 90, "prev_day_low": last["close"] - 260,
        "high": max(c["high"] for c in candles[-75:]),
        "low": min(c["low"] for c in candles[-75:]),
        "status": "LIVE",
    }


def run(symbol, candles, peer):
    return analyze_symbol(
        symbol=symbol, candles_5m=candles, candles_15m=[],
        spot=spot_from(candles), peer_candles_5m=peer, peer_symbol="BANKNIFTY",
        now_ist=IST.localize(datetime(2026, 8, 7, 10, 5)),
    )


candles = make_candles()
peer = make_candles(seed=11, base=51000.0)

r1 = run("NIFTY", candles, peer)
r2 = run("NIFTY", candles, peer)
assert r1 is not None, "engine returned None"
assert json.dumps(r1, sort_keys=True, default=str) == json.dumps(r2, sort_keys=True, default=str), "NOT deterministic"

required = ["verdict", "confidence", "score", "probabilities", "structure", "dealingRange",
            "liquidity", "zones", "smt", "confluence", "regime", "momentum", "session",
            "behavior", "intent", "tradePlan", "factors", "reasoning", "metrics"]
missing = [k for k in required if k not in r1]
assert not missing, f"missing keys: {missing}"

probs = r1["probabilities"]
assert abs(probs["continuation"] + probs["reversal"] + probs["chop"] - 100) < 1.5, f"probs don't sum: {probs}"
assert r1["verdict"] in ("STRONG_BUY", "BUY", "NEUTRAL", "SELL", "STRONG_SELL")
assert 5 <= r1["confidence"] <= 95

plan = r1["tradePlan"]
if r1["verdict"] != "NEUTRAL":
    assert plan["entryZone"] and plan["stopLoss"] and plan["targets"], "trade plan incomplete"

# no-repaint: extend series by 5 bars — earlier structure events must be a stable prefix
ext = candles + make_candles(n=5, seed=99, base=candles[-1]["close"])
r3 = run("NIFTY", ext, peer)
ev_old = [(e["type"], e["direction"], e["level"]) for e in r1["structure"]["ltf"]["events"]]
ev_new = [(e["type"], e["direction"], e["level"]) for e in r3["structure"]["ltf"]["events"]]
overlap = [e for e in ev_old if e in ev_new]
assert len(overlap) >= max(0, len(ev_old) - 1), f"repaint suspected: {ev_old} vs {ev_new}"

print("VERDICT      :", r1["verdict"], f"({r1['confidence']}% conf, score {r1['score']})")
print("PROBS        :", probs)
print("REGIME       :", r1["regime"]["market"], "| vol", r1["regime"]["volatility"], "| trend", r1["regime"]["trendDirection"], r1["regime"]["trendStrength"])
print("HTF/LTF      :", r1["structure"]["htf"]["bias"], "/", r1["structure"]["ltf"]["bias"], "| aligned:", r1["structure"]["aligned"])
print("DEALING RANGE:", r1["dealingRange"]["zone"], r1["dealingRange"]["positionPct"], "%")
print("POOLS        :", [(p["kind"], p["side"], p["level"]) for p in r1["liquidity"]["pools"]])
print("SWEEPS       :", [(s["poolKind"], s["trapConfirmed"], s["barsAgo"]) for s in r1["liquidity"]["sweeps"]])
print("OBs          :", [(o["side"], o["state"]) for o in r1["zones"]["orderBlocks"]])
print("FVGs         :", [(g["side"], g["state"]) for g in r1["zones"]["fvgs"]])
print("INTENT       :", r1["intent"]["phase"], r1["intent"]["direction"])
print("PLAN         : entry", plan["entryZone"], "| SL", plan["stopLoss"], "| targets", [t["level"] for t in plan["targets"]], "| RR", plan["riskReward"], "| risk", plan["riskScore"])
print("REASONING    :")
for line in r1["reasoning"]:
    print("  •", line)
print("\nALL ASSERTIONS PASSED ✅")
