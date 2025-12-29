# Complete Backend Startup Script
# Ensures all services are ready

Write-Host "`n" -NoNewline
Write-Host "╔════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   MyDailyTradingSignals - Backend Start   ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$baseDir = "d:\Trainings\GitHub projects\GitClonedProject\mytradingSignal"

# 1. Check virtual environment
Write-Host "[1/5] Checking Python environment..." -ForegroundColor Yellow
if (Test-Path "$baseDir\.venv\Scripts\Activate.ps1") {
    & "$baseDir\.venv\Scripts\Activate.ps1"
    Write-Host "    ✅ Virtual environment activated" -ForegroundColor Green
} else {
    Write-Host "    ⚠️  Virtual environment not found" -ForegroundColor Yellow
}

# 2. Check .env file
Write-Host "`n[2/5] Checking configuration..." -ForegroundColor Yellow
if (Test-Path "$baseDir\backend\.env") {
    Write-Host "    ✅ .env file exists" -ForegroundColor Green
    
    # Check critical variables
    $env = Get-Content "$baseDir\backend\.env" -Raw
    $hasApiKey = $env -match 'ZERODHA_API_KEY=([^\s]+)' -and $Matches[1] -ne 'your_zerodha_api_key_here'
    $hasToken = $env -match 'ZERODHA_ACCESS_TOKEN=([^\s]+)' -and $Matches[1] -ne 'your_access_token_here_after_login'
    
    if ($hasApiKey) {
        Write-Host "    ✅ Zerodha API Key configured" -ForegroundColor Green
    } else {
        Write-Host "    ⚠️  Zerodha API Key missing" -ForegroundColor Yellow
    }
    
    if ($hasToken) {
        Write-Host "    ✅ Zerodha Access Token configured" -ForegroundColor Green
    } else {
        Write-Host "    ⚠️  Zerodha Access Token missing (run: python backend/get_token.py)" -ForegroundColor Yellow
    }
} else {
    Write-Host "    ❌ .env file not found!" -ForegroundColor Red
    Write-Host "    Copy backend/.env.example to backend/.env" -ForegroundColor Yellow
    exit 1
}

# 3. Check if backend is already running
Write-Host "`n[3/5] Checking if backend is already running..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 2 -ErrorAction Stop
    Write-Host "    ⚠️  Backend already running on port 8000" -ForegroundColor Yellow
    Write-Host "    Stop it first (Ctrl+C) or skip this step" -ForegroundColor Gray
    $continue = Read-Host "`n    Continue anyway? (y/n)"
    if ($continue -ne 'y') {
        exit 0
    }
} catch {
    Write-Host "    ✅ Port 8000 is available" -ForegroundColor Green
}

# 4. Navigate to backend directory
Write-Host "`n[4/5] Navigating to backend directory..." -ForegroundColor Yellow
Set-Location "$baseDir\backend"
Write-Host "    ✅ Ready to start" -ForegroundColor Green

# 5. Start backend
Write-Host "`n[5/5] Starting backend server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Backend will start on http://0.0.0.0:8000" -ForegroundColor White
Write-Host "  Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host "════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Start uvicorn
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
