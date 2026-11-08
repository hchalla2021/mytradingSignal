from datetime import datetime
import json
from pathlib import Path
import sys
from types import ModuleType
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as service
from adapters import KiteTickerIngestion
from pipeline import MarketPipeline

TZ = ZoneInfo("Asia/Kolkata")


def client(monkeypatch):
    session_id = "test-session"
    service.browser_sessions[session_id] = datetime.now(TZ).replace(year=datetime.now(TZ).year + 1)
    monkeypatch.setattr(service, "refresh_shared_zerodha_auth", lambda: True)
    test_client = TestClient(service.app)
    test_client.cookies.set("morningedge_session", session_id)
    return test_client


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
        "/api/v1/status", "/api/v1/config", "/api/v1/preflight", "/api/v1/arm",
        "/api/v1/approval", "/api/v1/auth/session",
    }
    assert "/api/v1/auth/zerodha/login" not in service.app.openapi()["paths"]


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


def test_main_zerodha_token_authenticates_morningedge_session(monkeypatch, tmp_path):
    class FakeKite:
        def __init__(self, api_key):
            assert api_key == "morningedge-key"

        def set_access_token(self, access_token):
            assert access_token == "main-access-token"

        def profile(self):
            return {"user_id": "main-user"}

    kiteconnect = ModuleType("kiteconnect")
    kiteconnect.KiteConnect = FakeKite
    monkeypatch.setitem(sys.modules, "kiteconnect", kiteconnect)
    auth_file = tmp_path / "zerodha" / "credentials.json"
    auth_file.parent.mkdir()
    auth_file.write_text(json.dumps({
        "api_key": "morningedge-key",
        "access_token": "main-access-token",
    }), encoding="utf-8")
    monkeypatch.setattr(service.settings, "shared_zerodha_auth_file", auth_file)
    monkeypatch.setattr(service.settings, "frontend_url", "https://app.example.test")
    c = TestClient(service.app, base_url="https://api.example.test")
    session = c.get("/api/v1/auth/session")
    assert session.json() == {"authenticated": True, "zerodha_connected": True}
    assert "httponly" in session.headers["set-cookie"].lower()
    assert "secure" in session.headers["set-cookie"].lower()
    assert c.get("/api/v1/status").status_code == 200


def test_morningedge_rejects_requests_when_shared_token_is_missing(monkeypatch):
    monkeypatch.setattr(service, "refresh_shared_zerodha_auth", lambda: False)
    response = TestClient(service.app).get("/api/v1/status")
    assert response.status_code == 401
