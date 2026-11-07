from datetime import datetime
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as service
from adapters import KiteTickerIngestion
from pipeline import MarketPipeline

TZ = ZoneInfo("Asia/Kolkata")


def client(monkeypatch):
    monkeypatch.setattr(service.settings, "operator_token", "test-token")
    return TestClient(service.app, headers={"Authorization": "Bearer test-token"})


def test_frontend_contract_and_not_ready(monkeypatch):
    c = client(monkeypatch)
    assert c.get("/api/v1/status").json()["readiness"] == "NOT_READY"
    assert c.get("/api/v1/config").json()["risk"]["max_lots"] == 1
    assert c.put("/api/v1/config", json={"per_trade_loss_cap_inr": 500, "daily_loss_cap_inr": 1000,
          "max_trades_per_day": 2, "max_lots": 5, "min_model_confidence_pct": 20}).status_code == 200
    assert c.post("/api/v1/preflight").json()["passed"] is False
    assert c.post("/api/v1/arm").status_code == 409
    assert c.post("/api/v1/approval").json()["live_approved"] is False
    ws_token = c.post("/api/v1/events/token").json()
    assert ws_token["expires_in_seconds"] == 60
    assert ws_token["websocket_path"] == "/api/v1/events"
    assert service.app.openapi()["paths"].keys() >= {
        "/api/v1/status", "/api/v1/config", "/api/v1/preflight", "/api/v1/arm", "/api/v1/approval"
    }


def test_risk_limits_reject_invalid_values(monkeypatch):
    c = client(monkeypatch)
    response = c.put("/api/v1/config", json={"per_trade_loss_cap_inr": -1, "max_lots": 6})
    assert response.status_code == 422


def test_ticker_ingestion_uses_real_kite_ticks_and_rejects_stale():
    pipeline = MarketPipeline()
    adapter = KiteTickerIngestion(pipeline, {1: "NIFTY"})
    adapter.on_ticks(None, [{"instrument_token": 1, "last_price": 22000,
                             "exchange_timestamp": datetime.now(TZ)}])
    assert pipeline.snapshots()["NIFTY"]["price"] == 22000
    adapter.on_ticks(None, [{"instrument_token": 1, "last_price": 22001,
                             "exchange_timestamp": datetime(2020, 1, 1, tzinfo=TZ)}])
    assert pipeline.metrics()["rejected_ticks"] == 1
