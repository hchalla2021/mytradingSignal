import io
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from services.aqte_engine import IST
from services.aqte_execution_history import (
    LEGACY_REASON, XLSX_TYPE, bootstrap_executions, capture_context, export_executions, read_executions,
)
from services.aqte_live import AQTELiveService
from test_aqte_live import settings


START = datetime(2026, 11, 1, tzinfo=IST).timestamp()
END = datetime(2026, 12, 1, tzinfo=IST).timestamp()


def trade(identity="0000000000000001", at=START + 36000):
    return dict(id=identity, symbol="NIFTY", entry_at=at, exit_at=at + 60,
                contract=dict(trading_symbol="NIFTY_TEST_CE", exchange="NFO", lot_size=15),
                strategy="trend_continuation", quantity=15, filled=15, entry_price=100, exit_price=110,
                net_pnl=105, state="EXIT_PENDING", entry_id="00123456789012345678", protect_id="002",
                initial_stop=90, stop=103, target=120)


class ExecutionHistoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "live.sqlite3"
        self.broker = Mock()
        self.live = AQTELiveService(self.path, settings=settings, broker=lambda: self.broker)
        self.live.initialize()
        self.addCleanup(self.live.release_owner)

    def record(self, value):
        self.live.state["trades"].append(value)
        self.live.save("LIVE_CLOSED", trade=value)

    def test_history_is_continuous_paginated_and_not_limited_to_status_preview(self):
        for index in range(45):
            self.record(trade(f"{index:016x}", START - 86400 * (index + 1)))
        page = read_executions(self.path)
        self.assertEqual((len(page["rows"]), page["total"]), (4, 45))
        following = read_executions(self.path, limit=25, offset=25)
        self.assertEqual(len(following["rows"]), 20)
        self.assertEqual(len(read_executions(self.path, limit=100)["rows"]), 45)
        self.assertEqual(len(self.live.state["trades"]), 45)
        self.broker.assert_not_called()

    def test_month_uses_ist_entry_boundaries_including_month_crossing_exit(self):
        for index, at in enumerate((START - 1, START, END - 1, END)):
            self.record(trade(f"{index:016x}", at))
        november = read_executions(self.path, "2026-11", 100)
        self.assertEqual([row["id"] for row in november["rows"]], ["0000000000000002", "0000000000000001"])
        self.assertEqual(read_executions(self.path, "2026-10")["total"], 1)
        self.assertEqual(read_executions(self.path, "2026-12")["total"], 1)

    def test_legacy_audit_migration_recovers_unfilled_orders_and_is_idempotent(self):
        self.record(trade())
        proposal = dict(symbol="NIFTY", contract=trade()["contract"], strategy="quick_scalp_10",
                        entry=dict(quantity=15))
        self.live.save("ENTRY_INTENT", proposal=proposal, tag="0000000000000002E")
        self.live.save("ENTRY_ACK", order_id="0002")
        self.live.save("ENTRY_UNFILLED", status="REJECTED", reason="Broker rejected this order")
        self.live.save("ENTRY_FINISHED")
        self.live.state.pop("execution_history_version")
        self.live.save("LEGACY_FIXTURE")
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("DELETE FROM live_executions")
        self.live.release_owner()
        self.live.initialize()
        self.live.release_owner()
        self.live.initialize()
        rows = {row["id"]: row for row in read_executions(self.path, limit=100)["rows"]}
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows["0000000000000001"]["net_pnl"], 105)
        self.assertEqual(rows["0000000000000002"]["status"], "REJECTED")
        self.assertEqual(rows["0000000000000002"]["entry_id"], "0002")
        self.assertEqual(rows["0000000000000002"]["reason"], LEGACY_REASON)
        self.assertEqual(rows["0000000000000002"]["filled"], 0)

    def test_completed_migration_does_not_rescan_audit_on_every_restart(self):
        db = Mock()
        bootstrap_executions(db, {"execution_history_version": 1})
        db.execute.assert_not_called()

    def test_original_entry_context_is_detached_and_shadow_is_not_an_entry_engine(self):
        signal = dict(decision="BUY CE", reasons=["Quick scalp: obsolete tier", "RSI 65; volume 2.0x"],
                      confidence=80, engines=[
                          dict(name="Momentum", side="CE", status="SATISFIED", authority="ADVISORY"),
                          dict(name="Opposing", side="PE", status="SATISFIED", authority="ADVISORY"),
                          dict(name="ML Prediction", side="CE", status="SATISFIED", authority="SHADOW")])
        context = capture_context(signal, "quick_scalp_5", dict(points=5, reward_risk=1.8))
        signal["reasons"].clear()
        signal["engines"][0]["name"] = "Changed later"
        self.assertEqual(context["strategy_name"], "Quick Scalp (5-point target)")
        self.assertEqual(context["supporting_engines"], ["Momentum"])
        self.assertIn("target +5", context["reason"])
        self.assertIn("RSI 65", context["reason"])
        self.assertNotIn("obsolete", context["reason"])

    def test_workbook_is_real_excel_safe_text_and_download_never_deletes_records(self):
        value = trade()
        value["contract"]["trading_symbol"] = '=HYPERLINK("https://example.invalid","test")'
        value["execution_context"] = dict(strategy_name="Trend Continuation", entry_engine="AQTE Swing Rules",
                                         reason="=1+1", supporting_engines=["Momentum"], confidence=80)
        self.record(value)
        before = read_executions(self.path, limit=100)
        workbook = load_workbook(io.BytesIO(export_executions(self.path, "2026-11")), read_only=True)
        self.addCleanup(workbook.close)
        sheet = workbook["Executions"]
        rows = list(sheet.rows)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0][7].value, "Status")
        self.assertEqual(rows[0][8].value, "Strategy / Entry Reason")
        self.assertEqual(rows[1][8].value, "Trend Continuation")
        self.assertEqual((rows[1][1].data_type, rows[1][11].data_type), ("s", "s"))
        self.assertEqual(rows[1][11].value, "=1+1")
        self.assertEqual(rows[1][16].value, "00123456789012345678")
        self.assertEqual(rows[1][5].value, 105)
        self.assertEqual(read_executions(self.path, limit=100)["rows"], before["rows"])
        self.assertEqual(len(self.live.state["trades"]), 1)

    def test_empty_month_has_headers_not_dummy_executions(self):
        workbook = load_workbook(io.BytesIO(export_executions(self.path, "2026-11")), read_only=True)
        self.addCleanup(workbook.close)
        self.assertEqual(len(list(workbook["Executions"].rows)), 1)
        self.assertEqual(read_executions(self.path)["total"], 0)

    def test_unverified_exit_has_no_fabricated_pnl(self):
        self.record({**trade(), "exit_price": None, "exit_unverified": True, "net_pnl": 0.0})
        row = read_executions(self.path)["rows"][0]
        self.assertEqual(row["status"], "EXIT_UNVERIFIED")
        self.assertIsNone(row["net_pnl"])
        self.assertIsNone(row["return_pct"])

    def test_history_and_excel_use_owner_auth_validate_month_and_do_not_call_broker(self):
        from routers.aqte import live_operator, router
        app = FastAPI()
        app.include_router(router)
        self.record(trade())
        with TestClient(app) as client, patch("routers.aqte.get_live_service", return_value=self.live):
            for path in ("/api/aqte/live/executions", "/api/aqte/live/executions/export?month=2026-11"):
                self.assertEqual(client.get(path).status_code, 403)
                with patch("routers.aqte.app_access_service.validate_session",
                           new=AsyncMock(return_value={"authenticated": False})):
                    self.assertEqual(client.get(path, headers={
                        "X-Device-Id": "test", "X-AQTE-Intent": "manual-live-control",
                    }).status_code, 401)
            app.dependency_overrides[live_operator] = lambda: "owner"
            response = client.get("/api/aqte/live/executions")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(response.json()["total"], 1)
            exported = client.get("/api/aqte/live/executions/export?month=2026-11")
            self.assertEqual(exported.status_code, 200)
            self.assertEqual(exported.headers["content-type"], XLSX_TYPE)
            self.assertIn("AQTE-Executions-2026-11.xlsx", exported.headers["content-disposition"])
            self.assertTrue(exported.content.startswith(b"PK"))
            for suffix in ("?month=2026-13", "?month=bad", "?limit=0", "?limit=101", "?offset=-1"):
                self.assertEqual(client.get("/api/aqte/live/executions" + suffix).status_code, 422)
            self.assertEqual(client.get("/api/aqte/live/executions/export").status_code, 422)
        self.assertEqual(self.broker.mock_calls, [])


if __name__ == "__main__":
    unittest.main()
