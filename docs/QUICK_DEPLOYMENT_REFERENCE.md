# 🚀 QUICK DEPLOYMENT REFERENCE

## PRE-DEPLOYMENT CHECKLIST (Copy & Paste)

```powershell
# 1. Remove hardcoded sample data from advanced_analysis.py line 218
# Edit file: backend/routers/advanced_analysis.py
# Replace hardcoded values with error responses
# See: PRODUCTION_HARDCODED_DATA_REMOVAL_GUIDE.md

# 2. Delete test files
cd backend
Remove-Item test_*.py -Force
Remove-Item data/test_data_factory.py -Force
Remove-Item scripts/generate_test_data.py -Force

# 3. Remove debug statements (optional - can gate with flag)
# Find and remove: print(f"[DEBUG]")
# Find and remove: console.log(...)

# 4. Set environment variables
$env:ZERODHA_API_KEY = "YOUR_ACTUAL_KEY"
$env:ZERODHA_API_SECRET = "YOUR_ACTUAL_SECRET"
$env:JWT_SECRET = "GENERATE_RANDOM_256_CHAR_STRING"
$env:DEBUG = "False"
$env:REDIS_URL = "redis://localhost:6379"

# 5. Verify backend
cd backend
pip install -r requirements.txt
# Should complete without errors

# 6. Verify frontend
cd ../frontend
npm install
npm run build
# Should complete without errors

# 7. Test with live data (during market hours)
cd ../backend
uvicorn main:app --reload --port 8000
# Check logs for "Zerodha WebSocket connected"
# Should NOT see "SAMPLE data" messages

# 8. Test frontend separately
cd ../frontend
npm start
# Should load at http://localhost:3000
# Should show live prices from backend
```

---

## DEPLOYMENT COMMANDS

```bash
# BACKEND (Production Grade)
cd backend
pip install -r requirements.txt

# Option 1: With Gunicorn (Recommended)
gunicorn main:app --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --timeout 120

# Option 2: With Uvicorn directly
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4

# FRONTEND (Production Grade)
cd frontend
npm install
npm run build
# Then use a proper server like nginx or:
npm start -- -H 0.0.0.0 -p 3000
```

---

## VERIFICATION COMMANDS

```powershell
# Test backend API
Invoke-WebRequest -Uri "http://localhost:8000/api/health" -Method GET

# Test frontend
Invoke-WebRequest -Uri "http://localhost:3000" -Method GET

# Check for hardcoded values
Get-ChildItem -Path "backend" -Filter "*.py" -Recurse | 
  Select-String -Pattern "450000|380000" | Measure-Object

# Check for remaining debug statements
Get-ChildItem -Path "backend/routers" -Filter "*.py" | 
  Select-String -Pattern 'print\(f"' | Measure-Object

# Verify no test files
Get-ChildItem -Path "backend" -Filter "test_*.py" -Recurse | Measure-Object
```

---

## WHAT TO FIX NOW

### 1️⃣ CRITICAL (Do First)
**File:** `backend/routers/advanced_analysis.py` line 218

Replace this:
```python
"green_candle_volume": 450000 if symbol == "NIFTY" else 380000,
"red_candle_volume": 320000 if symbol == "NIFTY" else 410000,
```

With this:
```python
# Return error instead of sample data
# See full fix in PRODUCTION_HARDCODED_DATA_REMOVAL_GUIDE.md
```

### 2️⃣ IMPORTANT (Delete)
```
backend/test_intraday_filter.py
backend/test_data_flow.py
backend/test_ema_calculation.py
backend/test_ema_pipeline.py
backend/test_fetch.py
backend/test_market_structure_fix.py
backend/data/test_data_factory.py
backend/scripts/generate_test_data.py
```

### 3️⃣ OPTIONAL (Clean Up)
- Remove `print(f"[DEBUG]` statements
- Remove `console.log` from frontend
- Or gate them with `if DEBUG:` / `if (DEBUG)`

---

## TIMELINE

| Task | Time | Status |
|------|------|--------|
| Read this doc | 2 min | 📖 |
| Fix hardcoded data | 10 min | 🔧 |
| Delete test files | 5 min | 🗑️ |
| Remove debug statements | 10 min | 🧹 |
| Set environment vars | 5 min | ⚙️ |
| Backend build test | 5 min | ✅ |
| Frontend build test | 10 min | ✅ |
| Deploy to prod | 30 min | 🚀 |
| Monitor & verify | 30 min | 📊 |
| **TOTAL** | **~2 hours** | ⏱️ |

---

## PRODUCTION VERIFICATION

After deployment, verify:

```
✅ Backend runs: http://localhost:8000/api/health
✅ Frontend loads: http://localhost:3000
✅ Zerodha connects: Check logs for "WebSocket connected"
✅ Prices update: New ticks every 0.5-1 second
✅ No SAMPLE data: Grep logs for "SAMPLE" - should find nothing
✅ All signals: Check Overall Market Outlook shows all 9 signals
✅ Performance: Response time <100ms
✅ Errors: No 500/401/403 errors in logs
```

---

## ENVIRONMENT VARIABLES (MUST SET)

```bash
# Zerodha (Required)
ZERODHA_API_KEY=<your-actual-api-key>
ZERODHA_API_SECRET=<your-actual-api-secret>
ZERODHA_ACCESS_TOKEN=<will-be-set-after-login>

# Security (Required)
JWT_SECRET=<generate-random-string-min-32-chars>

# Optional
REDIS_URL=redis://localhost:6379
DEBUG=False
MARKET_OPEN=09:15:00
MARKET_CLOSE=15:30:00
```

---

## EMERGENCY ROLLBACK

If something goes wrong:

```bash
# Stop services
Ctrl+C

# Restore from git
git log --oneline | head -5
git revert <commit-hash>
git push

# Restart
# redeploy using commands above
```

---

## DOCUMENTATION TO READ

- **Full audit:** COMPLETE_PRODUCTION_READINESS_AUDIT.md
- **Detailed fixes:** PRODUCTION_HARDCODED_DATA_REMOVAL_GUIDE.md
- **This file:** FINAL_DEPLOYMENT_SUMMARY.md
- **This quick ref:** QUICK_DEPLOYMENT_REFERENCE.md (you are here)

---

## DO NOT DEPLOY IF

❌ Hardcoded sample data still in code  
❌ Test files still present  
❌ ZERODHA_API_KEY not set  
❌ JWT_SECRET is too short (<32 chars)  
❌ Frontend/backend don't build  
❌ Zerodha WebSocket doesn't connect  
❌ You see "SAMPLE data" in logs  

---

## SUCCESS INDICATORS

✅ All 9 signals calculating  
✅ Overall Market Outlook refreshing  
✅ Prices updating in real-time  
✅ No errors in logs  
✅ Response time <100ms  
✅ Market indices displaying  
✅ Technical analysis showing  
✅ Volume data live  
✅ Trend analysis live  
✅ Market structure visible  

---

## NEED HELP?

1. "How do I fix the hardcoded data?"
   → See PRODUCTION_HARDCODED_DATA_REMOVAL_GUIDE.md, section ISSUE 1

2. "Which files should I delete?"
   → See section PRE-DEPLOYMENT CHECKLIST #2 above

3. "What are the issues found?"
   → See COMPLETE_PRODUCTION_READINESS_AUDIT.md, PART 2

4. "Is my code ready?"
   → Yes, after applying fixes above (1-2 hours work)

5. "When can I deploy?"
   → After verifying all items in PRE-DEPLOYMENT CHECKLIST

---

**Status:** ✅ Project is 95% production ready  
**Next Step:** Apply fixes above (see CRITICAL section)  
**Estimated Deploy Time:** 2 hours total prep + 30 min deployment  
**Support:** Reference documents above for detailed guidance  

🚀 Ready to deploy! Fix the critical items and you're good to go!

