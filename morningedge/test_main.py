from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient

import main


class Clock:
    def __init__(self, value):
        self.value = value

    def __call__(self):
        return self.value


def test_status_is_feed_only_and_never_reports_simulated_trades(monkeypatch):
    engine = main.MorningMarketEngine(Clock(datetime(2026, 11, 11, 9, 21, tzinfo=main.TZ)))
    monkeypatch.setattr(main, "ENGINE", engine)
    monkeypatch.setattr(main, "FEED_ENABLED", False)
    monkeypatch.setattr(main, "FEED_STATE", "off")
    client = TestClient(main.app)

    status = client.get("/api/status").json()

    assert status["feed_enabled"] is False
    assert status["feed_status"] == "off"
    assert status["trade_enabled"] is False
    assert status["can_enable_trading"] is False
    assert set(status["indices"]) == {"NIFTY", "BANKNIFTY", "SENSEX"}
    assert set(status["signal"]) == {
        "decision", "reason", "symbol", "contract", "entry", "stop", "trailing_stop",
    }
    assert "paper" not in str(status).lower()
    assert "daily_pnl" not in status
    assert "active" not in status


def test_feed_off_closes_socket_and_clears_live_ticks(monkeypatch):
    engine = main.MorningMarketEngine()
    monkeypatch.setattr(main, "ENGINE", engine)
    monkeypatch.setattr(main, "FEED_ENABLED", True)
    monkeypatch.setattr(main, "FEED_STATE", "connected")
    monkeypatch.setattr(main, "FEED_GENERATION", 0)

    class Socket:
        closed = False

        def close(self):
            self.closed = True

    socket = Socket()
    monkeypatch.setattr(main, "KITE_SOCKET", socket)
    engine.ticks[1] = {"price": 22000}
    response = TestClient(main.app).post("/api/feed/control", json={"enabled": False})

    assert response.status_code == 200
    assert response.json() == {"feed_enabled": False, "feed_status": "off", "trade_enabled": False}
    assert socket.closed
    assert not engine.ticks
    status = TestClient(main.app).get("/api/status").json()
    assert status["signal"]["reason"] == "Waiting for live market data."
    assert "feed is off" not in status["signal"]["reason"].lower()


def test_feed_control_rejects_extra_fields():
    response = TestClient(main.app).post(
        "/api/feed/control", json={"enabled": False, "trade_enabled": True},
    )
    assert response.status_code == 422


def test_kite_credentials_read_only_from_backend_env_keys(tmp_path):
    env_file = tmp_path / "backend.env"
    env_file.write_text(
        "ZERODHA_API_KEY=api-key-value\n"
        "ZERODHA_API_SECRET=must-not-be-read\n"
        "ZERODHA_ACCESS_TOKEN=access-token-value\n"
        "JWT_SECRET=must-not-be-read-either\n",
        encoding="utf-8",
    )
    assert main.load_kite_credentials(env_file) == ("api-key-value", "access-token-value")


def test_kite_websocket_403_explains_access_token_recovery():
    message = main._feed_error_message(
        "connection was closed uncleanly (WebSocket connection upgrade failed (403 - Forbidden))",
    )

    assert "shared backend/.env file" in message
    assert "reconnects automatically when that token changes" in message
    assert "turn the feed OFF and ON" in message


class FakeSocket:
    closed = False

    def close(self):
        self.closed = True


def _capture_feed_threads(monkeypatch):
    started = []

    class Thread:
        def __init__(self, target, args=(), **kwargs):
            self.target, self.args = target, args

        def start(self):
            started.append((self.target, self.args))

    monkeypatch.setattr(main.threading, "Thread", Thread)
    return started


def _feed_globals(monkeypatch, tmp_path, token, state, credentials):
    env_file = tmp_path / "backend.env"
    env_file.write_text(f"ZERODHA_API_KEY=key\nZERODHA_ACCESS_TOKEN={token}\n", encoding="utf-8")
    monkeypatch.setattr(main, "CREDENTIALS_FILE", env_file)
    monkeypatch.setattr(main, "ENGINE", main.MorningMarketEngine())
    monkeypatch.setattr(main, "FEED_ENABLED", True)
    monkeypatch.setattr(main, "FEED_STATE", state)
    monkeypatch.setattr(main, "FEED_GENERATION", 3)
    monkeypatch.setattr(main, "FEED_CREDENTIALS", credentials)
    monkeypatch.setattr(main, "FEED_DOWN_SINCE", None)
    monkeypatch.setattr(main, "FEED_RETRY_SECONDS", main.FEED_RETRY_MIN_SECONDS)
    socket = FakeSocket()
    monkeypatch.setattr(main, "KITE_SOCKET", socket)
    return socket


def test_new_backend_env_token_reconnects_in_process_and_keeps_preopen_ticks(monkeypatch, tmp_path):
    socket = _feed_globals(monkeypatch, tmp_path, "today", "connected", ("key", "today"))
    started = _capture_feed_threads(monkeypatch)
    assert main.supervise_feed(now=0) is False
    assert started == [] and not socket.closed

    preopen_tick = (datetime(2026, 11, 13, 9, 0, 5, tzinfo=main.TZ), 26000.0)
    main.ENGINE.preopen["NIFTY"].append(preopen_tick)
    main.CREDENTIALS_FILE.write_text("ZERODHA_API_KEY=key\nZERODHA_ACCESS_TOKEN=next-day\n", encoding="utf-8")

    assert main.supervise_feed(now=15) is True
    assert socket.closed
    assert started == [(main.start_feed, (4,))]
    assert main.FEED_STATE == "connecting"
    assert main.ENGINE.preopen["NIFTY"] == [preopen_tick]


def test_failed_feed_retries_with_backoff_only_while_feed_is_on(monkeypatch, tmp_path):
    _feed_globals(monkeypatch, tmp_path, "same", "error", ("key", "same"))
    started = _capture_feed_threads(monkeypatch)

    assert main.supervise_feed(now=0) is False
    assert main.supervise_feed(now=59) is False
    assert main.supervise_feed(now=60) is True
    assert main.FEED_RETRY_SECONDS == 120

    main.FEED_STATE = "error"
    main.FEED_CREDENTIALS = ("key", "same")
    assert main.supervise_feed(now=179) is False
    assert main.supervise_feed(now=180) is True
    assert [args for _, args in started] == [(4,), (5,)]

    main.FEED_STATE = "error"
    main.FEED_ENABLED = False
    assert main.supervise_feed(now=10_000) is False
    assert len(started) == 2


def test_stale_feed_generation_failure_does_not_mark_current_feed_as_error(monkeypatch):
    monkeypatch.setattr(main, "ENGINE", main.MorningMarketEngine())
    monkeypatch.setattr(main, "FEED_GENERATION", 7)
    monkeypatch.setattr(main, "FEED_STATE", "connected")

    main._fail_feed(6, "Kite feed initialization failed: ReadTimeout")

    assert main.FEED_STATE == "connected"
    assert main.ENGINE.error is None


def test_kiteticker_naive_timestamps_are_process_local_time_not_ist():
    epoch = datetime(2026, 11, 13, 9, 15, tzinfo=main.TZ).timestamp()

    stamped = main.MorningMarketEngine._stamp(datetime.fromtimestamp(epoch))

    assert stamped.timestamp() == epoch
    assert stamped.utcoffset() == timedelta(hours=5, minutes=30)


def test_tick_stamped_a_little_ahead_of_this_clock_is_skew_not_rejected():
    clock = Clock(datetime(2026, 11, 11, 9, 21, tzinfo=main.TZ))
    engine = main.MorningMarketEngine(clock)

    for token, ahead in ((1, 2.5), (2, 4.0)):
        engine.on_ticks([{"instrument_token": token, "last_price": 100,
                          "exchange_timestamp": clock.value + timedelta(seconds=ahead)}])

    assert set(engine.ticks) == {1}


def test_breakout_returns_candidate_without_creating_position(monkeypatch):
    clock = Clock(datetime(2026, 11, 11, 9, 21, tzinfo=main.TZ))
    engine = main.MorningMarketEngine(clock)
    engine.ingest_instruments([
        {"exchange": exchange, "tradingsymbol": symbol, "instrument_token": token}
        for token, (exchange, symbol) in enumerate(main.INDICES.values(), start=1)
    ] + [{
        "exchange": "NFO", "tradingsymbol": "NIFTYCE", "instrument_token": 10,
        "name": "NIFTY", "instrument_type": "CE", "strike": 22000,
        "expiry": date(2026, 11, 12), "lot_size": 25,
    }])
    for token, symbol, high, last in (
        (1, "NIFTY", 22020, 22025),
        (2, "BANKNIFTY", 48020, 48019),
        (3, "SENSEX", 85020, 85019),
    ):
        engine.preopen[symbol] = [
            (clock.value.replace(hour=9, minute=0), high - 20),
            (clock.value.replace(hour=9, minute=7), high - 10),
        ]
        engine.opening[symbol] = [
            (clock.value.replace(hour=9, minute=15), high - 15),
            (clock.value.replace(hour=9, minute=19), high),
        ]
        engine.ticks[token] = {"price": last, "timestamp": clock.value, "depth": {}}
    engine.ticks[10] = {
        "price": 100.2, "timestamp": clock.value,
        "depth": {"buy": [{"price": 100}], "sell": [{"price": 100.5}]},
    }

    engine._evaluate()
    status = engine.status(True, "connected")

    assert status["signal"]["decision"] == "candidate CE"
    assert status["signal"]["contract"] == "NIFTYCE"
    assert status["signal"]["entry"] == 100.5
    assert "no order was placed" in status["signal"]["reason"]
    assert status["trade_enabled"] is False


def test_sensex_option_lookup_uses_bfo():
    engine = main.MorningMarketEngine()
    engine.ingest_instruments([
        {"exchange": "BSE", "tradingsymbol": "SENSEX", "instrument_token": 3},
        {"exchange": "BFO", "tradingsymbol": "SENSEX_CE", "instrument_token": 21,
         "name": "SENSEX", "instrument_type": "CE", "strike": 85000,
         "expiry": date(2026, 11, 12), "lot_size": 10},
    ])
    engine.ticks[3] = {"price": 85000, "timestamp": datetime.now(main.TZ), "depth": {}}
    engine.ticks[21] = {
        "price": 100, "timestamp": datetime.now(main.TZ),
        "depth": {"buy": [{"price": 99.9}], "sell": [{"price": 100}]},
    }
    contract, reason = engine._select_contract("SENSEX")
    assert reason is None
    assert contract["exchange"] == "BFO"
