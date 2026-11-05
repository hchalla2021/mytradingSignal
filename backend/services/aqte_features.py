"""Revision-aware completed-candle features shared by AQTE rules and advisory evaluators."""

from services.aqte_engine import WARMUP_CANDLES, closed_intelligence, session_bars, warmup_count
from services.aqte_engines import resample


class FeatureCache:
    def __init__(self, metrics):
        self.metrics = metrics
        self.entries = {}

    def get(self, book, token, at, previous_day=None):
        key = ("future", token, 60)
        previous = tuple((previous_day or {}).get(name) for name in ("high", "low", "close"))
        version = (book.revisions[key], int(at // 60), previous)
        cached = self.entries.get(token)
        if cached is not None and cached["version"] == version:
            self.metrics.increment("feature_cache_hits")
            return cached
        with self.metrics.measure("features.completed_candle"):
            bars = list(book.closed[key])
            completed = warmup_count(bars, at)
            # Only a contiguous tail is eligible for partial advisory indicators.
            eligible = bars if completed == WARMUP_CANDLES else (bars[-completed:] if completed else [])
            values = closed_intelligence(eligible, at, previous_day, partial=True)
            result = dict(version=version, values=values, bars=eligible, completed=completed,
                          opening=warmup_count(session_bars(bars, at), at),
                          timeframes={"5m": resample(eligible, 300), "15m": resample(eligible, 900)})
        self.entries[token] = result
        self.metrics.increment("feature_revisions")
        return result

    def retain(self, tokens):
        self.entries = {token: entry for token, entry in self.entries.items() if token in tokens}

    def diagnostics(self):
        result = {}
        for token, entry in self.entries.items():
            values = entry["values"] or {}
            readiness = {name: values.get(name) is not None
                         for name in ("rsi", "atr", "adx", "vwap", "supertrend", "cpr", "pivots", "volume_ratio")}
            readiness.update({f"ema_{period}": value is not None for period, value in values.get("ema", {}).items()})
            result[str(token)] = dict(completed=entry["completed"], opening=entry["opening"],
                                     completed_bar_at=values.get("at"), indicators=readiness,
                                     timeframes={name: dict(completed=len(closes), forming_included=False)
                                                 for name, closes in entry["timeframes"].items()},
                                     forming_candle_included=False)
        return result
