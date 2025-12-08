#!/usr/bin/env pwsh
# Development Startup Script
# Starts both backend and frontend servers in background

Write-Host "`nStarting Development Servers..." -ForegroundColor Cyan

# Stop any existing servers
Write-Host "`nStopping existing servers..." -ForegroundColor Yellow
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Start Backend
Write-Host "`nStarting Backend (Port 8001)..." -ForegroundColor Green
$backendPath = Join-Path $PSScriptRoot "backend"
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoExit", "-Command", "cd '$backendPath'; python -m uvicorn app:app --host 0.0.0.0 --port 8001 --reload"

Start-Sleep -Seconds 3

# Start Frontend
Write-Host "Starting Frontend (Port 3000)..." -ForegroundColor Green
$frontendPath = Join-Path $PSScriptRoot "frontend"
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoExit", "-Command", "cd '$frontendPath'; npm run dev"

# Wait for servers to start
Write-Host "`nWaiting for servers to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 8

# Check server status
Write-Host "`nServer Status:" -ForegroundColor Cyan

try {
    $backend = Invoke-RestMethod "http://localhost:8001/health" -TimeoutSec 3
    Write-Host "  [OK] Backend:  http://localhost:8001 - $($backend.status)" -ForegroundColor Green
} catch {
    Write-Host "  [FAIL] Backend:  http://localhost:8001 - Not responding" -ForegroundColor Red
}

try {
    $frontend = Invoke-WebRequest "http://localhost:3000" -UseBasicParsing -TimeoutSec 5
    Write-Host "  [OK] Frontend: http://localhost:3000 - Ready" -ForegroundColor Green
} catch {
    Write-Host "  [WAIT] Frontend: http://localhost:3000 - Starting..." -ForegroundColor Yellow
}

Write-Host "`nAccess your app:" -ForegroundColor Cyan
Write-Host "  Desktop: http://localhost:3000" -ForegroundColor White
Write-Host "  Mobile:  http://192.168.1.13:3000" -ForegroundColor White

Write-Host "`nServers running in background. To stop, run: .\stop-dev.ps1" -ForegroundColor Gray
Write-Host ""
