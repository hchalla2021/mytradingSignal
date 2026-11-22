from datetime import datetime, timedelta
from types import SimpleNamespace

from openingedge.context import BASKET, ContextFeed, black_scholes_iv
from openingedge import main
from openingedge.main import IST


def instruments(now):
    equities = [
        {"exchange": "NSE", "tradingsymbol": symbol, "instrument_type": "EQ", "instrument_token": number}
        for number, symbol in enumerate(BASKET, 1)
    ]
    expiry = now.date() + timedelta(days=7)
    derivatives = [
        {"exchange": "NFO", "name": name, "instrument_type": "FUT", "instrument_token": token,
         "tradingsymbol": f"{name}FUT", "expiry": expiry}
        for token, name in [(101, "NIFTY"), (102, "BANKNIFTY")]
    ]
    for number, strike in enumerate([80, 90, 100, 110, 120, 130]):
        for side, offset in (("CE", 0), ("PE", 1)):
            derivatives.append({
                "exchange": "NFO", "name": "NIFTY", "instrument_type": side,
                "instrument_token": 200 + number * 2 + offset,
                "tradingsymbol": f"NIFTY{strike}{side}", "expiry": expiry, "strike": strike,
            })
    currency = [{"exchange": "CDS", "name": "USDINR", "instrument_type": "FUT",
                 "instrument_token": 103, "tradingsymbol": "USDINRFUT", "expiry": expiry}]
    return equities, derivatives, currency


def test_context_live_values_and_staleness():
    now = datetime(2026, 11, 20, 10, tzinfo=IST)
    feed = ContextFeed()
    static = feed.configure(*instruments(now), now)
    assert len(static) == len(BASKET) + 3
    selected = feed.select_options(100, now)
    assert len(selected) == 10 and 210 not in selected
    feed.set_selected(selected)
    ticks = []
    for token in static:
        ticks.append({"instrument_token": token, "exchange_timestamp": now, "last_price": 101,
                      "ohlc": {"close": 100}})
    for token in selected:
        ticks.append({"instrument_token": token, "exchange_timestamp": now, "last_price": 3,
                      "oi": 200 if feed.options[token]["instrument_type"] == "PE" else 100,
                      "depth": {"buy": [{"price": 2.9}], "sell": [{"price": 3.1}]}})
    feed.on_ticks(ticks, now, IST)
    data = feed.snapshot(now, True, 100, 101, {"close": 100, "current_day": now.date().isoformat()})
    assert data["nifty_future"]["value"] == 101
    assert data["usdinr"]["status"] == "LIVE" and "not spot" in data["usdinr"]["detail"]
    assert data["breadth"]["value"] == "10 / 0"
    assert abs(data["heavyweights"]["value"] - 1) < 1e-10
    assert data["pcr"]["value"] == 2
    assert data["iv"]["status"] == "LIVE" and 0 < data["iv"]["value"] < 100
    assert data["auction_gap"]["status"] == "FROZEN"
    assert feed.snapshot(now, False, 100, None, None)["pcr"]["status"] == "UNAVAILABLE"
    stale = feed.snapshot(now + timedelta(seconds=31), True, 100, None, None)
    for name in ("nifty_future", "bank_future", "usdinr", "breadth", "heavyweights", "pcr", "iv"):
        assert stale[name]["status"] == "UNAVAILABLE"


def test_option_partial_oi_and_crossed_depth_are_unavailable():
    now = datetime(2026, 11, 20, 10, tzinfo=IST)
    feed = ContextFeed()
    feed.configure(*instruments(now), now)
    selected = feed.select_options(100, now)
    feed.set_selected(selected)
    ticks = [{"instrument_token": token, "exchange_timestamp": now, "last_price": 3, "oi": 100,
              "depth": {"buy": [{"price": 4}], "sell": [{"price": 3}]}} for token in selected]
    feed.on_ticks(ticks[:-1], now, IST)
    data = feed.snapshot(now, True, 100, None, None)
    assert data["pcr"]["status"] == "UNAVAILABLE"
    assert data["iv"]["status"] == "UNAVAILABLE"
    feed.on_ticks(ticks[-1:], now, IST)
    assert feed.snapshot(now, True, 100, None, None)["pcr"]["value"] == 1
    assert feed.snapshot(now, True, 100, None, None)["iv"]["status"] == "UNAVAILABLE"


def test_older_ticks_cannot_replace_newer_values():
    now = datetime(2026, 11, 20, 10, tzinfo=IST)
    feed = ContextFeed()
    feed.configure(*instruments(now), now)
    feed.on_ticks([
        {"instrument_token": 101, "timestamp": now, "last_price": 105, "ohlc": {"close": 100}},
        {"instrument_token": 101, "timestamp": now - timedelta(seconds=5), "last_price": 99, "ohlc": {"close": 100}},
    ], now, IST)
    assert feed.snapshot(now, True, None, None, None)["nifty_future"]["value"] == 105


def test_option_selection_needs_valid_spot_and_filters_expired_contracts():
    now = datetime(2026, 11, 20, 15, 30, tzinfo=IST)
    equities, derivatives, currency = instruments(now)
    for row in derivatives:
        row["expiry"] = now.date()
    feed = ContextFeed()
    feed.configure(equities, derivatives, currency, now)
    assert feed.select_options(100, now) == set()
    assert feed.select_options(float("nan"), now) == set()
    assert feed.snapshot(now, True, 100, None, None)["nifty_future"]["status"] == "UNAVAILABLE"


def test_implied_volatility_rejects_impossible_prices():
    assert black_scholes_iv(101, 100, 100, 0.1, True) is None
    assert black_scholes_iv(0, 100, 100, 0.1, True) is None
    assert black_scholes_iv(5, 100, 100, 0, True) is None
    assert 0 < black_scholes_iv(5, 100, 100, 0.1, True) < 100


def test_feed_subscribes_context_and_dynamic_options_without_extra_socket(monkeypatch):
    now = datetime(2026, 11, 20, 10, tzinfo=IST)
    equities, derivatives, currency = instruments(now)
    equities += [
        {"exchange": "NSE", "tradingsymbol": "NIFTY 50", "instrument_token": 301},
        {"exchange": "NSE", "tradingsymbol": "NIFTY BANK", "instrument_token": 302},
    ]
    sensex = [{"exchange": "BSE", "tradingsymbol": "SENSEX", "instrument_token": 303}]
    class Kite:
        def __init__(self, api_key):
            pass
        def set_access_token(self, token):
            pass
        def instruments(self, exchange):
            return {"NSE": equities, "BSE": sensex, "NFO": derivatives, "CDS": currency}[exchange]
    sockets = []
    class Ticker:
        MODE_FULL = "full"
        def __init__(self, *credentials):
            self.subscriptions = []
            sockets.append(self)
        def subscribe(self, tokens):
            self.subscriptions.append(set(tokens))
        def unsubscribe(self, tokens):
            pass
        def set_mode(self, mode, tokens):
            assert mode == "full"
        def connect(self, threaded):
            self.on_connect(self, {})
            self.on_ticks(self, [{"instrument_token": 301, "exchange_timestamp": now, "last_price": 100}])
        def close(self):
            pass
    class OneIteration:
        stopped = False
        def is_set(self):
            return self.stopped
        def wait(self, seconds):
            self.stopped = True
    market = main.Market(lambda: now)
    monkeypatch.setattr(main, "market", market)
    monkeypatch.setattr(main, "shutdown", OneIteration())
    monkeypatch.setattr(main, "credentials", lambda: ("fake-key", "fake-token"))
    monkeypatch.setattr(main, "load_history", lambda *args: None)
    monkeypatch.setitem(__import__("sys").modules, "kiteconnect", SimpleNamespace(KiteConnect=Kite, KiteTicker=Ticker))
    main.run_feed()
    assert len(sockets) == 1
    assert {301, 302, 303, 101, 102, 103}.issubset(sockets[0].subscriptions[0])
    assert len(sockets[0].subscriptions[1]) == 10
    assert sockets[0].subscriptions[1] == set(market.context.selected)


def test_missing_derivative_instruments_retry_without_disconnecting_index_feed(monkeypatch):
    clock = [datetime(2026, 11, 20, 10, tzinfo=IST)]
    equities, derivatives, currency = instruments(clock[0])
    equities += [
        {"exchange": "NSE", "tradingsymbol": "NIFTY 50", "instrument_token": 301},
        {"exchange": "NSE", "tradingsymbol": "NIFTY BANK", "instrument_token": 302},
    ]
    calls = []
    class Kite:
        def __init__(self, api_key):
            pass
        def set_access_token(self, token):
            pass
        def instruments(self, exchange):
            if exchange == "NFO":
                calls.append(exchange)
                if len(calls) == 1:
                    raise OSError("Temporary failure")
            return {"NSE": equities, "BSE": [{"exchange": "BSE", "tradingsymbol": "SENSEX",
                    "instrument_token": 303}], "NFO": derivatives, "CDS": currency}[exchange]
    sockets = []
    class Ticker:
        MODE_FULL = "full"
        def __init__(self, *credentials):
            self.subscriptions = []
            sockets.append(self)
        def subscribe(self, tokens):
            self.subscriptions.append(set(tokens))
        def unsubscribe(self, tokens):
            pass
        def set_mode(self, mode, tokens):
            pass
        def connect(self, threaded):
            self.on_connect(self, {})
        def close(self):
            pass
    class TwoIterations:
        count = 0
        def is_set(self):
            return self.count >= 2
        def wait(self, seconds):
            self.count += 1
            clock[0] += timedelta(minutes=5)
    market = main.Market(lambda: clock[0])
    monkeypatch.setattr(main, "market", market)
    monkeypatch.setattr(main, "shutdown", TwoIterations())
    monkeypatch.setattr(main, "credentials", lambda: ("fake-key", "fake-token"))
    monkeypatch.setattr(main, "load_history", lambda *args: None)
    monkeypatch.setitem(__import__("sys").modules, "kiteconnect", SimpleNamespace(KiteConnect=Kite, KiteTicker=Ticker))
    main.run_feed()
    assert len(sockets) == 1 and len(calls) == 2
    assert {301, 302, 303}.issubset(sockets[0].subscriptions[0])
    assert {101, 102}.issubset(sockets[0].subscriptions[1])
