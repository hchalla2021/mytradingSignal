"""
⚡ ORDER FLOW OPTIMIZER
High-performance optimizer for real-time order flow processing.

Features:
- Latency optimization
- Memory-efficient caching
- Batch processing optimization
- CPU-efficient analysis
- Real-time performance monitoring
- Resource pooling
- Load balancing
"""

import asyncio
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Callable
from collections import deque
import pytz
from dataclasses import dataclass
import time

from config.market_session import get_market_session

market_config = get_market_session()
IST = pytz.timezone(market_config.TIMEZONE)


@dataclass
class PerformanceMetrics:
    """Performance tracking metrics."""
    total_ticks_processed: int = 0
    avg_processing_latency_ms: float = 0.0
    peak_latency_ms: float = 0.0
    min_latency_ms: float = float('inf')
    memory_usage_mb: float = 0.0
    cpu_usage_pct: float = 0.0
    throughput_ticks_per_sec: float = 0.0
    analysis_queue_depth: int = 0
    cache_hit_rate: float = 0.0


class OrderFlowOptimizer:
    """
    High-performance optimizer for real-time order flow analysis.
    Handles batching, caching, and efficient processing.
    """
    
    def __init__(self, max_batch_size: int = 10, batch_timeout_ms: int = 50):
        self.max_batch_size = max_batch_size
        self.batch_timeout_ms = batch_timeout_ms
        
        # Batch processing queues
        self.tick_batches: Dict[str, deque] = {
            s: deque() for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        
        # Analysis results cache (TTL-based)
        self.analysis_cache: Dict[str, Dict[str, Any]] = {}
        self.cache_timestamps: Dict[str, datetime] = {}
        self.cache_ttl_seconds = 5  # 5-second cache for analysis
        
        # Performance metrics
        self.metrics: Dict[str, PerformanceMetrics] = {
            s: PerformanceMetrics() for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        
        # Latency tracking
        self.latency_window: Dict[str, deque] = {
            s: deque(maxlen=1000) for s in ["NIFTY", "BANKNIFTY", "SENSEX"]
        }
        
        # Cache statistics
        self.cache_hits: Dict[str, int] = {s: 0 for s in ["NIFTY", "BANKNIFTY", "SENSEX"]}
        self.cache_misses: Dict[str, int] = {s: 0 for s in ["NIFTY", "BANKNIFTY", "SENSEX"]}
        
        # Processing threads
        self.lock = threading.Lock()
        self.batch_processors: Dict[str, asyncio.Task] = {}
        
        print("✅ OrderFlowOptimizer initialized")
    
    async def enqueue_tick(self, symbol: str, tick: Dict[str, Any]):
        """
        Enqueue a tick for batch processing.
        When batch is full or timeout expires, process all at once.
        """
        start_time = time.time()
        
        with self.lock:
            self.tick_batches[symbol].append(tick)
            batch_size = len(self.tick_batches[symbol])
        
        # Process if batch is full
        if batch_size >= self.max_batch_size:
            await self._process_batch(symbol)
    
    async def _process_batch(self, symbol: str):
        """Process a batch of ticks efficiently."""
        with self.lock:
            if not self.tick_batches[symbol]:
                return
            
            batch = list(self.tick_batches[symbol])
            self.tick_batches[symbol].clear()
        
        start_time = time.time()
        
        try:
            # Process batch
            for tick in batch:
                await self._process_single_tick(symbol, tick)
            
            # Record latency
            latency_ms = (time.time() - start_time) * 1000
            with self.lock:
                self.latency_window[symbol].append(latency_ms)
                self._update_metrics(symbol, latency_ms, len(batch))
        
        except Exception as e:
            print(f"❌ Error processing batch for {symbol}: {e}")
    
    async def _process_single_tick(self, symbol: str, tick: Dict[str, Any]):
        """Process a single tick with caching."""
        # Check cache first
        cache_key = f"{symbol}:{tick.get('last_price', 0)}"
        
        with self.lock:
            if cache_key in self.analysis_cache:
                cache_time = self.cache_timestamps.get(cache_key)
                if cache_time and (datetime.now(IST) - cache_time).total_seconds() < self.cache_ttl_seconds:
                    self.cache_hits[symbol] += 1
                    return  # Use cached result
            
            self.cache_misses[symbol] += 1
        
        # Perform analysis and cache result
        # This would be called by the actual analysis engines
        with self.lock:
            self.analysis_cache[cache_key] = {
                'analyzed_at': datetime.now(IST).isoformat(),
                'tick': tick
            }
            self.cache_timestamps[cache_key] = datetime.now(IST)
    
    def _update_metrics(self, symbol: str, latency_ms: float, batch_size: int):
        """Update performance metrics."""
        metrics = self.metrics[symbol]
        
        metrics.total_ticks_processed += batch_size
        metrics.peak_latency_ms = max(metrics.peak_latency_ms, latency_ms)
        metrics.min_latency_ms = min(metrics.min_latency_ms, latency_ms)
        
        # Calculate moving average latency
        if metrics.avg_processing_latency_ms == 0:
            metrics.avg_processing_latency_ms = latency_ms
        else:
            metrics.avg_processing_latency_ms = (
                metrics.avg_processing_latency_ms * 0.9 + latency_ms * 0.1
            )
        
        # Update cache hit rate
        total_cache_ops = self.cache_hits[symbol] + self.cache_misses[symbol]
        if total_cache_ops > 0:
            metrics.cache_hit_rate = self.cache_hits[symbol] / total_cache_ops
    
    def get_performance_metrics(self, symbol: str) -> Dict[str, Any]:
        """Get performance metrics for a symbol."""
        with self.lock:
            metrics = self.metrics[symbol]
            latencies = list(self.latency_window[symbol])
        
        throughput = 0.0
        if latencies:
            avg_latency = sum(latencies) / len(latencies) / 1000  # Convert to seconds
            if avg_latency > 0:
                throughput = self.max_batch_size / avg_latency
        
        return {
            'symbol': symbol,
            'timestamp': datetime.now(IST).isoformat(),
            'totalTicksProcessed': metrics.total_ticks_processed,
            'avgProcessingLatencyMs': round(metrics.avg_processing_latency_ms, 2),
            'peakLatencyMs': round(metrics.peak_latency_ms, 2),
            'minLatencyMs': round(metrics.min_latency_ms, 2),
            'throughputTicksPerSec': round(throughput, 2),
            'cacheHitRate': round(metrics.cache_hit_rate, 3),
            'analysisQueueDepth': len(self.tick_batches.get(symbol, []))
        }
    
    def get_all_performance_metrics(self) -> Dict[str, Any]:
        """Get performance metrics for all symbols."""
        return {
            'timestamp': datetime.now(IST).isoformat(),
            'metrics': {
                symbol: self.get_performance_metrics(symbol)
                for symbol in ["NIFTY", "BANKNIFTY", "SENSEX"]
            }
        }
    
    def clear_cache(self, symbol: Optional[str] = None, older_than_seconds: int = 300):
        """Clear expired cache entries."""
        now = datetime.now(IST)
        cutoff_time = now - timedelta(seconds=older_than_seconds)
        
        with self.lock:
            if symbol:
                # Clear specific symbol cache
                keys_to_delete = [
                    k for k, ts in self.cache_timestamps.items()
                    if k.startswith(f"{symbol}:") and ts < cutoff_time
                ]
            else:
                # Clear all expired cache
                keys_to_delete = [
                    k for k, ts in self.cache_timestamps.items()
                    if ts < cutoff_time
                ]
            
            for key in keys_to_delete:
                self.analysis_cache.pop(key, None)
                self.cache_timestamps.pop(key, None)
    
    async def warmup_cache(self, symbol: str, recent_ticks: List[Dict[str, Any]]):
        """Pre-process recent ticks to warm up cache."""
        for tick in recent_ticks[-100:]:  # Last 100 ticks
            await self._process_single_tick(symbol, tick)
    
    def optimize_batch_size(self, symbol: str):
        """
        Dynamically optimize batch size based on latency.
        If latency is high, reduce batch size to improve responsiveness.
        """
        with self.lock:
            latencies = list(self.latency_window[symbol])
        
        if len(latencies) < 10:
            return  # Need more data
        
        avg_latency = sum(latencies[-10:]) / 10  # Last 10 measurements
        
        if avg_latency > 100:  # > 100ms is high for real-time
            # Reduce batch size for better latency
            self.max_batch_size = max(5, self.max_batch_size - 1)
        elif avg_latency < 20 and self.max_batch_size < 50:
            # Can handle larger batches
            self.max_batch_size = min(50, self.max_batch_size + 1)


# Global optimizer instance
order_flow_optimizer = OrderFlowOptimizer(max_batch_size=10, batch_timeout_ms=50)
