from datetime import datetime, timedelta
import io
import json
from unittest.mock import patch

from fastapi.testclient import TestClient

from openingedge import main
from openingedge import ai


def test_config_defaults_persist_and_invalid_values_are_rejected(tmp_path, monkeypatch):
    store = main.Store(tmp_path / "settings.sqlite3")
    store.initialize()
    monkeypatch.setattr(main, "store", store)
    monkeypatch.setattr(main, "ENV_FILE", tmp_path / "missing.env")
    monkeypatch.setattr(main, "execution", None)
    client = TestClient(main.app)
    assert store.read()["indices"]["NIFTY"] == {"lots": 1, "risk": None}
    assert client.put("/api/config/NIFTY", json={"lots": 2, "risk": 1500}).status_code == 200
    assert client.put("/api/daily-limit", json={"daily_loss": 3000}).status_code == 200
    assert client.put("/api/config/NIFTY", json={"lots": 0, "risk": 1500}).status_code == 422
    assert client.put("/api/config/NIFTY", json={"lots": 1, "risk": True}).status_code == 422
    assert client.put("/api/config/NIFTY", json={"lots": 1, "risk": -1}).status_code == 422
    assert client.put("/api/config/OTHER", json={"lots": 1, "risk": 100}).status_code == 404
    reloaded = main.Store(tmp_path / "settings.sqlite3")
    assert reloaded.read()["indices"]["NIFTY"] == {"lots": 2, "risk": 1500}
    assert reloaded.read()["daily_loss"] == 3000
    status = client.get("/api/status").json()
    assert status["trade_enabled"] is False
    assert status["automation_on"] is False
    assert status["execution_status"] == "LOCKED"
    assert status["active"] is None


def test_feed_status_uses_only_fresh_connected_quotes():
    now = datetime(2026, 11, 20, 9, 15, tzinfo=main.IST)
    clock = [now]
    market = main.Market(lambda: clock[0])
    assert market.instruments([{"exchange": "NSE", "tradingsymbol": "NIFTY 50", "instrument_token": 1}]) == [1]
    market.state = "connected"
    market.on_ticks([{"instrument_token": 1, "exchange_timestamp": now, "last_price": 25000, "ohlc": {"close": 24900}}])
    assert market.status()["indices"]["NIFTY"]["change"] == 100
    assert market.status()["stage"] == "EXECUTION WINDOW"
    market.state = "disconnected"
    assert market.status()["indices"]["NIFTY"]["price"] is None
    market.state = "connected"
    clock[0] += timedelta(seconds=11)
    assert market.status()["indices"]["NIFTY"]["price"] is None
    clock[0] = datetime(2026, 11, 20, 9, 20, tzinfo=main.IST)
    assert market.status()["stage"] == "ENTRY LOCK"


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


def test_review_requires_continuous_preopen_and_previous_day_confirmation():
    clock = [datetime(2026, 11, 20, 9, 0, tzinfo=main.IST)]
    market = main.Market(lambda: clock[0])
    market.instruments([{"exchange": "NSE", "tradingsymbol": "NIFTY 50", "instrument_token": 1}])
    market.state = "connected"
    market.set_history("NIFTY", [{"date": clock[0] - timedelta(days=1), "high": 105, "low": 90, "close": 98}])
    for minute in range(8):
        clock[0] = clock[0].replace(minute=minute)
        market.on_ticks([{"instrument_token": 1, "timestamp": clock[0], "last_price": 100 + minute}])
    assert market.review_evidence("NIFTY") is None
    clock[0] = clock[0].replace(minute=8)
    evidence = market.review_evidence("NIFTY")
    assert evidence["direction"] == "BUY_CE"
    assert evidence["previous_session"]["high"] == 105
    with market.lock:
        prior = market.previous_sessions["NIFTY"]
        market.previous_sessions["NIFTY"] = {**prior, "day": "2026-11-01"}
    assert market.review_evidence("NIFTY") is None
    with market.lock:
        market.previous_sessions["NIFTY"] = {**prior, "close": 110}
    assert market.review_evidence("NIFTY") is None
    with market.lock:
        market.previous_sessions["NIFTY"] = prior
        market.preopen["NIFTY"] = market.preopen["NIFTY"][:2] + market.preopen["NIFTY"][-2:]
    assert market.review_evidence("NIFTY") is None
    clock[0] = clock[0].replace(minute=15)
    assert market.review_evidence("NIFTY") is None


def test_daily_review_reservations_survive_restart_and_failed_attempt(tmp_path):
    db = tmp_path / "reviews.sqlite3"
    store = main.Store(db)
    store.initialize()
    assert store.claim_review("2026-11-20", "NIFTY")
    assert not main.Store(db).claim_review("2026-11-20", "NIFTY")
    store.finish_review("2026-11-20", "NIFTY", {
        "state": "UNAVAILABLE", "action": None, "confidence": None, "reason": "Network error",
    })
    assert not store.claim_review("2026-11-20", "NIFTY")
    assert store.claim_review("2026-11-20", "BANKNIFTY")
    assert store.claim_review("2026-11-20", "SENSEX")
    assert len(store.reviews("2026-11-20")) == 3
    assert store.claim_review("2026-11-23", "NIFTY")


def test_haiku_uses_only_fake_key_and_rejects_mismatched_response():
    config = {"key": "test-key", "model": "claude-haiku-5-5", "tokens": 256, "timeout": 12}
    evidence = {"index": "NIFTY", "direction": "BUY_CE", "preopen_first": 100, "preopen_last": 105}
    body = {"stop_reason": "end_turn", "content": [{"type": "text", "text": json.dumps({
        "action": "BUY_PE", "confidence": 80, "reason": "Opposite direction",
    })}]}
    with patch("openingedge.ai.urlopen", return_value=io.BytesIO(json.dumps(body).encode())) as mocked:
        result = ai.review(config, evidence)
    assert result["state"] == "UNAVAILABLE"
    sent = json.loads(mocked.call_args.args[0].data)
    assert sent["model"] == "claude-haiku-5-5"
    assert "test-key" not in json.dumps(sent)


def test_haiku_accepts_valid_review_and_surfaces_transport_failure():
    config = {"key": "test-key", "model": "claude-haiku-5-5", "tokens": 256, "timeout": 12}
    evidence = {"index": "NIFTY", "direction": "BUY_CE"}
    body = {"stop_reason": "end_turn", "content": [{"type": "text", "text": json.dumps({
        "action": "BUY_CE", "confidence": 80, "reason": "Directional agreement",
    })}]}
    with patch("openingedge.ai.urlopen", return_value=io.BytesIO(json.dumps(body).encode())):
        result = ai.review(config, evidence)
    assert result == {"state": "APPROVED", "action": "BUY_CE", "confidence": 80, "reason": "Directional agreement"}
    with patch("openingedge.ai.urlopen", side_effect=TimeoutError()):
        assert ai.review(config, evidence)["state"] == "UNAVAILABLE"


def test_haiku_config_uses_existing_env_names_without_exposing_key(tmp_path, monkeypatch):
    for name in ai.ENV_KEYS:
        monkeypatch.delenv(name, raising=False)
    env = tmp_path / "config.env"
    env.write_text("QUANTUMEDGE_AI_ENABLED=true\nQUANTUMEDGE_AI_MODEL=claude-haiku-5-5\n"
                   "QUANTUMEDGE_AI_ANTHROPIC_API_KEY=test-key\n", encoding="utf-8")
    config, error = ai.load_config(env)
    assert error is None and config["key"] == "test-key"
    env.write_text("QUANTUMEDGE_AI_ENABLED=false\n", encoding="utf-8")
    config, error = ai.load_config(env)
    assert config is None and "disabled" in error


def test_review_worker_rechecks_cutoff_after_slow_call(tmp_path, monkeypatch):
    clock = [datetime(2026, 11, 20, 9, 14, 59, tzinfo=main.IST)]
    market = main.Market(lambda: clock[0])
    monkeypatch.setattr(market, "review_evidence", lambda symbol: {"index": symbol, "direction": "BUY_CE"})
    store = main.Store(tmp_path / "reviews.sqlite3")
    store.initialize()
    class OneIteration:
        stopped = False
        def is_set(self):
            return self.stopped
        def wait(self, seconds):
            self.stopped = True
    monkeypatch.setattr(main, "market", market)
    monkeypatch.setattr(main, "store", store)
    monkeypatch.setattr(main, "shutdown", OneIteration())
    monkeypatch.setattr(main, "load_config", lambda path: ({"key": "test-key"}, None))
    calls = []
    def fake_review(config, evidence):
        calls.append(evidence["index"])
        clock[0] = clock[0].replace(minute=15, second=0)
        return {"state": "APPROVED", "action": "BUY_CE", "confidence": 80, "reason": "Test"}
    monkeypatch.setattr(main, "review", fake_review)
    main.run_reviews()
    assert calls == ["NIFTY"]
    assert list(store.reviews("2026-11-20")) == ["NIFTY"]


def test_review_worker_rechecks_cutoff_after_claim(tmp_path, monkeypatch):
    clock = [datetime(2026, 11, 20, 9, 14, 59, tzinfo=main.IST)]
    market = main.Market(lambda: clock[0])
    monkeypatch.setattr(market, "review_evidence", lambda symbol: (
        {"index": symbol, "direction": "BUY_CE"} if clock[0].time() < main.time(9, 15) else None))
    store = main.Store(tmp_path / "reviews.sqlite3")
    store.initialize()
    claim = store.claim_review
    def delayed_claim(day, symbol):
        result = claim(day, symbol)
        clock[0] = clock[0].replace(minute=15, second=0)
        return result
    monkeypatch.setattr(store, "claim_review", delayed_claim)
    class OneIteration:
        stopped = False
        def is_set(self):
            return self.stopped
        def wait(self, seconds):
            self.stopped = True
    monkeypatch.setattr(main, "market", market)
    monkeypatch.setattr(main, "store", store)
    monkeypatch.setattr(main, "shutdown", OneIteration())
    monkeypatch.setattr(main, "load_config", lambda path: ({"key": "test-key"}, None))
    with patch("openingedge.main.review") as mocked:
        main.run_reviews()
    mocked.assert_not_called()
    assert store.reviews("2026-11-20")["NIFTY"]["state"] == "UNAVAILABLE"
