# ═══════════════════════════════════════════════════════════════════════════════
# fix_0_signals.ps1 - Comprehensive Diagnostic for "0/8 signals" Issue (Windows)
# ═══════════════════════════════════════════════════════════════════════════════
# Problem: Overall Market Outlook shows "0/8 signals - Limited data"
# Cause: Backend APIs not returning data to frontend
# Solution: This script diagnoses and fixes all common issues
# ═══════════════════════════════════════════════════════════════════════════════

$ErrorActionPreference = "SilentlyContinue"

Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "   🚨 DIAGNOSING: '0/8 signals - Limited data' Issue" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ───────────────────────────────────────────────────────────────────────────────
# STEP 1: Check if Backend and Frontend are Running
# ───────────────────────────────────────────────────────────────────────────────
Write-Host "🔍 STEP 1: Checking Server Status..." -ForegroundColor Yellow
Write-Host ""

# Check if backend is running on port 8000
$backendProcess = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($backendProcess) {
    Write-Host "   ✅ Backend: Running on port 8000" -ForegroundColor Green
} else {
    Write-Host "   ❌ Backend: NOT RUNNING on port 8000" -ForegroundColor Red
    Write-Host ""
    Write-Host "→ Fix: Start backend server" -ForegroundColor Yellow
    Write-Host "   cd backend" -ForegroundColor Blue
    Write-Host "   python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000" -ForegroundColor Blue
}

# Check if frontend is running on port 3000 or 3001
$frontendProcess3000 = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
$frontendProcess3001 = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue

if ($frontendProcess3000) {
    Write-Host "   ✅ Frontend: Running on port 3000" -ForegroundColor Green
} elseif ($frontendProcess3001) {
    Write-Host "   ✅ Frontend: Running on port 3001" -ForegroundColor Green
} else {
    Write-Host "   ❌ Frontend: NOT RUNNING" -ForegroundColor Red
    Write-Host ""
    Write-Host "→ Fix: Start frontend server" -ForegroundColor Yellow
    Write-Host "   cd frontend" -ForegroundColor Blue
    Write-Host "   npm run dev" -ForegroundColor Blue
}

Write-Host ""
Write-Host "───────────────────────────────────────────────────────────────────────────────" -ForegroundColor Blue
Write-Host ""

# ───────────────────────────────────────────────────────────────────────────────
# STEP 2: Test Backend API Endpoints
# ───────────────────────────────────────────────────────────────────────────────
Write-Host "🔍 STEP 2: Testing Backend API Endpoints..." -ForegroundColor Yellow
Write-Host ""

# Test aggregated endpoint
Write-Host "   Testing /api/advanced/all-analysis/NIFTY..." -ForegroundColor Blue
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8000/api/advanced/all-analysis/NIFTY" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    $data = $response.Content | ConvertFrom-Json
    
    if ($response.StatusCode -eq 200) {
        Write-Host "   ✅ Status: 200 - $($data.status)" -ForegroundColor Green
        
        # Count available sections
        $sections = 0
        if ($data.volume_pulse.signal) { $sections++ }
        if ($data.trend_base.signal) { $sections++ }
        if ($data.zone_control.signal) { $sections++ }
        if ($data.candle_intent.signal) { $sections++ }
        
        Write-Host "   → $sections/4 analysis sections available" -ForegroundColor Green
    }
} catch {
    Write-Host "   ❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host "   → Unauthorized: Zerodha token expired!" -ForegroundColor Red
        Write-Host "   Fix: Generate new token" -ForegroundColor Yellow
        Write-Host "   cd backend" -ForegroundColor Blue
        Write-Host "   python get_token.py" -ForegroundColor Blue
    }
}

Write-Host ""

# Test technical analysis endpoint
Write-Host "   Testing /api/analysis/analyze/NIFTY..." -ForegroundColor Blue
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8000/api/analysis/analyze/NIFTY" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    $data = $response.Content | ConvertFrom-Json
    
    if ($response.StatusCode -eq 200) {
        $confidence = [math]::Round($data.confidence * 100)
        Write-Host "   ✅ Status: 200 - Signal: $($data.signal) (Confidence: $confidence%)" -ForegroundColor Green
    }
} catch {
    Write-Host "   ❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Test market data cache
Write-Host "   Testing /ws/cache/NIFTY..." -ForegroundColor Blue
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8000/ws/cache/NIFTY" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    $data = $response.Content | ConvertFrom-Json
    
    if ($response.StatusCode -eq 200 -and $data.data) {
        Write-Host "   ✅ Status: 200 - Price: ₹$($data.data.last_price), PCR: $($data.data.pcr)" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  Status: 200 but no data cached" -ForegroundColor Yellow
        Write-Host "   → WebSocket feed not running?" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   → Market data not cached (WebSocket feed not running?)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "───────────────────────────────────────────────────────────────────────────────" -ForegroundColor Blue
Write-Host ""

# ───────────────────────────────────────────────────────────────────────────────
# STEP 3: Check Redis Status (if running locally)
# ───────────────────────────────────────────────────────────────────────────────
Write-Host "🔍 STEP 3: Checking Redis Status..." -ForegroundColor Yellow
Write-Host ""

$redisProcess = Get-NetTCPConnection -LocalPort 6379 -State Listen -ErrorAction SilentlyContinue
if ($redisProcess) {
    Write-Host "   ✅ Redis: Running on port 6379" -ForegroundColor Green
    
    # Try to ping Redis
    try {
        $redisCliPath = Get-Command redis-cli -ErrorAction Stop
        $redisPing = & redis-cli ping 2>&1
        if ($redisPing -eq "PONG") {
            Write-Host "   → Redis responding correctly" -ForegroundColor Green
        }
    } catch {
        Write-Host "   ⚠️  Redis CLI not found (can't test connection)" -ForegroundColor Yellow
    }
} else {
    Write-Host "   ❌ Redis: NOT RUNNING on port 6379" -ForegroundColor Red
    Write-Host ""
    Write-Host "→ Fix: Start Redis server" -ForegroundColor Yellow
    Write-Host "   If Docker: docker-compose up -d redis" -ForegroundColor Blue
    Write-Host "   If WSL: wsl redis-server" -ForegroundColor Blue
}

Write-Host ""
Write-Host "───────────────────────────────────────────────────────────────────────────────" -ForegroundColor Blue
Write-Host ""

# ───────────────────────────────────────────────────────────────────────────────
# STEP 4: Check Environment Configuration
# ───────────────────────────────────────────────────────────────────────────────
Write-Host "🔍 STEP 4: Checking Environment Configuration..." -ForegroundColor Yellow
Write-Host ""

# Check backend .env
if (Test-Path "backend\.env") {
    $envContent = Get-Content "backend\.env" -Raw
    
    # Check for token
    if ($envContent -match 'ZERODHA_ACCESS_TOKEN=([^\r\n]+)') {
        $token = $matches[1]
        if ($token.Length -gt 20) {
            Write-Host "   ✅ Backend: Token present (length: $($token.Length))" -ForegroundColor Green
        } else {
            Write-Host "   ❌ Backend: Token missing or invalid" -ForegroundColor Red
        }
    } else {
        Write-Host "   ❌ Backend: ZERODHA_ACCESS_TOKEN not found in .env" -ForegroundColor Red
    }
    
    # Check CORS configuration
    if ($envContent -match 'CORS_ORIGINS=([^\r\n]+)') {
        $corsOrigins = $matches[1]
        if ($corsOrigins -match "localhost") {
            Write-Host "   ✅ Backend: CORS includes localhost" -ForegroundColor Green
        } else {
            Write-Host "   ⚠️  Backend: CORS doesn't include localhost" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "   ❌ Backend: .env file not found" -ForegroundColor Red
}

Write-Host ""

# Check frontend .env.local
if (Test-Path "frontend\.env.local") {
    $envContent = Get-Content "frontend\.env.local" -Raw
    
    if ($envContent -match 'NEXT_PUBLIC_API_URL=([^\r\n]+)') {
        $apiUrl = $matches[1]
        Write-Host "   ✅ Frontend: API_URL = $apiUrl" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  Frontend: NEXT_PUBLIC_API_URL not set" -ForegroundColor Yellow
    }
} else {
    Write-Host "   ⚠️  Frontend: .env.local file not found" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "───────────────────────────────────────────────────────────────────────────────" -ForegroundColor Blue
Write-Host ""

# ───────────────────────────────────────────────────────────────────────────────
# STEP 5: Summary & Next Steps
# ───────────────────────────────────────────────────────────────────────────────
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "   📊 DIAGNOSTIC SUMMARY" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Write-Host "💡 NEXT STEPS:" -ForegroundColor Yellow
Write-Host ""

if (-not $backendProcess) {
    Write-Host "   1. Start backend server:" -ForegroundColor Red
    Write-Host "      cd backend" -ForegroundColor Blue
    Write-Host "      .\.venv\Scripts\Activate.ps1" -ForegroundColor Blue
    Write-Host "      python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000" -ForegroundColor Blue
    Write-Host ""
}

if (-not $frontendProcess3000 -and -not $frontendProcess3001) {
    Write-Host "   2. Start frontend server:" -ForegroundColor Red
    Write-Host "      cd frontend" -ForegroundColor Blue
    Write-Host "      npm run dev" -ForegroundColor Blue
    Write-Host ""
}

if (-not $redisProcess) {
    Write-Host "   3. Start Redis:" -ForegroundColor Red
    Write-Host "      docker-compose up -d redis  # If using Docker" -ForegroundColor Blue
    Write-Host "      OR" -ForegroundColor Yellow
    Write-Host "      wsl redis-server  # If using WSL" -ForegroundColor Blue
    Write-Host ""
}

Write-Host "   4. Check browser DevTools Console:" -ForegroundColor Yellow
Write-Host "      - Open https://localhost:3000 or :3001" -ForegroundColor Blue
Write-Host "      - Press F12 → Console tab" -ForegroundColor Blue
Write-Host "      - Look for [OUTLOOK-NIFTY] logs showing data fetching" -ForegroundColor Blue
Write-Host ""

Write-Host "   5. Hard refresh browser to clear cache:" -ForegroundColor Yellow
Write-Host "      - Windows: Ctrl + Shift + R" -ForegroundColor Blue
Write-Host "      - Mac: Cmd + Shift + R" -ForegroundColor Blue
Write-Host ""

Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
