# 🚀 START APPLICATION - Local Development

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  MyDailyTradingSignals - Startup Script" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Get root directory
$rootDir = $PSScriptRoot

# Activate virtual environment
Write-Host "🔧 Activating Python virtual environment..." -ForegroundColor Yellow
& "$rootDir\.venv\Scripts\Activate.ps1"

# Check if backend is already running
$backendRunning = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -and (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue) }
if ($backendRunning) {
    Write-Host "⚠️  Backend already running on port 8000" -ForegroundColor Yellow
} else {
    # Kill any orphaned python processes holding port 8000
    Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    }
    # Start backend in new terminal
    Write-Host "🚀 Starting Backend Server (Port 8000)..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$env:FAST_STARTUP_MODE='true'; `$env:WATCHFILES_FORCE_POLLING='true'; cd '$rootDir\backend'; & '$rootDir\.venv\Scripts\python.exe' -m uvicorn main:app --reload --reload-delay 0.5 --host 127.0.0.1 --port 8000; Write-Host '🟢 Backend Server Starting...' -ForegroundColor Green"
    Start-Sleep -Seconds 3
}

# OpeningEdge read-only global-cue process using the shared Zerodha token.
$openingRunning = Get-NetTCPConnection -LocalPort 8012 -State Listen -ErrorAction SilentlyContinue
if ($openingRunning) {
    Write-Host "OpeningEdge already listening on port 8012; leaving it untouched." -ForegroundColor Yellow
} else {
    Write-Host "Starting independent OpeningEdge (Port 8012)..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$rootDir'; & '$rootDir\.venv\Scripts\python.exe' -m uvicorn openingedge.main:app --host 127.0.0.1 --port 8012 --workers 1"
}

$openingReady = $false
$openingFailure = 'No healthy OpeningEdge response received.'
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8012/health' -TimeoutSec 2
        if ($health.ok -eq $true) {
            $openingReady = $true
            Write-Host "OpeningEdge global-cue worker ready." -ForegroundColor Green
            break
        }
        $openingFailure = 'Port 8012 returned an unexpected service.'
    } catch {
        $openingFailure = $_.Exception.Message
    }
    Start-Sleep -Seconds 1
}
if (-not $openingReady) {
    Write-Error "OpeningEdge startup failed: $openingFailure Check the OpeningEdge terminal."
    exit 1
}

# Check if frontend is already running
$frontendRunning = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($frontendRunning) {
    Write-Host "⚠️  Frontend already running on port 3000" -ForegroundColor Yellow
} else {
    # Start frontend in new terminal
    Write-Host "🚀 Starting Frontend Server (Port 3000)..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$rootDir\frontend'; Write-Host '🟢 Frontend Server Starting (fast mode)...' -ForegroundColor Green; npm run dev:fast -- -p 3000"
    Start-Sleep -Seconds 3
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  ✅ Application Started Successfully!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "📊 Backend:  http://127.0.0.1:8000/docs" -ForegroundColor White
Write-Host "OpeningEdge: http://127.0.0.1:8012/health" -ForegroundColor White
Write-Host "🌐 Frontend: http://localhost:3000" -ForegroundColor White
Write-Host ""
Write-Host "📝 Environment: AUTO-DETECTED (Local)" -ForegroundColor Cyan
Write-Host "📁 Config Files:" -ForegroundColor Cyan
Write-Host "   - backend/.env" -ForegroundColor Gray
Write-Host "   - frontend/.env.local" -ForegroundColor Gray
Write-Host ""
Write-Host "🛑 To stop: Close the terminal windows or press Ctrl+C in each" -ForegroundColor Yellow
Write-Host ""
