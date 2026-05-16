"""
Test script for Smart Money Order Logic module.
Validates backend services and API endpoints.
"""

import asyncio
import httpx
import json
from datetime import datetime

BASE_URL = "http://localhost:8000"
SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"]

async def test_endpoints():
    """Test all Smart Money Order Logic endpoints."""
    async with httpx.AsyncClient() as client:
        print("\n" + "="*80)
        print("🚀 SMART MONEY ORDER LOGIC - ENDPOINT VALIDATION")
        print("="*80 + "\n")
        
        for symbol in SYMBOLS:
            print(f"\n📊 Testing {symbol}")
            print("-" * 40)
            
            # Test current signal endpoint
            try:
                response = await client.get(f"{BASE_URL}/api/smart-money/current/{symbol}")
                if response.status_code == 200:
                    signal = response.json()
                    print(f"✅ Current Signal: {signal.get('signalType', 'HOLD')}")
                    print(f"   Confidence: {signal.get('confidence', 0)*100:.0f}%")
                else:
                    print(f"⚠️ Current Signal: {response.status_code}")
            except Exception as e:
                print(f"❌ Current Signal Error: {e}")
            
            # Test volume profile endpoint
            try:
                response = await client.get(f"{BASE_URL}/api/smart-money/volume-profile/{symbol}")
                if response.status_code == 200:
                    profile = response.json()
                    print(f"✅ Volume Profile: {profile.get('levelCount', 0)} levels")
                else:
                    print(f"⚠️ Volume Profile: {response.status_code}")
            except Exception as e:
                print(f"❌ Volume Profile Error: {e}")
            
            # Test institutional activity endpoint
            try:
                response = await client.get(f"{BASE_URL}/api/smart-money/institutional-activity/{symbol}")
                if response.status_code == 200:
                    activity = response.json()
                    print(f"✅ Institutional Activity: {activity.get('activityLevel', 'LOW')}")
                    print(f"   Confidence: {activity.get('confidence', 0)*100:.0f}%")
                else:
                    print(f"⚠️ Institutional Activity: {response.status_code}")
            except Exception as e:
                print(f"❌ Institutional Activity Error: {e}")
            
            # Test market structure endpoint
            try:
                response = await client.get(f"{BASE_URL}/api/smart-money/market-structure/{symbol}")
                if response.status_code == 200:
                    structure = response.json()
                    print(f"✅ Market Structure: {structure.get('trend', 'NEUTRAL')}")
                    print(f"   Breakout Probability: {structure.get('breakoutProbability', 0)*100:.0f}%")
                else:
                    print(f"⚠️ Market Structure: {response.status_code}")
            except Exception as e:
                print(f"❌ Market Structure Error: {e}")
            
            # Test positioning endpoint
            try:
                response = await client.get(f"{BASE_URL}/api/smart-money/positioning/{symbol}")
                if response.status_code == 200:
                    positioning = response.json()
                    if 'netPosition' in positioning:
                        print(f"✅ Positioning: Net {positioning.get('netPosition', 0)}")
                    else:
                        print(f"✅ Positioning: No data yet")
                else:
                    print(f"⚠️ Positioning: {response.status_code}")
            except Exception as e:
                print(f"❌ Positioning Error: {e}")
            
            # Test clusters endpoint
            try:
                response = await client.get(f"{BASE_URL}/api/smart-money/clusters/{symbol}?limit=5")
                if response.status_code == 200:
                    clusters = response.json()
                    print(f"✅ Order Clusters: {clusters.get('clusterCount', 0)} clusters")
                else:
                    print(f"⚠️ Order Clusters: {response.status_code}")
            except Exception as e:
                print(f"❌ Order Clusters Error: {e}")
            
            # Test alerts endpoint
            try:
                response = await client.get(f"{BASE_URL}/api/smart-money/alerts/{symbol}")
                if response.status_code == 200:
                    alerts = response.json()
                    print(f"✅ Active Alerts: {alerts.get('activeAlertCount', 0)} alerts")
                else:
                    print(f"⚠️ Active Alerts: {response.status_code}")
            except Exception as e:
                print(f"❌ Active Alerts Error: {e}")
            
            # Test performance endpoint
            try:
                response = await client.get(f"{BASE_URL}/api/smart-money/performance/{symbol}")
                if response.status_code == 200:
                    perf = response.json()
                    print(f"✅ Performance: {perf.get('avgProcessingLatencyMs', 0):.1f}ms latency")
                    print(f"   Throughput: {perf.get('throughputTicksPerSec', 0):.0f} ticks/sec")
                else:
                    print(f"⚠️ Performance: {response.status_code}")
            except Exception as e:
                print(f"❌ Performance Error: {e}")
        
        # Test health endpoint
        print(f"\n🏥 System Health")
        print("-" * 40)
        try:
            response = await client.get(f"{BASE_URL}/api/smart-money/health")
            if response.status_code == 200:
                health = response.json()
                print(f"✅ Service Status: {health.get('status', 'unknown')}")
                print(f"   Service: {health.get('service', 'Unknown')}")
                print(f"   Version: {health.get('version', 'Unknown')}")
            else:
                print(f"⚠️ Health Check: {response.status_code}")
        except Exception as e:
            print(f"❌ Health Check Error: {e}")
        
        print("\n" + "="*80)
        print("✅ VALIDATION COMPLETE")
        print("="*80 + "\n")


async def main():
    """Run all tests."""
    await test_endpoints()


if __name__ == "__main__":
    asyncio.run(main())
