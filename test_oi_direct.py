import sys
sys.path.insert(0, 'backend')
import traceback
import asyncio

async def test():
    try:
        # Import and setup
        from routers import analysis
        
        # Call the endpoint function directly
        result = await analysis.oi_momentum_signal("NIFTY")
        import json
        print(json.dumps(result, indent=2, default=str))
    except Exception as e:
        print("ERROR:", str(e))
        traceback.print_exc()

asyncio.run(test())
