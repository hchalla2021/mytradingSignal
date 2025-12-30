#!/usr/bin/env pwsh
# Fast concurrent startup script for both backend and frontend

Write-Host "🚀 MyDailyTradingSignals - Fast Startup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Continue"

# Check if virtual environment exists
$venvPath = ".venv"
if (-not (Test-Path $venvPath)) {
    Write-Host "❌ Virtual environment not found at $venvPath" -ForegroundColor Red
    Write-Host "   Run: python -m venv .venv" -ForegroundColor Yellow
    exit 1
}

# Check if .env exists
if (-not (Test-Path "backend\.env")) {
    Write-Host "⚠️  Warning: backend\.env not found" -ForegroundColor Yellow
    Write-Host "   Backend may fail without proper configuration" -ForegroundColor Yellow
}

# Check if frontend node_modules exists
if (-not (Test-Path "frontend\node_modules")) {
    Write-Host "⚠️  Warning: frontend\node_modules not found" -ForegroundColor Yellow
    Write-Host "   Run: cd frontend && npm install" -ForegroundColor Yellow
}

Write-Host "🔧 Starting services concurrently..." -ForegroundColor Green
Write-Host ""

# Start Backend in background
Write-Host "📡 Backend: Starting on http://localhost:8000" -ForegroundColor Cyan
$backendJob = Start-Job -ScriptBlock {
    param($rootPath)
    Set-Location $rootPath
    & "$rootPath\.venv\Scripts\Activate.ps1"
    $env:PYTHONUNBUFFERED = "1"
    Set-Location "$rootPath\backend"
    python -m uvicorn main:app --host 0.0.0.0 --port 8000
} -ArgumentList $PWD

# Wait 2 seconds before starting frontend
Start-Sleep -Seconds 2

# Start Frontend in background
Write-Host "🎨 Frontend: Starting on http://localhost:3000" -ForegroundColor Cyan
$frontendJob = Start-Job -ScriptBlock {
    param($rootPath)
    Set-Location "$rootPath\frontend"
    npm run dev
} -ArgumentList $PWD

Write-Host ""
Write-Host "✅ Both services are starting in background..." -ForegroundColor Green
Write-Host ""
Write-Host "📊 Waiting for services to initialize..." -ForegroundColor Yellow

# Monitor both jobs for 15 seconds to show startup progress
$timeout = 15
$elapsed = 0
$backendReady = $false
$frontendReady = $false

while ($elapsed -lt $timeout) {
    Start-Sleep -Seconds 1
    $elapsed++
    
    # Check backend
    if (-not $backendReady) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:8000/health" -TimeoutSec 1 -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                Write-Host "✅ Backend ready! (${elapsed}s)" -ForegroundColor Green
                $backendReady = $true
            }
        } catch {
            # Still starting up
            Write-Host "   Backend: $elapsed/$timeout s..." -ForegroundColor Gray
        }
    }
    
    # Check frontend
    if (-not $frontendReady) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 1 -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                Write-Host "✅ Frontend ready! (${elapsed}s)" -ForegroundColor Green
                $frontendReady = $true
            }
        } catch {
            # Still starting up
        }
    }
    
    # Both ready
    if ($backendReady -and $frontendReady) {
        break
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "🎉 Services Started!" -ForegroundColor Green
Write-Host ""
Write-Host "Backend:  http://localhost:8000" -ForegroundColor Cyan
Write-Host "Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "WebSocket: ws://localhost:8000/ws/market" -ForegroundColor Cyan
Write-Host ""
Write-Host "📝 Logs:" -ForegroundColor Yellow
$backendId = $backendJob.Id
$frontendId = $frontendJob.Id
Write-Host "   Backend:  Get-Job | Where-Object { `$`_.Id -eq $backendId } | Receive-Job -Keep" -ForegroundColor Gray
Write-Host "   Frontend: Get-Job | Where-Object { `$`_.Id -eq $frontendId } | Receive-Job -Keep" -ForegroundColor Gray
Write-Host ""
Write-Host "🛑 To stop: Stop-Job -Id $backendId,$frontendId; Remove-Job -Id $backendId,$frontendId" -ForegroundColor Yellow
Write-Host ""

# Keep script running and show live logs
Write-Host "Press Ctrl+C to stop and show logs..." -ForegroundColor Yellow
Write-Host ""

try {
    # Stream output from both jobs
    while ($true) {
        $backendOutput = Receive-Job -Job $backendJob -Keep
        $frontendOutput = Receive-Job -Job $frontendJob -Keep
        
        if ($backendJob.State -eq "Failed" -or $frontendJob.State -eq "Failed") {
            Write-Host "❌ One or more services failed" -ForegroundColor Red
            break
        }
        
        Start-Sleep -Seconds 2
    }
} finally {
    Write-Host ""
    Write-Host "🛑 Stopping services..." -ForegroundColor Yellow
    Stop-Job -Job $backendJob -ErrorAction SilentlyContinue
    Stop-Job -Job $frontendJob -ErrorAction SilentlyContinue
    
    Write-Host ""
    Write-Host "📋 Backend Output:" -ForegroundColor Cyan
    Receive-Job -Job $backendJob
    
    Write-Host ""
    Write-Host "📋 Frontend Output:" -ForegroundColor Cyan
    Receive-Job -Job $frontendJob
    
    Remove-Job -Job $backendJob -ErrorAction SilentlyContinue
    Remove-Job -Job $frontendJob -ErrorAction SilentlyContinue
    
    Write-Host ""
    Write-Host "👋 Shutdown complete" -ForegroundColor Green
}
