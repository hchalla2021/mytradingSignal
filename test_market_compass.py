"""Market Compass Module - Comprehensive Test Suite

Tests all REST endpoints, WebSocket connectivity, multi-symbol validation, and latency targets.
"""

import asyncio
import time
import json
import requests
import websockets
from datetime import datetime

BASE_URL = "http://localhost:8000"
WS_URL = "ws://localhost:8000"

# Test data
TEST_SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"]
LATENCY_TARGET_MS = 50  # Target latency in milliseconds


class LatencyMeasurer:
    """Measures API latency."""

    def __init__(self):
        self.measurements = []

    def record(self, endpoint: str, latency_ms: float):
        self.measurements.append({
            'endpoint': endpoint,
            'latency_ms': latency_ms,
            'timestamp': datetime.now().isoformat(),
            'status': 'PASS' if latency_ms < LATENCY_TARGET_MS else 'WARNING'
        })

    def report(self):
        if not self.measurements:
            return "No measurements recorded"

        avg = sum(m['latency_ms'] for m in self.measurements) / len(self.measurements)
        max_latency = max(m['latency_ms'] for m in self.measurements)
        min_latency = min(m['latency_ms'] for m in self.measurements)

        report = f"""
╔══════════════════════════════════════════════════════════════╗
║         MARKET COMPASS - LATENCY PERFORMANCE REPORT         ║
╚══════════════════════════════════════════════════════════════╝

Performance Summary:
  • Average Latency: {avg:.2f}ms (Target: {LATENCY_TARGET_MS}ms)
  • Maximum Latency: {max_latency:.2f}ms
  • Minimum Latency: {min_latency:.2f}ms
  • Total Measurements: {len(self.measurements)}

Endpoint Breakdown:
"""
        for m in self.measurements:
            status_icon = "✅" if m['status'] == 'PASS' else "⚠️"
            report += f"  {status_icon} {m['endpoint']:40} {m['latency_ms']:7.2f}ms\n"

        return report


latency_meter = LatencyMeasurer()


def test_health_check():
    """Test health check endpoint."""
    print("\n▶️ Testing: Health Check Endpoint")
    try:
        start = time.time()
        response = requests.get(f"{BASE_URL}/api/market-compass/health")
        latency = (time.time() - start) * 1000

        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()

        assert 'status' in data, "Missing 'status' field"
        assert data['status'] == 'operational', f"Expected operational status, got {data['status']}"
        assert 'service' in data, "Missing 'service' field"
        assert 'capabilities' in data, "Missing 'capabilities' field"

        latency_meter.record("GET /api/market-compass/health", latency)

        print(f"  ✅ PASSED - Status: {data['status']} (Latency: {latency:.2f}ms)")
        return True
    except Exception as e:
        print(f"  ❌ FAILED - {str(e)}")
        return False


def test_correlation_endpoint():
    """Test correlation analysis endpoint."""
    print("\n▶️ Testing: Correlation Analysis Endpoint")
    passed = 0

    for symbol in TEST_SYMBOLS:
        try:
            start = time.time()
            response = requests.get(f"{BASE_URL}/api/market-compass/correlation/{symbol}")
            latency = (time.time() - start) * 1000

            assert response.status_code == 200, f"Expected 200, got {response.status_code}"
            data = response.json()

            assert 'primary_symbol' in data, "Missing primary_symbol"
            assert 'correlations' in data, "Missing correlations"
            assert data['primary_symbol'] == symbol, "Symbol mismatch"

            latency_meter.record(f"GET /api/market-compass/correlation/{symbol}", latency)

            print(f"  ✅ {symbol}: Found {data['count']} correlations (Latency: {latency:.2f}ms)")
            passed += 1
        except Exception as e:
            print(f"  ❌ {symbol}: FAILED - {str(e)}")

    return passed == len(TEST_SYMBOLS)


def test_market_structure_endpoint():
    """Test market structure endpoint."""
    print("\n▶️ Testing: Market Structure Endpoint")
    passed = 0

    for symbol in TEST_SYMBOLS:
        try:
            start = time.time()
            response = requests.get(f"{BASE_URL}/api/market-compass/market-structure/{symbol}")
            latency = (time.time() - start) * 1000

            assert response.status_code in [200, 202], f"Expected 200/202, got {response.status_code}"
            data = response.json()

            assert 'symbol' in data, "Missing symbol"

            latency_meter.record(f"GET /api/market-compass/market-structure/{symbol}", latency)

            print(f"  ✅ {symbol}: Structure analysis received (Latency: {latency:.2f}ms)")
            passed += 1
        except Exception as e:
            print(f"  ❌ {symbol}: FAILED - {str(e)}")

    return passed == len(TEST_SYMBOLS)


def test_global_impact_endpoint():
    """Test global impact analysis endpoint."""
    print("\n▶️ Testing: Global Impact Endpoint")
    try:
        start = time.time()
        response = requests.get(f"{BASE_URL}/api/market-compass/global-impact")
        latency = (time.time() - start) * 1000

        assert response.status_code in [200, 202], f"Expected 200/202, got {response.status_code}"

        latency_meter.record("GET /api/market-compass/global-impact", latency)

        print(f"  ✅ PASSED - Global impact data received (Latency: {latency:.2f}ms)")
        return True
    except Exception as e:
        print(f"  ❌ FAILED - {str(e)}")
        return False


def test_institutional_flow_endpoint():
    """Test institutional flow endpoint."""
    print("\n▶️ Testing: Institutional Flow Endpoint")
    passed = 0

    for symbol in TEST_SYMBOLS:
        try:
            start = time.time()
            response = requests.get(f"{BASE_URL}/api/market-compass/institutional-flow/{symbol}")
            latency = (time.time() - start) * 1000

            assert response.status_code == 200, f"Expected 200, got {response.status_code}"
            data = response.json()

            assert 'symbol' in data, "Missing symbol"

            latency_meter.record(f"GET /api/market-compass/institutional-flow/{symbol}", latency)

            print(f"  ✅ {symbol}: Flow analysis received (Latency: {latency:.2f}ms)")
            passed += 1
        except Exception as e:
            print(f"  ❌ {symbol}: FAILED - {str(e)}")

    return passed == len(TEST_SYMBOLS)


def test_market_regime_endpoint():
    """Test market regime endpoint."""
    print("\n▶️ Testing: Market Regime Endpoint")
    passed = 0

    for symbol in TEST_SYMBOLS:
        try:
            start = time.time()
            response = requests.get(f"{BASE_URL}/api/market-compass/market-regime/{symbol}")
            latency = (time.time() - start) * 1000

            assert response.status_code in [200, 202], f"Expected 200/202, got {response.status_code}"
            data = response.json()

            assert 'symbol' in data, "Missing symbol"

            latency_meter.record(f"GET /api/market-compass/market-regime/{symbol}", latency)

            print(f"  ✅ {symbol}: Regime analysis received (Latency: {latency:.2f}ms)")
            passed += 1
        except Exception as e:
            print(f"  ❌ {symbol}: FAILED - {str(e)}")

    return passed == len(TEST_SYMBOLS)


def test_sentiment_endpoint():
    """Test sentiment analysis endpoint."""
    print("\n▶️ Testing: Sentiment Analysis Endpoint")
    passed = 0

    for symbol in TEST_SYMBOLS:
        try:
            start = time.time()
            response = requests.get(f"{BASE_URL}/api/market-compass/sentiment/{symbol}")
            latency = (time.time() - start) * 1000

            assert response.status_code in [200, 202], f"Expected 200/202, got {response.status_code}"
            data = response.json()

            assert 'symbol' in data, "Missing symbol"

            latency_meter.record(f"GET /api/market-compass/sentiment/{symbol}", latency)

            print(f"  ✅ {symbol}: Sentiment analysis received (Latency: {latency:.2f}ms)")
            passed += 1
        except Exception as e:
            print(f"  ❌ {symbol}: FAILED - {str(e)}")

    return passed == len(TEST_SYMBOLS)


def test_risk_score_endpoint():
    """Test risk score endpoint."""
    print("\n▶️ Testing: Risk Score Endpoint")
    passed = 0

    for symbol in TEST_SYMBOLS:
        try:
            start = time.time()
            response = requests.get(f"{BASE_URL}/api/market-compass/risk-score/{symbol}")
            latency = (time.time() - start) * 1000

            assert response.status_code in [200, 202], f"Expected 200/202, got {response.status_code}"
            data = response.json()

            assert 'symbol' in data, "Missing symbol"

            latency_meter.record(f"GET /api/market-compass/risk-score/{symbol}", latency)

            print(f"  ✅ {symbol}: Risk assessment received (Latency: {latency:.2f}ms)")
            passed += 1
        except Exception as e:
            print(f"  ❌ {symbol}: FAILED - {str(e)}")

    return passed == len(TEST_SYMBOLS)


def test_dashboard_endpoint():
    """Test comprehensive dashboard endpoint."""
    print("\n▶️ Testing: Comprehensive Dashboard Endpoint")
    passed = 0

    for symbol in TEST_SYMBOLS:
        try:
            start = time.time()
            response = requests.get(f"{BASE_URL}/api/market-compass/dashboard/{symbol}")
            latency = (time.time() - start) * 1000

            assert response.status_code == 200, f"Expected 200, got {response.status_code}"
            data = response.json()

            assert 'symbol' in data, "Missing symbol"

            latency_meter.record(f"GET /api/market-compass/dashboard/{symbol}", latency)

            print(f"  ✅ {symbol}: Dashboard data received (Latency: {latency:.2f}ms)")
            passed += 1
        except Exception as e:
            print(f"  ❌ {symbol}: FAILED - {str(e)}")

    return passed == len(TEST_SYMBOLS)


async def test_websocket_connection():
    """Test WebSocket endpoint."""
    print("\n▶️ Testing: WebSocket Connection & Subscription")
    try:
        uri = f"{WS_URL}/ws/market-compass"
        
        async with websockets.connect(uri) as websocket:
            # Send subscription
            subscription = {
                "client_id": "test_client",
                "symbols": TEST_SYMBOLS
            }
            
            await websocket.send(json.dumps(subscription))
            
            # Receive snapshot
            message = await asyncio.wait_for(websocket.recv(), timeout=5)
            data = json.loads(message)
            
            assert 'type' in data, "Missing type in snapshot"
            assert data['type'] == 'snapshot', "Expected snapshot message"
            assert 'symbols' in data, "Missing symbols in snapshot"
            
            print(f"  ✅ WebSocket Connected")
            print(f"  ✅ Snapshot received for {len(data['symbols'])} symbols")
            
            return True
    except Exception as e:
        print(f"  ❌ FAILED - {str(e)}")
        return False


def run_all_tests():
    """Run all tests."""
    print("""
╔══════════════════════════════════════════════════════════════╗
║     MARKET COMPASS MODULE - COMPREHENSIVE TEST SUITE        ║
╚══════════════════════════════════════════════════════════════╝
""")

    results = []

    # REST API Tests
    print("\n📊 REST API TESTS")
    print("=" * 60)

    results.append(("Health Check", test_health_check()))
    results.append(("Correlation Endpoint", test_correlation_endpoint()))
    results.append(("Market Structure", test_market_structure_endpoint()))
    results.append(("Global Impact", test_global_impact_endpoint()))
    results.append(("Institutional Flow", test_institutional_flow_endpoint()))
    results.append(("Market Regime", test_market_regime_endpoint()))
    results.append(("Sentiment Analysis", test_sentiment_endpoint()))
    results.append(("Risk Score", test_risk_score_endpoint()))
    results.append(("Dashboard", test_dashboard_endpoint()))

    # WebSocket Test
    print("\n🔌 WEBSOCKET TESTS")
    print("=" * 60)

    try:
        ws_result = asyncio.run(test_websocket_connection())
        results.append(("WebSocket Connection", ws_result))
    except Exception as e:
        print(f"  ❌ WebSocket test failed: {str(e)}")
        results.append(("WebSocket Connection", False))

    # Summary
    print("\n" + latency_meter.report())

    print("\n📋 TEST SUMMARY")
    print("=" * 60)
    passed = sum(1 for _, result in results if result)
    total = len(results)

    for test_name, result in results:
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"  {status} - {test_name}")

    print(f"\n  Total: {passed}/{total} tests passed")

    if passed == total:
        print("\n🎉 ALL TESTS PASSED! Market Compass module is production-ready.")
    else:
        print(f"\n⚠️  {total - passed} test(s) failed. Review and fix before deployment.")

    return passed == total


if __name__ == "__main__":
    success = run_all_tests()
    exit(0 if success else 1)
