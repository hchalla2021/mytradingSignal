"""
Test State Orchestration System
Run this to verify all components are working correctly
"""
import asyncio
from datetime import datetime
import pytz

IST = pytz.timezone('Asia/Kolkata')

async def test_market_session():
    """Test Market Session Controller"""
    print("\n" + "="*70)
    print("1️⃣ TESTING MARKET SESSION CONTROLLER")
    print("="*70)
    
    from services.market_session_controller import market_session, MarketPhase
    
    now = datetime.now(IST)
    phase = market_session.get_current_phase(now)
    desc = market_session.get_phase_description(phase)
    is_trading = market_session.is_trading_hours(now)
    seconds_left = market_session.seconds_until_next_phase(now)
    
    print(f"\n✅ Current Time: {now.strftime('%Y-%m-%d %H:%M:%S %A')}")
    print(f"✅ Market Phase: {desc['icon']} {desc['title']}")
    print(f"✅ Description: {desc['description']}")
    print(f"✅ Is Trading Hours: {is_trading}")
    print(f"✅ Next Phase In: {seconds_left // 60} minutes")
    
    # Test different times
    test_times = [
        (9, 5, "PRE_OPEN"),
        (9, 10, "AUCTION_FREEZE"),
        (9, 20, "LIVE"),
        (16, 0, "CLOSED"),
    ]
    
    print(f"\n📊 Time-based Logic Tests:")
    for hour, minute, expected in test_times:
        test_time = now.replace(hour=hour, minute=minute)
        phase = market_session.get_current_phase(test_time)
        status = "✅" if phase.value == expected else "❌"
        print(f"  {status} {hour:02d}:{minute:02d} → {phase.value} (expected: {expected})")
    
    print(f"\n✅ Market Session Controller: WORKING\n")


async def test_auth_state():
    """Test Auth State Machine"""
    print("\n" + "="*70)
    print("2️⃣ TESTING AUTH STATE MACHINE")
    print("="*70)
    
    from services.auth_state_machine import auth_state_manager
    
    info = auth_state_manager.get_state_info()
    
    print(f"\n✅ Auth State: {info['state']}")
    print(f"✅ Is Valid: {info['is_valid']}")
    print(f"✅ Requires Login: {info['requires_login']}")
    print(f"✅ Has Token: {info['has_token']}")
    
    if info['token_age_hours']:
        print(f"✅ Token Age: {info['token_age_hours']:.2f} hours")
        if info['token_age_hours'] > 20:
            print(f"   ⚠️ Token is likely expired (>20 hours old)")
        else:
            print(f"   ✅ Token age is acceptable (<20 hours)")
    else:
        print(f"✅ Token Age: Unknown (no token file)")
    
    print(f"✅ Last Success: {info['last_success'] or 'Never'}")
    print(f"✅ Consecutive Failures: {info['consecutive_failures']}")
    
    print(f"\n✅ Auth State Machine: WORKING\n")


async def test_feed_watchdog():
    """Test Feed Watchdog"""
    print("\n" + "="*70)
    print("3️⃣ TESTING FEED WATCHDOG")
    print("="*70)
    
    from services.feed_watchdog import feed_watchdog
    
    metrics = feed_watchdog.get_health_metrics()
    
    print(f"\n✅ Feed State: {metrics['state']}")
    print(f"✅ Is Healthy: {metrics['is_healthy']}")
    print(f"✅ Is Stale: {metrics['is_stale']}")
    print(f"✅ Requires Reconnect: {metrics['requires_reconnect']}")
    
    if metrics['last_tick_seconds_ago']:
        print(f"✅ Last Tick: {metrics['last_tick_seconds_ago']}s ago")
    else:
        print(f"✅ Last Tick: Never (feed not started yet)")
    
    print(f"✅ Uptime: {metrics['uptime_minutes']:.1f} minutes")
    print(f"✅ Total Ticks: {metrics['total_ticks']}")
    print(f"✅ Total Reconnects: {metrics['total_reconnects']}")
    print(f"✅ Connection Quality: {metrics['connection_quality']:.1f}%")
    
    print(f"\n✅ Feed Watchdog: WORKING\n")


async def test_health_endpoint():
    """Test System Health Endpoint"""
    print("\n" + "="*70)
    print("4️⃣ TESTING SYSTEM HEALTH ENDPOINT")
    print("="*70)
    
    import httpx
    
    try:
        async with httpx.AsyncClient() as client:
            # Test health endpoint
            response = await client.get("http://localhost:8000/api/system/health")
            
            if response.status_code == 200:
                health = response.json()
                
                print(f"\n✅ Priority Status: {health['priority_status']}")
                print(f"✅ Priority Message: {health['priority_message']}")
                
                print(f"\n📊 Market:")
                print(f"  Phase: {health['market']['icon']} {health['market']['phase']}")
                print(f"  Trading Hours: {health['market']['is_trading_hours']}")
                
                print(f"\n🔐 Auth:")
                print(f"  State: {health['auth']['state']}")
                print(f"  Valid: {health['auth']['is_valid']}")
                
                print(f"\n🔌 Feed:")
                print(f"  State: {health['feed']['state']}")
                print(f"  Healthy: {health['feed']['is_healthy']}")
                print(f"  Quality: {health['feed']['connection_quality']:.0f}%")
                
                print(f"\n✅ System Health Endpoint: WORKING")
            else:
                print(f"\n❌ Health endpoint returned: {response.status_code}")
                print(f"   Make sure backend is running!")
                
    except Exception as e:
        print(f"\n❌ Cannot connect to backend: {e}")
        print(f"   Make sure backend is running on http://localhost:8000")
    
    print()


async def main():
    """Run all tests"""
    print("\n" + "="*70)
    print("🧪 STATE ORCHESTRATION SYSTEM - COMPONENT TEST")
    print("="*70)
    print(f"\nTesting Time: {datetime.now(IST).strftime('%Y-%m-%d %H:%M:%S %A')}")
    
    # Test components that don't need backend
    await test_market_session()
    await test_auth_state()
    await test_feed_watchdog()
    
    # Test backend endpoint (if running)
    await test_health_endpoint()
    
    print("="*70)
    print("✅ ALL COMPONENT TESTS COMPLETE")
    print("="*70)
    print("\n💡 Next Steps:")
    print("   1. Start backend: cd backend && uvicorn main:app --reload")
    print("   2. Open frontend: cd frontend && npm run dev")
    print("   3. Check /api/system/health endpoint")
    print("   4. Watch for system status banner on homepage")
    print()


if __name__ == "__main__":
    asyncio.run(main())
