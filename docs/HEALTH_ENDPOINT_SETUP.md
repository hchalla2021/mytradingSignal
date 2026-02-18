# FastAPI Health Endpoint Setup

The auto-start scheduler performs periodic health checks on your backend. For this to work properly, your FastAPI app needs a `/health` endpoint.

## Check if You Already Have It

First, check if your backend already has a health endpoint:

```bash
# While backend is running, test with curl
curl http://localhost:8000/health

# Should return: {"status": "ok"} with HTTP 200
```

If you get a 404 error, follow the steps below to add it.

---

## Option 1: Add to Your Main FastAPI App

Open `backend/main.py` and add this endpoint:

```python
from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI()

# ============= HEALTH CHECK ENDPOINT =============
@app.get("/health")
async def health_check():
    """
    Health check endpoint for monitoring systems
    Returns: {"status": "ok"} if backend is running
    """
    return JSONResponse(
        status_code=200,
        content={"status": "ok", "timestamp": datetime.now().isoformat()}
    )

# Rest of your app code...
```

**Location in file:**
- Add at the top with imports (if `datetime` not imported, add it)
- Add after `app = FastAPI()` and before any other routes
- Keep it simple - no complex logic

---

## Option 2: Add to Routers

If you use FastAPI routers (recommended), create separate router:

### File: `backend/routers/health.py`

```python
from fastapi import APIRouter
from datetime import datetime

router = APIRouter(tags=["health"])

@router.get("/health")
async def health_check():
    """Health check endpoint for monitoring"""
    return {
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "service": "trading-signal-backend"
    }

@router.get("/health/detailed")
async def health_check_detailed():
    """Detailed health check with more info"""
    try:
        # Add any database checks, cache checks, etc here
        return {
            "status": "healthy",
            "backend": "ok",
            "database": "ok",  # Check your DB connection
            "cache": "ok",      # Check Redis connection
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }
```

### Then in `backend/main.py`

```python
from fastapi import FastAPI
from routers import health  # Add this import

app = FastAPI()

# Include health router
app.include_router(health.router)

# Rest of your app...
```

---

## Option 3: More Advanced Health Check

If you want the health check to verify actual connectivity:

```python
from fastapi import APIRouter
from datetime import datetime
import asyncio

router = APIRouter(tags=["health"])

@router.get("/health")
async def health_check():
    """
    Comprehensive health check
    Verifies: Backend running, Redis accessible, Database connected
    """
    health_status = {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "checks": {}
    }
    
    # Check Redis cache
    try:
        cache = await get_redis()  # Your existing get_redis function
        await cache.ping()
        health_status["checks"]["redis"] = "ok"
    except:
        health_status["checks"]["redis"] = "error"
        health_status["status"] = "degraded"
    
    # Check if market data is flowing (optional)
    try:
        market_data = await cache.get("market_data:NIFTY")
        if market_data:
            health_status["checks"]["market_feed"] = "active"
        else:
            health_status["checks"]["market_feed"] = "no_data"  # OK if outside hours
    except:
        health_status["checks"]["market_feed"] = "error"
    
    # Return appropriate status code
    status_code = 200 if health_status["status"] == "healthy" else 503
    return JSONResponse(status_code=status_code, content=health_status)
```

---

## Testing Your Endpoint

After adding the health endpoint, test it:

```bash
# Start your backend (if not running)
cd /var/www/mytradingSignal
pm2 start backend/main.py --name backend

# Test the endpoint
curl http://localhost:8000/health

# Should return something like:
# {"status":"ok","timestamp":"2026-02-18T14:30:00.123456"}

# Test detailed endpoint (if you added it)
curl http://localhost:8000/health/detailed
```

---

## What the Auto-Start System Does

Once your health endpoint is working:

1. **Every 10 minutes** during market hours, scheduler hits `/health`
2. **If it gets HTTP 200** → Backend is healthy, no action
3. **If it gets error/timeout** → Backend crashed, auto-restart

The scheduler will log:

```
✅ Health check PASSED - Backend is responsive
```

or

```
⚠️ Health check FAILED - Backend not responding - attempting restart...
```

---

## If You Don't Have a Health Endpoint

The scheduler **still works**, but without health checks:

- ✅ Will start backend at 9 AM
- ✅ Will monitor PM2 process status
- ❌ Won't detect if backend crashed (only PM2 can detect that)

**Recommended**: Add even the simple endpoint (Option 1) for better monitoring.

---

## Common Issues

### "Health check always fails"
- Check if backend is actually running: `pm2 status`
- Check backend logs: `pm2 logs backend`
- Verify endpoint exists: `curl http://localhost:8000/health` (while backend running)
- Check if backend listens on correct port/host

### "Backend starts but health check times out"
- Backend might be slow to initialize
- Scheduler waits 5 seconds after starting, then checks health
- If backend needs more time, increase wait in `market-auto-start.js` line 265:
  ```javascript
  await new Promise(r => setTimeout(r, 10000));  // Changed from 5000 to 10000
  ```

### "Port 8000 already in use"
- Another backend instance might be running
- Kill it: `pkill -f "python.*main.py"`
- Or force PM2: `pm2 kill && pm2 start backend/main.py --name backend`

---

## Next Steps

1. Add health endpoint to your backend (pick Option 1, 2, or 3)
2. Test it's working: `curl http://localhost:8000/health`
3. Run setup script: `bash setup-auto-start.sh`
4. Watch logs: `pm2 logs market-scheduler`

Done! Your backend will now auto-start every market day at 9 AM.
