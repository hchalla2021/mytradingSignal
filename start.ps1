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
$backendRunning = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
if ($backendRunning) {
    Write-Host "⚠️  Backend already running on port 8000" -ForegroundColor Yellow
} else {
    # Start backend in new terminal
    Write-Host "🚀 Starting Backend Server (Port 8000)..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$rootDir'; & '.\.venv\Scripts\Activate.ps1'; cd backend; Write-Host '🟢 Backend Server Starting...' -ForegroundColor Green; uvicorn main:app --reload --host 0.0.0.0 --port 8000"
    Start-Sleep -Seconds 3
}

# Check if frontend is already running
$frontendRunning = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($frontendRunning) {
    Write-Host "⚠️  Frontend already running on port 3000" -ForegroundColor Yellow
} else {
    # Start frontend in new terminal
    Write-Host "🚀 Starting Frontend Server (Port 3000)..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$rootDir\frontend'; Write-Host '🟢 Frontend Server Starting...' -ForegroundColor Green; npm run dev -- -p 3000"
    Start-Sleep -Seconds 3
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  ✅ Application Started Successfully!" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "📊 Backend:  http://127.0.0.1:8000/docs" -ForegroundColor White
Write-Host "🌐 Frontend: http://localhost:3000" -ForegroundColor White
Write-Host ""
Write-Host "📝 Environment: AUTO-DETECTED (Local)" -ForegroundColor Cyan
Write-Host "📁 Config Files:" -ForegroundColor Cyan
Write-Host "   - backend/.env" -ForegroundColor Gray
Write-Host "   - frontend/.env.local" -ForegroundColor Gray
Write-Host ""
Write-Host "🛑 To stop: Close the terminal windows or press Ctrl+C in each" -ForegroundColor Yellow
Write-Host ""
