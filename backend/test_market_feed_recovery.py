"""Regression tests for recovering the KiteTicker stream that AQTE depends on."""

import asyncio
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from services import market_feed
from services.market_feed import MarketFeedService, REST_WS_RECOVERY_SECONDS

NETWORK_DROP = "connection was closed uncleanly (peer dropped the TCP connection without previous WebSocket closing handshake)"
HANDSHAKE_403 = "connection was closed uncleanly (WebSocket connection upgrade failed (403 - Forbidden))"


def feed():
    service = MarketFeedService(Mock(), Mock(broadcast=AsyncMock()))
    service.kws = Mock()
    return service


class MarketFeedRecoveryTests(unittest.TestCase):
    def test_network_drops_do_not_disable_kiteticker_retries(self):
        service = feed()
        with patch.object(market_feed, "feed_watchdog"), patch.object(market_feed, "auth_state_manager") as auth:
            for _ in range(3):
                service._on_error(service.kws, 1006, NETWORK_DROP)

        self.assertFalse(service._using_rest_fallback)
        self.assertEqual(service._consecutive_403_errors, 0)
        service.kws.close.assert_not_called()
        auth.mark_api_failure.assert_not_called()

    def test_rejected_handshake_switches_to_rest_after_three_403s(self):
        service = feed()
        with patch.object(market_feed, "feed_watchdog"), patch.object(market_feed, "auth_state_manager"):
            for _ in range(3):
                service._on_error(service.kws, 1006, HANDSHAKE_403)

        self.assertTrue(service._using_rest_fallback)
        service.kws.close.assert_called_once_with()

    def test_rest_fallback_schedules_websocket_recovery_only_while_market_is_open(self):
        service = feed()
        service.running = True
        service._using_rest_fallback = True
        with patch.object(market_feed, "is_market_open", return_value=True), \
                patch.object(market_feed.time_module, "monotonic", side_effect=[100.0, 129.9, 130.0]):
            self.assertFalse(service._rest_ws_recovery_due())
            self.assertEqual(service._ws_recovery_after, 100.0 + REST_WS_RECOVERY_SECONDS)
            self.assertFalse(service._rest_ws_recovery_due())
            self.assertTrue(service._rest_ws_recovery_due())

        with patch.object(market_feed, "is_market_open", return_value=False):
            self.assertFalse(service._rest_ws_recovery_due())
        self.assertIsNone(service._ws_recovery_after)

    def test_valid_token_keeps_rest_until_websocket_connects(self):
        service = feed()
        service._using_rest_fallback = True
        service._consecutive_403_errors = 2
        kite = Mock()
        kite.profile.return_value = {"user_name": "trader", "email": "trader@example.com"}
        settings = SimpleNamespace(zerodha_api_key="key", zerodha_access_token="token")
        with patch("kiteconnect.KiteConnect", return_value=kite), patch("config.get_settings", return_value=settings):
            self.assertTrue(asyncio.run(service._validate_token_before_connect()))

        self.assertTrue(service._using_rest_fallback)
        self.assertEqual(service._consecutive_403_errors, 0)

    def test_feed_loop_retries_websocket_from_rest_fallback(self):
        service = feed()
        service._using_rest_fallback = True
        service._ws_recovery_after = 0.0
        settings = SimpleNamespace(zerodha_api_key="key", zerodha_access_token="token")

        async def reconnect():
            service.running = False

        service._attempt_reconnect = AsyncMock(side_effect=reconnect)
        service._fetch_and_cache_last_data = AsyncMock(return_value=True)
        service._fetch_and_cache_last_data_safe = AsyncMock()
        watchdog = Mock(start=AsyncMock(), trigger_reconnect=AsyncMock())
        auth = SimpleNamespace(requires_login=False)
        with patch.object(market_feed, "reload_settings", return_value=settings), \
                patch.object(market_feed, "get_settings", return_value=settings), \
                patch.object(market_feed, "feed_watchdog", watchdog), \
                patch.object(market_feed, "auth_state_manager", auth), \
                patch.object(market_feed, "is_market_open", return_value=True), \
                patch.object(market_feed, "get_market_status", return_value="LIVE"), \
                patch("kiteconnect.KiteTicker"):
            started = time.monotonic()
            asyncio.run(service.start())

        service._attempt_reconnect.assert_awaited_once_with()
        self.assertGreaterEqual(service._ws_recovery_after, started + REST_WS_RECOVERY_SECONDS)
        self.assertFalse(service._feed_loop_active)


if __name__ == "__main__":
    unittest.main()
