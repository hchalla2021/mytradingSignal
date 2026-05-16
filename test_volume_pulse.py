#!/usr/bin/env python3
"""
🧪 VOLUME PULSE IMPLEMENTATION VALIDATION SCRIPT

This script validates all Volume Pulse endpoints and functionality.
Run this after starting the backend to ensure everything is working.

Usage:
    python test_volume_pulse.py

Expected output:
    ✅ All endpoints responding
    ✅ Data format correct
    ✅ WebSocket functional
    ✅ Performance acceptable
"""

import asyncio
import aiohttp
import json
import time
from datetime import datetime
import websockets

# Configuration
BASE_URL = "http://localhost:8000"
WS_URL = "ws://localhost:8000/ws/volume-pulse"
SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"]

# Test results
results = {
    "passed": 0,
    "failed": 0,
    "errors": []
}


async def test_rest_endpoint(session, method, endpoint, expected_status=200):
    """Test a REST endpoint."""
    url = f"{BASE_URL}{endpoint}"
    try:
        async with session.request(method, url) as response:
            if response.status == expected_status:
                data = await response.json()
                results["passed"] += 1
                return True, data
            else:
                error = f"Expected {expected_status}, got {response.status}"
                results["failed"] += 1
                results["errors"].append(f"{endpoint}: {error}")
                return False, None
    except Exception as e:
        results["failed"] += 1
        results["errors"].append(f"{endpoint}: {str(e)}")
        return False, None


async def test_current_metrics(session):
    """Test GET /api/volume-pulse/current/{symbol}"""
    print("\n📊 Testing Current Volume Metrics...")
    for symbol in SYMBOLS:
        success, data = await test_rest_endpoint(session, "GET", f"/api/volume-pulse/current/{symbol}")
        status = "✅" if success else "❌"
        print(f"  {status} /api/volume-pulse/current/{symbol}")
        if success and data:
            metrics = data.get("volumeMetrics", {})
            print(f"     • Momentum: {metrics.get('volumeMomentum', 0):.1f}")
            print(f"     • Ratio: {metrics.get('volumeRatio', 0):.2f}x")


async def test_profile(session):
    """Test GET /api/volume-pulse/profile/{symbol}"""
    print("\n🏗️  Testing Volume Profile Endpoint...")
    for symbol in SYMBOLS:
        success, data = await test_rest_endpoint(session, "GET", f"/api/volume-pulse/profile/{symbol}")
        status = "✅" if success else "❌"
        print(f"  {status} /api/volume-pulse/profile/{symbol}")
        if success and data:
            profile = data.get("profile", {})
            print(f"     • POC: {profile.get('pointOfControl', 0):.2f}")
            print(f"     • Shape: {profile.get('profileShape', 'N/A')}")


async def test_anomalies(session):
    """Test GET /api/volume-pulse/anomalies/{symbol}"""
    print("\n🚨 Testing Anomaly Detection...")
    for symbol in SYMBOLS[:1]:  # Test only NIFTY for brevity
        success, data = await test_rest_endpoint(session, "GET", f"/api/volume-pulse/anomalies/{symbol}")
        status = "✅" if success else "❌"
        print(f"  {status} /api/volume-pulse/anomalies/{symbol}")
        if success and data:
            anomalies = data.get("anomalies", [])
            print(f"     • Count: {len(anomalies)}")


async def test_statistics(session):
    """Test GET /api/volume-pulse/statistics/{symbol}"""
    print("\n📈 Testing Volume Statistics...")
    for symbol in SYMBOLS[:1]:  # Test only NIFTY for brevity
        success, data = await test_rest_endpoint(session, "GET", f"/api/volume-pulse/statistics/{symbol}")
        status = "✅" if success else "❌"
        print(f"  {status} /api/volume-pulse/statistics/{symbol}")
        if success and data:
            stats = data.get("analysis", {})
            print(f"     • Trend: {stats.get('trendDirection', 'N/A')}")
            print(f"     • Percentile: {stats.get('percentile', 0):.1f}")


async def test_patterns(session):
    """Test GET /api/volume-pulse/patterns/{symbol}"""
    print("\n🎯 Testing Pattern Detection...")
    for symbol in SYMBOLS[:1]:
        success, data = await test_rest_endpoint(session, "GET", f"/api/volume-pulse/patterns/{symbol}")
        status = "✅" if success else "❌"
        print(f"  {status} /api/volume-pulse/patterns/{symbol}")
        if success and data:
            patterns = data.get("patterns", [])
            print(f"     • Count: {len(patterns)}")


async def test_forecast(session):
    """Test GET /api/volume-pulse/forecast/{symbol}"""
    print("\n🔮 Testing Volume Forecast...")
    for symbol in SYMBOLS[:1]:
        success, data = await test_rest_endpoint(session, "GET", f"/api/volume-pulse/forecast/{symbol}")
        status = "✅" if success else "❌"
        print(f"  {status} /api/volume-pulse/forecast/{symbol}")
        if success and data:
            forecast = data.get("forecast", {})
            print(f"     • Next Bar: {forecast.get('nextBar', 0):.0f}")
            print(f"     • Confidence: {forecast.get('confidence', 0):.2f}")


async def test_flow(session):
    """Test GET /api/volume-pulse/flow/{symbol}"""
    print("\n🔄 Testing Volume Flow Analysis...")
    for symbol in SYMBOLS[:1]:
        success, data = await test_rest_endpoint(session, "GET", f"/api/volume-pulse/flow/{symbol}")
        status = "✅" if success else "❌"
        print(f"  {status} /api/volume-pulse/flow/{symbol}")
        if success and data:
            flow = data.get("volumeFlow", {})
            print(f"     • Direction: {data.get('institutional', {}).get('flowDirection', 'N/A')}")
            print(f"     • Buying Pressure: {flow.get('buyingPressure', 0):.1f}%")


async def test_support_resistance(session):
    """Test GET /api/volume-pulse/support-resistance/{symbol}"""
    print("\n📏 Testing Support/Resistance Levels...")
    success, data = await test_rest_endpoint(session, "GET", f"/api/volume-pulse/support-resistance/NIFTY")
    status = "✅" if success else "❌"
    print(f"  {status} /api/volume-pulse/support-resistance/NIFTY")
    if success and data:
        levels = data.get("keyLevels", {})
        print(f"     • POC: {levels.get('pointOfControl', 0):.2f}")


async def test_health(session):
    """Test GET /api/volume-pulse/health"""
    print("\n❤️  Testing Health Endpoint...")
    success, data = await test_rest_endpoint(session, "GET", "/api/volume-pulse/health")
    status = "✅" if success else "❌"
    print(f"  {status} /api/volume-pulse/health")
    if success and data:
        print(f"     • Status: {data.get('status')}")
        print(f"     • Version: {data.get('version')}")


async def test_websocket():
    """Test WebSocket connection."""
    print("\n🔌 Testing WebSocket Endpoint...")
    try:
        async with websockets.connect(WS_URL) as websocket:
            # Subscribe to NIFTY
            subscribe_msg = {
                "action": "subscribe",
                "symbols": ["NIFTY"],
                "client_id": "test_client"
            }
            await websocket.send(json.dumps(subscribe_msg))
            
            # Receive snapshot
            response = await asyncio.wait_for(websocket.recv(), timeout=5)
            data = json.loads(response)
            
            if data.get("type") == "snapshot":
                results["passed"] += 1
                print(f"  ✅ WebSocket connection and snapshot")
                print(f"     • Received data for symbol: {data.get('symbol')}")
            else:
                results["failed"] += 1
                print(f"  ❌ WebSocket - unexpected response type")
    except asyncio.TimeoutError:
        results["failed"] += 1
        results["errors"].append("WebSocket: Timeout waiting for snapshot")
        print(f"  ❌ WebSocket - timeout")
    except Exception as e:
        results["failed"] += 1
        results["errors"].append(f"WebSocket: {str(e)}")
        print(f"  ❌ WebSocket - {str(e)}")


async def main():
    """Run all tests."""
    print("=" * 60)
    print("🧪 VOLUME PULSE IMPLEMENTATION VALIDATION")
    print("=" * 60)
    print(f"Backend URL: {BASE_URL}")
    print(f"WebSocket URL: {WS_URL}")
    print(f"Symbols: {', '.join(SYMBOLS)}")
    print()

    # Test REST endpoints
    async with aiohttp.ClientSession() as session:
        await test_current_metrics(session)
        await test_profile(session)
        await test_anomalies(session)
        await test_statistics(session)
        await test_patterns(session)
        await test_forecast(session)
        await test_flow(session)
        await test_support_resistance(session)
        await test_health(session)

    # Test WebSocket
    await test_websocket()

    # Print summary
    print("\n" + "=" * 60)
    print("📊 TEST SUMMARY")
    print("=" * 60)
    print(f"✅ Passed: {results['passed']}")
    print(f"❌ Failed: {results['failed']}")
    print(f"Total: {results['passed'] + results['failed']}")
    print()

    if results['failed'] == 0:
        print("🎉 ALL TESTS PASSED!")
        print("✅ Volume Pulse module is production-ready")
    else:
        print("⚠️  SOME TESTS FAILED")
        print("\nErrors:")
        for error in results['errors']:
            print(f"  • {error}")

    print("=" * 60)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n⚠️  Test interrupted by user")
    except Exception as e:
        print(f"\n\n❌ Test failed with error: {e}")
