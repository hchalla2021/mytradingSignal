"""Bounded AQTE instrumentation and independent advisory evaluation workers."""

import copy
import logging
import threading
import time
from collections import Counter, deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from services.aqte_engine import SYMBOLS
from services.aqte_engines import ENGINES

logger = logging.getLogger(__name__)


class Latencies:
    def __init__(self, capacity=256):
        self.capacity = capacity
        self.lock = threading.Lock()
        self.samples = {}
        self.counts = Counter()
        self.counters = Counter()

    def observe(self, stage, milliseconds):
        with self.lock:
            self.samples.setdefault(stage, deque(maxlen=self.capacity)).append(milliseconds)
            self.counts[stage] += 1

    def increment(self, name, amount=1):
        with self.lock:
            self.counters[name] += amount

    @contextmanager
    def measure(self, stage):
        started = time.perf_counter_ns()
        try:
            yield
        finally:
            self.observe(stage, (time.perf_counter_ns() - started) / 1_000_000)

    def snapshot(self):
        with self.lock:
            result = {}
            for name, samples in self.samples.items():
                values = sorted(samples)
                result[name] = dict(count=self.counts[name], samples=len(values),
                                    p50_ms=round(values[(len(values) - 1) // 2], 4),
                                    p95_ms=round(values[min(len(values) - 1, int(len(values) * .95))], 4),
                                    max_ms=round(values[-1], 4), last_ms=round(samples[-1], 4))
            return dict(latency=result, counters=dict(self.counters))


class EngineWorkers:
    """At most one running and one latest pending job per (index, engine); no all-engine barrier."""

    def __init__(self, metrics, publish=None):
        self.metrics = metrics
        self.publish = publish
        self.lock = threading.RLock()
        self.pool = ThreadPoolExecutor(max_workers=12, thread_name_prefix="aqte-evaluator")
        self.running = set()
        self.pending = {}
        self.results = {}
        self.closed = False

    def submit(self, symbol, key, source_at, job):
        if symbol not in SYMBOLS or key not in {engine[1] for engine in ENGINES}:
            raise ValueError("Unknown AQTE engine identity")
        identity = (symbol, key)
        queued_at = time.perf_counter_ns()
        with self.lock:
            if self.closed:
                return
            if identity in self.running:
                if identity in self.pending:
                    self.metrics.increment("engine_jobs_coalesced")
                self.pending[identity] = (source_at, job, queued_at)
                return
            self.running.add(identity)
            self.pool.submit(self._run, identity, source_at, job, queued_at)

    def _run(self, identity, source_at, job, queued_at):
        symbol, key = identity
        self.metrics.observe(f"engine_queue.{key}", (time.perf_counter_ns() - queued_at) / 1_000_000)
        try:
            with self.metrics.measure(f"engine.{key}"):
                card = job()
            error = None
        except Exception as exc:
            logger.exception("AQTE %s evaluator failed for %s; other evaluators continue", key, symbol)
            self.metrics.increment(f"engine_errors.{key}")
            card, error = None, f"{type(exc).__name__}: evaluator unavailable"
        with self.lock:
            previous = self.results.get(identity)
            if previous is None or source_at >= previous["source_at"]:
                self.results[identity] = dict(card=card, error=error, source_at=source_at,
                                              evaluated_at=time.time())
            next_job = self.pending.pop(identity, None) if not self.closed else None
            if next_job is None:
                self.running.discard(identity)
            else:
                self.pool.submit(self._run, identity, *next_job)
        if self.publish:
            self.publish()

    def snapshot(self):
        with self.lock:
            return copy.deepcopy(self.results)

    def diagnostics(self):
        with self.lock:
            return dict(running=len(self.running), pending=len(self.pending),
                        capacity=36, workers=12, closed=self.closed)

    def close(self):
        with self.lock:
            self.closed = True
            self.pending.clear()
        self.pool.shutdown(wait=True, cancel_futures=True)
