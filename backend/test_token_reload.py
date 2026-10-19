import asyncio
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from kiteconnect.exceptions import TokenException
from watchdog.events import FileModifiedEvent
from watchdog.observers.polling import PollingObserver

import config
from config import get_settings
from routers import auth, system_health
from services.auth_state_machine import AuthState, AuthStateManager
from services.chart_history_service import ChartHistoryService
from services.market_feed import MarketFeedService, IST
from services.token_watcher import TokenWatcher
from services.unified_auth_service import AuthStatus, UnifiedAuthService


class TokenReloadTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.env_file = Path(self.directory.name) / ".env"
        self.env_file.write_text("ZERODHA_ACCESS_TOKEN=old-token\n", encoding="utf-8")
        env_patch = patch.dict(os.environ, {
            "ZERODHA_ACCESS_TOKEN": "container-startup-token",
            "ZERODHA_API_KEY": "container-api-key",
        })
        env_patch.start()
        self.addCleanup(env_patch.stop)
        file_patch = patch.object(config, "ENV_FILE", self.env_file)
        file_patch.start()
        self.addCleanup(file_patch.stop)
        get_settings.cache_clear()
        self.addCleanup(get_settings.cache_clear)

    def test_persisted_token_overrides_docker_environment_only_for_token(self):
        self.assertEqual(get_settings().zerodha_access_token, "old-token")
        self.env_file.write_text(
            "ZERODHA_ACCESS_TOKEN=new-token\nZERODHA_API_KEY=file-api-key\n", encoding="utf-8"
        )
        get_settings.cache_clear()
        self.assertEqual(get_settings().zerodha_access_token, "new-token")
        self.assertEqual(get_settings().zerodha_api_key, "container-api-key")
        self.assertEqual(os.environ["ZERODHA_ACCESS_TOKEN"], "container-startup-token")

    def test_environment_token_still_works_without_a_persisted_value(self):
        self.env_file.unlink()
        self.assertEqual(get_settings().zerodha_access_token, "container-startup-token")

    def test_explicit_empty_persisted_token_disables_stale_environment_token(self):
        self.env_file.write_text("ZERODHA_ACCESS_TOKEN=\n", encoding="utf-8")
        self.assertEqual(get_settings().zerodha_access_token, "")

    async def test_login_persists_and_updates_both_auth_services_without_file_event(self):
        legacy = Mock()
        unified = Mock(update_token=AsyncMock())
        manager = Mock()
        original_update = auth.update_env_file
        with patch.object(auth, "update_env_file",
                          side_effect=lambda _, key, value: original_update(str(self.env_file), key, value)), \
             patch("services.auth_state_machine.auth_state_manager", legacy), \
             patch("services.unified_auth_service.unified_auth", unified), \
             patch("services.global_token_manager.get_token_manager", return_value=manager):
            await auth._persist_access_token("fresh-login-token")
        self.assertEqual(get_settings().zerodha_access_token, "fresh-login-token")
        legacy.update_token.assert_called_once_with("fresh-login-token")
        unified.update_token.assert_awaited_once_with("fresh-login-token")
        manager.force_recheck.assert_called_once()

    async def test_manual_and_auto_login_use_the_same_persistence_path(self):
        session = {"access_token": "fresh-login-token", "user_id": "test", "user_name": "Test"}
        with patch.object(auth, "_persist_access_token", new_callable=AsyncMock) as persist, \
             patch.object(auth.user_analytics, "register_login", new_callable=AsyncMock), \
             patch("kiteconnect.KiteConnect") as kite, \
             patch("services.zerodha_auto_login.auto_login", new_callable=AsyncMock, return_value=session):
            kite.return_value.generate_session.return_value = session
            response = await auth.zerodha_callback("test-request", status="success", state=None)
            self.assertEqual(response.status_code, 200)
            result = await auth.one_click_auto_login()
            self.assertTrue(result["success"])
            self.assertEqual(persist.await_count, 2)
            for call in persist.await_args_list:
                self.assertEqual(call.args, ("fresh-login-token",))

    async def test_watcher_dispatches_from_worker_thread_to_server_loop(self):
        loop = asyncio.get_running_loop()
        notified = asyncio.Event()

        async def update_token(token):
            self.assertIs(asyncio.get_running_loop(), loop)
            self.assertEqual(token, "changed-token")
            notified.set()

        unified = Mock(update_token=AsyncMock(side_effect=update_token))
        watcher = TokenWatcher(Mock(), unified)
        watcher.env_file = self.env_file
        self.env_file.write_text("ZERODHA_ACCESS_TOKEN=changed-token\n", encoding="utf-8")
        with patch("services.auth_state_machine.auth_state_manager") as legacy:
            await asyncio.to_thread(watcher.on_modified, FileModifiedEvent(str(self.env_file)))
            await asyncio.wait_for(notified.wait(), timeout=3)
            await watcher._check_and_reload_token()
        unified.update_token.assert_awaited_once()
        legacy.update_token.assert_called_once_with("changed-token")
        self.assertEqual(watcher.last_token, "changed-token")

    async def test_history_uses_refreshed_token_despite_frozen_container_environment(self):
        self.env_file.write_text("ZERODHA_ACCESS_TOKEN=chart-token\n", encoding="utf-8")
        service = ChartHistoryService(Path(self.directory.name) / "history.sqlite3")
        with patch("services.chart_history_service.KiteConnect") as kite, \
             patch("services.chart_history_service.request_chart_candles", return_value=[]):
            await asyncio.to_thread(service._fetch, "NIFTY", "5",
                                    "2026-10-01T00:00:00+05:30", "2026-10-14T23:59:59+05:30")
        kite.return_value.set_access_token.assert_called_once_with("chart-token")

    async def test_polling_watcher_detects_external_file_changes(self):
        notified = asyncio.Event()

        async def update_token(_):
            notified.set()

        unified = Mock(update_token=AsyncMock(side_effect=update_token))
        watcher = TokenWatcher(Mock(), unified)
        watcher.env_file = self.env_file
        observer = PollingObserver(timeout=0.05)
        observer.schedule(watcher, self.directory.name, recursive=False)
        observer.start()
        try:
            with patch("services.auth_state_machine.auth_state_manager") as legacy:
                self.env_file.write_text("ZERODHA_ACCESS_TOKEN=polling-refreshed-token\n", encoding="utf-8")
                await asyncio.wait_for(notified.wait(), timeout=3)
                legacy.update_token.assert_called_once_with("polling-refreshed-token")
                unified.update_token.assert_awaited_once_with("polling-refreshed-token")
        finally:
            observer.stop()
            await asyncio.to_thread(observer.join)

    async def test_rejected_token_stays_rejected_when_health_is_polled(self):
        legacy = AuthStateManager()
        legacy.mark_api_failure(TokenException("Invalid access_token"))
        with patch.object(system_health, "auth_state_manager", legacy):
            for _ in range(2):
                status = await system_health.get_system_health()
                self.assertFalse(status["auth"]["is_valid"])
                self.assertTrue(status["auth"]["requires_login"])
                self.assertEqual(status["priority_status"], "AUTH_REQUIRED")
        self.assertEqual(legacy.current_state, AuthState.EXPIRED)

    async def test_api_token_rejection_updates_legacy_auth_state(self):
        legacy = AuthStateManager()
        unified = UnifiedAuthService()
        with patch("services.auth_state_machine.auth_state_manager", legacy), \
             patch("kiteconnect.KiteConnect") as kite:
            kite.return_value.profile.side_effect = TokenException("Invalid access_token")
            self.assertFalse(await unified.validate_token(force=True))
            self.assertEqual(unified.status, AuthStatus.EXPIRED)
            self.assertTrue(legacy.requires_login)
            result = await auth.validate_token()
            self.assertFalse(result["valid"])
            self.assertTrue(legacy.requires_login)

    async def test_running_feed_reconnects_on_token_rotation_even_if_auth_was_valid(self):
        feed = MarketFeedService(Mock(), Mock())
        old_settings = Mock(zerodha_api_key="key", zerodha_access_token="old-token")
        new_settings = Mock(zerodha_api_key="key", zerodha_access_token="new-token")
        now = IST.localize(datetime(2026, 10, 19, 10))
        real_sleep = asyncio.sleep

        async def advance(_):
            clock.now.return_value = now + timedelta(seconds=2)
            settings_mock.return_value = new_settings
            await real_sleep(0)

        async def reconnect():
            feed.running = False

        with patch("services.market_feed.reload_settings", return_value=old_settings), \
             patch("services.market_feed.get_settings", return_value=old_settings) as settings_mock, \
             patch("services.market_feed.datetime") as clock, \
             patch("services.market_feed.asyncio.sleep", side_effect=advance), \
             patch("services.market_feed.auth_state_manager") as legacy, \
             patch("services.market_feed.feed_watchdog.start", new_callable=AsyncMock), \
             patch("services.market_feed.get_market_status", return_value="CLOSED"), \
             patch("kiteconnect.KiteTicker") as ticker, \
             patch.object(feed, "_fetch_and_cache_last_data_safe", new_callable=AsyncMock), \
             patch.object(feed, "_attempt_reconnect", side_effect=reconnect) as attempt:
            legacy.requires_login = False
            clock.now.return_value = now
            await asyncio.wait_for(feed.start(), timeout=3)
        ticker.assert_called_once_with("key", "old-token")
        attempt.assert_awaited_once()
        self.assertFalse(feed._feed_loop_active)

    async def test_reconnect_constructs_ticker_with_persisted_token_not_container_token(self):
        self.env_file.write_text("ZERODHA_ACCESS_TOKEN=reconnect-token\n", encoding="utf-8")
        feed = MarketFeedService(Mock(), Mock())
        with patch.object(feed, "_validate_token_before_connect", new_callable=AsyncMock, return_value=True), \
             patch("kiteconnect.KiteTicker") as ticker:
            await feed._attempt_reconnect()
        ticker.assert_called_once_with("container-api-key", "reconnect-token")
        ticker.return_value.connect.assert_called_once_with(threaded=True)


if __name__ == "__main__":
    unittest.main()
