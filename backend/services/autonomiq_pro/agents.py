"""AUTONOMIQ PRO agents.

Deterministic agents (Python): MarketAnalysisAgent, QuantResearchAgent, SignalValidationAgent.
AI agents (Anthropic): StrategyAgent, RiskReviewAgent — they only choose/critique direction;
all prices come from live Zerodha quotes, never from the model.
"""

from __future__ import annotations

from . import indicators as ind

ACTIONS = ("BUY_CE", "BUY_PE", "WAIT", "NO_TRADE")


def _trend(candles: list[dict], fast: int, slow: int) -> dict | None:
    if len(candles) < slow + 5:
        return None
    closes = [c["close"] for c in candles]
    f, s = ind.ema(closes, fast)[-1], ind.ema(closes, slow)[-1]
    st = ind.supertrend(candles)
    close = closes[-1]
    if close > f > s:
        label = "UP"
    elif close < f < s:
        label = "DOWN"
    else:
        label = "SIDEWAYS"
    return {"trend": label, "close": round(close, 2), f"ema{fast}": round(f, 2), f"ema{slow}": round(s, 2),
            "supertrend": ("UP" if st[0] == 1 else "DOWN") if st else None,
            "supertrend_line": round(st[1], 2) if st else None}


class MarketAnalysisAgent:
    name = "market-analysis"

    def run(self, data: dict, now_day: str) -> dict:
        c5, c15, c60 = (data["candles"].get(k) or [] for k in ("5m", "15m", "60m"))
        today = [c for c in c5 if c["date"][:10] == now_day]
        earlier_days = sorted({c["date"][:10] for c in c5 if c["date"][:10] < now_day})
        prev = [c for c in c5 if earlier_days and c["date"][:10] == earlier_days[-1]]
        atr5 = ind.atr(c5)
        atr15 = ind.atr(c15)
        t15 = _trend(c15, 20, 50)
        regime = None
        if t15 and atr15:
            spread = abs(t15["ema20"] - t15["ema50"]) / atr15
            regime = "TRENDING" if spread >= 1.0 else "RANGING"
        return {
            "timeframes": {"5m": _trend(c5, 9, 21), "15m": t15, "60m": _trend(c60, 20, 50)},
            "atr_5m": round(atr5, 2) if atr5 else None, "atr_15m": round(atr15, 2) if atr15 else None,
            "rsi_5m": round(ind.rsi([c["close"] for c in c5]) or 0, 2) if len(c5) > 15 else None,
            "rsi_15m": round(ind.rsi([c["close"] for c in c15]) or 0, 2) if len(c15) > 15 else None,
            "regime": regime,
            "day_high": max((c["high"] for c in today), default=None),
            "day_low": min((c["low"] for c in today), default=None),
            "prev_day_high": max((c["high"] for c in prev), default=None),
            "prev_day_low": min((c["low"] for c in prev), default=None),
            "sparkline": [round(c["close"], 2) for c in today][-75:],
        }


class QuantResearchAgent:
    """Scores directional edge from -100 (strong bearish) to +100 (strong bullish)."""

    name = "quant-research"

    def run(self, analysis: dict, data: dict) -> dict:
        score, factors, flags = 0.0, [], []

        def add(points: float, text: str) -> None:
            nonlocal score
            score += points
            factors.append({"points": points, "factor": text})

        tf = analysis["timeframes"]
        for key, weight in (("60m", 15), ("15m", 15), ("5m", 10)):
            t = tf.get(key)
            if t and t["trend"] == "UP":
                add(weight, f"{key} trend up (price > fast EMA > slow EMA)")
            elif t and t["trend"] == "DOWN":
                add(-weight, f"{key} trend down (price < fast EMA < slow EMA)")
        for key, weight in (("15m", 10), ("5m", 5)):
            t = tf.get(key)
            if t and t.get("supertrend"):
                add(weight if t["supertrend"] == "UP" else -weight, f"{key} SuperTrend {t['supertrend']}")

        fut = data.get("futures") or {}
        if fut.get("ltp") and fut.get("vwap"):
            above = fut["ltp"] > fut["vwap"]
            add(10 if above else -10, f"Futures {'above' if above else 'below'} VWAP {fut['vwap']}")
        imbalance = fut.get("order_imbalance")
        if imbalance is not None and abs(imbalance) >= 0.15:
            add(5 if imbalance > 0 else -5, f"Futures order-book imbalance {imbalance:+.2f}")

        rsi5 = analysis.get("rsi_5m")
        if rsi5:
            if 55 <= rsi5 <= 72:
                add(10, f"RSI 5m {rsi5} bullish momentum")
            elif 28 <= rsi5 <= 45:
                add(-10, f"RSI 5m {rsi5} bearish momentum")
            if rsi5 > 78 or rsi5 < 22:
                flags.append(f"RSI 5m extreme ({rsi5})")

        opt = data.get("options") or {}
        pcr = opt.get("pcr")
        if pcr:
            if pcr >= 1.2:
                add(5, f"PCR {pcr} — put writing support")
            elif pcr <= 0.8:
                add(-5, f"PCR {pcr} — call writing resistance")
        dc, dp = opt.get("call_oi_change"), opt.get("put_oi_change")
        if dc is not None and dp is not None and (dc or dp):
            add(5 if dp > dc else -5, f"OI change: puts {dp:+,} vs calls {dc:+,}")

        t5 = tf.get("5m")
        atr5 = analysis.get("atr_5m")
        if t5 and atr5 and abs(t5["close"] - t5["ema21"]) > 2.2 * atr5:
            flags.append("Price extended > 2.2 ATR from 5m EMA21")
        if fut.get("volume_ratio") and fut["volume_ratio"] >= 1.5 and t5:
            add(5 if t5["trend"] == "UP" else -5 if t5["trend"] == "DOWN" else 0,
                f"Futures volume {fut['volume_ratio']}x average")

        score = max(min(score, 100), -100)
        bias = "BULLISH" if score >= 25 else "BEARISH" if score <= -25 else "NEUTRAL"
        return {"score": round(score, 1), "bias": bias, "factors": factors, "flags": flags,
                "pcr": pcr, "atm_iv": opt.get("atm_iv")}


STRATEGY_SYSTEM = """You are the Strategy Agent of AUTONOMIQ PRO, an intraday Indian index-options desk
(NIFTY, BANKNIFTY on NSE; SENSEX on BSE). You receive pre-computed, live, completed-candle features,
option-chain metrics and a deterministic quant score for each index.

Rules:
- Decide one action for each index present in the input (only those): BUY_CE, BUY_PE, WAIT or NO_TRADE.
  Long options only.
- Prefer WAIT when signals conflict, price is extended, or edge is unclear. NO_TRADE when data quality is poor.
- Do NOT output prices, strikes, stop-losses or targets; the execution layer derives them from live quotes.
- Never invent data that is not in the input.
- Respond with ONE compact JSON object only, no markdown, no extra text (hard limit ~350 tokens), exactly:
{"market_alert":{"tone":"BULLISH|BEARISH|NEUTRAL|CAUTION","title":"<= 5 words","detail":"<= 20 words"},
 "summary":"<= 45 words of market analysis",
 "indices":{"<INDEX>":{"action":"...","conviction":0-100,"reasoning":"<= 20 words","risks":["<= 8 words"]}}}"""

def strategy_payload(contexts: dict[str, dict], session: dict) -> dict:
    return {"session": session, "indices": {
        symbol: {
            "spot": ctx["spot"], "analysis": {k: v for k, v in ctx["analysis"].items() if k != "sparkline"},
            "quant": {k: ctx["quant"][k] for k in ("score", "bias", "flags", "pcr", "atm_iv")},
            "quant_factors": [f["factor"] for f in ctx["quant"]["factors"]],
            "futures": ctx["data"].get("futures"),
            "options": {k: v for k, v in (ctx["data"].get("options") or {}).items() if k != "strikes"},
            "data_errors": ctx["data"]["errors"],
        } for symbol, ctx in contexts.items()}}


def normalize_strategy(result: dict) -> dict:
    """Validate the AI output shape; anything malformed degrades to WAIT."""
    indices = {}
    for symbol, raw in (result.get("indices") or {}).items():
        if not isinstance(raw, dict):
            continue
        action = str(raw.get("action", "WAIT")).upper().replace(" ", "_")
        try:
            conviction = max(0.0, min(float(raw.get("conviction", 0)), 100.0))
        except (TypeError, ValueError):
            conviction = 0.0
        indices[str(symbol).upper()] = {
            "action": action if action in ACTIONS else "WAIT", "conviction": conviction,
            "reasoning": str(raw.get("reasoning", ""))[:400],
            "risks": [str(r)[:160] for r in (raw.get("risks") or []) if isinstance(r, (str, int, float))][:4],
        }
    alert = result.get("market_alert") if isinstance(result.get("market_alert"), dict) else {}
    tone = str(alert.get("tone", "NEUTRAL")).upper()
    return {
        "market_alert": {"tone": tone if tone in ("BULLISH", "BEARISH", "NEUTRAL", "CAUTION") else "NEUTRAL",
                         "title": str(alert.get("title", ""))[:80], "detail": str(alert.get("detail", ""))[:300]},
        "summary": str(result.get("summary", ""))[:700],
        "indices": indices,
    }


def data_problems(ctx: dict) -> list[str]:
    data, problems = ctx["data"], []
    if not ctx["spot"].get("fresh"):
        problems.append("Live spot tick missing or stale")
    if not data["candles"].get("5m") or not data["candles"].get("15m"):
        problems.append("Completed candles unavailable")
    if not data.get("options"):
        problems.append("Option chain unavailable")
    return problems


def quant_action(ctx: dict, min_score: float) -> tuple[str, str]:
    """Deterministic quant decision. The AI can only confirm it or downgrade it to WAIT."""
    quant = ctx["quant"]
    score = quant["score"]
    action = "BUY_CE" if score >= min_score else "BUY_PE" if score <= -min_score else "WAIT"
    if action != "WAIT" and any("extended" in f or "extreme" in f for f in quant["flags"]):
        return "WAIT", "Quant edge present but price is extended — wait for pullback"
    return action, f"Quant score {score:+.0f} ({quant['bias'].lower()})"


class SignalValidationAgent:
    """Reconciles the AI strategy with the quant engine. AI cannot override the numbers."""

    name = "signal-validation"

    def run(self, symbol: str, ctx: dict, ai: dict | None, min_score: float, require_ai: bool,
            ai_state: str) -> dict:
        quant = ctx["quant"]
        problems = data_problems(ctx)
        if problems:
            return {"action": "NO_TRADE", "score": quant["score"], "strength": "Low",
                    "reasoning": "; ".join(problems), "source": "validation", "conviction": 0}

        score = quant["score"]
        quant_action_, quant_note = quant_action(ctx, min_score)

        if ai is None:
            if require_ai and quant_action_ in ("BUY_CE", "BUY_PE"):
                return {"action": "WAIT", "score": score, "strength": _strength(abs(score)), "conviction": abs(score),
                        "reasoning": f"{quant_note}. Awaiting AI confirmation ({ai_state}).", "source": "quant"}
            return {"action": quant_action_, "score": score, "strength": _strength(abs(score)),
                    "conviction": abs(score), "reasoning": quant_note, "source": "quant"}

        ai_action = ai["action"]
        conviction = round((abs(score) + ai["conviction"]) / 2, 1)
        if ai_action in ("WAIT", "NO_TRADE"):
            action, reason = ai_action, ai["reasoning"] or quant_note
        elif ai_action == quant_action_:
            action, reason = ai_action, f"{ai['reasoning']} {quant_note}.".strip()
        else:
            action = "WAIT"
            reason = f"AI suggested {ai_action.replace('_', ' ')} but quant engine disagrees ({quant_note})."
        return {"action": action, "score": score, "strength": _strength(conviction), "conviction": conviction,
                "reasoning": reason, "risks": ai.get("risks", []), "source": "ai+quant"}


def _strength(value: float) -> str:
    return "High" if value >= 75 else "Medium" if value >= 55 else "Low"
