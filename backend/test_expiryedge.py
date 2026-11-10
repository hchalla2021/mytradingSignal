import tempfile
import unittest
import contextlib
import sqlite3
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import expiryedge
from services.expiryedge import SYMBOLS, get_config, listed_expiries, save_config


class ExpiryEdgeConfigTests(unittest.TestCase):
    def test_weekday_is_persisted_across_reads(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.sqlite3"
            self.assertEqual(set(get_config(path)["schedules"]), set(SYMBOLS))
            self.assertIsNone(get_config(path)["schedules"]["NIFTY"]["weekday"])
            save_config("NIFTY", "Thursday", path)
            save_config("SENSEX", "Monday", path)
            config = get_config(path)
            self.assertEqual(config["schedules"]["NIFTY"]["weekday"], "Thursday")
            self.assertEqual(config["schedules"]["SENSEX"]["weekday"], "Monday")
            self.assertIsNone(config["schedules"]["BANKNIFTY"]["weekday"])

    def test_existing_single_weekday_is_migrated_to_each_index(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.sqlite3"
            with contextlib.closing(sqlite3.connect(path)) as connection, connection:
                connection.execute(
                    "CREATE TABLE expiryedge_config "
                    "(id INTEGER PRIMARY KEY CHECK(id=1), weekday TEXT NOT NULL, updated_at TEXT NOT NULL)"
                )
                connection.execute(
                    "INSERT INTO expiryedge_config(id, weekday, updated_at) VALUES(1, 'Wednesday', 'legacy')"
                )
            config = get_config(path)
            self.assertEqual(
                {config["schedules"][symbol]["weekday"] for symbol in SYMBOLS},
                {"Wednesday"},
            )

    def test_invalid_weekdays_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                save_config("NIFTY", "Sunday", Path(directory) / "config.sqlite3")

    def test_expiries_are_derived_only_from_listed_option_rows(self):
        rows = [
            {"name": "NIFTY", "instrument_type": "CE", "instrument_token": 11,
             "lot_size": 25, "expiry": date(2026, 11, 10)},
            {"name": "NIFTY", "instrument_type": "PE", "instrument_token": 12,
             "lot_size": 25, "expiry": date(2026, 11, 10)},
            {"name": "NIFTY", "instrument_type": "FUT", "instrument_token": 13,
             "lot_size": 25, "expiry": date(2026, 11, 10)},
            {"name": "BANKNIFTY", "instrument_type": "CE", "instrument_token": 14,
             "lot_size": 15, "expiry": date(2026, 11, 10)},
            {"name": "NIFTY", "instrument_type": "CE", "instrument_token": 15,
             "lot_size": 25, "expiry": date(2026, 11, 6)},
        ]
        self.assertEqual(
            listed_expiries(rows, "NIFTY", date(2026, 11, 7)),
            [{"expiry": "2026-11-10", "listed_option_contracts": 2, "lot_sizes": [25]}],
        )

    def test_config_api_validates_and_persists_selection(self):
        app = FastAPI()
        app.include_router(expiryedge.router)
        app.dependency_overrides[expiryedge.expiryedge_operator] = lambda: "owner"
        with patch("routers.expiryedge.save_config", return_value={
            "symbol": "NIFTY", "weekday": "Tuesday", "updated_at": "2026-11-08T00:00:00+05:30",
        }):
            response = TestClient(app).put("/api/expiryedge/config", json={
                "symbol": "NIFTY", "expiry_weekday": "Tuesday",
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["weekday"], "Tuesday")
        self.assertEqual(TestClient(app).put("/api/expiryedge/config", json={
            "symbol": "NIFTY", "expiry_weekday": "Sunday",
        }).status_code, 422)

    def test_status_uses_current_listed_instruments_and_reports_live_readiness(self):
        app = FastAPI()
        app.include_router(expiryedge.router)
        app.dependency_overrides[expiryedge.expiryedge_operator] = lambda: "owner"
        rows = [{
            "name": "NIFTY", "instrument_type": "CE", "instrument_token": 11,
            "lot_size": 25, "expiry": date(2026, 11, 10),
        }]

        class BrokerClient:
            def __init__(self, **_kwargs):
                pass

            def set_access_token(self, _token):
                pass

        settings = SimpleNamespace(
            zerodha_api_key="configured", zerodha_access_token="configured",
            aqte_live_enabled=False, expiryedge_ai_live_enabled=False,
        )
        snapshots = {
            symbol: {
                "market_data": {"state": "NOT_CONNECTED", "last_tick_at": None},
                "signal": {"ready": False, "decision": "WAIT", "side": None,
                           "reason": "feed unavailable", "setup_key": None},
            }
            for symbol in SYMBOLS
        }
        with patch("routers.expiryedge.get_settings", return_value=settings), \
                patch("routers.expiryedge.KiteConnect", BrokerClient), \
                patch("routers.expiryedge.instrument_catalog.get", return_value=rows), \
                patch("routers.expiryedge.live_market_snapshots", return_value=snapshots), \
                patch("routers.expiryedge.get_config", return_value={
                    "schedules": {symbol: {"weekday": "Tuesday", "updated_at": "2026-11-08T00:00:00+05:30"}
                                  for symbol in SYMBOLS},
                }):
            response = TestClient(app).get("/api/expiryedge/status")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        payload = response.json()
        self.assertFalse(payload["live_orders_enabled"])
        self.assertEqual(payload["expiry_calendar"]["state"], "UNVERIFIED")
        self.assertEqual(payload["instruments"]["NIFTY"]["next_listed_expiry"]["expiry"], "2026-11-10")
        self.assertTrue(payload["instruments"]["NIFTY"]["configured_weekday_matches"])
        self.assertNotIn("No dedicated standalone ExpiryEdge AI order owner", " ".join(payload["block_reasons"]))
        self.assertEqual(set(payload["markets"]), set(SYMBOLS))
        self.assertEqual(set(payload["expiry_gates"]), set(SYMBOLS))
        self.assertIn("/api/expiryedge/live/approval", [route.path for route in app.routes])


if __name__ == "__main__":
    unittest.main()
