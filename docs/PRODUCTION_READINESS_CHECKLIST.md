# 🔧 PRODUCTION READINESS - FIX CHECKLIST

**Date Created:** January 25, 2026  
**Status:** Ready for Implementation  
**Estimated Time:** 2.5 hours

---

## PHASE 1: SECURITY (30 minutes)

### ☐ 1.1 Rotate Zerodha Credentials (5 min)
- [ ] Go to https://developers.kite.trade/apps
- [ ] Regenerate API Secret for production app
- [ ] Note new API Key and Secret
- [ ] Invalidate old tokens
- **Evidence:** Check dashboard shows UPDATED credentials

### ☐ 1.2 Generate Secure JWT Secret (2 min)
Generate new random string:
```bash
openssl rand -base64 32
```
- [ ] Save output to secure location (password manager)
- [ ] Store temporarily in comments for next step
- **Evidence:** Copy & paste of generated string

### ☐ 1.3 Delete .env Files from Git History (10 min)
```bash
# Remove from tracking (but keep locally)
git rm --cached backend/.env
git rm --cached backend/.env.digitalocean
git rm --cached backend/.env.market
git rm --cached backend/.env.production
git rm --cached frontend/.env.local
git rm --cached frontend/.env.digitalocean
git rm --cached frontend/.env.production
git rm --cached .env.production.template
```
- [ ] Executed above commands
- [ ] Added `.env*` to .gitignore
- [ ] Committed with message: "🔒 Remove sensitive .env files"
- **Evidence:** `git status` shows clean, no .env files staged

### ☐ 1.4 Update Backend .env File (5 min)
**File:** `backend/.env`
- [ ] Set ZERODHA_API_KEY to new value from step 1.1
- [ ] Set ZERODHA_API_SECRET to new value from step 1.1
- [ ] Set JWT_SECRET to new value from step 1.2
- [ ] Leave ZERODHA_ACCESS_TOKEN empty (generated on login)
- [ ] Keep REDIRECT_URL as localhost for local dev
- [ ] Keep CORS_ORIGINS as localhost for local dev

### ☐ 1.5 Secure .gitignore (5 min)
**File:** `.gitignore`
- [ ] Add the following:
```
.env
.env.local
.env.*.local
.env.production
access_token.txt
```
- [ ] Verify file exists and is committed
- **Evidence:** `cat .gitignore | grep ".env"`

---

## PHASE 2: FIX HARDCODED DATA (45 minutes)

### ☐ 2.1 Find Hardcoded Prices (5 min)
```bash
cd backend
grep -r "24500\|51000\|80000\|base_price" --include="*.py" routers/ services/
```
- [ ] Execute command
- [ ] Identify all occurrences
- [ ] Document findings
- **Evidence:** List of files with line numbers

### ☐ 2.2 Fix TREND-BASE Endpoint (30 min)
**File:** `backend/routers/advanced_analysis.py`
**Location:** Lines 407-441

**Current Code:** Returns hardcoded sample data
**New Code:** Return 503 error instead

Replace:
```python
# OLD CODE - Lines 407-441
"""
Lines showing:
base_price = 24500 if symbol == "NIFTY" else 51000...
return { "signal": "BUY", "confidence": 72... }
"""
```

With:
```python
# NEW CODE - return proper error
raise HTTPException(
    status_code=503,
    detail={
        "message": "Market data unavailable",
        "symbol": symbol,
        "reason": "Market closed or insufficient historical data",
        "market_hours": "9:15 AM - 3:30 PM IST (Mon-Fri, except holidays)",
        "next_available": "Next trading day"
    }
)
```

- [ ] File updated
- [ ] Syntax checked: `python -m py_compile backend/routers/advanced_analysis.py`
- [ ] Tested endpoint in logs
- **Evidence:** File saved with proper error response

### ☐ 2.3 Check for Other Hardcoded Prices (10 min)
- [ ] Review grep results from 2.1
- [ ] Fix each occurrence following same pattern as 2.2
- [ ] Search for similar patterns in other files
- **Evidence:** All files checked and updated

---

## PHASE 3: CONFIGURATION & LOGGING (45 minutes)

### ☐ 3.1 Add Production Guards to Test Pages (15 min)
**File:** `frontend/app/test-env/page.tsx`
- [ ] Add import: `import { notFound } from 'next/navigation';`
- [ ] Add guard at top of export function:
```typescript
if (process.env.NODE_ENV === 'production') {
  notFound();
}
```
- [ ] Verify file syntax
- **Evidence:** File updated and saved

**File:** `frontend/app/test-api/page.tsx`
- [ ] Add same guard as above
- **Evidence:** File updated and saved

### ☐ 3.2 Guard Console Logs (15 min)
**File:** `frontend/hooks/useMarketSocket.ts`

Locations: Lines 134, 143, 229, 232

For each `console.log()`:
- [ ] Wrap with: `if (process.env.NODE_ENV === 'development') { console.log(...) }`

Example:
```typescript
// OLD
console.log('📊 [SNAPSHOT] Received data:', snapshot);

// NEW
if (process.env.NODE_ENV === 'development') {
  console.log('📊 [SNAPSHOT] Received data:', snapshot);
}
```
- [ ] All console.log statements guarded
- [ ] Rebuilt frontend: `npm run build`
- **Evidence:** Rebuild succeeds with no errors

### ☐ 3.3 Implement Fail-Fast Validation (15 min)
**File:** `backend/main.py`
**Location:** Lines 38-66

Current code only prints warnings. Add:
```python
import sys  # Add to imports at top

# Replace the if validation_errors block:
if validation_errors:
    print("\n🚨 CRITICAL CONFIGURATION ERRORS:")
    for error in validation_errors:
        print(f"   ❌ {error}")
    print("\n⚠️  Application startup ABORTED")
    sys.exit(1)  # ✅ EXIT with error
else:
    print("✅ Environment configuration valid")
```
- [ ] File updated
- [ ] Syntax checked: `python -m py_compile backend/main.py`
- [ ] Tested with missing env vars (should exit with error)
- **Evidence:** Backend exits cleanly when config missing

---

## PHASE 4: TESTING (30 minutes)

### ☐ 4.1 Frontend Build Test (10 min)
```bash
cd frontend
npm run build
```
- [ ] Build succeeds
- [ ] No TypeScript errors
- [ ] No warnings about console.log
- **Evidence:** Build output shows "✓ Compiled successfully"

### ☐ 4.2 Backend Startup Test (10 min)
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --port 8000
```
- [ ] Backend starts
- [ ] Shows "Application startup complete"
- [ ] Validation messages look correct
- [ ] No missing credential errors
- **Evidence:** Startup logs show all checks passing

### ☐ 4.3 API Endpoint Tests (10 min)
```bash
# Test TREND-BASE returns error (not dummy data)
curl -s http://localhost:8000/api/advanced/trend-base/NIFTY | jq .

# Should show 503 error or data_unavailable status
# NOT hardcoded prices like ₹24,500
```
- [ ] Endpoint returns proper error
- [ ] No dummy prices in response
- [ ] Response includes market hours info
- **Evidence:** Output shows error structure

---

## PHASE 5: PRE-DEPLOYMENT (30 minutes)

### ☐ 5.1 Run Pre-Deployment Checklist (15 min)
```bash
#!/bin/bash
# Check for secrets in git
git log -p | grep -E "ZERODHA_API_KEY|JWT_SECRET" | head -5
# Should show NOTHING or only in docs

# Check .env files not tracked
git status | grep ".env"
# Should show NOTHING

# Test backend config
cd backend
python -c "from config import Settings; s = Settings(); print('✓ Config OK')"

# Test required vars
[ -z "$ZERODHA_API_KEY" ] && echo "⚠️ Missing ZERODHA_API_KEY"
[ -z "$JWT_SECRET" ] && echo "⚠️ Missing JWT_SECRET"
```

- [ ] All checks pass
- [ ] No secrets in git history
- [ ] .env files not being tracked
- [ ] Config loads successfully
- **Evidence:** Script output shows all checks passing

### ☐ 5.2 Environment Files Validation (10 min)
- [ ] `backend/.env` exists and has placeholder structure
- [ ] `frontend/.env.local` exists and has placeholder structure
- [ ] Both files are in .gitignore
- [ ] Example files (.example) exist for reference
- **Evidence:** Files verified and committed

### ☐ 5.3 Final Code Review (5 min)
- [ ] No `console.log()` without guards
- [ ] No `print()` without guards
- [ ] No hardcoded IPs or domains in code
- [ ] No dummy data returned by APIs
- [ ] No test routes exposed
- **Evidence:** Manual review completed

---

## PHASE 6: DOCUMENTATION (15 minutes)

### ☐ 6.1 Update Deployment Guide
- [ ] Create/update `docs/PRODUCTION_DEPLOYMENT.md`
- [ ] Document all secrets needed
- [ ] Add security checklist
- [ ] Add post-deployment tests

### ☐ 6.2 Update README.md
- [ ] Add "Production Deployment" section
- [ ] Link to deployment guide
- [ ] Note about credential rotation

### ☐ 6.3 Create CHANGELOG Entry
- [ ] Document security fixes
- [ ] Document configuration changes
- [ ] Note breaking changes if any

---

## DEPLOYMENT CHECKLIST

### ☐ Before Deploying to Production

**Security:**
- [ ] All credentials are NEW (rotated)
- [ ] JWT_SECRET is unique (not default)
- [ ] .env files NOT in git repository
- [ ] Credentials in GitHub Secrets or DO App Platform only

**Code Quality:**
- [ ] No hardcoded prices returned
- [ ] No dummy data in responses
- [ ] Test pages have production guards
- [ ] Logging guarded for production

**Testing:**
- [ ] Frontend builds successfully
- [ ] Backend starts cleanly
- [ ] APIs tested and return real data
- [ ] Health checks pass

**Configuration:**
- [ ] CORS properly restricted
- [ ] Redirect URLs set correctly
- [ ] Database connected
- [ ] Redis connected (if configured)

### ☐ Post-Deployment

- [ ] Health endpoints responding
- [ ] WebSocket connections working
- [ ] Market data flowing through
- [ ] Monitor logs for errors
- [ ] Set up alerts for failures

---

## SUMMARY

**Total Tasks:** 40+  
**Total Time:** ~2.5 hours  
**Priority:** MUST complete before ANY production deployment

**Completion Status:**
- [ ] Phase 1 Complete (Security)
- [ ] Phase 2 Complete (Data Quality)
- [ ] Phase 3 Complete (Config/Logging)
- [ ] Phase 4 Complete (Testing)
- [ ] Phase 5 Complete (Pre-Deployment)
- [ ] Phase 6 Complete (Documentation)
- [ ] **READY FOR PRODUCTION** ✅

---

## NEXT STEPS

1. **Start with Phase 1** - Most critical
2. **Document as you go** - Mark off checkboxes
3. **Test after each phase** - Catch issues early
4. **Review before deploying** - Double-check all items

---

**Good luck! Report back when all items are complete.**

