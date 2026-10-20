"""Order-flow analytics on recorded futures footprints (pure functions, replayable).

Input minutes come from services.order_flow_engine. Nothing here invents trade-side data:
bars whose flow was not fully observed are marked incomplete and never produce signals.
Confidence is a transparent rule score (0-100), not a probability; replay statistics are reported separately.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

IST_OFFSET = 19_800
SESSION_OPEN_MIN = 9 * 60 + 15
SESSION_CLOSE_MIN = 15 * 60 + 30
LAST_ENTRY_MIN = 15 * 60 + 10
LOTS = 2  # one lot exits at T1, one rides to T2 / breakeven
IMBALANCE_RATIO = 3.0
STACK = 3
VALUE_AREA = 0.70


def _day_open(t: int) -> int:
    return (t + IST_OFFSET) // 86_400 * 86_400 - IST_OFFSET + SESSION_OPEN_MIN * 60


def _minute_of_day(t: int) -> int:
    return ((t + IST_OFFSET) // 60) % 1440


def bar_start(t: int, interval: int) -> int:
    open_ = _day_open(t)
    return open_ + (t - open_) // (interval * 60) * interval * 60


def aggregate(minutes: Iterable[Dict[str, Any]], interval: int) -> List[Dict[str, Any]]:
    bars: Dict[int, Dict[str, Any]] = {}
    for m in sorted(minutes, key=lambda item: item["t"]):
        key = bar_start(int(m["t"]), interval)
        bar = bars.get(key)
        if bar is None:
            bar = bars[key] = {"t": key, "o": m["o"], "h": m["h"], "l": m["l"], "c": m["c"], "v": 0.0, "b": 0.0,
                               "s": 0.0, "n": 0.0, "lv": {}, "bk": [0.0, 0.0, 0], "dp": [0.0, 0.0, 0],
                               "sp": [0.0, 0], "spot": None, "gap": False, "count": 0}
        bar["h"], bar["l"], bar["c"] = max(bar["h"], m["h"]), min(bar["l"], m["l"]), m["c"]
        for field in ("v", "b", "s", "n"):
            bar[field] += m[field]
        for price, (buy, sell) in m["lv"].items():
            cell = bar["lv"].setdefault(float(price), [0.0, 0.0])
            cell[0] += buy
            cell[1] += sell
        for field in ("bk", "dp"):
            for i in range(3):
                bar[field][i] += m[field][i]
        bar["sp"][0] += m["sp"][0]
        bar["sp"][1] += m["sp"][1]
        bar["spot"] = m.get("spot") or bar["spot"]
        bar["gap"] = bar["gap"] or bool(m.get("gap"))
        bar["count"] += 1
    out = []
    for key in sorted(bars):
        bar = bars[key]
        close = _day_open(key) + (SESSION_CLOSE_MIN - SESSION_OPEN_MIN) * 60
        expected = max(1, min(interval, (close - key) // 60))
        bar["end"] = min(key + interval * 60, close)
        bar["complete"] = bar["count"] >= expected and not bar["gap"]
        out.append(bar)
    return out


def value_area(levels: Dict[float, List[float]], row: float) -> Optional[Dict[str, float]]:
    volume = {round(p, 2): b + s for p, (b, s) in levels.items() if b + s > 0}
    if not volume:
        return None
    low, high = min(volume), max(volume)
    prices = [round(low + i * row, 2) for i in range(int(round((high - low) / row)) + 1)]
    sizes = [volume.get(p, 0.0) for p in prices]
    total = sum(sizes)
    poc = max(range(len(prices)), key=lambda i: (sizes[i], -abs(i - len(prices) / 2)))
    lo = hi = poc
    acc = sizes[poc]
    while acc < VALUE_AREA * total and (lo > 0 or hi < len(prices) - 1):
        up = sizes[hi + 1] if hi < len(prices) - 1 else -1
        down = sizes[lo - 1] if lo > 0 else -1
        if up >= down:
            hi += 1
            acc += up
        else:
            lo -= 1
            acc += down
    return {"poc": prices[poc], "vah": prices[hi], "val": prices[lo], "volume": total}


def stacked_imbalances(levels: Dict[float, List[float]], row: float, total: float) -> Dict[str, List[List[float]]]:
    """Diagonal imbalance: buyers at P vs sellers at P-row (and mirror). Three or more in a row form a zone."""
    floor = max(total * 0.01, 1.0)
    prices = sorted(levels)
    found: Dict[str, List[float]] = {"buy": [], "sell": []}
    if not prices:
        return {"buy": [], "sell": []}
    low, high = prices[0], prices[-1]
    for price in prices:
        # Edge rows have no diagonal counterpart inside the bar; comparing against nothing is a false positive.
        buy = levels[price][0]
        below = levels.get(round(price - row, 2), [0.0, 0.0])[1]
        if price > low and buy >= floor and buy >= IMBALANCE_RATIO * max(below, 1.0):
            found["buy"].append(price)
        sell = levels[price][1]
        above = levels.get(round(price + row, 2), [0.0, 0.0])[0]
        if price < high and sell >= floor and sell >= IMBALANCE_RATIO * max(above, 1.0):
            found["sell"].append(price)
    zones: Dict[str, List[List[float]]] = {"buy": [], "sell": []}
    for side, hits in found.items():
        run: List[float] = []
        for price in hits:
            if run and round(price - run[-1], 2) != round(row, 2):
                if len(run) >= STACK:
                    zones[side].append([run[0], run[-1]])
                run = []
            run.append(price)
        if len(run) >= STACK:
            zones[side].append([run[0], run[-1]])
    return zones


def fill_fees(price: float, quantity: float, side: str, exchange: str) -> float:
    """Zerodha futures charges (zerodha.com/charges): brokerage min(₹20, 0.03%), STT 0.05% sell,
    NSE txn 0.00183% (BSE 0), SEBI ₹10/crore, stamp 0.002% buy, GST 18% on brokerage+txn+SEBI."""
    turnover = price * quantity
    brokerage = min(20.0, 0.0003 * turnover)
    stt = 0.0005 * turnover if side == "SELL" else 0.0
    txn = (0.0000183 if exchange == "NFO" else 0.0) * turnover
    sebi = turnover * 10 / 1e7
    stamp = 0.00002 * turnover if side == "BUY" else 0.0
    return brokerage + stt + txn + sebi + stamp + 0.18 * (brokerage + txn + sebi)


def _ratio(pair: List[float]) -> Optional[float]:
    return round(pair[0] / pair[1], 3) if pair[2] and pair[1] else None


def analyze(bars: List[Dict[str, Any]], *, row: float, tick: float, now: float, exchange: str = "NFO",
            lot_size: Optional[int] = None, feed_age: Optional[float] = None) -> Dict[str, Any]:
    cvd = 0.0
    out_bars: List[Dict[str, Any]] = []
    events: List[Dict[str, Any]] = []
    session_levels: Dict[float, List[float]] = {}
    for bar in bars:
        delta = bar["b"] - bar["s"]
        cvd += delta
        for price, (buy, sell) in bar["lv"].items():
            cell = session_levels.setdefault(price, [0.0, 0.0])
            cell[0] += buy
            cell[1] += sell
        profile = value_area(bar["lv"], row)
        classified = bar["b"] + bar["s"]
        out_bars.append({
            "t": bar["t"], "end": bar["end"], "o": bar["o"], "h": bar["h"], "l": bar["l"], "c": bar["c"],
            "v": round(bar["v"]), "b": round(bar["b"]), "s": round(bar["s"]), "n": round(bar["n"]),
            "d": round(delta), "cvd": round(cvd), "poc": profile["poc"] if profile else None,
            "lv": [[p, round(b), round(s)] for p, (b, s) in sorted(bar["lv"].items()) if b or s],
            "imb": stacked_imbalances(bar["lv"], row, classified),
            "book": _ratio(bar["bk"]), "depth": _ratio(bar["dp"]),
            "spread": round(bar["sp"][0] / bar["sp"][1], 2) if bar["sp"][1] else None,
            "basis": round(bar["c"] - bar["spot"], 2) if bar.get("spot") else None,
            "complete": bar["complete"], "closed": bar["end"] <= now,
            "coverage": round(classified / bar["v"], 3) if bar["v"] else 0.0,
        })

    # ── per-bar detections on closed, fully-observed bars ──────────────────
    for i, bar in enumerate(out_bars):
        bar["flags"] = []
        if not (bar["closed"] and bar["complete"]) or bar["v"] <= 0:
            continue
        prior = [b for b in out_bars[max(0, i - 20):i] if b["complete"] and b["v"] > 0]
        if len(prior) < 5:
            continue
        avg_volume = sum(b["v"] for b in prior) / len(prior)
        span = bar["h"] - bar["l"]
        position = (bar["c"] - bar["l"]) / span if span > 0 else 0.5
        ratio = bar["d"] / bar["v"]
        window = out_bars[max(0, i - 12):i]
        flags = bar["flags"]
        if bar["v"] >= 1.3 * avg_volume and ratio >= 0.25 and position >= 2 / 3:
            flags.append("aggressive_buy")
        if bar["v"] >= 1.3 * avg_volume and ratio <= -0.25 and position <= 1 / 3:
            flags.append("aggressive_sell")
        if bar["v"] >= 1.5 * avg_volume and ratio <= -0.2 and position >= 0.5:
            flags.append("absorption_sellers")  # heavy selling met by passive bids: bullish
        if bar["v"] >= 1.5 * avg_volume and ratio >= 0.2 and position <= 0.5:
            flags.append("absorption_buyers")  # heavy buying met by passive offers: bearish
        if len(window) >= 6:
            prior_high = max(b["h"] for b in window)
            prior_low = min(b["l"] for b in window)
            if bar["h"] > prior_high and bar["c"] < prior_high and bar["d"] <= 0:
                flags.append("failed_breakout")
            if bar["l"] < prior_low and bar["c"] > prior_low and bar["d"] >= 0:
                flags.append("failed_breakdown")
            if bar["h"] > prior_high and bar["cvd"] < max(b["cvd"] for b in window):
                flags.append("cvd_divergence_bear")
            if bar["l"] < prior_low and bar["cvd"] > min(b["cvd"] for b in window):
                flags.append("cvd_divergence_bull")
            previous = out_bars[i - 1]
            levels = bar["lv"]
            mean_level = bar["v"] / max(1, len(levels))
            if levels and bar["h"] >= prior_high and previous["v"] and previous["d"] / previous["v"] >= 0.15 and \
                    ratio < 0.5 * previous["d"] / previous["v"] and sum(levels[-1][1:]) < 0.5 * mean_level:
                flags.append("exhaustion_buyers")
            if levels and bar["l"] <= prior_low and previous["v"] and previous["d"] / previous["v"] <= -0.15 and \
                    ratio > 0.5 * previous["d"] / previous["v"] and sum(levels[0][1:]) < 0.5 * mean_level:
                flags.append("exhaustion_sellers")
        if bar["imb"]["buy"]:
            flags.append("stacked_buy_imbalance")
        if bar["imb"]["sell"]:
            flags.append("stacked_sell_imbalance")
        for flag in flags:
            bullish = flag in BULLISH
            events.append({"t": bar["t"], "kind": flag, "side": "BUY" if bullish else "SELL",
                           "price": bar["l"] if bullish else bar["h"]})

    profile = value_area(session_levels, row)
    signals, active, replay, wait = _signals(out_bars, profile, row=row, tick=tick, now=now,
                                             exchange=exchange, lot_size=lot_size)
    last = out_bars[-1] if out_bars else None
    stale = feed_age is not None and feed_age > 20
    if active is None:
        reasons = wait or ["No order-flow trigger on the last closed bar."]
        if stale:
            reasons = [f"Feed stale ({int(feed_age)}s since last futures tick)."]
        guidance: Dict[str, Any] = {"action": "WAIT", "reasons": reasons}
    else:
        guidance = dict(active)
        if stale:
            guidance = {"action": "WAIT", "reasons": [f"Feed stale ({int(feed_age)}s); last plan not refreshed."],
                        "plan": active}
    return {
        "bars": out_bars, "events": events, "profile": profile, "signals": signals, "guidance": guidance,
        "replay": replay,
        "summary": {
            "delta": last["d"] if last else 0, "cvd": last["cvd"] if last else 0,
            "buy": last["b"] if last else 0, "sell": last["s"] if last else 0,
            "book": last["book"] if last else None, "depth": last["depth"] if last else None,
            "coverage": last["coverage"] if last else 0.0, "basis": last["basis"] if last else None,
        },
    }


BULLISH = {"aggressive_buy", "absorption_sellers", "failed_breakdown", "cvd_divergence_bull",
           "exhaustion_sellers", "stacked_buy_imbalance"}
WEIGHTS = {"absorption_sellers": 30, "absorption_buyers": 30, "failed_breakdown": 30, "failed_breakout": 30,
           "exhaustion_sellers": 20, "exhaustion_buyers": 20, "stacked_buy_imbalance": 20,
           "stacked_sell_imbalance": 20, "aggressive_buy": 20, "aggressive_sell": 20,
           "cvd_divergence_bull": 15, "cvd_divergence_bear": 15}
TRIGGERS = {"absorption_sellers", "absorption_buyers", "failed_breakdown", "failed_breakout",
            "exhaustion_sellers", "exhaustion_buyers"}
REASONS = {
    "absorption_sellers": "sellers absorbed (high volume, negative delta, close holds up)",
    "absorption_buyers": "buyers absorbed (high volume, positive delta, close held down)",
    "failed_breakdown": "failed breakdown below 12-bar low",
    "failed_breakout": "failed breakout above 12-bar high",
    "exhaustion_sellers": "selling exhaustion at the low",
    "exhaustion_buyers": "buying exhaustion at the high",
    "stacked_buy_imbalance": "stacked buy imbalances",
    "stacked_sell_imbalance": "stacked sell imbalances",
    "aggressive_buy": "aggressive buying",
    "aggressive_sell": "aggressive selling",
    "cvd_divergence_bull": "CVD higher low vs price lower low",
    "cvd_divergence_bear": "CVD lower high vs price higher high",
}


def _score(bar: Dict[str, Any], profile: Optional[Dict[str, float]]) -> tuple:
    bull = [f for f in bar["flags"] if f in BULLISH]
    bear = [f for f in bar["flags"] if f not in BULLISH]
    bull_score = sum(WEIGHTS[f] for f in bull)
    bear_score = sum(WEIGHTS[f] for f in bear)
    bull_reasons = [REASONS[f] for f in bull]
    bear_reasons = [REASONS[f] for f in bear]
    if bar["book"] is not None:
        if bar["book"] >= 1.15:
            bull_score += 10
            bull_reasons.append(f"bid book {bar['book']:.2f}x offers")
        elif bar["book"] <= 1 / 1.15:
            bear_score += 10
            bear_reasons.append(f"offer book {1 / bar['book']:.2f}x bids")
    if profile:
        if bar["l"] <= profile["val"] <= bar["c"]:
            bull_score += 10
            bull_reasons.append("held value-area low")
        if bar["h"] >= profile["vah"] >= bar["c"]:
            bear_score += 10
            bear_reasons.append("rejected value-area high")
    return bull_score, bear_score, bull, bear, bull_reasons, bear_reasons


def _signals(bars: List[Dict[str, Any]], profile: Optional[Dict[str, float]], *, row: float, tick: float,
             now: float, exchange: str, lot_size: Optional[int]):
    signals: List[Dict[str, Any]] = []
    trade: Optional[Dict[str, Any]] = None
    pending: Optional[Dict[str, Any]] = None
    wait: List[str] = []
    running_levels: Dict[float, List[float]] = {}
    for i, bar in enumerate(bars):
        # Profile known at the time (no look-ahead): built from bars before this one.
        known = value_area(running_levels, row) if running_levels else None
        for price, b, s in bar["lv"]:
            cell = running_levels.setdefault(price, [0.0, 0.0])
            cell[0] += b
            cell[1] += s
        if pending is not None:
            if _day_open(bar["t"]) != _day_open(pending["time"]):
                pending["status"] = "expired"  # never carry an unfilled signal overnight
            else:
                _fill(pending, bar, tick, exchange, lot_size)
            if pending.get("status") == "open":
                trade = pending
            pending = None
        if trade is not None:
            next_day = i + 1 < len(bars) and _day_open(bars[i + 1]["t"]) != _day_open(bar["t"])
            day_over = now >= _day_open(bar["t"]) + (SESSION_CLOSE_MIN - SESSION_OPEN_MIN) * 60
            session_over = bar["closed"] and (next_day or (i == len(bars) - 1 and day_over) or
                                              _minute_of_day(bar["end"]) >= SESSION_CLOSE_MIN - 1)
            _manage(trade, bar, tick, exchange, lot_size, session_over)
            if trade["status"] != "open":
                trade = None
        if not bar["closed"]:
            continue
        if not bar["complete"]:
            wait = ["Last bar not fully observed (feed started mid-bar or had a gap)."]
            continue
        if trade is not None:
            continue
        bull_score, bear_score, bull, bear, bull_reasons, bear_reasons = _score(bar, known)
        minute = _minute_of_day(bar["end"])
        side = None
        if bull_score >= 50 and bull_score - bear_score >= 25 and TRIGGERS & set(bull) and \
                (bar["d"] >= 0 or "absorption_sellers" in bull):
            side = "BUY"
        elif bear_score >= 50 and bear_score - bull_score >= 25 and TRIGGERS & set(bear) and \
                (bar["d"] <= 0 or "absorption_buyers" in bear):
            side = "SELL"
        if side is None:
            wait = ([f"Conflicting flow: bull {bull_score} / bear {bear_score}."] if bull_score or bear_score
                    else ["No absorption, exhaustion or failed-auction trigger on the last closed bar."])
            continue
        if minute >= LAST_ENTRY_MIN:
            wait = ["No new entries after 15:10 IST."]
            continue
        buy = side == "BUY"
        entry = bar["c"]
        stop = round(bar["l"] - row - tick, 2) if buy else round(bar["h"] + row + tick, 2)
        risk = abs(entry - stop)
        ranges = [b["h"] - b["l"] for b in bars[max(0, i - 14):i + 1]]
        if risk <= 0 or risk > 2.5 * (sum(ranges) / len(ranges)) + row:
            wait = ["Order-flow setup found but stop distance too wide for a defined-risk entry."]
            continue
        t1 = round(entry + risk if buy else entry - risk, 2)
        t2 = round(entry + 2 * risk if buy else entry - 2 * risk, 2)
        if known:
            magnet = known["vah"] if buy else known["val"]
            if (magnet - entry) * (1 if buy else -1) >= 1.2 * risk and abs(magnet - entry) <= 3 * risk:
                t2 = magnet
        score = min(95, bull_score if buy else bear_score)
        pending = {"id": f"of-{bar['t']}-{side}", "time": bar["t"], "side": side, "action": side, "entry": entry,
                   "stop": stop, "t1": t1, "t2": t2, "confidence": score,
                   "reasons": (bull_reasons if buy else bear_reasons)[:4], "status": "pending", "exits": []}
        signals.append(pending)
        wait = []
    active = None
    live = trade or pending
    if live is not None:
        active = {key: live[key] for key in ("id", "time", "side", "action", "entry", "stop", "t1", "t2",
                                              "confidence", "reasons", "status")}
        active["fill"] = live.get("fill")
        active["stopNow"] = live["fill"] if live.get("breakeven") else live["stop"]
        if live["status"] == "pending":
            active["reasons"] = active["reasons"] + ["Enter at next bar open (not yet filled)."]
    return signals, active, _replay(signals, lot_size), wait


def _price(price: float, side: str, slip: float) -> float:
    return round(price + slip if side == "BUY" else price - slip, 2)


def _slippage(bar: Dict[str, Any], tick: float) -> float:
    return max(tick, bar.get("spread") or tick) + tick


def _record(trade: Dict[str, Any], bar: Dict[str, Any], price: float, lots: int, reason: str, tick: float,
            exchange: str, lot_size: Optional[int]) -> None:
    buy = trade["side"] == "BUY"
    fill = _price(price, "SELL" if buy else "BUY", _slippage(bar, tick))
    points = (fill - trade["fill"]) if buy else (trade["fill"] - fill)
    fees = None
    if lot_size:
        quantity = lots * lot_size
        fees = fill_fees(fill, quantity, "SELL" if buy else "BUY", exchange)
    trade["exits"].append({"time": bar["t"], "price": fill, "lots": lots, "reason": reason,
                           "points": round(points, 2), "fees": round(fees, 2) if fees is not None else None})
    trade["remaining"] -= lots
    if trade["remaining"] <= 0:
        trade["status"] = "closed"


def _fill(trade: Dict[str, Any], bar: Dict[str, Any], tick: float, exchange: str, lot_size: Optional[int]) -> None:
    buy = trade["side"] == "BUY"
    if (buy and bar["o"] <= trade["stop"]) or (not buy and bar["o"] >= trade["stop"]):
        trade["status"] = "skipped"
        trade["skip"] = "opened beyond stop"
        return
    trade["fill"] = _price(bar["o"], trade["side"], _slippage(bar, tick))
    trade["fillTime"] = bar["t"]
    trade["remaining"] = LOTS
    trade["breakeven"] = False
    trade["status"] = "open"
    trade["entryFees"] = round(fill_fees(trade["fill"], LOTS * lot_size, trade["side"], exchange), 2) if lot_size else None


def _manage(trade: Dict[str, Any], bar: Dict[str, Any], tick: float, exchange: str, lot_size: Optional[int],
            session_over: bool) -> None:
    buy = trade["side"] == "BUY"
    stop = trade["fill"] if trade["breakeven"] else trade["stop"]
    hit_stop = bar["l"] <= stop if buy else bar["h"] >= stop
    if hit_stop:  # conservative: stop assumed before targets inside the same bar
        _record(trade, bar, stop, trade["remaining"], "breakeven" if trade["breakeven"] else "stop",
                tick, exchange, lot_size)
        return
    if trade["remaining"] == LOTS and (bar["h"] >= trade["t1"] if buy else bar["l"] <= trade["t1"]):
        _record(trade, bar, trade["t1"], 1, "T1", tick, exchange, lot_size)
        trade["breakeven"] = True  # effective from the next bar
    if trade["status"] == "open" and (bar["h"] >= trade["t2"] if buy else bar["l"] <= trade["t2"]):
        _record(trade, bar, trade["t2"], trade["remaining"], "T2", tick, exchange, lot_size)
        return
    if trade["status"] == "open" and session_over:
        _record(trade, bar, bar["c"], trade["remaining"], "session close", tick, exchange, lot_size)


def _replay(signals: List[Dict[str, Any]], lot_size: Optional[int]) -> Dict[str, Any]:
    closed = [s for s in signals if s["status"] == "closed"]
    results = []
    for trade in closed:
        points = sum(e["points"] * e["lots"] for e in trade["exits"]) / LOTS
        net = None
        if lot_size:
            gross = sum(e["points"] * e["lots"] * lot_size for e in trade["exits"])
            fees = (trade.get("entryFees") or 0) + sum(e["fees"] or 0 for e in trade["exits"])
            net = gross - fees
            trade["pnl"] = {"gross": round(gross, 2), "fees": round(fees, 2), "net": round(net, 2)}
        trade["points"] = round(points, 2)
        results.append(net if net is not None else points)
    wins = [r for r in results if r > 0]
    losses = [r for r in results if r <= 0]
    equity = peak = drawdown = 0.0
    for value in results:
        equity += value
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
    return {
        "trades": len(results), "wins": len(wins), "winRate": round(len(wins) / len(results), 3) if results else None,
        "unit": "INR net of fees and slippage" if lot_size else "points after slippage (lot size unavailable)",
        "net": round(sum(results), 2), "profitFactor": round(sum(wins) / -sum(losses), 2) if losses and sum(losses) < 0 else None,
        "expectancy": round(sum(results) / len(results), 2) if results else None, "maxDrawdown": round(drawdown, 2),
        "lots": LOTS, "lotSize": lot_size,
    }
