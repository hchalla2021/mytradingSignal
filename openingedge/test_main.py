from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from openingedge import main


def test_store_initializes_only_global_cue_journals(tmp_path):
    store = main.Store(tmp_path / "cues.sqlite3")
    store.initialize()
    client = TestClient(main.app)
    assert client.put("/api/trade-control", json={"enabled": True}).status_code == 404
    assert client.put("/api/config/NIFTY", json={"lots": 2, "risk": 1500}).status_code == 404
    assert client.put("/api/daily-limit", json={"daily_loss": 3000}).status_code == 404


def test_feed_status_uses_only_fresh_connected_quotes():
    now = datetime(2026, 11, 20, 9, 15, tzinfo=main.IST)
    clock = [now]
    market = main.Market(lambda: clock[0])
    assert market.instruments([{"exchange": "NSE", "tradingsymbol": "NIFTY 50", "instrument_token": 1}]) == [1]
    market.state = "connected"
    market.on_ticks([{"instrument_token": 1, "exchange_timestamp": now, "last_price": 25000, "ohlc": {"close": 24900}}])
    assert market.status()["indices"]["NIFTY"]["change"] == 100
    market.state = "disconnected"
    assert market.status()["indices"]["NIFTY"]["price"] is None
    market.state = "connected"
    clock[0] += timedelta(seconds=11)
    assert market.status()["indices"]["NIFTY"]["price"] is None


def test_preopen_requires_real_coverage_and_resets_each_day():
    clock = [datetime(2026, 11, 20, 9, 0, tzinfo=main.IST)]
    market = main.Market(lambda: clock[0])
    market.instruments([{"exchange": "NSE", "tradingsymbol": "NIFTY 50", "instrument_token": 1}])
    market.state = "connected"
    for minute, price in [(0, 100), (1, 101), (2, 102), (3, 103),
                          (4, 104), (5, 105), (6, 105), (7, 105)]:
        clock[0] = clock[0].replace(minute=minute)
        market.on_ticks([{"instrument_token": 1, "timestamp": clock[0], "last_price": price}])
    assert not market.status()["indices"]["NIFTY"]["preopen_complete"]
    clock[0] = clock[0].replace(minute=8)
    data = market.status()["indices"]["NIFTY"]
    assert data["preopen_complete"] and data["preopen_high"] == 105 and data["preopen_low"] == 100
    clock[0] += timedelta(days=1)
    assert market.status()["indices"]["NIFTY"]["preopen_high"] is None


def test_status_exposes_read_only_shared_session(tmp_path, monkeypatch):
    store = main.Store(tmp_path / "cues.sqlite3")
    store.initialize()
    env_file = tmp_path / "backend.env"
    env_file.write_text("ZERODHA_API_KEY=key\nZERODHA_ACCESS_TOKEN=token\n", encoding="utf-8")
    monkeypatch.setattr(main, "store", store)
    monkeypatch.setattr(main, "ENV_FILE", env_file)
    client = TestClient(main.app)
    body = client.get("/api/status").json()
    assert body["zerodha_session"] is True
    assert "context" in body
    assert body["reason"].startswith("Global cue display is read-only")
    assert "automation_on" not in body
    assert "active" not in body
    assert "config" not in body
