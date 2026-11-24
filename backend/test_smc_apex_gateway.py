import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import smc_apex


class GatewayTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(smc_apex.router)
        self.client = TestClient(app)
        self.owner = SimpleNamespace(app_access_username="owner", frontend_url="http://localhost:3000",
                                     cors_origins="http://localhost:3000", jwt_secret="x" * 48)
        self.settings = patch.object(smc_apex, "get_settings", return_value=self.owner)
        self.settings.start()
        self.session = patch.object(smc_apex.app_access_service, "validate_session",
                                    new_callable=AsyncMock)
        self.validate = self.session.start()
        self.validate.return_value = {"authenticated": True, "username": "owner"}

    def tearDown(self):
        self.session.stop()
        self.settings.stop()

    def test_nonowner_and_unsigned_intent_never_reach_service(self):
        self.validate.return_value = {"authenticated": True, "username": "other"}
        self.assertEqual(self.client.get("/api/smc-apex/status").status_code, 401)
        self.validate.return_value = {"authenticated": True, "username": "owner"}
        for headers in ({}, {"Origin": "https://evil.invalid", "X-Apex-Intent": "manual-live-control"},
                        {"Origin": "http://localhost:3000", "X-Apex-Intent": "save-configuration"}):
            response = self.client.put("/api/smc-apex/trade-control", json={"enabled": True}, headers=headers)
            self.assertEqual(response.status_code, 403)

    def test_signed_transport_forwards_only_allowlisted_body_without_browser_credentials(self):
        requests = []
        def transport(request):
            requests.append(request)
            return httpx.Response(200, json={"live": False})
        original = httpx.AsyncClient
        with patch.object(smc_apex.httpx, "AsyncClient", side_effect=lambda **kwargs: original(
                **kwargs, transport=httpx.MockTransport(transport))):
            response = self.client.put("/api/smc-apex/trade-control", json={"enabled": False},
                                       headers={"Origin": "http://localhost:3000", "X-Apex-Intent": "manual-live-control",
                                                "Cookie": "app_access_token=mock", "X-Device-Id": "mock-device"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(requests[0].content), {"enabled": False})
        self.assertIn("x-apex-signature", requests[0].headers)
        self.assertNotIn("cookie", requests[0].headers)
        self.assertNotIn("x-device-id", requests[0].headers)
        self.assertEqual(self.client.get("/api/smc-apex/orders").status_code, 404)

    def test_unavailable_service_is_explicit_not_off(self):
        with patch.object(smc_apex.httpx, "AsyncClient") as client:
            client.return_value.__aenter__.return_value.request.side_effect = httpx.ConnectError("mock")
            response = self.client.get("/api/smc-apex/status")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("live", response.json())

    def test_lightweight_live_state_uses_authenticated_signed_transport(self):
        requests = []
        original = httpx.AsyncClient
        def response(request):
            requests.append(request)
            return httpx.Response(200, json={"live": False, "at": "2026-11-24T11:20:00+05:30"})
        with patch.object(smc_apex.httpx, "AsyncClient", side_effect=lambda **kwargs: original(
                **kwargs, transport=httpx.MockTransport(response))):
            result = self.client.get("/api/smc-apex/trade-control")
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.json()["live"])
        self.assertEqual(requests[0].url.path, "/api/trade-control")
        self.assertIn("x-apex-signature", requests[0].headers)
        self.validate.return_value = {"authenticated": False}
        self.assertEqual(self.client.get("/api/smc-apex/trade-control").status_code, 401)


if __name__ == "__main__":
    unittest.main()
