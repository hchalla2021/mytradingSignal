#!/usr/bin/env python
"""Test if OI momentum endpoint is working"""
import asyncio
import sys

async def test():
    try:
        print("Attempting to import _calc_oi_momentum...")
        from routers.analysis import _calc_oi_momentum
        print("✅ _calc_oi_momentum imported successfully")
        
        print("\nCalling _calc_oi_momentum('NIFTY'...")
        result = await _calc_oi_momentum("NIFTY")
        print(f"✅ Result signal: {result.get('final_signal', 'ERROR')}")
        print(f"   Confidence: {result.get('confidence', 0)}")
        print(f"   Reasons: {result.get('reasons', [])}")
        return True
    except ImportError as e:
        print(f"❌ Import Error: {e}")
        return False
    except TypeError as e:
        print(f"❌ Type Error (likely async issue): {e}")
        return False
    except Exception as e:
        print(f"❌ {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False

success = asyncio.run(test())
sys.exit(0 if success else 1)
