"""Twelve read-only AQTE strategy engines with orchestration, ranking and a conflict veto.

Every rule reads live Kite-fed AQTE state: completed one-minute futures candles, the latest futures/spot
ticks, subscribed ATM option quotes (OI, depth, premiums) and India VIX, or the shadow ML observation.
Engines never place orders. The live controller's validated scalp/swing rules remain the only entry
authority; engines can only rank entries or veto one that satisfied engines clearly oppose. Missing or
stale evidence is reported as MONITORING (rule result null), never inferred.
"""

import math
from dataclasses import dataclass
from datetime import datetime
from statistics import fmean, pstdev

from services.aqte_engine import IST, Policy, ema, finite_number, scalp_bias, session, session_bars

ENGINES = (
    (1, "momentum", "Momentum"), (2, "breakout", "Breakout"), (3, "trend", "Trend Following"),
    (4, "liquidity_sweep", "Liquidity Sweep"), (5, "order_flow", "Order Flow"), (6, "scalping", "Scalping"),
    (7, "mean_reversion", "Mean Reversion"), (8, "volatility_breakout", "Volatility Breakout"),
    (9, "options", "Options Intelligence"), (10, "multi_timeframe", "Multi-Timeframe"),
    (11, "stat_arb", "Statistical Arbitrage"), (12, "ml", "ML Prediction"),
)
STATUSES = ("SATISFIED", "PARTIAL", "MONITORING", "NOT_SATISFIED")
# India VIX bands (annualised %) used only for the volatility label.
VIX_BANDS = ((13.0, "Low"), (20.0, "Moderate"))
# Option-liquidity bands by ATM bid/ask spread fraction; the execution cap is Policy.spread_fraction.
TIGHT_SPREAD = 0.01
ML_THRESHOLD = 0.55
ML_MAX_AGE_SECONDS = 120


@dataclass(frozen=True)
class EngineConfig:
    risk_free_rate: float = 0.065
    veto: bool = True
    veto_min: int = 2


def rule(key, label, passed, requirement, value=None):
    return dict(id=key, label=label, passed=None if passed is None else bool(passed),
                requirement=requirement, value=value)


def side_rule(key, label, sign, ready, test, requirement, value=None):
    """Null when evidence is missing; FAIL when evidence exists but the engine has no direction."""
    if not ready:
        return rule(key, label, None, requirement, value)
    if not sign:
        return rule(key, label, False, requirement, value or "No direction")
    return rule(key, label, test(sign), requirement, value)


def fmt(value, digits=2, suffix=""):
    return f"{value:.{digits}f}{suffix}" if finite_number(value) else None


def status_of(rules):
    if not rules or any(r["passed"] is None for r in rules):
        return "MONITORING"
    passed = sum(r["passed"] for r in rules)
    return "SATISFIED" if passed == len(rules) else "PARTIAL" if passed * 2 >= len(rules) else "NOT_SATISFIED"


def _cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _bs(spot, strike, years, rate, sigma, call):
    root = sigma * math.sqrt(years)
    d1 = (math.log(spot / strike) + (rate + sigma * sigma / 2) * years) / root
    d2 = d1 - root
    discount = strike * math.exp(-rate * years)
    price = spot * _cdf(d1) - discount * _cdf(d2) if call else discount * _cdf(-d2) - spot * _cdf(-d1)
    return price, d1, d2


def greeks(spot, strike, years, rate, price, call):
    """Black-Scholes implied volatility (bisection) and Greeks from a live premium; None when not solvable."""
    if not all(finite_number(v) and v > 0 for v in (spot, strike, years, price)) or not finite_number(rate):
        return None
    discount = strike * math.exp(-rate * years)
    lower = max(0.0, spot - discount) if call else max(0.0, discount - spot)
    if not lower < price < (spot if call else discount):
        return None
    low, high = 1e-4, 5.0
    for _ in range(100):
        mid = (low + high) / 2
        if _bs(spot, strike, years, rate, mid, call)[0] > price:
            high = mid
        else:
            low = mid
    sigma = (low + high) / 2
    _, d1, d2 = _bs(spot, strike, years, rate, sigma, call)
    density = math.exp(-d1 * d1 / 2) / math.sqrt(2 * math.pi)
    decay = -spot * density * sigma / (2 * math.sqrt(years))
    carry = rate * strike * math.exp(-rate * years)
    theta = decay - carry * _cdf(d2) if call else decay + carry * _cdf(-d2)
    return dict(iv=round(sigma * 100, 2), delta=round(_cdf(d1) - (0 if call else 1), 4),
                gamma=round(density / (spot * sigma * math.sqrt(years)), 6),
                theta=round(theta / 365, 2), vega=round(spot * density * math.sqrt(years) / 100, 2))


def expiry_years(expiry, now):
    try:
        close = datetime.fromisoformat(str(expiry)[:10]).replace(hour=15, minute=30, tzinfo=IST).timestamp()
    except ValueError:
        return None
    return max(close - now, 60.0) / (365 * 86400)


def option_chain(options, spot, now, rate):
    """Summarise fresh subscribed strikes: premiums, depth, OI, PCR, IV and Greeks."""
    rows = []
    for contract, tick in options:
        two_sided = 0 < tick.bid <= tick.ask
        mid = (tick.bid + tick.ask) / 2 if two_sided else tick.price
        years = expiry_years(contract.expiry, now)
        model = greeks(spot, contract.strike, years, rate, mid, contract.side == "CE") if years else None
        rows.append(dict(
            side=contract.side, strike=contract.strike, trading_symbol=contract.trading_symbol,
            expiry=contract.expiry, lot_size=contract.lot_size, token=contract.token, ltp=tick.price,
            bid=tick.bid if two_sided else None, ask=tick.ask if two_sided else None,
            spread=round((tick.ask - tick.bid) / tick.ask, 4) if two_sided else None,
            bid_quantity=tick.bid_quantity, ask_quantity=tick.ask_quantity, oi=tick.oi, volume=tick.volume,
            at=tick.at, **(model or dict(iv=None, delta=None, gamma=None, theta=None, vega=None))))
    rows.sort(key=lambda r: (r["strike"], r["side"]))
    calls = [r for r in rows if r["side"] == "CE"]
    puts = [r for r in rows if r["side"] == "PE"]
    complete = calls and puts and all(r["oi"] is not None for r in rows)
    call_oi = sum(r["oi"] for r in calls) if complete else 0
    pcr = round(sum(r["oi"] for r in puts) / call_oi, 3) if complete and call_oi > 0 else None
    atm = {}
    if finite_number(spot) and rows:
        strike = min({r["strike"] for r in rows}, key=lambda k: abs(k - spot))
        atm = {r["side"]: r for r in rows if r["strike"] == strike}
    return dict(pcr=pcr, strikes=sorted({r["strike"] for r in rows}), atm=atm, rows=rows)


def resample(bars, seconds):
    """Completed higher-timeframe closes from completed one-minute session bars (incomplete tail dropped)."""
    buckets = {}
    for bar in bars:
        if session(bar["at"]):
            buckets.setdefault(int(bar["at"] // seconds) * seconds, []).append(bar)
    keys = sorted(buckets)
    if keys and keys[-1] + seconds > bars[-1]["at"] + 60:
        keys.pop()
    return [buckets[k][-1]["close"] for k in keys]


def session_change(bars, at):
    today = session_bars(bars, at)
    if not today or today[0]["open"] <= 0:
        return None
    return (today[-1]["close"] - today[0]["open"]) / today[0]["open"] * 100


def _sign(side):
    return 1 if side == "CE" else -1 if side == "PE" else 0


def _engines(info, live, spot, bars, chain, peers, symbol, ml, vix, rule_checks, policy):
    e = info.get("ema") or {}
    price, vwap, atr, rsi = (info.get(k) for k in ("close", "vwap", "atr", "rsi"))
    volume, breakout, sweep = info.get("volume_ratio"), info.get("breakout"), info.get("sweep")
    live_price = live.price if live else None
    depth = (live.buy_depth + live.sell_depth) if live else 0
    imbalance = (live.buy_depth - live.sell_depth) / depth if depth else None
    has = lambda *values: all(finite_number(v) for v in values)  # noqa: E731
    bias = _sign(scalp_bias(info))
    ema_ok = has(*(e.get(str(n)) for n in (9, 20, 50, 100, 200)))
    stack = lambda s: all(s * (e[str(a)] - e[str(b)]) > 0 for a, b in ((9, 20), (20, 50), (50, 100), (100, 200)))  # noqa: E731
    vol_value = fmt(volume, 2, "x")
    out = {}

    s = bias
    out["momentum"] = (s, [
        side_rule("rsi", "RSI (14) momentum band", s, has(rsi), lambda s: 55 <= rsi <= 80 if s > 0 else 20 <= rsi <= 45,
                  "CE 55-80; PE 20-45", fmt(rsi, 1)),
        side_rule("ema", "EMA 9 vs 20", s, has(e.get("9"), e.get("20")), lambda s: s * (e["9"] - e["20"]) > 0,
                  "EMA9 above EMA20 for CE; below for PE"),
        side_rule("vwap", "Price vs session VWAP", s, has(price, vwap), lambda s: s * (price - vwap) > 0,
                  "Above VWAP for CE; below for PE", fmt(vwap)),
        rule("volume", "Relative volume", volume >= 1.2 if has(volume) else None, ">= 1.2x prior 20-minute average", vol_value),
        side_rule("follow", "Live tick follow-through", s, has(live_price, price), lambda s: s * (live_price - price) > 0,
                  "Live futures beyond last closed candle", fmt(live_price)),
    ])

    s = int(breakout) if has(breakout) else 0
    level = info.get("breakout_high") if s > 0 else info.get("breakout_low")
    out["breakout"] = (s, [
        rule("break", "20-candle breakout", breakout != 0 if has(breakout) else None, "Close beyond prior 20-candle range",
             "High" if s > 0 else "Low" if s < 0 else "Inside range"),
        rule("volume", "Breakout volume", volume >= 1.5 if has(volume) else None, ">= 1.5x average", vol_value),
        side_rule("imbalance", "Order-book support", s, has(imbalance), lambda s: s * imbalance >= 0.10,
                  ">= 10% top-5 depth imbalance in breakout direction", fmt((imbalance or 0) * 100, 0, "%") if has(imbalance) else None),
        rule("extension", "Not extended", abs(price - e["20"]) <= 2 * atr if has(price, e.get("20"), atr) else None,
             "Within 2 ATR of EMA20; no chasing"),
        side_rule("hold", "Live hold beyond level", s, has(live_price) and (not s or has(level)), lambda s: s * (live_price - level) > 0,
                  "Live futures still beyond the broken level", fmt(level)),
    ])

    trend = info.get("supertrend")
    s = 1 if trend == "BULLISH" else -1 if trend == "BEARISH" else 0
    st_price, structure = info.get("supertrend_price"), info.get("structure")
    out["trend"] = (s, [
        side_rule("stack", "EMA 9/20/50/100/200 stack", s, ema_ok, stack, "Fully stacked in SuperTrend direction"),
        side_rule("vwap", "Price vs VWAP", s, has(price, vwap), lambda s: s * (price - vwap) > 0, "Trend side of VWAP"),
        rule("pullback", "Pullback entry zone", abs(price - e["20"]) <= atr if has(price, e.get("20"), atr) else None,
             "Within 1 ATR of EMA20", fmt(abs(price - e["20"]) / atr if has(price, e.get("20"), atr) and atr else None, 2, " ATR")),
        side_rule("structure", "Structure not opposing", s, structure in ("HIGHER_HIGH", "LOWER_LOW", "RANGE"),
                  lambda s: structure != ("LOWER_LOW" if s > 0 else "HIGHER_HIGH"), "No opposite 20-candle extreme", structure),
        side_rule("supertrend", "Live above/below SuperTrend", s, has(live_price, st_price),
                  lambda s: s * (live_price - st_price) > 0, "Live futures on trend side of SuperTrend", fmt(st_price)),
    ])

    s = int(sweep) if has(sweep) else 0
    out["liquidity_sweep"] = (s, [
        rule("sweep", "Liquidity sweep and reclaim", sweep != 0 if has(sweep) else None,
             "Wick through 20-candle extreme, close back inside", "Bullish" if s > 0 else "Bearish" if s < 0 else "None"),
        side_rule("imbalance", "Order book not opposing", s, has(imbalance), lambda s: s * imbalance >= 0, ">= 0 in reversal direction",
                  fmt((imbalance or 0) * 100, 0, "%") if has(imbalance) else None),
        rule("volume", "Sweep participation", volume >= 1.0 if has(volume) else None, ">= 1.0x average", vol_value),
        side_rule("rsi", "RSI not exhausted", s, has(rsi), lambda s: rsi < 70 if s > 0 else rsi > 30, "CE < 70; PE > 30", fmt(rsi, 1)),
        side_rule("confirm", "Live reversal confirmation", s, has(live_price, price), lambda s: s * (live_price - price) >= 0,
                  "Live futures not giving back the reclaim", fmt(live_price)),
    ])

    s = (1 if imbalance >= 0.10 else -1 if imbalance <= -0.10 else 0) if has(imbalance) else 0
    oi_change = (info.get("live") or {}).get("oi_change")
    out["order_flow"] = (s, [
        rule("depth", "Top-5 depth imbalance", abs(imbalance) >= 0.15 if has(imbalance) else None, ">= 15% buy or sell pressure",
             fmt(imbalance * 100, 0, "%") if has(imbalance) else None),
        side_rule("queue", "Best bid/ask queue", s, bool(live), lambda s: s * (live.bid_quantity - live.ask_quantity) > 0,
                  "Larger queue on the pressure side", f"{live.bid_quantity}/{live.ask_quantity}" if live else None),
        side_rule("oi", "Futures OI build-up", s, has(oi_change, live_price, price),
                  lambda s: oi_change > 0 and s * (live_price - price) > 0,
                  "OI rising with price (long/short build-up)", f"{oi_change:+,}" if has(oi_change) else None),
        rule("volume", "Participation", volume >= 1.0 if has(volume) else None, ">= 1.0x average", vol_value),
        side_rule("vwap", "Price vs VWAP", s, has(price, vwap), lambda s: s * (price - vwap) > 0, "Pressure side of VWAP"),
    ])

    scalp = (rule_checks or {}).get("scalp") or {}
    s = _sign(scalp.get("side"))
    rules = [rule(c["id"], c["label"], (c["passed"] if s or c["passed"] is not None else
             (False if has(price, vwap, e.get("9"), e.get("20")) else None)), c["requirement"]) for c in scalp.get("checks") or ()]
    out["scalping"] = (s, rules or [rule("bias", "Scalp bias", None, "VWAP and EMA 9/20 agree")])

    stretch = (price - vwap) / atr if has(price, vwap, atr) and atr > 0 else None
    s = (1 if stretch <= -2 else -1 if stretch >= 2 else 0) if stretch is not None else 0
    out["mean_reversion"] = (s, [
        rule("stretch", "Stretch from VWAP", abs(stretch) >= 2 if stretch is not None else None, ">= 2 ATR from VWAP",
             fmt(stretch, 2, " ATR")),
        side_rule("rsi", "RSI extreme", s, has(rsi), lambda s: rsi <= 30 if s > 0 else rsi >= 70, "CE <= 30; PE >= 70", fmt(rsi, 1)),
        rule("range", "No full trend stack", not (stack(1) or stack(-1)) if ema_ok else None, "EMA stack absent (non-trending)"),
        side_rule("turn", "Live turn toward VWAP", s, has(live_price, price), lambda s: s * (live_price - price) > 0,
                  "Live futures reverting toward VWAP", fmt(live_price)),
    ])

    last = bars[-1] if bars else None
    span = last["high"] - last["low"] if last else None
    s = int(breakout) if has(breakout) and breakout else (_sign("CE" if last["close"] > last["open"] else "PE")
                                                         if last and last["close"] != last["open"] else 0)
    vix_change = (vix or {}).get("change_pct")
    out["volatility_breakout"] = (s, [
        rule("expansion", "Range expansion", span >= 1.5 * atr if has(span, atr) and atr > 0 else None,
             "Last candle range >= 1.5 ATR", fmt(span / atr if has(span, atr) and atr else None, 2, " ATR")),
        side_rule("break", "Directional breakout", s, has(breakout), lambda s: breakout == s, "Breakout in expansion direction"),
        rule("volume", "Expansion volume", volume >= 1.5 if has(volume) else None, ">= 1.5x average", vol_value),
        rule("vix", "India VIX not falling", vix_change >= 0 if has(vix_change) else None, "VIX change >= 0%",
             fmt(vix_change, 2, "%")),
    ])

    s = bias
    side = "CE" if s > 0 else "PE" if s < 0 else None
    option = chain["atm"].get(side) if side else None
    pcr = chain["pcr"]
    out["options"] = (s, [
        side_rule("quote", "ATM option two-sided quote", s, bool(chain["atm"]), lambda s: bool(option and option["bid"]),
                  "Fresh bid and ask on the ATM strike", option["trading_symbol"] if option else None),
        side_rule("spread", "Option spread", s, bool(chain["atm"]),
                  lambda s: bool(option and option["spread"] is not None and option["spread"] <= policy.spread_fraction),
                  f"<= {policy.spread_fraction:.0%} of ask", fmt(option["spread"] * 100, 2, "%") if option and option["spread"] is not None else None),
        side_rule("depth", "Ask depth for one lot", s, bool(chain["atm"]),
                  lambda s: bool(option and option["ask_quantity"] >= option["lot_size"]), ">= one lot at best ask",
                  str(option["ask_quantity"]) if option else None),
        side_rule("pcr", "PCR (OI, subscribed strikes)", s, pcr is not None, lambda s: pcr > 1 if s > 0 else pcr < 1,
                  "PCR > 1 for CE; < 1 for PE", fmt(pcr, 2)),
        side_rule("iv", "Implied volatility solvable", s, bool(chain["atm"]),
                  lambda s: bool(option and option["iv"] is not None and 5 <= option["iv"] <= 100), "IV 5-100% from live premium",
                  fmt(option["iv"], 1, "%") if option else None),
        side_rule("delta", "Near-ATM delta", s, bool(chain["atm"]),
                  lambda s: bool(option and option["delta"] is not None and 0.3 <= abs(option["delta"]) <= 0.7), "|delta| 0.30-0.70",
                  fmt(option["delta"], 2) if option else None),
    ])

    s = bias
    five, fifteen = resample(bars, 300), resample(bars, 900)
    out["multi_timeframe"] = (s, [
        side_rule("m1", "1m EMA 9/20", s, has(e.get("9"), e.get("20")), lambda s: s * (e["9"] - e["20"]) > 0, "Aligned on 1-minute"),
        side_rule("m5", "5m close vs EMA9 and EMA9 vs EMA21", s, len(five) >= 21,
                  lambda s: s * (five[-1] - ema(five, 9)) > 0 and s * (ema(five, 9) - ema(five, 21)) > 0,
                  "Aligned on 5-minute", f"{len(five)} bars"),
        side_rule("m15", "15m close vs EMA9", s, len(fifteen) >= 9, lambda s: s * (fifteen[-1] - ema(fifteen, 9)) > 0,
                  "Aligned on 15-minute", f"{len(fifteen)} bars"),
        side_rule("supertrend", "1m SuperTrend", s, trend in ("BULLISH", "BEARISH"),
                  lambda s: trend == ("BULLISH" if s > 0 else "BEARISH"), "Agrees with bias", trend),
    ])

    closes = [b["close"] for b in bars[-20:]]
    deviation = pstdev(closes) if len(closes) == 20 else None
    z = (closes[-1] - fmean(closes)) / deviation if deviation else None
    s = (1 if z <= -2 else -1 if z >= 2 else 0) if z is not None else 0
    own, others = peers.get(symbol), [v for k, v in peers.items() if k != symbol]
    relative = own - fmean(others) if has(own) and others and all(has(v) for v in others) else None
    basis = (live.price - spot.price) / spot.price * 100 if live and spot and spot.price > 0 else None
    out["stat_arb"] = (s, [
        rule("zscore", "20-candle z-score", abs(z) >= 2 if z is not None else None, "|z| >= 2", fmt(z, 2)),
        side_rule("relative", "Relative value vs peer indices", s, relative is not None,
                  lambda s: s * relative <= 0, "Laggard for CE; leader for PE", fmt(relative, 2, "%")),
        rule("basis", "Spot-futures basis sane", -0.5 <= basis <= 2 if has(basis) else None, "-0.5% to +2% of spot", fmt(basis, 3, "%")),
        side_rule("revert", "Live reversion", s, has(live_price, price), lambda s: s * (live_price - price) > 0,
                  "Live futures moving back toward mean", fmt(live_price)),
    ])

    probability = (ml or {}).get("probability_positive_net_return")
    fresh = has(probability, (ml or {}).get("observed_at"))
    ml_side = (ml or {}).get("side")
    out["ml"] = (_sign(ml_side), [
        rule("model", "Shadow model loaded", True if fresh else None, "LightGBM shadow model scoring", (ml or {}).get("model_id")),
        rule("probability", "Positive net-return probability", probability >= ML_THRESHOLD if fresh else None,
             f">= {ML_THRESHOLD:.0%} (uncalibrated, shadow only)", fmt(probability * 100 if fresh else None, 1, "%")),
        rule("authority", "Order authority", True if fresh else None, "Shadow only; never places or approves orders", "None"),
    ])
    return out


def evaluate(signal, *, live=None, spot=None, bars=(), options=(), peers=None, ml=None, ml_reason=None, vix=None,
             policy=None, now=0.0, config=EngineConfig()):
    """Engine cards, market context and orchestration for one index snapshot signal."""
    policy = policy or Policy()
    info = signal.get("intelligence")
    ready = bool(signal.get("feed_ready")) and info is not None and signal.get("rule_checks") is not None
    chain = option_chain(options, spot.price if spot else None, now, config.risk_free_rate)
    reason = None if ready else (signal.get("reasons") or ["Waiting for live market data"])[0]
    evaluated = _engines(info, live, spot, list(bars), chain, peers or {}, signal.get("symbol"), ml, vix,
                         signal.get("rule_checks"), policy) if ready else {}
    engines = []
    for number, key, name in ENGINES:
        sign, rules = evaluated.get(key, (0, []))
        state = status_of(rules)
        passed = sum(r["passed"] is True for r in rules)
        engines.append(dict(
            id=number, key=key, name=name, status=state, side="CE" if sign > 0 else "PE" if sign < 0 else None,
            passed=passed, total=len(rules), score=round(passed / len(rules) * 100) if rules else None,
            authority="SHADOW" if key == "ml" else "ENTRY" if key == "scalping" else "ADVISORY",
            rules=rules, reason=reason or (ml_reason if key == "ml" and state == "MONITORING" else None)))
    return dict(engines=engines, orchestration=orchestrate(engines),
                market=context(info if ready else None, chain, vix), options=chain if ready else None)


def orchestrate(engines):
    voting = [e for e in engines if e["authority"] != "SHADOW"]
    satisfied = [e for e in voting if e["status"] == "SATISFIED" and e["side"]]
    ce = sum(e["side"] == "CE" for e in satisfied)
    pe = sum(e["side"] == "PE" for e in satisfied)
    evaluated = [e for e in voting if e["status"] != "MONITORING"]
    counts = {state.lower(): sum(e["status"] == state for e in engines) for state in STATUSES}
    leader = max(ce, pe)
    return dict(**counts, ce=ce, pe=pe, consensus="CE" if ce > pe else "PE" if pe > ce else None,
                conflict=bool(ce and pe), evaluated=len(evaluated),
                consensus_pct=round(leader / len(evaluated) * 100) if evaluated and leader else None)


def context(info, chain, vix):
    regime = None
    if info:
        e, trend = info.get("ema") or {}, info.get("supertrend")
        values = [e.get(str(n)) for n in (9, 20, 50, 200)]
        if all(finite_number(v) for v in values):
            if values == sorted(values, reverse=True) and trend == "BULLISH":
                regime = "Trending Bullish"
            elif values == sorted(values) and trend == "BEARISH":
                regime = "Trending Bearish"
            else:
                regime = "Range / Rotation"
    level = (vix or {}).get("price")
    volatility = next((label for limit, label in VIX_BANDS if level < limit), "High") if finite_number(level) else None
    spreads = [r["spread"] for r in chain["atm"].values() if r["spread"] is not None] if chain else []
    liquidity = None
    if spreads:
        worst = max(spreads)
        liquidity = "High" if worst <= TIGHT_SPREAD else "Moderate" if worst <= 0.03 else "Low"
    return dict(regime=regime, volatility=volatility, liquidity=liquidity, pcr=chain["pcr"] if info else None,
                vix=level if finite_number(level) else None,
                vix_change_pct=(vix or {}).get("change_pct") if finite_number(level) else None)


def veto_reason(signal, config=EngineConfig()):
    """Block an entry only when satisfied engines clearly oppose it; never approves an entry."""
    decision = signal.get("decision")
    orchestration = signal.get("orchestration")
    if not config.veto or decision not in ("BUY CE", "BUY PE") or not orchestration:
        return None
    side = decision[-2:]
    aligned, against = orchestration[side.lower()], orchestration["pe" if side == "CE" else "ce"]
    if against >= config.veto_min and against > aligned:
        return f"Engine conflict: {against} satisfied engines oppose {side} ({aligned} aligned); WAIT"
    return None


def rank_key(signal):
    """Order actionable entries by aligned satisfied engines, then rule score."""
    decision = signal.get("decision")
    side = decision[-2:] if decision in ("BUY CE", "BUY PE") and signal.get("entry") else None
    aligned = (signal.get("orchestration") or {}).get(side.lower(), 0) if side else 0
    confidence = signal.get("confidence")
    return (1 if side else 0, aligned, confidence if finite_number(confidence) else 0)

