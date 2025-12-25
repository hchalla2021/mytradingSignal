"""Test AI Engine initialization"""
import sys
sys.path.insert(0, 'd:/Trainings/GitHub projects/GitClonedProject/mytradingSignal/backend')

try:
    print("🧪 Testing AI Engine components...")
    
    # Test imports
    print("\n1. Testing imports...")
    from services.ai_engine import AIScheduler
    from services.cache import CacheService
    from services.websocket_manager import manager
    print("✅ All imports successful")
    
    # Test cache
    print("\n2. Testing CacheService...")
    cache = CacheService()
    print("✅ CacheService created")
    
    # Test mock market feed
    print("\n3. Creating mock market feed...")
    class MockFeed:
        pass
    feed = MockFeed()
    print("✅ Mock feed created")
    
    # Test AIScheduler initialization
    print("\n4. Testing AIScheduler initialization...")
    scheduler = AIScheduler(feed, cache, manager)
    print("✅ AIScheduler initialized successfully!")
    
    print("\n🎉 ALL TESTS PASSED! AI Engine is ready!")
    
except Exception as e:
    print(f"\n❌ ERROR: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
