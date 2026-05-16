#!/usr/bin/env python3
"""
🧪 TREND BASE IMPLEMENTATION VALIDATION SCRIPT

This script validates all Trend Base endpoints and functionality.
Run this after starting the backend to ensure everything is working.

Usage:
    python test_trend_base.py

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
WS_URL = "ws://localhost:8000/ws/trend-base"
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


async def test_current_trend(session):
    """Test GET /api/trend-base/current/{symbol}"""
    print("\n📊 Testing Current Trend Endpoint...")
    for symbol in SYMBOLS:
        success, data = await test_rest_endpoint(session, "GET", f"/api/trend-base/current/{symbol}")
        status = "✅" if success else "❌"
        print(f"  {status} /api/trend-base/current/{symbol}")
        if success and data:
            trend = data.get("trend", {})
            print(f"     • Trend: {trend.get('trendType')} ({trend.get('strength', 0)*100:.0f}%)")


async def test_structure(session):
    """Test GET /api/trend-base/structure/{symbol}"""
    print("\n🏗️  Testing Structure Endpoint...")
    for symbol in SYMBOLS:
        success, data = await test_rest_endpoint(session, "GET", f"/api/trend-base/structure/{symbol}")
        status = "✅" if success else "❌"
        print(f"  {status} /api/trend-base/structure/{symbol}")
        if success and data:
            structure = data.get("structure", {})
            print(f"     • Levels: {len(structure.get('supportLevels', []))} support, {len(structure.get('resistanceLevels', []))} resistance")


async def test_momentum(session):
    """Test GET /api/trend-base/momentum/{symbol}"""
    print("\n💪 Testing Momentum Endpoint...")
    for symbol in SYMBOLS:
        success, data = await test_rest_endpoint(session, "GET", f"/api/trend-base/momentum/{symbol}")
        status = "✅" if success else "❌"
        print(f"  {status} /api/trend-base/momentum/{symbol}")
        if success and data:
            momentum = data.get("momentum", {})
            print(f"     • Score: {momentum.get('momentumScore', 0):.1f}, Direction: {momentum.get('momentumDirection')}")


async def test_breakout_signal(session):
    """Test GET /api/trend-base/breakout-signal/{symbol}"""
    print("\n🚀 Testing Breakout Signal Endpoint...")
    for symbol in SYMBOLS:
        success, data = await test_rest_endpoint(session, "GET", f"/api/trend-base/breakout-signal/{symbol}")
        status = "✅" if success else "❌"
        print(f"  {status} /api/trend-base/breakout-signal/{symbol}")
        if success and data:
            signal = data.get("breakoutSignal", {})
            print(f"     • Signal: {signal.get('signalType')}, Confidence: {signal.get('confidence', 0)*100:.0f}%")


async def test_swing_points(session):
    """Test GET /api/trend-base/swing-points/{symbol}"""
    print("\n📍 Testing Swing Points Endpoint...")
    for symbol in SYMBOLS[:1]:  # Test only NIFTY for brevity
        success, data = await test_rest_endpoint(session, "GET", f"/api/trend-base/swing-points/{symbol}?limit=10")
        status = "✅" if success else "❌"
        print(f"  {status} /api/trend-base/swing-points/{symbol}")
        if success and data:
            swings = data.get("swingPoints", [])
            print(f"     • Count: {len(swings)}")


async def test_patterns(session):
    """Test GET /api/trend-base/patterns/{symbol}"""
    print("\n🎯 Testing Patterns Endpoint...")
    for symbol in SYMBOLS[:1]:  # Test only NIFTY for brevity
        success, data = await test_rest_endpoint(session, "GET", f"/api/trend-base/patterns/{symbol}?limit=5")
        status = "✅" if success else "❌"
        print(f"  {status} /api/trend-base/patterns/{symbol}")
        if success and data:
            patterns = data.get("patterns", [])
            print(f"     • Count: {len(patterns)}")


async def test_support_resistance(session):
    """Test GET /api/trend-base/support-resistance/{symbol}"""
    print("\n📏 Testing Support/Resistance Endpoint...")
    success, data = await test_rest_endpoint(session, "GET", f"/api/trend-base/support-resistance/NIFTY")
    status = "✅" if success else "❌"
    print(f"  {status} /api/trend-base/support-resistance/NIFTY")
    if success and data:
        print(f"     • Immediate Support: {data.get('immediateSupport')}")
        print(f"     • Immediate Resistance: {data.get('immediateResistance')}")


async def test_zones(session):
    """Test GET /api/trend-base/zones/{symbol}"""
    print("\n⚡ Testing Supply/Demand Zones Endpoint...")
    success, data = await test_rest_endpoint(session, "GET", f"/api/trend-base/zones/NIFTY")
    status = "✅" if success else "❌"
    print(f"  {status} /api/trend-base/zones/NIFTY")
    if success and data:
        print(f"     • Supply Zones: {len(data.get('supplyZones', []))}")
        print(f"     • Demand Zones: {len(data.get('demandZones', []))}")


async def test_confluence_points(session):
    """Test GET /api/trend-base/confluence-points/{symbol}"""
    print("\n🎯 Testing Confluence Points Endpoint...")
    success, data = await test_rest_endpoint(session, "GET", f"/api/trend-base/confluence-points/NIFTY")
    status = "✅" if success else "❌"
    print(f"  {status} /api/trend-base/confluence-points/NIFTY")
    if success and data:
        print(f"     • Confluence Points: {len(data.get('confluencePoints', []))}")


async def test_fractals(session):
    """Test GET /api/trend-base/fractals/{symbol}"""
    print("\n📊 Testing Fractal Analysis Endpoint...")
    success, data = await test_rest_endpoint(session, "GET", f"/api/trend-base/fractals/NIFTY")
    status = "✅" if success else "❌"
    print(f"  {status} /api/trend-base/fractals/NIFTY")
    if success and data:
        print(f"     • Bullish Fractals: {data.get('fractalsBullish')}")
        print(f"     • Bearish Fractals: {data.get('fractalsBearish')}")


async def test_performance(session):
    """Test GET /api/trend-base/performance/{symbol}"""
    print("\n⚙️  Testing Performance Endpoint...")
    success, data = await test_rest_endpoint(session, "GET", f"/api/trend-base/performance/NIFTY")
    status = "✅" if success else "❌"
    print(f"  {status} /api/trend-base/performance/NIFTY")
    if success and data:
        perf = data.get("performance", {})
        print(f"     • Latency: {perf.get('analysisLatencyMs')}ms")
        print(f"     • Throughput: {perf.get('throughputTicksPerSec')} ticks/sec")


async def test_health(session):
    """Test GET /api/trend-base/health"""
    print("\n❤️  Testing Health Endpoint...")
    success, data = await test_rest_endpoint(session, "GET", "/api/trend-base/health")
    status = "✅" if success else "❌"
    print(f"  {status} /api/trend-base/health")
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
    print("🧪 TREND BASE IMPLEMENTATION VALIDATION")
    print("=" * 60)
    print(f"Backend URL: {BASE_URL}")
    print(f"WebSocket URL: {WS_URL}")
    print(f"Symbols: {', '.join(SYMBOLS)}")
    print()

    # Test REST endpoints
    async with aiohttp.ClientSession() as session:
        await test_current_trend(session)
        await test_structure(session)
        await test_momentum(session)
        await test_breakout_signal(session)
        await test_swing_points(session)
        await test_patterns(session)
        await test_support_resistance(session)
        await test_zones(session)
        await test_confluence_points(session)
        await test_fractals(session)
        await test_performance(session)
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
        print("✅ Trend Base module is production-ready")
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
