"""Institutional pressure scoring (FII/DII proxy inference)."""

from __future__ import annotations

from typing import Any, Dict, Optional


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _global_risk_score(global_snapshot: Optional[Dict[str, Any]]) -> float:
    if not global_snapshot:
        return 0.0
    weights = {
        "DJI": 0.22,
        "SPX": 0.20,
        "IXIC": 0.16,
        "DAX": 0.15,
        "FTSE": 0.12,
        "NIKKEI": 0.15,
    }
    total = 0.0
    total_w = 0.0
    for sym, w in weights.items():
        item = global_snapshot.get(sym) or {}
        chg = float(item.get("changePct") or 0.0)
        total += _clamp(chg / 1.25, -1.0, 1.0) * w
        total_w += w
    if total_w <= 0:
        return 0.0
    return _clamp(total / total_w, -1.0, 1.0)


def compute_institutional_pressure(
    *,
    raw_score: float,
    spot_change_pct: float,
    near_premium_pct: float,
    fair_value_pct: float,
    rsi: Optional[float],
    volume_score: float,
    trend_structure_score: float,
    global_snapshot: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Return institutional pressure score in [-100, +100] with explainability."""
    premium_dev = 0.0
    if fair_value_pct > 0:
        premium_dev = _clamp((near_premium_pct - fair_value_pct) / max(fair_value_pct * 0.6, 0.05), -1.0, 1.0)

    rsi_score = 0.0 if rsi is None else _clamp((float(rsi) - 50.0) / 20.0, -1.0, 1.0)
    spot_momo = _clamp(spot_change_pct / 0.55, -1.0, 1.0)
    global_risk = _global_risk_score(global_snapshot)

    # FII proxy: futures basis + global risk + tactical momentum
    fii = _clamp(
        premium_dev * 0.50 +
        global_risk * 0.30 +
        spot_momo * 0.20,
        -1.0,
        1.0,
    )

    # DII proxy: domestic trend absorption + RSI + volume confirmation
    dii = _clamp(
        trend_structure_score * 0.45 +
        rsi_score * 0.35 +
        volume_score * 0.20,
        -1.0,
        1.0,
    )

    composite = _clamp(
        raw_score * 0.40 +
        fii * 0.35 +
        dii * 0.25,
        -1.0,
        1.0,
    )
    score = int(round(composite * 100))

    if score >= 35:
        label = "STRONG_BUY_PRESSURE"
    elif score >= 12:
        label = "BUY_PRESSURE"
    elif score <= -35:
        label = "STRONG_SELL_PRESSURE"
    elif score <= -12:
        label = "SELL_PRESSURE"
    else:
        label = "BALANCED_FLOW"

    return {
        "score": score,
        "label": label,
        "fiiProxy": int(round(fii * 100)),
        "diiProxy": int(round(dii * 100)),
        "drivers": {
            "rawScore": round(raw_score, 4),
            "premiumDev": round(premium_dev, 4),
            "spotMomentum": round(spot_momo, 4),
            "rsiScore": round(rsi_score, 4),
            "volumeScore": round(volume_score, 4),
            "trendStructure": round(trend_structure_score, 4),
            "globalRisk": round(global_risk, 4),
        },
    }
