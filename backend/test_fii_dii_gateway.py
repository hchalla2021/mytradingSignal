import asyncio
import threading
import time
import unittest
from unittest.mock import AsyncMock, Mock, patch

from routers import fii_dii


class RealtimeSnapshotTests(unittest.IsolatedAsyncioTestCase):
    async def test_inference_does_not_block_other_requests(self):
        release = threading.Event()
        cache = Mock()
        cache.get_all_market_data = AsyncMock(return_value={"NIFTY": {"price": 100}})
        engine = Mock()
        expected = {"indices": {"NIFTY": {"aggregateScore": 10}}}
        engine.get_snapshot.return_value = expected
        engine.update_tick.side_effect = lambda *_: release.wait(.5)

        with patch.object(fii_dii, "get_cache", return_value=cache), \
                patch.object(fii_dii, "fii_dii_realtime_ai_engine", engine):
            pending = asyncio.create_task(fii_dii._build_realtime_snapshot())
            started = time.monotonic()
            try:
                await asyncio.sleep(.02)
                self.assertLess(time.monotonic() - started, .2)
            finally:
                release.set()
                result = await pending
        engine.update_tick.assert_called_once_with("NIFTY", {"price": 100})
        self.assertEqual(result, expected)

    async def test_inference_errors_are_not_hidden(self):
        cache = Mock()
        cache.get_all_market_data = AsyncMock(return_value={"NIFTY": {"price": 100}})
        engine = Mock()
        engine.update_tick.side_effect = RuntimeError("inference unavailable")
        with patch.object(fii_dii, "get_cache", return_value=cache), \
                patch.object(fii_dii, "fii_dii_realtime_ai_engine", engine):
            with self.assertRaisesRegex(RuntimeError, "inference unavailable"):
                await fii_dii._build_realtime_snapshot()
