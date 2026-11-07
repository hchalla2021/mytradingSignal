from contextlib import asynccontextmanager
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from config import get_settings
from routers import aqte as aqte_router
from services.app_access import app_access_service
from services.engine_events import EngineEventService, EngineEventStore


class EngineEventStoreTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = EngineEventStore(path=Path(self.directory.name) / "events.sqlite3")
        await self.store.connect()

    async def asyncTearDown(self):
        await self.store.close()
        self.directory.cleanup()

    @staticmethod
    def event(key, message):
        return dict(at=1000.0, instrument="NIFTY", event_type="TEST_EVENT", severity="info",
                    message=message, source="test", idempotency_key=key)

    async def test_append_is_idempotent_and_replay_is_ordered(self):
        first = await self.store.append(self.event("first", "first event"))
        duplicate = await self.store.append(self.event("first", "duplicate"))
        second = await self.store.append(self.event("second", "second event"))

        self.assertIsNotNone(first)
        self.assertIsNone(duplicate)
        self.assertIsNotNone(second)
        self.assertEqual([first["id"], second["id"]], [event["id"] for event in await self.store.read_after(0)])
        self.assertEqual([second["id"]], [event["id"] for event in await self.store.read_after(first["id"])])


class EngineEventServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_published_events_are_persisted_before_broadcast(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EngineEventStore(path=Path(directory) / "events.sqlite3")
            service = EngineEventService(store)
            await service.start()
            queue = service.subscribe()
            try:
                saved = await service.publish(
                    "MARKET_DATA_CONNECTED", "Feed connected", severity="success",
                    source="test", idempotency_key="feed:1",
                )
                delivered = await queue.get()
                duplicate = await service.publish(
                    "MARKET_DATA_CONNECTED", "Feed connected", severity="success",
                    source="test", idempotency_key="feed:1",
                )

                self.assertEqual(saved, delivered)
                self.assertIsNone(duplicate)
                self.assertEqual([saved], await service.history(0))
            finally:
                service.unsubscribe(queue)
                await service.stop()

    async def test_slow_subscriber_is_signalled_for_durable_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            store = EngineEventStore(path=Path(directory) / "events.sqlite3")
            service = EngineEventService(store)
            await service.start()
            queue = service.subscribe(capacity=1)
            try:
                await service.publish("FIRST", "first", idempotency_key="first")
                await service.publish("SECOND", "second", idempotency_key="second")

                self.assertIsNone(await queue.get())
                self.assertEqual(2, len(await service.history(0)))
            finally:
                service.unsubscribe(queue)
                await service.stop()


class EngineEventWebSocketTests(unittest.TestCase):
    def test_authenticated_owner_cookie_replays_persisted_events(self):
        with tempfile.TemporaryDirectory() as directory:
            service = EngineEventService(EngineEventStore(path=Path(directory) / "events.sqlite3"))

            @asynccontextmanager
            async def lifespan(app):
                await service.start()
                await service.publish(
                    "MARKET_DATA_CONNECTED", "Feed connected", severity="success",
                    idempotency_key="feed:1",
                )
                yield
                await service.stop()

            app = FastAPI(lifespan=lifespan)
            app.include_router(aqte_router.router)
            cfg = get_settings()
            with patch.object(aqte_router, "get_engine_event_service", return_value=service), \
                    patch.object(app_access_service, "validate_session", new_callable=AsyncMock,
                                 return_value={"authenticated": True, "username": cfg.app_access_username}) as validate:
                with TestClient(app) as client:
                    client.cookies.set("app_access_token", "test-session")
                    with client.websocket_connect("/api/aqte/events?device_id=test-device") as websocket:
                        payload = websocket.receive_json()

                validate.assert_awaited_once_with("test-session", "test-device")
                self.assertEqual("history", payload["type"])
                self.assertEqual("MARKET_DATA_CONNECTED", payload["events"][0]["event_type"])


if __name__ == "__main__":
    unittest.main()
