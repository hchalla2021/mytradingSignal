# Simple diagnostic for "0/8 signals" issue
$ErrorActionPreference = "SilentlyContinue"

Write-Host ""
Write-Host "=== DIAGNOSING: 0/8 signals - Limited data Issue ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if servers are running
Write-Host "Step 1: Checking Server Status..." -ForegroundColor Yellow
Write-Host ""

$backend = Get-NetTCPConnection -LocalPort 8000 -State Listen
if ($backend) {
    Write-Host "  Backend: Running on port 8000" -ForegroundColor Green
} else {
    Write-Host "  Backend: NOT RUNNING" -ForegroundColor Red
}

$frontend = Get-NetTCPConnection -LocalPort 3000, 3001 -State Listen
if ($frontend) {
    Write-Host "  Frontend: Running on port $($frontend.LocalPort)" -ForegroundColor Green
} else {
    Write-Host "  Frontend: NOT RUNNING" -ForegroundColor Red
}

Write-Host ""

# Step 2: Test backend APIs
Write-Host "Step 2: Testing Backend APIs..." -ForegroundColor Yellow
Write-Host ""

try {
    Write-Host "  Testing /api/advanced/all-analysis/NIFTY..." -ForegroundColor Blue
    $response = Invoke-RestMethod -Uri "http://localhost:8000/api/advanced/all-analysis/NIFTY" -TimeoutSec 5
    
    if ($response.status -eq "SUCCESS") {
        Write-Host "  SUCCESS: Got data" -ForegroundColor Green
        
        $sections = 0
        if ($response.volume_pulse) { $sections++; Write-Host "    - Volume Pulse: OK" -ForegroundColor Green }
        if ($response.trend_base) { $sections++; Write-Host "    - Trend Base: OK" -ForegroundColor Green }
        if ($response.zone_control) { $sections++; Write-Host "    - Zone Control: OK" -ForegroundColor Green }
        if ($response.candle_intent) { $sections++; Write-Host "    - Candle Intent: OK" -ForegroundColor Green }
        
        Write-Host "  Total: $sections/4 sections available" -ForegroundColor Green
    } else {
        Write-Host "  Status: $($response.status)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

try {
    Write-Host "  Testing /api/analysis/analyze/NIFTY..." -ForegroundColor Blue
    $response = Invoke-RestMethod -Uri "http://localhost:8000/api/analysis/analyze/NIFTY" -TimeoutSec 5
    
    $confidence = [math]::Round($response.confidence * 100)
    Write-Host "  Signal: $($response.signal), Confidence: $confidence%" -ForegroundColor Green
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host "  Token expired! Run: python backend/get_token.py" -ForegroundColor Yellow
    }
}

Write-Host ""

try {
    Write-Host "  Testing /ws/cache/NIFTY..." -ForegroundColor Blue
    $response = Invoke-RestMethod -Uri "http://localhost:8000/ws/cache/NIFTY" -TimeoutSec 5
    
    if ($response.data) {
        Write-Host "  Price: Rs $($response.data.last_price), PCR: $($response.data.pcr)" -ForegroundColor Green
    } else {
        Write-Host "  No cached data (WebSocket not feeding?)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host ""

# Step 3: Check configuration
Write-Host "Step 3: Checking Configuration..." -ForegroundColor Yellow
Write-Host ""

if (Test-Path "backend\.env") {
    $envContent = Get-Content "backend\.env" -Raw
    
    if ($envContent -match 'ZERODHA_ACCESS_TOKEN=(\S+)') {
        $token = $matches[1]
        if ($token.Length -gt 20) {
            Write-Host "  Token: Present (length $($token.Length))" -ForegroundColor Green
        } else {
            Write-Host "  Token: Missing or invalid" -ForegroundColor Red
        }
    }
    
    if ($envContent -match 'CORS_ORIGINS=([^\r\n]+)') {
        $cors = $matches[1]
        if ($cors -match "localhost") {
            Write-Host "  CORS: Includes localhost" -ForegroundColor Green
        } else {
            Write-Host "  CORS: No localhost (may block frontend)" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "  Backend .env: NOT FOUND" -ForegroundColor Red
}

Write-Host ""
Write-Host ""

# Summary
Write-Host "=== SUMMARY ===" -ForegroundColor Cyan
Write-Host ""

if (-not $backend) {
    Write-Host "FIX 1: Start backend" -ForegroundColor Yellow
    Write-Host "  cd backend" -ForegroundColor Blue
    Write-Host "  python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000" -ForegroundColor Blue
    Write-Host ""
}

if (-not $frontend) {
    Write-Host "FIX 2: Start frontend" -ForegroundColor Yellow
    Write-Host "  cd frontend" -ForegroundColor Blue
    Write-Host "  npm run dev" -ForegroundColor Blue
    Write-Host ""
}

Write-Host "After starting servers, open browser DevTools (F12) and check:" -ForegroundColor Yellow
Write-Host "  1. Console tab for [OUTLOOK-NIFTY] logs" -ForegroundColor Blue
Write-Host "  2. Network tab for API requests (should be 200 OK)" -ForegroundColor Blue
Write-Host ""
Write-Host "Hard refresh browser: Ctrl+Shift+R" -ForegroundColor Yellow
Write-Host ""
