import threading
import time
import unittest

from kiteconnect.exceptions import NetworkException

from services.kite_request_pacing import KiteRequestPacer


class KiteRequestPacingTests(unittest.TestCase):
    def test_requests_are_serialized_and_spaced(self):
        pacer = KiteRequestPacer(min_interval=0.01)
        active = 0
        maximum_active = 0
        guard = threading.Lock()

        def request(*_args, **_kwargs):
            nonlocal active, maximum_active
            with guard:
                active += 1
                maximum_active = max(maximum_active, active)
            time.sleep(0.02)
            with guard:
                active -= 1

        threads = [
            threading.Thread(target=pacer.request, args=(request, object(), "orders", "GET"))
            for _ in range(3)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(maximum_active, 1)

    def test_rate_limited_get_retries_once_after_cooldown(self):
        pacer = KiteRequestPacer(min_interval=0, base_cooldown=0, max_cooldown=0)
        calls = 0

        def request(*_args, **_kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise NetworkException("Too many requests", code=429)
            return "ok"

        self.assertEqual(pacer.request(request, object(), "orders", "GET"), "ok")
        self.assertEqual(calls, 2)

    def test_rate_limited_mutation_is_never_retried(self):
        pacer = KiteRequestPacer(min_interval=0, base_cooldown=0, max_cooldown=0)
        calls = 0

        def request(*_args, **_kwargs):
            nonlocal calls
            calls += 1
            raise NetworkException("Too many requests", code=429)

        with self.assertRaises(NetworkException):
            pacer.request(request, object(), "orders", "POST")
        self.assertEqual(calls, 1)


if __name__ == "__main__":
    unittest.main()
