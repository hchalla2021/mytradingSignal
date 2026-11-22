from datetime import datetime, timedelta

import pytest

from openingedge import main
from openingedge import execution as execution_module
from openingedge.execution import Execution
from fastapi.testclient import TestClient


class Broker:
    def __init__(self, clock):
        self.clock = clock
        self.book = []
        self.placed = []
        self.positions_value = []
        self.option_quote = {
            "instrument_token": 10, "timestamp": None, "last_price": 102,
            "depth": {
                "buy": [{"price": 99, "quantity": 1000}],
                "sell": [{"price": 100, "quantity": 1000}],
            },
        }

    def orders(self):
        return list(self.book)

    def positions(self):
        return {"net": list(self.positions_value)}

    def quote(self, instruments):
        self.option_quote["timestamp"] = self.clock()
        return {name: dict(self.option_quote) for name in instruments}

    def place_order(self, **kwargs):
        order_id = f"order-{len(self.placed) + 1}"
        self.placed.append(kwargs)
        order = {
            **kwargs, "order_id": order_id, "status": "OPEN" if kwargs["transaction_type"] == "SELL" else "OPEN",
            "filled_quantity": 0, "average_price": 0,
        }
        self.book.append(order)
        return order_id

    def modify_order(self, **kwargs):
        order = next(item for item in self.book if item["order_id"] == kwargs["order_id"])
        order.update(kwargs)
        return kwargs["order_id"]

    def cancel_order(self, **kwargs):
        order = next(item for item in self.book if item["order_id"] == kwargs["order_id"])
        order["status"] = "CANCELLED"
        return kwargs["order_id"]


@pytest.fixture
def execution(tmp_path, monkeypatch):
    store = main.Store(tmp_path / "execution.sqlite3")
    store.initialize()
    for symbol in main.INDICES:
        store.save_index(symbol, 1, 1500)
    store.save_daily_loss(3000)
    env = tmp_path / "backend.env"
    env.write_text("TRADE_ENABLED=true\n", encoding="utf-8")
    now = datetime(2026, 11, 23, 9, 16, tzinfo=main.IST)
    market = main.Market(lambda: now)
    market.state = "connected"
    market.day = now.date()
    market.quotes = {
        symbol: {"price": 25_000, "previous_close": 24_900, "timestamp": now}
        for symbol in main.INDICES
    }
    expiry = now.date() + timedelta(days=3)
    market.context.all_options = {
        10: {
            "exchange": "NFO", "tradingsymbol": "NIFTY26NOV25000CE", "name": "NIFTY",
            "instrument_type": "CE", "instrument_token": 10, "strike": 25_000,
            "expiry": expiry, "lot_size": 65, "tick_size": 0.05,
        },
    }
    engine = Execution(store, market, env)
    engine.set_broker(Broker(market.clock))
    return engine, store, market


def approve(store, market, symbol="NIFTY"):
    store.claim_review(market.clock().date().isoformat(), symbol)
    store.finish_review(market.clock().date().isoformat(), symbol, {
        "state": "APPROVED", "action": "BUY_CE", "confidence": 80, "reason": "Confirmed",
    })


def test_owner_on_enters_once_and_off_preserves_owned_position(execution, monkeypatch):
    engine, store, market = execution
    approve(store, market)
    monkeypatch.setattr(execution_module, "LIVE_EXECUTION_READY", True)
    assert engine.set_automation(True)["automation_on"] is True
    engine.tick()
    assert len(engine.broker.placed) == 1
    assert engine.broker.placed[0]["transaction_type"] == "BUY"
    assert engine.broker.placed[0]["validity"] == "IOC"
    assert engine.active["state"] == "ENTRY_PENDING"

    engine.set_automation(False)
    entry = engine.broker.book[0]
    entry.update(status="COMPLETE", filled_quantity=65, average_price=100)
    engine.last_scan = 0
    engine.tick()
    assert len(engine.broker.placed) == 2
    assert engine.broker.placed[1]["transaction_type"] == "SELL"
    assert engine.broker.placed[1]["order_type"] == "SL"
    assert engine.active["state"] == "PROTECTION_PENDING"
    assert engine.set_automation(False)["automation_on"] is False

    restarted = Execution(store, market, engine.env_file)
    assert restarted.automation_on is False
    assert restarted.active["id"] == engine.active["id"]


def test_unverified_execution_allows_approval_but_never_places_orders(execution):
    engine, store, market = execution
    engine.env_file.write_text("TRADE_ENABLED=false\n", encoding="utf-8")
    approve(store, market)
    state = engine.set_automation(True)
    assert state["automation_on"] is True
    assert state["execution_status"] == "LOCKED"
    assert "not yet verified" in state["execution_block_reason"]
    engine.tick()
    assert engine.broker.placed == []
    with pytest.raises(ValueError, match="entry preconditions"):
        engine._enter(market.clock())
    assert engine.set_automation(False)["automation_on"] is False


def test_locked_execution_never_mutates_an_existing_trade(execution):
    engine, _, _ = execution
    engine.active = {"state": "PROTECTION_UNKNOWN"}
    engine.tick()
    assert engine.broker.placed == []
    assert "manage any existing trade in Kite" in engine.error
    with pytest.raises(ValueError, match="execution is locked"):
        engine._reconcile()


def test_protection_timeout_never_resubmits_after_restart(execution, monkeypatch):
    engine, store, market = execution
    approve(store, market)
    monkeypatch.setattr(execution_module, "LIVE_EXECUTION_READY", True)
    engine.set_automation(True)
    engine.tick()
    engine.broker.book[0].update(status="COMPLETE", filled_quantity=65, average_price=100)
    attempts = []
    def timeout(**kwargs):
        attempts.append(kwargs)
        raise TimeoutError("broker response lost")
    monkeypatch.setattr(engine.broker, "place_order", timeout)
    engine.last_scan = 0
    engine.tick()
    assert engine.active["state"] == "PROTECTION_UNKNOWN"
    engine.last_scan = 0
    engine.tick()
    restarted = Execution(store, market, engine.env_file)
    restarted.set_broker(engine.broker)
    restarted.tick()
    assert len(attempts) == 1
    assert restarted.active["state"] == "PROTECTION_UNKNOWN"


def test_acknowledged_stop_missing_from_broker_is_not_resent(execution, monkeypatch):
    engine, store, market = execution
    approve(store, market)
    monkeypatch.setattr(execution_module, "LIVE_EXECUTION_READY", True)
    engine.set_automation(True)
    engine.tick()
    engine.broker.book[0].update(status="COMPLETE", filled_quantity=65, average_price=100)
    engine.last_scan = 0
    engine.tick()
    assert len(engine.broker.placed) == 2
    engine.broker.book.pop()
    engine.last_scan = 0
    engine.tick()
    assert len(engine.broker.placed) == 2
    assert engine.active["state"] == "PROTECTION_UNKNOWN"


def test_trade_control_on_off_and_confirmation(execution, monkeypatch):
    engine, store, market = execution
    monkeypatch.setattr(main, "store", store)
    monkeypatch.setattr(main, "market", market)
    monkeypatch.setattr(main, "ENV_FILE", engine.env_file)
    monkeypatch.setattr(main, "execution", engine)
    client = TestClient(main.app)
    response = client.put("/api/trade-control", json={"enabled": True, "confirmation": "incorrect"})
    assert response.status_code == 422
    assert engine.automation_on is False
    response = client.put("/api/trade-control", json={
        "enabled": True, "confirmation": "START OPENINGEDGE LIVE TRADING",
    })
    assert response.status_code == 200
    assert response.json()["automation_on"] is True
    assert response.json()["execution_status"] == "LOCKED"
    status = client.get("/api/status").json()
    assert status["automation_on"] is True
    assert status["execution_status"] == "LOCKED"
    assert "not yet verified" in status["reason"]
    response = client.put("/api/trade-control", json={
        "enabled": False, "confirmation": "STOP OPENINGEDGE NEW ENTRIES",
    })
    assert response.status_code == 200
    assert response.json()["automation_on"] is False
    assert client.get("/api/status").json()["automation_on"] is False
    assert Execution(store, market, engine.env_file).status()["automation_on"] is False
    assert engine.broker.placed == []
