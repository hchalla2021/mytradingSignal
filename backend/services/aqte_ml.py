"""AQTE-specific research features and LightGBM shadow inference, never order authority."""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Mapping

from services.aqte_engine import IST, SYMBOLS, Policy, Tick, day, session

if TYPE_CHECKING:
    import lightgbm

SCHEMA = "aqte-option-quality-v1"
HORIZON_SECONDS = 300
TARGET = "positive_net_option_return_300s_after_observed_no_chase_fill"
FEATURE_NAMES = (
    "nifty", "banknifty", "sensex", "is_ce",
    "ema9_20_pct", "ema20_50_pct", "ema50_100_pct", "ema100_200_pct",
    "rsi", "atr_pct", "vwap_distance_pct", "supertrend_direction",
    "volume_ratio", "futures_imbalance", "breakout", "sweep",
    "premium_spot_pct", "spread_fraction", "bid_lots_log", "ask_lots_log",
    "moneyness_pct", "days_to_expiry", "session_fraction",
)


class MLUnavailable(ValueError):
    """Explicit missing/incompatible model or unusable feature evidence."""


def feature_vector(signal: Mapping[str, Any], quote: Tick) -> tuple[float, ...]:
    """Use only contemporaneous data; never impute unavailable market evidence."""
    try:
        symbol, decision = signal["symbol"], signal["decision"]
        info, contract = signal["intelligence"], signal["contract"]
        observed = float(signal["at"])
        if not math.isfinite(observed) or not session(observed):
            raise MLUnavailable("ML observation must be inside a regular market session")
        spot, close = float(signal["spot"]), float(info["close"])
        lots = int(contract["lot_size"])
        if symbol not in SYMBOLS or decision not in ("BUY CE", "BUY PE"):
            raise MLUnavailable("ML requires an existing AQTE BUY candidate")
        if quote.token != contract["token"] or quote.symbol != symbol or quote.kind != "option":
            raise MLUnavailable("ML option quote does not match the candidate contract")
        if decision != f'BUY {contract["side"]}':
            raise MLUnavailable("ML candidate side does not match its contract")
        if not all(math.isfinite(value) and value > 0 for value in (spot, close, quote.ask, quote.bid)):
            raise MLUnavailable("ML needs positive finite prices")
        if lots <= 0 or not 0 < quote.bid <= quote.ask or quote.ask_quantity < lots or quote.bid_quantity < lots:
            raise MLUnavailable("ML requires executable one-lot bid/ask depth")
        if not 0 <= observed - quote.at <= 5 or not 0 <= observed - quote.received <= 5:
            raise MLUnavailable("ML option quote is stale or future-dated")
        minute = int(observed // 60) * 60
        if info["at"] != minute - 60:
            raise MLUnavailable("ML requires the immediately preceding completed futures candle")
        if info["supertrend"] not in ("BULLISH", "BEARISH"):
            raise MLUnavailable("ML trend evidence unavailable")
        expires = datetime.strptime(contract["expiry"], "%Y-%m-%d").date()
        dt = datetime.fromtimestamp(observed, IST)
        days = (expires - dt.date()).days
        if days < 0 or not 0 <= info["rsi"] <= 100 or not -1 <= info["imbalance"] <= 1:
            raise MLUnavailable("ML feature evidence outside its supported range")
        ema = [float(info["ema"][str(period)]) for period in (9, 20, 50, 100, 200)]
        if any(value <= 0 for value in (*ema, float(info["vwap"]))) or (
            info["atr"] < 0 or info["volume_ratio"] < 0
            or info["breakout"] not in (-1, 0, 1) or info["sweep"] not in (-1, 0, 1)
        ):
            raise MLUnavailable("ML indicators outside their supported range")
        values = (
            *(float(symbol == name) for name in SYMBOLS), float(decision == "BUY CE"),
            *((a - b) / close * 100 for a, b in zip(ema, ema[1:])),
            float(info["rsi"]) / 100, float(info["atr"]) / close * 100,
            (close - float(info["vwap"])) / close * 100,
            1.0 if info["supertrend"] == "BULLISH" else -1.0,
            float(info["volume_ratio"]), float(info["imbalance"]),
            float(info["breakout"]), float(info["sweep"]),
            quote.ask / spot * 100, (quote.ask - quote.bid) / quote.ask,
            math.log1p(quote.bid_quantity / lots), math.log1p(quote.ask_quantity / lots),
            (float(contract["strike"]) - spot) / spot * 100, float(days),
            (dt.hour * 60 + dt.minute - 555) / 375,
        )
    except MLUnavailable:
        raise
    except (KeyError, ValueError, TypeError, OverflowError) as exc:
        raise MLUnavailable("ML features incomplete or invalid") from exc
    if not all(math.isfinite(value) for value in values):
        raise MLUnavailable("ML features contain non-finite values")
    return values


@dataclass(frozen=True)
class Sample:
    symbol: str
    token: int
    signal_at: float
    entry_at: float
    label_at: float
    features: tuple[float, ...]
    net_return: float

    @property
    def label(self) -> int:
        return int(self.net_return > 0)

    def validate(self) -> None:
        times = (self.signal_at, self.entry_at, self.label_at)
        if self.symbol not in SYMBOLS or self.token <= 0 or not all(math.isfinite(v) for v in times):
            raise ValueError("Invalid ML sample identity or timestamp")
        if not self.signal_at < self.entry_at < self.label_at or day(self.signal_at) != day(self.label_at):
            raise ValueError("ML labels must follow their entry within the same IST session")
        if not all(session(value) for value in times):
            raise ValueError("ML samples must stay within a regular market session")
        if self.entry_at - self.signal_at >= Policy().order_lifetime:
            raise ValueError("ML hypothetical entry exceeds its no-chase order lifetime")
        if not HORIZON_SECONDS <= self.label_at - self.entry_at <= HORIZON_SECONDS + 5:
            raise ValueError("ML label horizon differs from the feature/target contract")
        if len(self.features) != len(FEATURE_NAMES) or not all(math.isfinite(v) for v in self.features):
            raise ValueError("ML feature schema mismatch")
        if not math.isfinite(self.net_return):
            raise ValueError("Invalid ML net return")


class ShadowModel:
    def __init__(self, booster: lightgbm.Booster, model_id: str, symbols: tuple[str, ...],
                 coverage: tuple[str, ...], train_label_end: float, holdout_end: float):
        self.booster = booster
        self.model_id = model_id
        self.symbols = symbols
        self.coverage = coverage
        self.train_label_end = train_label_end
        self.holdout_end = holdout_end

    @classmethod
    def load(cls, path: Path) -> ShadowModel:
        bundle = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(bundle, dict):
            raise MLUnavailable("AQTE ML artifact must be a JSON object")
        if bundle.get("schema") != SCHEMA or bundle.get("target") != TARGET or (
            bundle.get("features") != list(FEATURE_NAMES) or bundle.get("mode") != "SHADOW"
            or bundle.get("validated") is not False
        ):
            raise MLUnavailable("AQTE ML artifact schema, target or research-only contract mismatch")
        model_text = bundle["model_text"]
        digest = hashlib.sha256(model_text.encode("utf-8")).hexdigest()
        if digest != bundle.get("sha256"):
            raise MLUnavailable("AQTE ML artifact checksum mismatch")
        symbols = tuple(bundle["symbols"])
        if not symbols or any(symbol not in SYMBOLS for symbol in symbols):
            raise MLUnavailable("AQTE ML artifact has invalid symbol coverage")
        coverage = tuple(bundle["coverage"])
        if not coverage or any(key not in {f"{symbol}:{side}" for symbol in symbols for side in ("CE", "PE")}
                               for key in coverage):
            raise MLUnavailable("AQTE ML artifact has invalid option-side coverage")
        report = bundle["report"]
        train_end, test_start, test_end = (float(report[key]) for key in
                                         ("train_label_end", "holdout_start", "holdout_end"))
        if not all(math.isfinite(value) for value in (train_end, test_start, test_end)) or (
            not (train_end < test_start - HORIZON_SECONDS and test_start < test_end)
        ):
            raise MLUnavailable("AQTE ML artifact does not describe a chronological embargoed evaluation")
        import lightgbm as lgb

        try:
            booster = lgb.Booster(model_str=model_text)
        except lgb.basic.LightGBMError as exc:
            raise MLUnavailable("AQTE LightGBM model could not be loaded") from exc
        if tuple(booster.feature_name()) != FEATURE_NAMES:
            raise MLUnavailable("AQTE LightGBM feature order mismatch")
        if not str(booster.dump_model().get("objective", "")).startswith("binary"):
            raise MLUnavailable("AQTE ML artifact is not a binary classifier")
        return cls(booster, digest[:16], symbols, coverage, train_end, test_end)

    def predict(self, signal: Mapping[str, Any], quote: Tick) -> dict[str, Any]:
        import lightgbm as lgb
        import numpy as np

        if signal["symbol"] not in self.symbols:
            raise MLUnavailable("No training coverage for this index")
        features = feature_vector(signal, quote)
        if f'{signal["symbol"]}:{signal["contract"]["side"]}' not in self.coverage:
            raise MLUnavailable("No training coverage for this index/option side")
        if signal["at"] <= self.holdout_end:
            raise MLUnavailable("Shadow observations must follow the model's complete holdout period")
        try:
            probability = float(self.booster.predict(np.asarray([features]), num_threads=1)[0])
        except lgb.basic.LightGBMError as exc:
            raise MLUnavailable("AQTE LightGBM inference failed") from exc
        if not math.isfinite(probability) or not 0 <= probability <= 1:
            raise MLUnavailable("AQTE LightGBM produced an invalid probability")
        return dict(
            status="SHADOW", affects_orders=False, validated=False, calibrated=False,
            model_id=self.model_id, target=TARGET, horizon_seconds=HORIZON_SECONDS,
            train_label_end=self.train_label_end, holdout_end=self.holdout_end,
            observed_at=signal["at"], candle_at=signal["intelligence"]["at"],
            token=quote.token, probability_positive_net_return=round(probability, 6),
        )
