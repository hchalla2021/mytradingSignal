"""Serialize and pace Kite REST calls across the application process."""

import functools
import logging
import threading
import time
from collections.abc import Callable
from typing import Any, cast

logger = logging.getLogger(__name__)
RequestHandler = Callable[..., Any]


class KiteRequestPacer:
    def __init__(
        self,
        min_interval: float = 0.2,
        base_cooldown: float = 3.0,
        max_cooldown: float = 30.0,
    ) -> None:
        self.min_interval = min_interval
        self.base_cooldown = base_cooldown
        self.max_cooldown = max_cooldown
        self._lock = threading.Lock()
        self._last_request_at = 0.0
        self._cooldown_until = 0.0
        self._rate_limit_streak = 0

    @staticmethod
    def _is_rate_limited(error: Exception) -> bool:
        return getattr(error, "code", None) == 429 or "too many requests" in str(error).casefold()

    def _wait(self) -> None:
        now = time.monotonic()
        delay = max(self._cooldown_until - now, self.min_interval - (now - self._last_request_at), 0.0)
        if delay:
            time.sleep(delay)

    def request(
        self,
        original: RequestHandler,
        client: object,
        route: str,
        method: str,
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        method = str(method).upper()
        with self._lock:
            for attempt in range(2 if method == "GET" else 1):
                self._wait()
                try:
                    result = original(client, route, method, *args, **kwargs)
                except Exception as error:
                    self._last_request_at = time.monotonic()
                    if not self._is_rate_limited(error):
                        raise
                    self._rate_limit_streak += 1
                    cooldown = min(
                        self.base_cooldown * (2 ** (self._rate_limit_streak - 1)),
                        self.max_cooldown,
                    )
                    self._cooldown_until = time.monotonic() + cooldown
                    logger.warning("Kite REST rate limit received; pausing requests for %.1fs", cooldown)
                    if method == "GET" and attempt == 0:
                        continue
                    raise
                self._last_request_at = time.monotonic()
                self._rate_limit_streak = 0
                self._cooldown_until = 0.0
                return result
        raise RuntimeError("Kite request ended without a response")


_pacer = KiteRequestPacer()


def install_kite_request_pacing() -> None:
    from kiteconnect import KiteConnect

    original = cast(RequestHandler, getattr(KiteConnect, "_request"))
    if getattr(original, "_mdts_paced", False):
        return

    @functools.wraps(original)
    def paced_request(client: object, route: str, method: str, *args: Any, **kwargs: Any) -> Any:
        return _pacer.request(original, client, route, method, *args, **kwargs)

    setattr(paced_request, "_mdts_paced", True)
    setattr(KiteConnect, "_request", paced_request)
